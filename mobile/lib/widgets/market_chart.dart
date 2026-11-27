export 'intraday_chart.dart';
export 'chart_painter.dart';

import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/chart_history.dart';
import '../core/chart_labels.dart';
import '../core/chart_marks.dart';
import '../core/chart_viewport.dart';
import '../core/indicators.dart';
import '../core/patch_daily_quote.dart';
import '../core/store.dart';
import 'chart_painter.dart';
import 'common.dart';

part 'fullscreen_chart.dart';
part 'chart_gestures.dart';

class MarketChart extends StatefulWidget {
  const MarketChart({
    super.key,
    required this.bars,
    required this.symbol,
    this.amount,
    this.amountDate,
    this.unit = 'day',
    this.name = '',
    this.terminal = false,
    this.viewportHeight,
    this.volumeUnit = '手',
    this.historySource = '',
    this.events = const [],
    this.trades = const [],
    this.patterns = const [],
    this.expanded = false,
    this.initialStudy,
    this.onLiveAlerts,
    this.initialProjection,
  });
  final List<Bar> bars;
  final String symbol, unit, volumeUnit, historySource;
  final String name;
  final List<Json> events, trades, patterns;
  final Json? initialStudy;
  final ValueChanged<List<Json>>? onLiveAlerts;
  final Json? initialProjection;
  final bool expanded;
  final bool terminal;
  final double? amount;
  final String? amountDate;
  final double? viewportHeight;
  @override
  State<MarketChart> createState() => _MarketChartState();
}

/// Keeps a chart (viewport, paged history, study) alive while its list item
/// is scrolled out of view.
class ChartKeepAlive extends StatefulWidget {
  const ChartKeepAlive({super.key, required this.child});
  final Widget child;
  @override
  State<ChartKeepAlive> createState() => _ChartKeepAliveState();
}

class _ChartKeepAliveState extends State<ChartKeepAlive>
    with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;
  @override
  Widget build(BuildContext context) {
    super.build(context);
    return widget.child;
  }
}

class _MarketChartState extends State<MarketChart> {
  late List<Bar> bars;
  late IndicatorData indicators;
  late int barsHash;
  bool historyBusy = false, historyMore = true;
  String? historyError;
  int historyRequest = 0;
  bool get historyEnabled =>
      supportedStock(widget.symbol) &&
      ['day', 'week', 'month'].contains(widget.unit);
  Future<void> loadOlder() async {
    if (!historyEnabled || historyBusy || !historyMore || bars.isEmpty) return;
    final request = ++historyRequest, before = bars.first.time;
    final store = context.read<AtlasStore>();
    setState(() {
      historyBusy = true;
      historyError = null;
    });
    try {
      final page = await store.api.get(
        '/api/desk/history',
        parameters: {
          'symbol': widget.symbol,
          'period': widget.unit,
          'before': before,
          'basis': historyBasisFor(widget.historySource, widget.symbol),
        },
      );
      if (!mounted || request != historyRequest) return;
      final merged = mergeChartHistory(
            bars,
            page,
            volumeUnit: widget.volumeUnit,
          ),
          added = merged.length - bars.length;
      setState(() {
        setBars(merged, structural: true);
        viewport.length = bars.length;
        if (hover != null) hover = hover! + added;
        historyMore = page['hasMore'] == true;
      });
      viewChanged();
      scheduleStudy();
    } catch (e) {
      if (mounted && request == historyRequest) {
        setState(() => historyError = '$e');
      }
    } finally {
      if (mounted && request == historyRequest) {
        setState(() => historyBusy = false);
      }
    }
  }

  void maybeLoadOlder() {
    if (start < 24 && historyError == null) loadOlder();
  }

  List<MaLine> mas = List.of(defaultMa);
  final viewport = ChartViewport();

  /// Bumped whenever the viewport moves; only the canvas, legend and
  /// readouts listen, so pans and pinches do not rebuild the toolbar.
  final view = ValueNotifier<int>(0);

  /// Crosshair selection; scrubbing repaints only the crosshair layer.
  final selection = ValueNotifier<ChartSelection>((
    hover: null,
    forecast: null,
  ));
  int? get hover => selection.value.hover;
  set hover(int? v) =>
      selection.value = (hover: v, forecast: selection.value.forecast);
  int? get forecastHover => selection.value.forecast;
  set forecastHover(int? v) =>
      selection.value = (hover: selection.value.hover, forecast: v);
  bool _atLatest = true;

  /// Notifies viewport listeners; rebuilds everything only when the chart
  /// leaves or returns to the newest candle (projection, "回到最新").
  void viewChanged() {
    view.value++;
    final latest = viewport.offset == 0;
    if (latest != _atLatest) {
      _atLatest = latest;
      if (mounted) setState(() {});
    }
  }

  int get count => viewport.count;
  set count(int v) => viewport.count = v;
  int get offset => viewport.offset;
  set offset(int v) => viewport.offset = v;
  DateTime hapticAt = DateTime.fromMillisecondsSinceEpoch(0);
  bool get compact =>
      widget.expanded &&
      MediaQuery.sizeOf(context).width > MediaQuery.sizeOf(context).height;
  String paneMode = 'macd', overlay = 'MA';
  bool rsi = false;
  List<Json> studyTrades = [],
      studyPatterns = [],
      studyIndicators = [],
      studyRegimes = [];
  int studyRequest = 0;
  String studyKey = '', studyParams = '', studyStatus = '标注依据当前MA · 核验中';
  bool projectionOn = false, projectionBusy = false, projectionQueued = false;
  int projectionHorizon = 10, projectionRequest = 0;
  String projectionKey = '', projectionFor = '', projectionScenario = 'base';
  IndicatorData? forecastCache;
  (Json?, String, List<Bar>, List<MaLine>)? _forecastFor;
  IndicatorData? get forecastData {
    if (!drawProjection) return null;
    final f = _forecastFor;
    if (f == null ||
        !identical(f.$1, projection) ||
        f.$2 != projectionScenario ||
        !identical(f.$3, bars) ||
        !identical(f.$4, mas)) {
      final branch = rows(projection?['scenarios'])
          .where((r) => r['id'] == projectionScenario)
          .firstOrNull;
      final futureBars = rows(branch?['candles']).map(Bar.fromJson).toList();
      forecastCache = futureBars.isEmpty
          ? null
          : IndicatorData([...bars, ...futureBars], mas);
      _forecastFor = (projection, projectionScenario, bars, mas);
    }
    return forecastCache;
  }

  Json? projection;
  String? projectionError;

  /// Candle structure a projection was computed for. Live ticks of the last
  /// candle (and a horizon change, until its result arrives) keep it drawn;
  /// paging history, a new candle date or other MAs invalidate it.
  String get projectionFrame =>
      '$currentStudyParams|${bars.length}|${bars.firstOrNull?.time}|${bars.lastOrNull?.time}';
  bool get drawProjection =>
      projectionOn &&
      projection?['available'] == true &&
      offset == 0 &&
      projectionFor == projectionFrame;
  List<Json> get candlePayload => bars
      .map(
        (b) => {
          'time': b.time,
          'open': b.open,
          'high': b.high,
          'low': b.low,
          'close': b.close,
          'volume': b.volume,
        },
      )
      .toList();
  Future<void> refreshProjection() async {
    if (!mounted || !projectionOn || bars.isEmpty) return;
    final key = '$currentStudyKey:$projectionHorizon', frame = projectionFrame;
    if (projectionBusy) {
      projectionQueued = true;
      return;
    }
    if (projectionKey == key) return;
    projectionBusy = true;
    final request = ++projectionRequest;
    try {
      final result = await context.read<AtlasStore>().chartStudies.compute({
        'task': 'projection',
        'unit': widget.unit,
        'symbol': widget.symbol,
        'ma': periods,
        'horizon': projectionHorizon,
        'candles': candlePayload,
      });
      if (mounted && request == projectionRequest && frame == projectionFrame) {
        setState(() {
          projection = obj(result['projection']);
          projectionError = null;
          projectionKey = key;
          projectionFor = frame;
        });
      }
    } catch (e) {
      if (mounted && request == projectionRequest) {
        setState(() {
          projectionError = '$e';
          projectionKey = key;
        });
      }
    } finally {
      projectionBusy = false;
      if (mounted &&
          projectionOn &&
          (projectionQueued ||
              projectionKey != '$currentStudyKey:$projectionHorizon')) {
        projectionQueued = false;
        scheduleStudy(live: projectionFor == projectionFrame);
      }
    }
  }

