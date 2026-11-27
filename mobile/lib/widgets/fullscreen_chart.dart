part of 'market_chart.dart';

const _allOrientations = [
  DeviceOrientation.portraitUp,
  DeviceOrientation.landscapeLeft,
  DeviceOrientation.landscapeRight,
];

/// iOS 16+ rejects a geometry request for orientations the view controller
/// does not support yet ("Requested: portrait; Supported: landscapeLeft,
/// landscapeRight") and then does not rotate. Widen the mask to every
/// orientation first, then narrow it to [target].
Future<void> _preferOrientations(List<DeviceOrientation> target) async {
  if (target.length != _allOrientations.length) {
    await SystemChrome.setPreferredOrientations(_allOrientations);
  }
  await SystemChrome.setPreferredOrientations(target);
}

class FullscreenChart extends StatefulWidget {
  const FullscreenChart({
    super.key,
    required this.bars,
    required this.symbol,
    this.name = '',
    required this.unit,
    required this.volumeUnit,
    this.historySource = '',
    required this.events,
    this.trades = const [],
    this.patterns = const [],
    this.initialStudy,
    this.initialProjection,
    this.amount,
    this.amountDate,
  });
  final List<Bar> bars;
  final String symbol, unit, volumeUnit, historySource;
  final String name;
  final List<Json> events, trades, patterns;
  final Json? initialStudy;
  final Json? initialProjection;
  final double? amount;
  final String? amountDate;
  @override
  State<FullscreenChart> createState() => _FullscreenChartState();
}

class _FullscreenChartState extends State<FullscreenChart> {
  /// Keeps the one MarketChart State (zoom, indicators, paged history,
  /// study) across rotations.
  final chartKey = GlobalKey();
  late List<Bar> bars = widget.bars;
  late String historySource = widget.historySource;
  late String volumeUnit = widget.volumeUnit;
  late List<Json> events = widget.events;
  late List<Json> trades = widget.trades;
  late List<Json> patterns = widget.patterns;
  Timer? timer;
  bool loading = false, quoteLoading = false;
  late double? quoteAmount = widget.amount;
  late String? quoteDate = widget.amountDate;
  int refreshTick = 0;
  Timer? orientationRestore;
  bool restoreAutoRotate = false;
  static const autoRotate = _allOrientations;

  /// Rotate button: from portrait it locks landscape (both sides, so the
  /// phone can still be flipped); from landscape it returns to portrait and
  /// then re-enables auto-rotation instead of locking portrait.
  void rotate() {
    orientationRestore?.cancel();
    if (MediaQuery.orientationOf(context) == Orientation.portrait) {
      restoreAutoRotate = false;
      _preferOrientations([
        DeviceOrientation.landscapeLeft,
        DeviceOrientation.landscapeRight,
      ]);
    } else {
      restoreAutoRotate = true;
      _preferOrientations([DeviceOrientation.portraitUp]);
    }
  }