  Future<void> projectionSettings() async {
    if (!projectionOn) {
      setState(() => projectionOn = true);
      await refreshProjection();
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      constraints: BoxConstraints(
        maxWidth: 640,
        maxHeight: MediaQuery.sizeOf(context).height * .60,
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) => Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 8, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      tr(ctx, '推演设置'),
                      style: Theme.of(ctx).textTheme.titleMedium,
                    ),
                  ),
                  IconButton(
                    tooltip: tr(ctx, '关闭'),
                    onPressed: () => Navigator.pop(ctx),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              tr(ctx, '行情推演'),
                              style: Theme.of(ctx).textTheme.titleLarge,
                            ),
                          ),
                          Switch(
                            value: projectionOn,
                            onChanged: (v) async {
                              setState(() => projectionOn = v);
                              update(() {});
                              if (!v) return;
                              await refreshProjection();
                              if (ctx.mounted) update(() {});
                            },
                          ),
                        ],
                      ),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final n in [5, 10, 15, 20])
                            ChoiceChip(
                              label: Text(
                                widget.unit == 'day'
                                    ? '约${n ~/ 5}周'
                                    : '$n 根${widget.unit}K',
                              ),
                              selected: projectionHorizon == n,
                              onSelected: (_) async {
                                setState(() => projectionHorizon = n);
                                update(() {});
                                await refreshProjection();
                                // The sheet may have been closed meanwhile.
                                if (ctx.mounted) update(() {});
                              },
                            ),
                        ],
                      ),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final entry in [
                            ('base', '基准'),
                            ('bull', '偏强'),
                            ('bear', '偏弱'),
                          ])
                            ChoiceChip(
                              label: Text(tr(ctx, entry.$2)),
                              selected: projectionScenario == entry.$1,
                              onSelected: (_) {
                                setState(() => projectionScenario = entry.$1);
                                update(() {});
                              },
                            ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(tr(ctx, '虚线为条件情景，不是实盘或确定预测；随最新量价和MA重新计算。')),
                      if (projectionError != null)
                        Text(tr(ctx, projectionError!)),
                      if (projection != null) ...[
                        Text(
                          '${str(projection!['asOf'])} · ${projection!['model'] == 'analogs' ? tr(ctx, '历史相似窗口 ${projection!['sampleCount']} 段') : tr(ctx, '样本不足 · 近期量价片段重采样')}',
                          style: TextStyle(color: muted, fontSize: 12),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          tr(ctx, str(obj(projection!['basis'])['regime'])),
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        for (final fact
                            in obj(projection!['basis'])['facts'] as List? ??
                                [])
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              tr(ctx, str(fact)),
                              style: const TextStyle(height: 1.5),
                            ),
                          ),
                        for (final scenario in rows(
                          projection!['scenarios'],
                        ).where((s) => s['id'] == projectionScenario))
                          Padding(
                            padding: const EdgeInsets.only(top: 10),
                            child: Text(
                              '${tr(ctx, '本条路径依据：')}${tr(ctx, str(scenario['explanation']))}',
                              style: const TextStyle(height: 1.6),
                            ),
                          ),
                        for (final r in rows(projection!['conditions']))
                          Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: Text(
                              tr(ctx, str(r['text'])),
                              style: TextStyle(
                                height: 1.6,
                                color: r['side'] == 'bull'
                                    ? up
                                    : r['side'] == 'bear'
                                    ? down
                                    : ink,
                              ),
                            ),
                          ),
                        for (final text
                            in obj(projection!['basis'])['limitations']
                                    as List? ??
                                [])
                          Padding(
                            padding: const EdgeInsets.only(top: 10),
                            child: Text(
                              tr(ctx, str(text)),
                              style: TextStyle(color: muted, fontSize: 12),
                            ),
                          ),
                        const SizedBox(height: 14),
                        Text(
                          tr(ctx, str(projection!['notice'])),
                          style: TextStyle(color: muted, fontSize: 12),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  bool volume = true, macd = true, kdj = true, markers = true;
  bool shapeMarkers = true, crossMarkers = false, indicatorLabels = true;
  Timer? studyRetry, studyThrottle;
  int studyRetries = 0;
  bool studyBusy = false, studyQueued = false, studyFailed = false;
  bool studyReady = false;
  DateTime studyAt = DateTime.fromMillisecondsSinceEpoch(0);

  /// Live ticks of the last candle refresh annotations at most this often;
  /// a new candle date, paging or a parameter change refreshes at once.
  static const liveStudyInterval = Duration(seconds: 45);
  final Map<int, Offset> pointers = {};
  double? pinchDistance;

  void loadPreferences() {
    final prefs = context.read<AtlasStore>().prefs;
    try {
      final a = obj(
        jsonDecode(prefs.getString('chart.annotations.v1') ?? '{}'),
      );
      markers = a['trades'] != false;
      shapeMarkers = a['shapes'] != false;
      indicatorLabels = a['indicators'] != false;
      crossMarkers = a['crosses'] == true;
    } catch (_) {}
    final raw = prefs.getString('ma');
    try {
      if (raw != null) {
        final saved = rows(jsonDecode(raw)).map(MaLine.fromJson).toList();
        if (saved.length == 8 &&
            saved.every((m) => m.period >= 1 && m.period <= 500) &&
            saved.where((m) => m.enabled).map((m) => m.period).toSet().length ==
                saved.where((m) => m.enabled).length) {
          mas = saved;
        }
      }
    } catch (_) {}
  }

  @override
  void initState() {
    super.initState();
    loadPreferences();
    setBars(widget.bars, structural: true);
    viewport.reset(defaultChartBarCount(widget.unit));
    projection = widget.initialProjection;
    projectionScenario = str(projection?['selectedScenario'], 'base');
    projectionOn = projection != null;
    projectionHorizon = (numOf(projection?['horizon']) ?? 10).toInt();
    viewport.length = bars.length;
    // The handed-over projection belongs to these candles; keep drawing it
    // while it is recomputed.
    if (projection != null) projectionFor = projectionFrame;
    acceptInitialStudy();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) refreshAll();
    });
  }

  /// Replaces the candles and their indicators; [structural] is false when
  /// only the last candle's values changed (live tick).
  void setBars(List<Bar> next, {required bool structural}) {
    indicators = structural || bars.isEmpty
        ? IndicatorData(next, mas)
        : IndicatorData.updateLast(indicators, next);
    bars = next;
    barsHash = Object.hashAll(
      next.map(
        (b) => Object.hash(b.time, b.open, b.high, b.low, b.close, b.volume),
      ),
    );
  }

  /// Guide events, kept by reference while the parent rebuilds an equal list
  /// (so marks are not re-resolved and the canvas not repainted every tick).
  late List<Json> events = widget.events;

  @override
  void didUpdateWidget(covariant MarketChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(widget.events, events) &&
        (widget.events.length != events.length ||
            jsonEncode(widget.events) != jsonEncode(events))) {
      events = widget.events;
    }
    final identityChanged =
        oldWidget.symbol != widget.symbol ||
        oldWidget.unit != widget.unit ||
        oldWidget.volumeUnit != widget.volumeUnit ||
        historyBasisFor(oldWidget.historySource, oldWidget.symbol) !=
            historyBasisFor(widget.historySource, widget.symbol);
    if (identityChanged || !identical(oldWidget.bars, widget.bars)) {
      acceptBars(identityChanged);
    }
    if (oldWidget.initialStudy != widget.initialStudy) acceptInitialStudy();
    if (oldWidget.amount != widget.amount ||
        oldWidget.amountDate != widget.amountDate) {
      scheduleStudy(live: true);
    }
  }

  void acceptBars(bool identityChanged) {
    final oldBars = bars;
    final first = widget.bars.firstOrNull;
    final anchor = first == null
        ? null
        : oldBars.where((b) => b.time == first.time).firstOrNull;
    final basisChanged =
        first != null &&
        anchor != null &&
        first.time != widget.bars.last.time &&
        (first.close - anchor.close).abs() > .011 + first.close.abs() * .0002;
    final List<Bar> next;
    final bool structural;
    if (identityChanged || basisChanged) {
      historyRequest++;
      historyBusy = false;
      historyMore = true;
      historyError = null;
      next = widget.bars;
      structural = true;
    } else {
      next = mergeLatestBars(oldBars, widget.bars);
      // Same candles in a new list (e.g. a parent rebuild): nothing to do.
      if (sameBars(next, oldBars)) return;
      structural = !onlyLastBarChanged(oldBars, next);
    }
    if (!structural) {
      // Only the live candle moved: recompute its indicators, keep the view.
      setBars(next, structural: false);
      scheduleStudy(live: true);
      return;
    }
    final rightDate = oldBars.isEmpty
        ? null
        : oldBars[(oldBars.length - offset - 1).clamp(0, oldBars.length - 1)]
              .time;
    final selectedDate = hover == null || oldBars.isEmpty
        ? null
        : oldBars[hover!.clamp(0, oldBars.length - 1)].time;
    setBars(next, structural: true);
    if (identityChanged || basisChanged) {
      viewport.reset(defaultChartBarCount(widget.unit));
    }
    viewport.length = bars.length;
    if (!identityChanged && !basisChanged && offset > 0 && rightDate != null) {
      final index = indicators.indexOf(rightDate);
      if (index != null) offset = bars.length - index - 1;
    }
    offset = offset.clamp(0, math.max(0, bars.length - 1));
    _atLatest = offset == 0;
    selection.value = (hover: indicators.indexOf(selectedDate), forecast: null);
    scheduleStudy();
  }

  @override
  void dispose() {
    studyRetry?.cancel();
    studyThrottle?.cancel();
    view.dispose();
    selection.dispose();
    super.dispose();
  }

  int get end => viewport.end;
  int get start => viewport.start;

  /// Index of the readout candle (a future index while projecting).
  int get readoutIndex {
    final f = forecastData;
    if (f != null && forecastHover != null && forecastHover! < f.bars.length) {
      return forecastHover!;
    }
    return (hover ?? (end - 1)).clamp(0, bars.length - 1);
  }

  IndicatorData get readoutData {
    final f = forecastData;
    return f != null && forecastHover != null ? f : indicators;
  }

  Bar get current => readoutData.bars[readoutIndex];
  void range(int days) {
    viewport.reset(days);
    selection.value = (hover: null, forecast: null);
    viewChanged();
    setState(() {});
  }

  Future<Color?> customColor(BuildContext context, Color initial) async {
    final controller = TextEditingController(
      text:
          '#${initial.toARGB32().toRadixString(16).substring(2).toUpperCase()}',
    );
    String? error;
    ModalRoute<dynamic>? editorRoute;
    final result = await showDialog<Color>(
      context: context,
      builder: (ctx) {
        editorRoute = ModalRoute.of(ctx);
        return StatefulBuilder(
          builder: (ctx, update) => AlertDialog(
            scrollable: true,
            title: Text(tr(ctx, '自定义颜色')),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: controller,
                  maxLength: 7,
                  autocorrect: false,
                  textCapitalization: TextCapitalization.characters,
                  decoration: InputDecoration(
                    labelText: 'HEX',
                    hintText: '#RRGGBB',
                    errorText: error,
                  ),
                ),
                Wrap(
                  spacing: 8,
                  children: defaultMa
                      .map(
                        (m) => IconButton(
                          onPressed: () => controller.text =
                              '#${m.color.toARGB32().toRadixString(16).substring(2).toUpperCase()}',
                          icon: Icon(Icons.circle, color: m.color),
                        ),
                      )
                      .toList(),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: Text(tr(ctx, '取消')),
              ),
              FilledButton(
                onPressed: () {
                  final value = controller.text.trim();
                  if (!RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(value)) {
                    update(() => error = tr(ctx, '请输入 #RRGGBB 色值'));
                    return;
                  }
                  Navigator.pop(
                    ctx,
                    Color(int.parse('FF${value.substring(1)}', radix: 16)),
                  );
                },
                child: Text(tr(ctx, '应用参数')),
              ),
            ],
          ),
        );
      },
    );
    await editorRoute?.completed;
    controller.dispose();
    return result;
  }

  Future<void> settings() async {
    final periods = mas
            .map((m) => TextEditingController(text: '${m.period}'))
            .toList(),
        enabled = mas.map((m) => m.enabled).toList(),
        colors = mas.map((m) => m.color).toList();
    String? error;
    ModalRoute<dynamic>? editorRoute;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) {
        editorRoute = ModalRoute.of(ctx);
        return StatefulBuilder(
          builder: (ctx, update) => Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              18,
              20,
              math.max(0, MediaQuery.viewInsetsOf(ctx).bottom) + 22,
            ),
            child: SingleChildScrollView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    tr(ctx, '均线参数'),
                    style: Theme.of(ctx).textTheme.titleLarge,
                  ),
                  OutlinedButton.icon(
                    onPressed: annotationSettings,
                    icon: const Icon(Icons.sell_outlined, size: 16),
                    label: Text(tr(ctx, '标注设置')),
                  ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final spec in [
                        ('经典', [5, 13, 20, 30, 60, 120, 144, 250]),
                        ('斐波那契', [5, 13, 21, 34, 55, 89, 144, 233]),
                      ])
                        TextButton(
                          onPressed: () => update(() {
                            for (var k = 0; k < 8; k++) {
                              periods[k].text = '${spec.$2[k]}';
                              enabled[k] = true;
                            }
                          }),
                          child: Text(spec.$1),
                        ),
                    ],
                  ),
                  ...List.generate(
                    8,
                    (i) => Row(
                      children: [
                        Checkbox(
                          value: enabled[i],
                          onChanged: (v) => update(() => enabled[i] = v!),
                        ),
                        SizedBox(width: 38, child: Text('MA${i + 1}')),
                        Expanded(
                          child: TextField(
                            controller: periods[i],
                            keyboardType: TextInputType.number,
                            decoration: InputDecoration(
                              labelText: tr(ctx, '周期'),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        DropdownButton<Color>(
                          menuMaxHeight: compactMenuHeight(context),
                          value: colors[i],
                          items: {...defaultMa.map((m) => m.color), colors[i]}
                              .map(
                                (color) => DropdownMenuItem(
                                  value: color,
                                  child: Container(
                                    width: 30,
                                    height: 12,
                                    color: color,
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: (c) => update(() => colors[i] = c!),
                        ),
                        IconButton(
                          tooltip: tr(ctx, '自定义颜色'),
                          icon: const Icon(Icons.palette_outlined),
                          onPressed: () async {
                            final color = await customColor(ctx, colors[i]);
                            if (color != null && ctx.mounted) {
                              update(() => colors[i] = color);
                            }
                          },
                        ),
                      ],
                    ),
                  ),
                  if (error != null) Text(error!, style: TextStyle(color: up)),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      TextButton(
                        onPressed: () => update(() {
                          for (var i = 0; i < 8; i++) {
                            periods[i].text = '${defaultMa[i].period}';
                            enabled[i] = true;
                            colors[i] = defaultMa[i].color;
                          }
                        }),
                        child: Text(tr(ctx, '恢复默认')),
                      ),
                      const Spacer(),
                      FilledButton(
                        onPressed: () {
                          final values = periods
                              .map((c) => int.tryParse(c.text))
                              .toList();
                          if (values.any(
                                (v) => v == null || v < 1 || v > 500,
                              ) ||
                              values.indexed
                                      .where((r) => enabled[r.$1])
                                      .map((r) => r.$2)
                                      .toSet()
                                      .length !=
                                  enabled.where((v) => v).length) {
                            update(
                              () =>
                                  error = tr(ctx, '周期须为 1–500 的整数，已启用的周期不能重复。'),
                            );
                            return;
                          }
                          setState(() {
                            mas = List.generate(
                              8,
                              (i) => MaLine(values[i]!, colors[i], enabled[i]),
                            );
                            indicators = IndicatorData(bars, mas);
                          });
                          scheduleStudy();
                          context.read<AtlasStore>().prefs.setString(
                            'ma',
                            jsonEncode(mas.map((m) => m.toJson()).toList()),
                          );
                          context.read<AtlasStore>().chartRevision.value++;
                          Navigator.pop(ctx);
                        },
                        child: Text(tr(ctx, '应用参数')),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
    await editorRoute?.completed;
    for (final c in periods) {
      c.dispose();
    }
  }

  void selectAt(Offset p, double width) {
    final future = drawProjection ? rows(projection!['points']).length : 0;
    final virtual =
        start +
        (ChartPlot.fraction(p.dx, width) * (end - start + future)).floor();
    if (future > 0 && virtual >= end) {
      forecastHover = virtual.clamp(end, end + future - 1);
      return;
    }
    final i = viewport.select(
      ChartPlot.fraction(p.dx, width) *
          (end - start + future) /
          math.max(1, end - start),
    );
    if (i != hover &&
        DateTime.now().difference(hapticAt).inMilliseconds >= 80) {
      hapticAt = DateTime.now();
      HapticFeedback.selectionClick();
    }
    selection.value = (hover: i, forecast: null);
  }

  Future<void> expand() async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        // A modal fullscreen route has no iOS edge back-swipe, so panning
        // towards older candles from the left edge cannot dismiss it; it
        // closes with its own close button.
        fullscreenDialog: true,
        builder: (_) => FullscreenChart(
          bars: bars,
          symbol: widget.symbol,
          name: widget.name,
          unit: widget.unit,
          volumeUnit: widget.volumeUnit,
          historySource: widget.historySource,
          events: widget.events,
          trades: widget.trades,
          patterns: widget.patterns,
          initialProjection: drawProjection
              ? {...projection!, 'selectedScenario': projectionScenario}
              : null,
          initialStudy: studyReady
              ? {
                  'tradeMarkers': studyTrades,
                  'patternMarks': studyPatterns,
                  'indicatorMarks': studyIndicators,
                  'trendRegimes': studyRegimes,
                  'verification': {
                    'symbol': widget.symbol,
                    'unit': widget.unit,
                    'maPeriods': periods,
                    'candleCount': bars.length,
                    'last': {
                      'time': bars.last.time,
                      'open': bars.last.open,
                      'high': bars.last.high,
                      'low': bars.last.low,
                      'close': bars.last.close,
                      'volume': bars.last.volume,
                    },
                  },
                }
              : null,
          amount: widget.amount,
          amountDate: widget.amountDate,
        ),
      ),
    );
    if (!mounted) return;
    final before = mas;
    loadPreferences();
    setState(() {
      if (!identical(before, mas)) indicators = IndicatorData(bars, mas);
    });
    scheduleStudy();
  }

  List<int> get periods =>
      mas.where((m) => m.enabled).map((m) => m.period).toList();
  String get currentStudyParams => '${widget.symbol}|${widget.unit}|$periods';
  double? get studyAmount =>
      bars.isNotEmpty && widget.amountDate == bars.last.time
      ? widget.amount
      : null;
  String get currentStudyKey =>
      '$currentStudyParams|$studyAmount|${bars.length}|$barsHash';
  String get studyStructure =>
      '$currentStudyParams|${bars.length}|${bars.firstOrNull?.time}|${bars.lastOrNull?.time}';

  void acceptInitialStudy() {
    final seed = widget.initialStudy;
    if (seed == null || bars.isEmpty) return;
    final verification = obj(seed['verification']),
        last = obj(verification['last']),
        bar = bars.last;
    final periods = this.periods..sort();
    final verifiedPeriods =
        (verification['maPeriods'] as List? ?? [])
            .map((p) => numOf(p)?.toInt())
            .toList()
          ..sort((a, b) => (a ?? 0).compareTo(b ?? 0));
    if (verification['symbol'] != widget.symbol ||
        verification['unit'] != widget.unit ||
        verification['candleCount'] != bars.length ||
        jsonEncode(periods) != jsonEncode(verifiedPeriods) ||
        last['time'] != bar.time ||
        numOf(last['open']) != bar.open ||
        numOf(last['high']) != bar.high ||
        numOf(last['low']) != bar.low ||
        numOf(last['close']) != bar.close ||
        numOf(last['volume']) != bar.volume) {
      return;
    }
    studyTrades = rows(seed['tradeMarkers']);
    studyPatterns = rows(seed['patternMarks']);
    studyIndicators = rows(seed['indicatorMarks']);
    studyRegimes = rows(seed['trendRegimes']);
    final alerts = rows(seed['liveAlerts']);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onLiveAlerts?.call(alerts);
    });
    studyKey = currentStudyKey;
    studyParams = currentStudyParams;
    studyAt = DateTime.now();
    studyReady = true;
    studyFailed = false;
    studyStatus = 'K线与标注 · 同步快照';
  }

  void refreshAll() {
    refreshStudy();
    refreshProjection();
  }

  /// Data-driven refresh of annotations and projection. Live ticks ([live])
  /// are throttled to [liveStudyInterval]; the trailing state is always
  /// computed.
  void scheduleStudy({bool live = false}) {
    if (!mounted || bars.isEmpty) return;
    studyThrottle?.cancel();
    final wait = live
        ? liveStudyInterval - DateTime.now().difference(studyAt)
        : Duration.zero;
    if (wait > Duration.zero) {
      studyThrottle = Timer(wait, () {
        if (mounted) refreshAll();
      });
      return;
    }
    scheduleMicrotask(() {
      if (mounted) refreshAll();
    });
  }

  Future<void> refreshStudy({bool retry = false}) async {
    if (!mounted || bars.isEmpty) return;
    final key = currentStudyKey,
        params = currentStudyParams,
        structure = studyStructure;
    if (studyBusy) {
      studyQueued = true;
      return;
    }
    if (studyKey == key && !retry) return;
    if (studyKey != key) {
      studyRetries = 0;
      studyRetry?.cancel();
    }
    studyBusy = true;
    final sameParameters = studyParams == params;
    studyKey = key;
    studyParams = params;
    final request = ++studyRequest;
    final periods = this.periods;
    // Keep the current marks (same parameters) until the new result swaps
    // them in; only a parameter change hides marks computed for other MAs.
    if (!sameParameters || studyFailed) {
      setState(() {
        if (!sameParameters) {
          studyReady = false;
          studyTrades = [];
          studyPatterns = [];
          studyIndicators = [];
          studyRegimes = [];
        }
        studyFailed = false;
        studyStatus = '标注依据当前MA · 核验中';
      });
    }
    try {
      final result = await context.read<AtlasStore>().chartStudies.compute({
        'symbol': widget.symbol,
        'name': widget.name,
        'unit': widget.unit,
        'ma': periods,
        'amount': studyAmount,
        'candles': candlePayload,
      });
      // A result for the same candle structure is still valid when only the
      // live candle moved meanwhile; a follow-up is scheduled below.
      if (!mounted ||
          request != studyRequest ||
          params != currentStudyParams ||
          structure != studyStructure) {
        return;
      }
      studyAt = DateTime.now();
      setState(() {
        studyReady = true;
        studyFailed = false;
        studyTrades = rows(result['tradeMarkers']);
        studyPatterns = rows(result['patternMarks']);
        studyIndicators = rows(result['indicatorMarks']);
        studyRegimes = rows(result['trendRegimes']);
        studyStatus = '当前 MA${periods.join('/')} · 形态量价 v4';
      });
      widget.onLiveAlerts?.call(rows(result['liveAlerts']));
    } catch (_) {
      if (mounted && request == studyRequest && key == currentStudyKey) {
        setState(() {
          studyFailed = true;
          studyStatus = '标注更新失败 · 保留历史标注，可点此重试';
        });
        if (studyRetries < 2) {
          studyRetries++;
          studyRetry?.cancel();
          studyRetry = Timer(Duration(seconds: studyRetries == 1 ? 5 : 20), () {
            if (mounted) refreshStudy(retry: true);
          });
        }
      }
    } finally {
      studyBusy = false;
      if (mounted && (studyQueued || studyKey != currentStudyKey)) {
        studyQueued = false;
        if (!studyFailed) scheduleStudy(live: structure == studyStructure);
      }
    }
  }

  void retryStudy() {
    studyKey = '';
    studyRetries = 0;
    studyRetry?.cancel();
    refreshStudy(retry: true);
  }

  (Object?, Object?, Object?, Object?, Object?)? _marksFor;
  ChartMarks _marks = ChartMarks.empty;

  /// Study and guide marks resolved to candle indices, rebuilt only when the
  /// candle index or a mark list changes.
  ChartMarks get chartMarks {
    final key = (
      indicators.timeIndex,
      studyTrades,
      studyPatterns,
      studyIndicators,
      events,
    );
    final f = _marksFor;
    if (f == null ||
        !identical(f.$1, key.$1) ||
        !identical(f.$2, key.$2) ||
        !identical(f.$3, key.$3) ||
        !identical(f.$4, key.$4) ||
        !identical(f.$5, key.$5)) {
      _marks = ChartMarks.resolve(
        indicators.timeIndex,
        bars.isEmpty ? '' : bars.last.time,
        trades: studyTrades,
        patterns: studyPatterns,
        indicatorMarks: studyIndicators,
        events: events,
      );
      _marksFor = key;
    }
    return _marks;
  }

  Object? _geometryKey;
  ChartGeometry? _geometry;
  ChartGeometry geometryFor(
    Size size,
    IndicatorData? forecast, {
    required bool volume,
    required bool macd,
    required bool kdj,
  }) {
    final key = (
      indicators,
      forecast,
      viewport.start,
      viewport.end,
      size,
      volume,
      macd,
      kdj,
      rsi,
      overlay,
      widget.volumeUnit,
      AtlasPalette.light,
    );
    if (key != _geometryKey || _geometry == null) {
      _geometryKey = key;
      _geometry = ChartGeometry.compute(
        data: indicators,
        forecast: forecast,
        start: viewport.start,
        end: viewport.end,
        size: size,
        volume: volume,
        macd: macd,
        kdj: kdj,
        rsi: rsi,
        overlay: overlay,
        volumeUnit: widget.volumeUnit,
      );
    }
    return _geometry!;
  }

  Future<void> annotationDetails() async {
    if (forecastHover != null && drawProjection) {
      await projectionSettings();
      return;
    }
    if (bars.isEmpty) return;
    final index = (hover ?? (bars.length - offset - 1)).clamp(
          0,
          bars.length - 1,
        ),
        date = bars[index].time;
    final items = [
      ...studyTrades,
      ...studyPatterns,
      ...studyIndicators,
    ].where((m) => m['time'] == date).toList();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: .65,
        minChildSize: .3,
        maxChildSize: .9,
        builder: (ctx, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.all(20),
          children: [
            Text('$date · 标注依据', style: Theme.of(ctx).textTheme.titleLarge),
            const SizedBox(height: 12),
            Text(tr(context, studyStatus)),
            if (date == bars.last.time)
              for (final r in studyRegimes)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '最新${str(r['label'])} · ${r['direction'] == 'up'
                            ? '上涨'
                            : r['direction'] == 'down'
                            ? '下跌'
                            : r['direction'] == 'range'
                            ? '震荡'
                            : '待确认'}',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: r['direction'] == 'up'
                              ? up
                              : r['direction'] == 'down'
                              ? down
                              : muted,
                        ),
                      ),
                      Text(str(r['detail'])),
                    ],
                  ),
                ),
            if (items.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 20),
                child: Text(tr(context, '该根暂无有效形态或买卖条件；长按K线可选择其他日期。')),
              ),
            for (final m in items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      tr(context, str(m['label'])),
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 6),
                    Text(tr(context, str(m['reason'] ?? m['detail']))),
                    if (m['provisional'] == true)
                      Text(tr(context, '盘中预警，收盘前可以失效。')),
                  ],
                ),
              ),
            Text(tr(context, '买入观察/卖预警是条件提示；已确认买卖点与历史规则跟踪另行区分，不代表账户实际持仓或成交。')),
          ],
        ),
      ),
    );
  }

  void saveAnnotations() {
    context.read<AtlasStore>().prefs.setString(
      'chart.annotations.v1',
      jsonEncode({
        'trades': markers,
        'shapes': shapeMarkers,
        'indicators': indicatorLabels,
        'crosses': crossMarkers,
      }),
    );
  }

  Future<void> annotationSettings() => showModalBottomSheet<void>(
    context: context,
    useSafeArea: true,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, update) => SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                tr(ctx, '标注设置'),
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                ),
              ),
              for (final item in [
                ('形态标注', shapeMarkers),
                ('买卖点', markers),
                ('指标标注', indicatorLabels),
                ('MA交叉', crossMarkers),
              ])
                SwitchListTile(
                  title: Text(tr(ctx, item.$1)),
                  subtitle: item.$1 == '指标标注'
                      ? Text(tr(ctx, 'MACD／KDJ 金叉死叉、顶底背离与 VOL 量能标注'))
                      : null,
                  value: item.$2,
                  onChanged: (value) {
                    setState(() {
                      switch (item.$1) {
                        case '形态标注':
                          shapeMarkers = value;
                        case '买卖点':
                          markers = value;
                        case '指标标注':
                          indicatorLabels = value;
                        default:
                          crossMarkers = value;
                      }
                    });
                    saveAnnotations();
                    update(() {});
                  },
                ),
              Text(
                tr(ctx, '开关只控制图表显示，设置保存在本设备；无信号不等于开关关闭。'),
                style: TextStyle(color: muted, fontSize: 13),
              ),
              TextButton(
                onPressed: retryStudy,
                child: Text(tr(context, studyStatus)),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  Future<void> indicatorSettings() async {
    await showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) => SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  tr(ctx, '图表指标'),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 12),
                Chips(
                  values: const {
                    'MA': 'MA',
                    'BOLL': 'BOLL (20,2)',
                    'SAR': 'SAR (0.02,0.2)',
                  },
                  selected: overlay,
                  onSelected: (v) {
                    setState(() => overlay = v);
                    update(() {});
                  },
                ),
                TextButton(
                  onPressed: retryStudy,
                  child: Text(tr(context, studyStatus), maxLines: 2),
                ),
                for (final item in [
                  ('VOL', volume),
                  ('MACD', macd),
                  ('KDJ', kdj),
                  ('RSI (14)', rsi),
                  ('形态标注', shapeMarkers),
                  ('买卖点', markers),
                  ('MA交叉', crossMarkers),
                  ('指标标注', indicatorLabels),
                ])
                  SwitchListTile(
                    dense: true,
                    title: Text(tr(ctx, item.$1)),
                    value: item.$2,
                    onChanged: (v) {
                      setState(() {
                        switch (item.$1) {
                          case 'VOL':
                            volume = v;
                          case 'MACD':
                            macd = v;
                          case 'KDJ':
                            kdj = v;
                          case '形态标注':
                            shapeMarkers = v;
                          case '买卖点':
                            markers = v;
                          case 'MA交叉':
                            crossMarkers = v;
                          case '指标标注':
                            indicatorLabels = v;
                          default:
                            rsi = v;
                        }
                      });
                      saveAnnotations();
                      update(() {});
                    },
                  ),
                Text(
                  tr(ctx, '指标按当前周期计算，历史不足时留空。'),
                  style: TextStyle(color: muted, fontSize: 13),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  int _months(int n) => widget.unit.startsWith('m') && widget.unit != 'month'
      ? n * 22
      : widget.unit == 'month'
      ? n
      : widget.unit == 'week'
      ? {1: 4, 3: 13, 6: 26}[n]!
      : n * 22;

  /// Compact 17pt toolbar glyph with a full 44pt hit area.
  Widget _smallIcon(
    IconData icon,
    String title,
    VoidCallback action, {
    double width = 44,
  }) => SizedBox(
    width: width,
    height: 44,
    child: IconButton(
      padding: EdgeInsets.zero,
      constraints: BoxConstraints.tightFor(width: width, height: 44),
      style: IconButton.styleFrom(
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        shape: const RoundedRectangleBorder(),
      ),
      tooltip: tr(context, title),
      onPressed: action,
      icon: Icon(icon, size: 17),
    ),
  );

  void rotate() {
    final full = context.findAncestorStateOfType<_FullscreenChartState>();
    if (full != null) {
      full.rotate();
      return;
    }
    SystemChrome.setPreferredOrientations(
      compact
          ? [DeviceOrientation.portraitUp]
          : [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight],
    );
  }

  Widget _portraitHeader() => SizedBox(
    height: 44,
    child: Row(
      children: [
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            '${widget.name} ${widget.symbol}'.trim(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 13, height: 1),
          ),
        ),
        SizedBox(
          width: 44,
          height: 44,
          child: PopupMenuButton<String>(
            padding: EdgeInsets.zero,
            tooltip: tr(context, '副图布局'),
            onSelected: (v) => setState(() {
              if (v == 'markers') {
                markers = !markers;
                return;
              }
              if (v == 'shapes') {
                shapeMarkers = !shapeMarkers;
                return;
              }
              if (v == 'crosses') {
                crossMarkers = !crossMarkers;
                return;
              }
              volume = true;
              macd = v == 'all' || v == 'macd';
              kdj = v == 'all' || v == 'kdj';
            }),
            itemBuilder: (_) => [
              PopupMenuItem(value: 'all', child: Text(tr(context, '全部副图'))),
              const PopupMenuItem(value: 'vol', child: Text('VOL')),
              const PopupMenuItem(value: 'macd', child: Text('VOL + MACD')),
              const PopupMenuItem(value: 'kdj', child: Text('VOL + KDJ')),
              CheckedPopupMenuItem(
                value: 'markers',
                checked: markers,
                child: Text(tr(context, '买卖点')),
              ),
              CheckedPopupMenuItem(
                value: 'shapes',
                checked: shapeMarkers,
                child: Text(tr(context, '形态标注')),
              ),
              CheckedPopupMenuItem(
                value: 'crosses',
                checked: crossMarkers,
                child: Text(tr(context, 'MA交叉')),
              ),
            ],
            icon: const Icon(Icons.view_stream_outlined, size: 17),
          ),
        ),
        _smallIcon(Icons.screen_rotation_outlined, '横竖屏切换', rotate),
        _smallIcon(Icons.close, '关闭全屏', () => Navigator.pop(context)),
      ],
    ),
  );

  /// Status line under the candles; [_historyAction] supplies its button.
  Widget _historyStatusBar() => SizedBox(
    height: 24,
    child: Padding(
      padding: const EdgeInsets.only(left: 8, right: 76),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Text(
          tr(
            context,
            historyBusy
                ? '正在加载更早K线…'
                : historyError ?? (historyMore ? '向左查看，自动加载更早K线' : '已到数据源最早历史'),
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 10, color: muted),
        ),
      ),
    ),
  );

  /// "加载更早/重试": the label sits in the 24pt status line, the 44pt target
  /// extends over the x-axis date band of the canvas above it.
  Widget _historyAction() => SizedBox(
    width: 72,
    height: 44,
    child: TextButton(
      style: TextButton.styleFrom(
        padding: const EdgeInsets.only(bottom: 5),
        minimumSize: const Size(72, 44),
        alignment: Alignment.bottomCenter,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        shape: const RoundedRectangleBorder(),
      ),
      onPressed: loadOlder,
      child: Text(
        tr(context, historyError == null ? '加载更早' : '重试'),
        style: const TextStyle(fontSize: 11),
      ),
    ),
  );

  Widget _rangeMenu() {
    final options = [1, 3, 6];
    final selected = options.where((n) => _months(n) == count).firstOrNull;
    String text(int n) => widget.unit.startsWith('m') && widget.unit != 'month'
        ? '${n * 22}根'
        : '$n个月';
    return SizedBox(
      width: 64,
      height: 44,
      child: PopupMenuButton<int>(
        tooltip: tr(context, '显示范围'),
        padding: EdgeInsets.zero,
        initialValue: selected,
        onSelected: (n) => range(_months(n)),
        itemBuilder: (_) => [
          for (final n in options)
            PopupMenuItem(value: n, child: Text(tr(context, text(n)))),
        ],
        child: Padding(
          padding: const EdgeInsets.only(left: 6),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  selected == null ? '$count根' : tr(context, text(selected)),
                  maxLines: 1,
                  overflow: TextOverflow.clip,
                  style: TextStyle(
                    fontSize: 11,
                    color: selected == null ? muted : ink,
                  ),
                ),
              ),
              Icon(Icons.arrow_drop_down, size: 16, color: muted),
            ],
          ),
        ),
      ),
    );
  }

  Widget _terminalToolbar() => LayoutBuilder(
    builder: (context, c) {
      final actions = <(IconData, String, VoidCallback)>[
        if (offset > 0) (Icons.skip_next, '回到最新', () => range(count)),
        (Icons.show_chart, '图表指标', indicatorSettings),
        (Icons.tune, '均线参数', settings),
        (Icons.auto_graph, '行情推演', projectionSettings),
        (Icons.sell_outlined, '标注设置', annotationSettings),
        (Icons.info_outline, '标注依据', annotationDetails),
        if (!widget.expanded) (Icons.fullscreen, '展开图表', expand),
      ];
      final width = math
          .min(44.0, (c.maxWidth - 64) / math.max(1, actions.length))
          .floorToDouble();
      return Row(
        children: [
          // Only the range label follows pinches; the icons rebuild on
          // setState (e.g. when "回到最新" appears).
          ValueListenableBuilder<int>(
            valueListenable: view,
            builder: (context, _, _) => _rangeMenu(),
          ),
          const Spacer(),
          for (final (icon, title, action) in actions)
            _smallIcon(icon, title, action, width: width),
        ],
      );
    },
  );

  Widget _wideToolbar() => Row(
    children: [
      Expanded(
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final item in [
                (
                  '1个月',
                  widget.unit == 'month'
                      ? 1
                      : widget.unit == 'week'
                      ? 4
                      : 22,
                ),
                (
                  '3个月',
                  widget.unit == 'month'
                      ? 3
                      : widget.unit == 'week'
                      ? 13
                      : 66,
                ),
                (
                  '6个月',
                  widget.unit == 'month'
                      ? 6
                      : widget.unit == 'week'
                      ? 26
                      : 132,
                ),
                (
                  '1年',
                  widget.unit == 'month'
                      ? 12
                      : widget.unit == 'week'
                      ? 52
                      : 264,
                ),
                ('全部', bars.length),
              ])
                TextButton(
                  onPressed: () => range(item.$2),
                  child: Text(
                    tr(context, item.$1),
                    style: TextStyle(
                      color: count == item.$2 ? ink : muted,
                      fontSize: 13,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
      IconButton(
        onPressed: indicatorSettings,
        tooltip: tr(context, '图表指标'),
        icon: const Icon(Icons.show_chart, size: 20),
      ),
      IconButton(
        onPressed: settings,
        tooltip: tr(context, '均线参数'),
        icon: const Icon(Icons.tune, size: 20),
      ),
      IconButton(
        onPressed: projectionSettings,
        tooltip: tr(context, '行情推演'),
        icon: Icon(
          Icons.auto_graph,
          size: 20,
          color: projectionOn ? ChartTone.text(ChartTone.projection) : muted,
        ),
      ),
      if (offset > 0)
        IconButton(
          onPressed: () => range(count),
          tooltip: tr(context, '回到最新'),
          icon: const Icon(Icons.skip_next),
        ),
      if (widget.expanded) ...[
        if (compact)
          PopupMenuButton<String>(
            tooltip: tr(context, '副图布局'),
            initialValue: paneMode,
            onSelected: (v) => setState(() => paneMode = v),
            itemBuilder: (_) => [
              PopupMenuItem(
                value: 'all',
                child: Text(tr(context, '全部副图 · 可纵向滚动')),
              ),
              const PopupMenuItem(value: 'vol', child: Text('VOL')),
              const PopupMenuItem(value: 'macd', child: Text('VOL + MACD')),
              const PopupMenuItem(value: 'kdj', child: Text('VOL + KDJ')),
            ],
            icon: const Icon(Icons.view_stream_outlined),
          ),
        IconButton(
          onPressed: rotate,
          tooltip: tr(context, '横竖屏切换'),
          icon: const Icon(Icons.screen_rotation_outlined),
        ),
        IconButton(
          onPressed: () => Navigator.pop(context),
          tooltip: tr(context, '关闭全屏'),
          icon: const Icon(Icons.close),
        ),
      ] else
        IconButton(
          onPressed: expand,
          tooltip: tr(context, '展开图表'),
          icon: const Icon(Icons.fullscreen),
        ),
    ],
  );

  /// MA/BOLL/SAR values for the readout candle. Display only: MA visibility
  /// changes go through the 均线参数 sheet (long-press opens it), so a stray
  /// tap never changes the configuration.
  Widget _legend() {
    final idx = readoutIndex, readout = readoutData;
    double? at(List<double?> values) =>
        idx < values.length ? values[idx] : null;
    TextStyle style(Color color) => TextStyle(
      color: color,
      fontSize: widget.terminal ? 12 : 13,
      height: 1.1,
    );
    final children = overlay == 'BOLL'
        ? [
            Text('BOLL (20,2)', style: style(ink)),
            Text('MID ${fixed(at(readout.bollMid))}', style: style(ink)),
            Text(
              'UP ${fixed(at(readout.bollUpper))}',
              style: style(ChartTone.text(ChartTone.amber)),
            ),
            Text(
              'LOW ${fixed(at(readout.bollLower))}',
              style: style(ChartTone.text(ChartTone.pink)),
            ),
          ]
        : overlay == 'SAR'
        ? [
            Text(
              'SAR (0.02,0.2)',
              style: style(ChartTone.text(ChartTone.amber)),
            ),
            Text(
              fixed(at(readout.sar)),
              style: style(ChartTone.text(ChartTone.amber)),
            ),
          ]
        : [
            for (final ma in mas)
              Text(
                'MA${ma.period} ${ma.enabled ? fixed(at(readout.averages[ma.period] ?? const [])) : '—'}',
                style: style(ma.enabled ? chartTextColor(ma.color) : muted),
              ),
          ];
    return Semantics(
      hint: tr(context, '长按编辑均线显示与参数'),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onLongPress: settings,
        child: _ChartLegend(
          compact: compact,
          dense: widget.terminal,
          children: children,
        ),
      ),
    );
  }

  /// OHLC of the readout candle, each coloured against the previous close.
  Widget _readout({required bool dense}) {
    final idx = readoutIndex, data = readoutData, c = data.bars[idx];
    final previous = idx > 0 ? data.bars[idx - 1].close : null;
    final future = forecastData != null && forecastHover != null;
    Color tone(double v) => switch (ohlcDirection(v, previous)) {
      1 => up,
      -1 => down,
      _ => ink,
    };
    final values = [('开', c.open), ('高', c.high), ('低', c.low), ('收', c.close)];
    if (dense) {
      return SizedBox(
        height: 24,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              Text(
                '${future ? '推演 · ' : ''}${c.time}',
                style: TextStyle(fontSize: 11, height: 1, color: muted),
              ),
              const SizedBox(width: 8),
              for (final p in values)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Text(
                    '${tr(context, p.$1)} ${fixed(p.$2)}',
                    style: TextStyle(
                      fontSize: 11,
                      height: 1,
                      color: tone(p.$2),
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
    }
    return Wrap(
      spacing: 12,
      runSpacing: 6,
      children: [
        Text(
          '${widget.expanded ? '${widget.name.isEmpty ? '' : '${widget.name} · '}${widget.symbol} · ' : ''}${c.time}',
          style: TextStyle(fontSize: 13, color: muted),
        ),
        for (final p in values)
          Text(
            '${tr(context, p.$1)} ${p.$2.toStringAsFixed(2)}',
            style: TextStyle(color: tone(p.$2), fontSize: 13),
          ),
      ],
    );
  }

  Widget _projectionSummary(
    double summaryHeight,
    String reason,
    String invalid,
    TextStyle explanationStyle,
  ) {
    Widget menuLabel(String text) => ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6),
        child: Center(
          widthFactor: 1,
          child: Text(text, style: const TextStyle(fontSize: 13)),
        ),
      ),
    );
    return SizedBox(
      key: const ValueKey('projection-summary'),
      height: summaryHeight,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 44,
              child: Row(
                children: [
                  const Text(
                    '推演',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(width: 8),
                  PopupMenuButton<int>(
                    tooltip: '推演期限',
                    padding: EdgeInsets.zero,
                    itemBuilder: (_) => [
                      for (final n in [5, 10, 15, 20])
                        PopupMenuItem(
                          value: n,
                          child: Text(
                            widget.unit == 'day' ? '约${n ~/ 5}周' : '$n根K',
                          ),
                        ),
                    ],
                    onSelected: (n) async {
                      setState(() => projectionHorizon = n);
                      await refreshProjection();
                    },
                    child: menuLabel(
                      widget.unit == 'day'
                          ? '约${projectionHorizon ~/ 5}周 ▾'
                          : '$projectionHorizon根K ▾',
                    ),
                  ),
                  PopupMenuButton<String>(
                    tooltip: '推演情景',
                    padding: EdgeInsets.zero,
                    itemBuilder: (_) => [
                      for (final row in [
                        ('base', '基准'),
                        ('bull', '偏强'),
                        ('bear', '偏弱'),
                      ])
                        PopupMenuItem(value: row.$1, child: Text(row.$2)),
                    ],
                    onSelected: (v) => setState(() => projectionScenario = v),
                    child: menuLabel(
                      projectionScenario == 'bull'
                          ? '偏强 ▾'
                          : projectionScenario == 'bear'
                          ? '偏弱 ▾'
                          : '基准 ▾',
                    ),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: projectionSettings,
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      minimumSize: const Size(44, 44),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: const Text('详细依据', style: TextStyle(fontSize: 12)),
                  ),
                ],
              ),
            ),
            Text(reason, style: explanationStyle),
            const SizedBox(height: 4),
            Text(invalid, style: explanationStyle.copyWith(color: muted)),
          ],
        ),
      ),
    );
  }

  bool get annotationsWanted => markers || shapeMarkers || indicatorLabels;

  /// Small status on the canvas while annotations are not verified; the
  /// candles and indicators are painted regardless.
  Widget? _studyChip() {
    if (!annotationsWanted || studyReady && !studyFailed) return null;
    final chip = Container(
      margin: const EdgeInsets.only(top: 2, right: 6),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: surface.withValues(alpha: .88),
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: muted.withValues(alpha: .3), width: .5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (studyFailed)
            Icon(Icons.refresh, size: 11, color: muted)
          else
            SizedBox(
              width: 9,
              height: 9,
              child: CircularProgressIndicator(strokeWidth: 1, color: muted),
            ),
          const SizedBox(width: 4),
          Text(
            tr(context, studyFailed ? '标注更新失败 · 重试' : '标注同步中…'),
            style: TextStyle(fontSize: 10, height: 1.2, color: muted),
          ),
        ],
      ),
    );
    return Positioned(
      key: const ValueKey('study-status'),
      top: 0,
      right: 0,
      child: studyFailed
          ? Semantics(
              button: true,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: retryStudy,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minHeight: 44,
                    minWidth: 44,
                  ),
                  child: Align(
                    alignment: Alignment.topRight,
                    widthFactor: 1,
                    child: chip,
                  ),
                ),
              ),
            )
          : IgnorePointer(child: chip),
    );
  }

  void panBy(double dx, double canvasWidth) {
    viewport.pan(dx, ChartPlot.width(canvasWidth));
    viewChanged();
  }

  Widget _canvas(double plotHeight) => LayoutBuilder(
    builder: (context, constraints) {
      final store = context.read<AtlasStore>();
      final (fontSize, locale) = context.select<AtlasStore, (double, String)>(
        (s) => (s.fontSize, s.locale),
      );
      final width = constraints.maxWidth, size = Size(width, plotHeight);
      final drawVolume = compact ? true : volume,
          drawMacd = compact ? paneMode == 'all' || paneMode == 'macd' : macd,
          drawKdj = compact ? paneMode == 'all' || paneMode == 'kdj' : kdj;
      final font = math.max(14.0, fontSize * .72);
      final platform = Theme.of(context).platform;
      final edge =
          !widget.expanded &&
              (platform == TargetPlatform.iOS ||
                  platform == TargetPlatform.macOS)
          ? math.max(
                  20.0,
                  View.of(context).padding.left /
                      View.of(context).devicePixelRatio,
                ) +
                8
          : 0.0;
      final chip = _studyChip();
      final layers = Stack(
        children: [
          ValueListenableBuilder<int>(
            valueListenable: view,
            builder: (context, _, _) {
              final forecast = forecastData;
              final geometry = geometryFor(
                size,
                forecast,
                volume: drawVolume,
                macd: drawMacd,
                kdj: drawKdj,
              );
              final ready = studyReady;
              return RepaintBoundary(
                child: CustomPaint(
                  key: const ValueKey('candlestick-canvas'),
                  painter: ChartPainter(
                    indicators,
                    viewport.start,
                    viewport.end,
                    drawVolume,
                    drawMacd,
                    drawKdj,
                    shapeMarkers ? events : const [],
                    widget.volumeUnit,
                    font,
                    markers,
                    translate: store.t,
                    locale: locale,
                    overlay: overlay,
                    rsi: rsi,
                    trades: ready ? studyTrades : const [],
                    patterns: ready ? studyPatterns : const [],
                    indicatorMarks: ready && indicatorLabels
                        ? studyIndicators
                        : const [],
                    showPatterns: shapeMarkers,
                    showCrosses: crossMarkers,
                    projection: forecast == null ? null : projection,
                    forecast: forecast,
                    period: widget.unit,
                    marks: chartMarks,
                    geometry: geometry,
                  ),
                  child: RepaintBoundary(
                    child: CustomPaint(
                      key: const ValueKey('chart-crosshair'),
                      size: size,
                      painter: CrosshairPainter(
                        geometry,
                        selection,
                        font: font,
                        projection: forecast != null,
                        translate: store.t,
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
          ?chip,
        ],
      );
      return Listener(
        onPointerDown: (e) {
          pointers[e.pointer] = e.localPosition;
          if (pointers.length == 2) {
            pinchDistance =
                (pointers.values.first - pointers.values.last).distance;
            viewport.beginPinch(
              pinchDistance!,
              ChartPlot.fraction(
                (pointers.values.first.dx + pointers.values.last.dx) / 2,
                width,
              ),
            );
            selection.value = (hover: null, forecast: null);
          }
        },
        onPointerMove: (e) {
          pointers[e.pointer] = e.localPosition;
          if (pointers.length == 2 && pinchDistance != null) {
            final distance =
                (pointers.values.first - pointers.values.last).distance;
            if (distance > 10) {
              viewport.pinch(
                distance,
                ChartPlot.fraction(
                  (pointers.values.first.dx + pointers.values.last.dx) / 2,
                  width,
                ),
              );
              viewChanged();
            }
          }
        },
        onPointerUp: (e) {
          final wasPinching = pinchDistance != null;
          pointers.remove(e.pointer);
          pinchDistance = null;
          if (wasPinching) maybeLoadOlder();
        },
        onPointerCancel: (e) {
          pointers.remove(e.pointer);
          pinchDistance = null;
        },
        child: RawGestureDetector(
          gestures: {
            // Wins the arena once a second finger lands on the chart, so the
            // enclosing page cannot scroll while pinching.
            _PinchClaimRecognizer:
                GestureRecognizerFactoryWithHandlers<_PinchClaimRecognizer>(
                  () => _PinchClaimRecognizer(debugOwner: this),
                  (_) {},
                ),
            if (edge > 0)
              // Claims horizontal pans that start inside the iOS back-swipe
              // zone before the route's back gesture does.
              _EdgePanRecognizer:
                  GestureRecognizerFactoryWithHandlers<_EdgePanRecognizer>(
                    () => _EdgePanRecognizer(debugOwner: this),
                    (r) => r
                      ..edge = edge
                      ..onStart = () {
                        viewport.beginPan();
                        selection.value = (hover: null, forecast: null);
                      }
                      ..onUpdate = ((dx) => panBy(dx, width))
                      ..onEnd = maybeLoadOlder,
                  ),
          },
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onHorizontalDragStart: (_) {
              viewport.beginPan();
              selection.value = (hover: null, forecast: null);
            },
            onHorizontalDragUpdate: (e) {
              if (pointers.length < 2) panBy(e.delta.dx, width);
            },
            onHorizontalDragEnd: (_) => maybeLoadOlder(),
            onLongPressStart: (e) => selectAt(e.localPosition, width),
            onLongPressMoveUpdate: (e) => selectAt(e.localPosition, width),
            onLongPressEnd: (_) {},
            // No double-tap recognizer: it would hold every single tap in
            // the arena for ~300ms before the candle is selected.
            onTapDown: (e) => selectAt(e.localPosition, width),
            child: ListenableBuilder(
              listenable: Listenable.merge([view, selection]),
              builder: (context, child) {
                final c = current;
                return Semantics(
                  label:
                      '${widget.symbol} ${c.time} ${tr(context, '开')} ${fixed(c.open)} ${tr(context, '高')} ${fixed(c.high)} ${tr(context, '低')} ${fixed(c.low)} ${tr(context, '收')} ${fixed(c.close)}',
                  hint:
                      '${tr(context, '双指缩放 · 横滑平移 · 长按联动十字光标')} · $studyStatus',
                  onIncrease: () =>
                      hover = ((hover ?? end - 1) + 1).clamp(start, end - 1),
                  onDecrease: () =>
                      hover = ((hover ?? end - 1) - 1).clamp(start, end - 1),
                  child: child,
                );
              },
              child: layers,
            ),
          ),
        ),
      );
    },
  );

  @override
  Widget build(BuildContext context) {
    if (bars.isEmpty) {
      return const SizedBox(
        height: 200,
        child: Center(child: Text('No valid price history')),
      );
    }
    final projecting = drawProjection;
    // Terminal header: 44pt toolbar row, 40pt legend, 24pt OHLC readout;
    // fullscreen adds a 44pt title row.
    final height = widget.terminal
        ? math.max(
            160.0,
            (widget.viewportHeight ?? 500) -
                (widget.expanded ? 152 : 108) -
                (historyEnabled ? 24 : 0),
          )
        : compact
        ? math.max(
            paneMode == 'all' ? 460.0 : 190.0,
            (widget.viewportHeight ??
                    (MediaQuery.sizeOf(context).height -
                        MediaQuery.paddingOf(context).vertical)) -
                94 -
                (historyEnabled ? 24 : 0),
          )
        : widget.expanded
        ? math.max(450.0, MediaQuery.sizeOf(context).height - 280)
        : (280 + (volume ? 100 : 0) + (macd ? 100 : 0) + (kdj ? 100 : 0))
              .toDouble();
    return LayoutBuilder(
      builder: (context, outer) {
        final basis = obj(projection?['basis']),
            sampleCount = (numOf(projection?['sampleCount']) ?? 0).toInt();
        final source = obj(
          rows(projection?['scenarios'])
              .where((r) => r['id'] == projectionScenario)
              .firstOrNull?['source'],
        );
        final method = projection?['model'] == 'analogs'
            ? '从 $sampleCount 段相似窗口中选整段代表路径（${str(source['from'])}—${str(source['to'])}）'
            : '相似样本不足，采用近期3根量价片段重采样';
        final reason = '${str(basis['regime'], '条件情景')}；$method，保留实体、影线和量能节奏。';
        final invalid =
            '失效观察：跌破 ${fixed(projection?['support'])} 且不能收回，或放量下跌／均线向下发散。假设走势，不是发生概率。';
        const explanationStyle = TextStyle(fontSize: 13, height: 1.45);
        double measured(String text) {
          final p = TextPainter(
            text: TextSpan(text: text, style: explanationStyle),
            textDirection: TextDirection.ltr,
            textScaler: MediaQuery.textScalerOf(context),
          )..layout(maxWidth: math.max(80, outer.maxWidth - 20));
          return p.height;
        }

        final summaryHeight = projecting
            ? 44 + measured(reason) + measured(invalid) + 18
            : 0.0;
        final plotHeight = math.max(160.0, height - summaryHeight);
        final liveReadouts = Listenable.merge([view, selection]);
        final summary = projecting
            ? _projectionSummary(
                summaryHeight,
                reason,
                invalid,
                explanationStyle,
              )
            : null;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.terminal && widget.expanded) _portraitHeader(),
            if (widget.terminal) ...[
              SizedBox(height: 44, child: _terminalToolbar()),
              ListenableBuilder(
                listenable: liveReadouts,
                builder: (context, _) => _legend(),
              ),
            ] else ...[
              _wideToolbar(),
              ?summary,
              ListenableBuilder(
                listenable: liveReadouts,
                builder: (context, _) => _legend(),
              ),
            ],
            if (widget.terminal) ?summary,
            SizedBox(
              height: widget.terminal
                  ? 0
                  : compact
                  ? 4
                  : 14,
            ),
            ListenableBuilder(
              listenable: liveReadouts,
              builder: (context, _) => _readout(dense: widget.terminal),
            ),
            SizedBox(
              height: widget.terminal
                  ? 0
                  : compact
                  ? 4
                  : 10,
            ),
            Stack(
              clipBehavior: Clip.none,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _canvas(plotHeight),
                    if (historyEnabled) _historyStatusBar(),
                  ],
                ),
                if (historyEnabled && !historyBusy && historyMore)
                  Positioned(right: 0, bottom: 0, child: _historyAction()),
              ],
            ),
            if (!compact && !widget.terminal)
              Wrap(
                spacing: 6,
                children: [
                  FilterChip(
                    label: const Text('VOL'),
                    selected: volume,
                    onSelected: (v) => setState(() => volume = v),
                  ),
                  FilterChip(
                    label: const Text('MACD'),
                    selected: macd,
                    onSelected: (v) => setState(() => macd = v),
                  ),
                  FilterChip(
                    label: const Text('KDJ'),
                    selected: kdj,
                    onSelected: (v) => setState(() => kdj = v),
                  ),
                  FilterChip(
                    label: Text(tr(context, '买卖点')),
                    selected: markers,
                    onSelected: (v) => setState(() => markers = v),
                  ),
                ],
              ),
            if (!compact && !widget.terminal)
              Text(
                tr(context, '双指缩放 · 横滑平移 · 长按联动十字光标'),
                style: TextStyle(fontSize: 12, color: muted),
              ),
          ],
        );
      },
    );
  }
}

class _ChartLegend extends StatelessWidget {
  const _ChartLegend({
    required this.compact,
    required this.children,
    this.dense = false,
  });
  final bool dense;
  final bool compact;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => dense
      ? SizedBox(
          height: 40,
          child: LayoutBuilder(
            builder: (context, c) => Column(
              children: [
                for (var row = 0; row < 2; row++)
                  SizedBox(
                    height: 20,
                    child: Row(
                      children: children
                          .skip(row * 4)
                          .take(4)
                          .map(
                            (w) => SizedBox(
                              width: c.maxWidth / 4,
                              child: Align(
                                alignment: Alignment.centerLeft,
                                child: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  child: w,
                                ),
                              ),
                            ),
                          )
                          .toList(),
                    ),
                  ),
              ],
            ),
          ),
        )
      : compact
      ? SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: children
                .map(
                  (w) => Padding(
                    padding: const EdgeInsets.only(right: 14),
                    child: w,
                  ),
                )
                .toList(),
          ),
        )
      : Wrap(spacing: 14, runSpacing: 8, children: children);
}