  @override
  void initState() {
    super.initState();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.manual, overlays: []);
    SystemChrome.setPreferredOrientations(autoRotate);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) refreshQuote();
    });
    timer = Timer.periodic(const Duration(seconds: 5), (_) {
      // No polling while the app is in the background.
      if (!mounted || !context.read<AtlasStore>().foreground) return;
      refreshQuote();
      if (++refreshTick % 12 == 0) refresh();
    });
  }

  Future<void> refreshQuote() async {
    if (quoteLoading ||
        !mounted ||
        !supportedStock(widget.symbol) ||
        widget.unit != 'day' ||
        !context.read<AtlasStore>().foreground ||
        !(ModalRoute.of(context)?.isCurrent ?? false)) {
      return;
    }
    quoteLoading = true;
    try {
      final result = await context.read<AtlasStore>().api.get(
        '/api/desk/quotes',
        parameters: {'symbols': widget.symbol},
      );
      final quote = rows(result['items'])
          .where((q) => q['symbol'] == widget.symbol)
          .firstOrNull;
      if (!mounted || quote == null) return;
      final updated = patchDailyQuote(bars, quote, volumeUnit);
      if (!identical(updated, bars)) {
        setState(() {
          bars = updated;
          quoteAmount = numOf(quote['amount']);
          quoteDate = str(quote['asOf'], '').split('T').first;
        });
      }
    } catch (_) {
      /* Keep the last verified candle; background quote failure does not replace the chart. */
    } finally {
      quoteLoading = false;
    }
  }

  Future<void> refresh() async {
    if (loading ||
        !mounted ||
        !context.read<AtlasStore>().foreground ||
        !(ModalRoute.of(context)?.isCurrent ?? false)) {
      return;
    }
    loading = true;
    try {
      final api = context.read<AtlasStore>().api;
      final Json data;
      if (supportedStock(widget.symbol) && widget.unit != 'day') {
        data = await api.get(
          '/api/desk/history',
          parameters: {
            'symbol': widget.symbol,
            'period': widget.unit,
            'study': 'client',
          },
        );
      } else if (supportedStock(widget.symbol)) {
        data = await api.get(
          '/api/analysis',
          parameters: {'symbol': widget.symbol, 'review': '1'},
        );
      } else {
        data = await api.get(
          '/api/market',
          parameters: {'symbol': widget.symbol},
        );
      }
      if (!mounted) return;
      final source = data['market'] == null ? data : obj(data['market']);
      setState(() {
        bars = rows(source['candles']).map(Bar.fromJson).toList();
        historySource = str(
          source['provider'] ?? source['source'],
          historySource,
        );
        volumeUnit = str(
          data['volumeUnit'] ?? source['volumeUnit'],
          historySource.contains('新浪') ||
                  !cnStock(widget.symbol) ||
                  RegExp(r'^68[89]').hasMatch(widget.symbol)
              ? '股'
              : '手',
        );
        if (data['guide'] != null) events = rows(obj(data['guide'])['events']);
        if (data['tradeMarkers'] != null) trades = rows(data['tradeMarkers']);
        if (data['patternMarks'] != null) patterns = rows(data['patternMarks']);
      });
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(tr(context, '刷新失败，保留上一快照'))));
      }
    } finally {
      loading = false;
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    orientationRestore?.cancel();
    SystemChrome.setEnabledSystemUIMode(
      SystemUiMode.manual,
      overlays: SystemUiOverlay.values,
    );
    // Back to the app's portrait-only mask; widened first so the request is
    // valid while a landscape lock is active.
    _preferOrientations([DeviceOrientation.portraitUp]);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: LayoutBuilder(
        builder: (context, c) {
          final portrait =
              MediaQuery.orientationOf(context) == Orientation.portrait;
          if (portrait && restoreAutoRotate) {
            restoreAutoRotate = false;
            orientationRestore?.cancel();
            orientationRestore = Timer(
              const Duration(milliseconds: 800),
              () => SystemChrome.setPreferredOrientations(autoRotate),
            );
          }
          final chart = MarketChart(
            key: chartKey,
            bars: bars,
            amount: quoteAmount,
            amountDate: quoteDate,
            symbol: widget.symbol,
            name: widget.name,
            unit: widget.unit,
            volumeUnit: volumeUnit,
            historySource: historySource,
            events: events,
            trades: trades,
            patterns: patterns,
            initialStudy: widget.initialStudy,
            initialProjection: widget.initialProjection,
            expanded: true,
            terminal: portrait,
            viewportHeight: c.maxHeight,
          );
          // Same wrapper in both orientations so rotation never rebuilds the
          // chart State; portrait simply does not scroll.
          return SingleChildScrollView(
            physics: portrait ? const NeverScrollableScrollPhysics() : null,
            child: chart,
          );
        },
      ),
    ),
  );
}
