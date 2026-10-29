export 'intraday_chart.dart';
import '../core/patch_daily_quote.dart';
import '../core/pattern_ranges.dart';

import 'dart:convert';
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/indicators.dart';
import '../core/chart_viewport.dart';
import 'common.dart';

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
    this.events = const [],
    this.trades = const [],
    this.patterns = const [],
    this.expanded = false,
    this.initialStudy,
    this.onLiveAlerts,
    this.initialProjection,
  });
  final List<Bar> bars;
  final String symbol, unit, volumeUnit;
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

class _MarketChartState extends State<MarketChart> {
  List<MaLine> mas = List.of(defaultMa);
  late IndicatorData indicators;
  final viewport = ChartViewport();
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
  int? hover, forecastHover;
  List<Json> studyTrades = [],
      studyPatterns = [],
      studyIndicators = [],
      studyRegimes = [];
  int studyRequest = 0;
  String studyKey = '', studyStatus = '标注依据当前MA · 核验中';
  bool projectionOn = false, projectionBusy = false;
  int projectionHorizon = 15, projectionRequest = 0;
  String projectionKey = '', projectionScenario = 'base', forecastKey = '';
  IndicatorData? forecastCache;
  IndicatorData? get forecastData {
    if (!drawProjection) return null;
    final key =
        '$projectionKey:$projectionScenario:${jsonEncode(mas.map((m) => m.toJson()).toList())}';
    if (forecastKey != key) {
      final branch = rows(projection?['scenarios'])
          .where((r) => r['id'] == projectionScenario)
          .firstOrNull;
      final bars = rows(branch?['candles']).map(Bar.fromJson).toList();
      forecastCache = bars.isEmpty
          ? null
          : IndicatorData([...widget.bars, ...bars], mas);
      forecastKey = key;
    }
    return forecastCache;
  }

  Json? projection;
  String? projectionError;
  bool get drawProjection =>
      projectionOn && projection?['available'] == true && offset == 0;
  Future<void> refreshProjection() async {
    if (!mounted || !projectionOn || widget.bars.isEmpty) return;
    final key = '$currentStudyKey:$projectionHorizon';
    if (projectionBusy || projectionKey == key) return;
    projectionBusy = true;
    final request = ++projectionRequest;
    try {
      final result = await context.read<AtlasStore>().chartStudies.compute({
        'task': 'projection',
        'unit': widget.unit,
        'symbol': widget.symbol,
        'ma': mas.where((m) => m.enabled).map((m) => m.period).toList(),
        'horizon': projectionHorizon,
        'candles': widget.bars
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
            .toList(),
      });
      if (mounted &&
          request == projectionRequest &&
          key == '$currentStudyKey:$projectionHorizon') {
        setState(() {
          projection = obj(result['projection']);
          projectionError = null;
          projectionKey = key;
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
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) => Padding(
          padding: const EdgeInsets.all(20),
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
                      onChanged: (v) {
                        setState(() => projectionOn = v);
                        update(() {});
                        if (v) refreshProjection();
                      },
                    ),
                  ],
                ),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final n in [5, 10, 15])
                      ChoiceChip(
                        label: Text(
                          widget.unit == 'day'
                              ? '约${n ~/ 5}周'
                              : '$n 根${widget.unit}K',
                        ),
                        selected: projectionHorizon == n,
                        onSelected: (_) async {
                          setState(() => projectionHorizon = n);
                          await refreshProjection();
                          update(() {});
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
                        label: Text(entry.$2),
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
                if (projectionError != null) Text(projectionError!),
                if (projection != null) ...[
                  Text(
                    '${str(projection!['asOf'])} · ${projection!['model'] == 'analogs' ? '历史相似窗口 ${projection!['sampleCount']} 段' : '样本不足 · 波动规则情景'}',
                    style: TextStyle(color: muted, fontSize: 12),
                  ),
                  for (final r in rows(projection!['conditions']))
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(
                        str(r['text']),
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
                  const SizedBox(height: 14),
                  Text(
                    str(projection!['notice']),
                    style: TextStyle(color: muted, fontSize: 12),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  bool volume = true, macd = true, kdj = true, markers = true;
  bool shapeMarkers = true, crossMarkers = false, indicatorLabels = true;
  Timer? studyRetry;
  int studyRetries = 0;
  bool studyBusy = false;
  bool studyReady = false;
  final Map<int, Offset> pointers = {};
  double? pinchDistance;

  @override
  void initState() {
    super.initState();
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
    indicators = IndicatorData(widget.bars, mas);
    projection = widget.initialProjection;
    projectionScenario = str(projection?['selectedScenario'], 'base');
    projectionOn = projection != null;
    projectionHorizon = (numOf(projection?['horizon']) ?? 15).toInt();
    viewport.length = widget.bars.length;
    acceptInitialStudy();
    WidgetsBinding.instance.addPostFrameCallback((_) => refreshStudy());
  }

  @override
  void didUpdateWidget(covariant MarketChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (Object.hashAll(
              oldWidget.bars.map(
                (b) => Object.hash(
                  b.time,
                  b.open,
                  b.high,
                  b.low,
                  b.close,
                  b.volume,
                ),
              ),
            ) !=
            Object.hashAll(
              widget.bars.map(
                (b) => Object.hash(
                  b.time,
                  b.open,
                  b.high,
                  b.low,
                  b.close,
                  b.volume,
                ),
              ),
            ) ||
        oldWidget.symbol != widget.symbol ||
        oldWidget.unit != widget.unit) {
      final rightDate = oldWidget.bars.isEmpty
          ? null
          : oldWidget
                .bars[(oldWidget.bars.length - offset - 1).clamp(
                  0,
                  oldWidget.bars.length - 1,
                )]
                .time;
      final selectedDate = hover == null || oldWidget.bars.isEmpty
          ? null
          : oldWidget.bars[hover!.clamp(0, oldWidget.bars.length - 1)].time;
      indicators = IndicatorData(widget.bars, mas);
      viewport.length = widget.bars.length;
      if (offset > 0 && rightDate != null) {
        final index = widget.bars.indexWhere((b) => b.time == rightDate);
        if (index >= 0) offset = widget.bars.length - index - 1;
      }
      final selectedIndex = selectedDate == null
          ? -1
          : widget.bars.indexWhere((b) => b.time == selectedDate);
      hover = selectedIndex < 0 ? null : selectedIndex;
      if (oldWidget.symbol != widget.symbol || oldWidget.unit != widget.unit) {
        offset = 0;
      }
      offset = offset.clamp(0, math.max(0, widget.bars.length - 1));
    }
    if (oldWidget.initialStudy != widget.initialStudy) acceptInitialStudy();
  }

  @override
  void dispose() {
    studyRetry?.cancel();
    super.dispose();
  }

  int get end => viewport.end;
  int get start => viewport.start;
  Bar? get current =>
      drawProjection &&
          forecastHover != null &&
          forecastData != null &&
          forecastHover! < forecastData!.bars.length
      ? forecastData!.bars[forecastHover!]
      : widget.bars.isEmpty
      ? null
      : widget.bars[(hover ?? (end - 1)).clamp(0, widget.bars.length - 1)];
  void range(int days) => setState(() {
    viewport.reset(days);
    hover = null;
    forecastHover = null;
  });
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
                            indicators = IndicatorData(widget.bars, mas);
                          });
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
      setState(() => forecastHover = virtual.clamp(end, end + future - 1));
      return;
    }
    forecastHover = null;
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
    setState(() => hover = i);
  }

  Future<void> expand() async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => FullscreenChart(
          bars: widget.bars,
          symbol: widget.symbol,
          name: widget.name,
          unit: widget.unit,
          volumeUnit: widget.volumeUnit,
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
                    'maPeriods': mas
                        .where((m) => m.enabled)
                        .map((m) => m.period)
                        .toList(),
                    'candleCount': widget.bars.length,
                    'last': {
                      'time': widget.bars.last.time,
                      'open': widget.bars.last.open,
                      'high': widget.bars.last.high,
                      'low': widget.bars.last.low,
                      'close': widget.bars.last.close,
                      'volume': widget.bars.last.volume,
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
    if (raw != null) {
      final saved = rows(jsonDecode(raw)).map(MaLine.fromJson).toList();
      if (saved.length == 8 &&
          saved.every((m) => m.period >= 1 && m.period <= 500)) {
        setState(() {
          mas = saved;
          indicators = IndicatorData(widget.bars, mas);
        });
      }
    }
  }

  String get currentStudyKey {
    final periods = mas.where((m) => m.enabled).map((m) => m.period).toList();
    return '${widget.symbol}:${widget.unit}:$periods:${widget.amount}:${Object.hashAll(widget.bars.map((b) => Object.hash(b.time, b.open, b.high, b.low, b.close, b.volume)))}';
  }

  void acceptInitialStudy() {
    final seed = widget.initialStudy;
    if (seed == null || widget.bars.isEmpty) return;
    final verification = obj(seed['verification']),
        last = obj(verification['last']),
        bar = widget.bars.last;
    final periods = mas.where((m) => m.enabled).map((m) => m.period).toList()
      ..sort();
    final verifiedPeriods =
        (verification['maPeriods'] as List? ?? [])
            .map((p) => numOf(p)?.toInt())
            .toList()
          ..sort((a, b) => (a ?? 0).compareTo(b ?? 0));
    if (verification['symbol'] != widget.symbol ||
        verification['unit'] != widget.unit ||
        verification['candleCount'] != widget.bars.length ||
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
    studyReady = true;
    studyStatus = 'K线与标注 · 同步快照';
  }

  Future<void> refreshStudy({bool retry = false}) async {
    if (!mounted || widget.bars.isEmpty) return;
    final periods = mas.where((m) => m.enabled).map((m) => m.period).toList();
    final key = currentStudyKey;
    if (studyBusy || studyKey == key && !retry) return;
    if (studyKey != key) {
      studyRetries = 0;
      studyRetry?.cancel();
    }
    studyBusy = true;
    final sameParameters =
        studyKey.split(':').take(3).join(':') ==
        key.split(':').take(3).join(':');
    studyKey = key;
    final request = ++studyRequest;
    setState(() {
      if (!sameParameters) studyReady = false;
      studyTrades = sameParameters
          ? studyTrades.where((m) => m['provisional'] != true).toList()
          : [];
      studyPatterns = sameParameters
          ? studyPatterns.where((m) => m['provisional'] != true).toList()
          : [];
      studyIndicators = sameParameters
          ? studyIndicators
                .where((m) => m['time'] != widget.bars.last.time)
                .toList()
          : [];
      studyStatus = '标注依据当前MA · 核验中';
    });
    try {
      final result = await context.read<AtlasStore>().chartStudies.compute({
        'symbol': widget.symbol,
        'name': widget.name,
        'unit': widget.unit,
        'ma': periods,
        'amount': widget.amountDate == widget.bars.last.time
            ? widget.amount
            : null,
        'candles': widget.bars
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
            .toList(),
      });
      if (!mounted || request != studyRequest || key != currentStudyKey) return;
      setState(() {
        studyReady = true;
        studyTrades = rows(result['tradeMarkers']);
        studyPatterns = rows(result['patternMarks']);
        studyIndicators = rows(result['indicatorMarks']);
        studyRegimes = rows(result['trendRegimes']);
        widget.onLiveAlerts?.call(rows(result['liveAlerts']));
        studyStatus = '当前 MA${periods.join('/')} · 形态量价 v4';
      });
    } catch (_) {
      if (mounted && request == studyRequest && key == currentStudyKey) {
        setState(() => studyStatus = '标注更新失败 · 保留历史标注，可点此重试');
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
      if (mounted) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) refreshStudy();
        });
      }
    }
  }

  Future<void> annotationDetails() async {
    if (forecastHover != null && drawProjection) {
      await projectionSettings();
      return;
    }
    if (widget.bars.isEmpty) return;
    final index = (hover ?? (widget.bars.length - offset - 1)).clamp(
          0,
          widget.bars.length - 1,
        ),
        date = widget.bars[index].time;
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
            Text(studyStatus),
            if (date == widget.bars.last.time)
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
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 20),
                child: Text('该根暂无有效形态或买卖条件；长按K线可选择其他日期。'),
              ),
            for (final m in items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      str(m['label']),
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 6),
                    Text(str(m['reason'] ?? m['detail'])),
                    if (m['provisional'] == true) const Text('盘中预警，收盘前可以失效。'),
                  ],
                ),
              ),
            const Text('买入观察/卖预警是条件提示；已确认买卖点与历史规则跟踪另行区分，不代表账户实际持仓或成交。'),
          ],
        ),
      ),
    );
  }

  Widget _smallIcon(IconData icon, String title, VoidCallback action) =>
      SizedBox(
        width: 36,
        height: 30,
        child: IconButton(
          padding: EdgeInsets.zero,
          visualDensity: VisualDensity.compact,
          tooltip: tr(context, title),
          onPressed: action,
          icon: Icon(icon, size: 17),
        ),
      );
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
                onPressed: () {
                  studyKey = '';
                  studyRetries = 0;
                  studyRetry?.cancel();
                  refreshStudy();
                },
                child: Text(studyStatus),
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
                  onPressed: () {
                    studyKey = '';
                    refreshStudy();
                  },
                  child: Text(studyStatus, maxLines: 2),
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
  Widget _portraitHeader() => SizedBox(
    height: 32,
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
          width: 36,
          height: 30,
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
        _smallIcon(
          Icons.screen_rotation_outlined,
          '横竖屏切换',
          () => SystemChrome.setPreferredOrientations([
            DeviceOrientation.landscapeLeft,
            DeviceOrientation.landscapeRight,
          ]),
        ),
        _smallIcon(Icons.close, '关闭全屏', () => Navigator.pop(context)),
      ],
    ),
  );
  @override
  Widget build(BuildContext context) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        refreshStudy();
        refreshProjection();
      }
    });
    if (widget.bars.isEmpty) {
      return const SizedBox(
        height: 200,
        child: Center(child: Text('No valid price history')),
      );
    }
    final c = current!,
        idx = (drawProjection ? forecastHover : null) ?? hover ?? end - 1;
    final readout = drawProjection && forecastHover != null
        ? forecastData!
        : indicators;
    final drawVolume = compact ? true : volume,
        drawMacd = compact ? paneMode == 'all' || paneMode == 'macd' : macd,
        drawKdj = compact ? paneMode == 'all' || paneMode == 'kdj' : kdj;
    final height = widget.terminal
        ? math.max(
            160.0,
            (widget.viewportHeight ?? 500) - (widget.expanded ? 126 : 94),
          )
        : compact
        ? math.max(
            paneMode == 'all' ? 460.0 : 190.0,
            (widget.viewportHeight ??
                    (MediaQuery.sizeOf(context).height -
                        MediaQuery.paddingOf(context).vertical)) -
                94,
          )
        : widget.expanded
        ? math.max(450.0, MediaQuery.sizeOf(context).height - 280)
        : (280 + (volume ? 100 : 0) + (macd ? 100 : 0) + (kdj ? 100 : 0))
              .toDouble();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.terminal && widget.expanded) _portraitHeader(),
        if (widget.terminal)
          SizedBox(
            height: 30,
            child: Row(
              children: [
                for (final n in [1, 3, 6])
                  GestureDetector(
                    onTap: () => range(_months(n)),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      child: Text(
                        tr(
                          context,
                          widget.unit.startsWith('m') && widget.unit != 'month'
                              ? '${n * 22}根'
                              : n == 1
                              ? '1个月'
                              : n == 3
                              ? '3个月'
                              : '6个月',
                        ),
                        style: TextStyle(
                          fontSize: 11,
                          height: 1,
                          color: count == _months(n) ? ink : muted,
                        ),
                      ),
                    ),
                  ),
                const Spacer(),
                if (offset > 0)
                  _smallIcon(Icons.skip_next, '回到最新', () => range(count)),
                _smallIcon(Icons.show_chart, '图表指标', indicatorSettings),
                _smallIcon(Icons.tune, '均线参数', settings),
                _smallIcon(Icons.auto_graph, '行情推演', projectionSettings),
                _smallIcon(Icons.sell_outlined, '标注设置', annotationSettings),
                _smallIcon(Icons.info_outline, '标注依据', annotationDetails),
                if (!widget.expanded)
                  _smallIcon(Icons.fullscreen, '展开图表', expand),
              ],
            ),
          )
        else
          Row(
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
                        ('全部', widget.bars.length),
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
                  color: projectionOn ? const Color(0xffd5ae58) : muted,
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
                      PopupMenuItem(value: 'vol', child: Text('VOL')),
                      PopupMenuItem(
                        value: 'macd',
                        child: const Text('VOL + MACD'),
                      ),
                      PopupMenuItem(
                        value: 'kdj',
                        child: const Text('VOL + KDJ'),
                      ),
                    ],
                    icon: const Icon(Icons.view_stream_outlined),
                  ),
                IconButton(
                  onPressed: () => SystemChrome.setPreferredOrientations(
                    compact
                        ? [DeviceOrientation.portraitUp]
                        : [
                            DeviceOrientation.landscapeLeft,
                            DeviceOrientation.landscapeRight,
                          ],
                  ),
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
          ),
        _ChartLegend(
          compact: compact,
          dense: widget.terminal,
          children: overlay != 'MA'
              ? (overlay == 'BOLL'
                    ? [
                        Text(
                          'BOLL (20,2)',
                          style: TextStyle(color: ink, fontSize: 12),
                        ),
                        Text(
                          'MID ${fixed(readout.bollMid[idx])}',
                          style: TextStyle(color: ink, fontSize: 12),
                        ),
                        Text(
                          'UP ${fixed(readout.bollUpper[idx])}',
                          style: const TextStyle(
                            color: Colors.amber,
                            fontSize: 12,
                          ),
                        ),
                        Text(
                          'LOW ${fixed(readout.bollLower[idx])}',
                          style: TextStyle(
                            color: atlasColor(0xffed89bf),
                            fontSize: 12,
                          ),
                        ),
                      ]
                    : [
                        Text(
                          'SAR (0.02,0.2)',
                          style: const TextStyle(
                            color: Colors.amber,
                            fontSize: 12,
                          ),
                        ),
                        Text(
                          fixed(readout.sar[idx]),
                          style: const TextStyle(
                            color: Colors.amber,
                            fontSize: 12,
                          ),
                        ),
                      ])
              : mas
                    .map(
                      (ma) => InkWell(
                        onTap: () {
                          setState(() {
                            mas = mas
                                .map(
                                  (m) => m == ma
                                      ? MaLine(m.period, m.color, !m.enabled)
                                      : m,
                                )
                                .toList();
                            indicators = IndicatorData(widget.bars, mas);
                          });
                          context.read<AtlasStore>().prefs.setString(
                            'ma',
                            jsonEncode(mas.map((m) => m.toJson()).toList()),
                          );
                        },
                        child: Text(
                          'MA${ma.period} ${ma.enabled ? fixed(readout.averages[ma.period]?[idx]) : '—'}',
                          style: TextStyle(
                            color: ma.enabled ? chartColor(ma.color) : muted,
                            fontSize: widget.terminal ? 12 : 13,
                            height: 1.1,
                          ),
                        ),
                      ),
                    )
                    .toList(),
        ),
        SizedBox(
          height: widget.terminal
              ? 0
              : compact
              ? 4
              : 14,
        ),
        if (widget.terminal)
          SizedBox(
            height: 24,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  Text(
                    '${drawProjection && forecastHover != null ? '推演 · ' : ''}${c.time}',
                    style: TextStyle(fontSize: 11, height: 1, color: muted),
                  ),
                  const SizedBox(width: 8),
                  for (final p in [
                    ('开', c.open),
                    ('高', c.high),
                    ('低', c.low),
                    ('收', c.close),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Text(
                        '${tr(context, p.$1)} ${fixed(p.$2)}',
                        style: TextStyle(
                          fontSize: 11,
                          height: 1,
                          color: p.$1 == '高'
                              ? up
                              : p.$1 == '低'
                              ? down
                              : ink,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          )
        else
          Wrap(
            spacing: 12,
            runSpacing: 6,
            children: [
              Text(
                '${widget.expanded ? '${widget.name.isEmpty ? '' : '${widget.name} · '}${widget.symbol} · ' : ''}${c.time}',
                style: TextStyle(fontSize: 13, color: muted),
              ),
              for (final pair in [
                ('开', c.open),
                ('高', c.high),
                ('低', c.low),
                ('收', c.close),
              ])
                Text(
                  '${tr(context, pair.$1)} ${pair.$2.toStringAsFixed(2)}',
                  style: TextStyle(
                    color: pair.$1 == '低'
                        ? down
                        : pair.$1 == '高'
                        ? up
                        : ink,
                    fontSize: 13,
                  ),
                ),
            ],
          ),
        SizedBox(
          height: widget.terminal
              ? 0
              : compact
              ? 4
              : 10,
        ),
        LayoutBuilder(
          builder: (context, constraints) => Listener(
            onPointerDown: (e) {
              pointers[e.pointer] = e.localPosition;
              if (pointers.length == 2) {
                pinchDistance =
                    (pointers.values.first - pointers.values.last).distance;
                viewport.beginPinch(
                  pinchDistance!,
                  ChartPlot.fraction(
                    (pointers.values.first.dx + pointers.values.last.dx) / 2,
                    constraints.maxWidth,
                  ),
                );
                hover = null;
              }
            },
            onPointerMove: (e) {
              pointers[e.pointer] = e.localPosition;
              if (pointers.length == 2 && pinchDistance != null) {
                final distance =
                    (pointers.values.first - pointers.values.last).distance;
                if (distance > 10) {
                  setState(
                    () => viewport.pinch(
                      distance,
                      ChartPlot.fraction(
                        (pointers.values.first.dx + pointers.values.last.dx) /
                            2,
                        constraints.maxWidth,
                      ),
                    ),
                  );
                }
              }
            },
            onPointerUp: (e) {
              pointers.remove(e.pointer);
              pinchDistance = null;
            },
            onPointerCancel: (e) {
              pointers.remove(e.pointer);
            },
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onHorizontalDragStart: (_) {
                viewport.beginPan();
                setState(() => hover = null);
              },
              onHorizontalDragUpdate: (e) {
                if (pointers.length < 2) {
                  setState(
                    () => viewport.pan(
                      e.delta.dx,
                      ChartPlot.width(constraints.maxWidth),
                    ),
                  );
                }
              },
              onDoubleTap: () => range(66),
              onLongPressStart: (e) =>
                  selectAt(e.localPosition, constraints.maxWidth),
              onLongPressMoveUpdate: (e) =>
                  selectAt(e.localPosition, constraints.maxWidth),
              onLongPressEnd: (_) {},
              onTapDown: (e) => selectAt(e.localPosition, constraints.maxWidth),
              child: Semantics(
                label:
                    '${widget.symbol} ${c.time} ${tr(context, '开')} ${fixed(c.open)} ${tr(context, '高')} ${fixed(c.high)} ${tr(context, '低')} ${fixed(c.low)} ${tr(context, '收')} ${fixed(c.close)}',
                hint: '${tr(context, '双指缩放 · 横滑平移 · 长按联动十字光标')} · $studyStatus',
                onIncrease: () => setState(
                  () => hover = ((hover ?? end - 1) + 1).clamp(start, end - 1),
                ),
                onDecrease: () => setState(
                  () => hover = ((hover ?? end - 1) - 1).clamp(start, end - 1),
                ),
                child: RepaintBoundary(
                  child: CustomPaint(
                    key: const ValueKey('candlestick-canvas'),
                    size: Size(constraints.maxWidth, height),
                    painter:
                        studyReady ||
                            !markers && !shapeMarkers && !indicatorLabels
                        ? ChartPainter(
                            indicators,
                            start,
                            end,
                            (drawProjection ? forecastHover : null) ?? hover,
                            drawVolume,
                            drawMacd,
                            drawKdj,
                            shapeMarkers ? widget.events : [],
                            widget.volumeUnit,
                            math.max(
                              14,
                              context.watch<AtlasStore>().fontSize * .72,
                            ),
                            markers,
                            overlay: overlay,
                            rsi: rsi,
                            trades: studyTrades,
                            patterns: studyPatterns,
                            indicatorMarks: indicatorLabels
                                ? studyIndicators
                                : const [],
                            showPatterns: shapeMarkers,
                            showCrosses: crossMarkers,
                            projection: drawProjection ? projection : null,
                            forecast: forecastData,
                          )
                        : null,
                    child:
                        studyReady ||
                            !markers && !shapeMarkers && !indicatorLabels
                        ? null
                        : SizedBox(
                            width: constraints.maxWidth,
                            height: height,
                            child: Center(
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  if (studyBusy)
                                    const CircularProgressIndicator(
                                      strokeWidth: 1.5,
                                    ),
                                  const SizedBox(height: 12),
                                  Text(
                                    tr(
                                      context,
                                      studyStatus.contains('失败')
                                          ? '标注核验失败，请重试'
                                          : '正在同步 K线与标注',
                                    ),
                                    style: TextStyle(
                                      color: muted,
                                      fontSize: 14,
                                    ),
                                  ),
                                  if (studyStatus.contains('失败'))
                                    TextButton(
                                      onPressed: () =>
                                          refreshStudy(retry: true),
                                      child: Text(tr(context, '重试')),
                                    ),
                                ],
                              ),
                            ),
                          ),
                  ),
                ),
              ),
            ),
          ),
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

class FullscreenChart extends StatefulWidget {
  const FullscreenChart({
    super.key,
    required this.bars,
    required this.symbol,
    this.name = '',
    required this.unit,
    required this.volumeUnit,
    required this.events,
    this.trades = const [],
    this.patterns = const [],
    this.initialStudy,
    this.initialProjection,
    this.amount,
    this.amountDate,
  });
  final List<Bar> bars;
  final String symbol, unit, volumeUnit;
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
  late List<Bar> bars = widget.bars;
  late List<Json> events = widget.events;
  late List<Json> trades = widget.trades;
  late List<Json> patterns = widget.patterns;
  Timer? timer;
  bool loading = false, quoteLoading = false;
  late double? quoteAmount = widget.amount;
  late String? quoteDate = widget.amountDate;
  int refreshTick = 0;
  @override
  void initState() {
    super.initState();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.manual, overlays: []);
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) refreshQuote();
    });
    timer = Timer.periodic(const Duration(seconds: 5), (_) {
      refreshQuote();
      if (++refreshTick % 12 == 0) refresh();
    });
  }

  Future<void> refreshQuote() async {
    if (quoteLoading ||
        !mounted ||
        !cnStock(widget.symbol) ||
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
      final updated = patchDailyQuote(bars, quote, widget.volumeUnit);
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
      if (cnStock(widget.symbol) && widget.unit != 'day') {
        data = await api.get(
          '/api/desk/history',
          parameters: {'symbol': widget.symbol, 'period': widget.unit},
        );
      } else if (cnStock(widget.symbol)) {
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
    SystemChrome.setEnabledSystemUIMode(
      SystemUiMode.manual,
      overlays: SystemUiOverlay.values,
    );
    SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: LayoutBuilder(
        builder: (context, c) {
          final portrait =
              MediaQuery.orientationOf(context) == Orientation.portrait;
          final chart = MarketChart(
            bars: bars,
            amount: quoteAmount,
            amountDate: quoteDate,
            symbol: widget.symbol,
            name: widget.name,
            unit: widget.unit,
            volumeUnit: widget.volumeUnit,
            events: events,
            trades: trades,
            patterns: patterns,
            initialStudy: widget.initialStudy,
            initialProjection: widget.initialProjection,
            expanded: true,
            terminal: portrait,
            viewportHeight: c.maxHeight,
          );
          return portrait ? chart : SingleChildScrollView(child: chart);
        },
      ),
    ),
  );
}

class ChartPainter extends CustomPainter {
  ChartPainter(
    this.data,
    this.start,
    this.end,
    this.hover,
    this.volume,
    this.macd,
    this.kdj,
    this.events,
    this.unit,
    this.font,
    this.showSignals, {
    this.overlay = 'MA',
    this.rsi = false,
    this.trades = const [],
    this.patterns = const [],
    this.indicatorMarks = const [],
    this.showPatterns = true,
    this.showCrosses = false,
    this.projection,
    this.forecast,
  });
  final IndicatorData data;
  final int start, end;
  final int? hover;
  final bool volume, macd, kdj;
  final List<Json> events, trades, patterns;
  final List<Json> indicatorMarks;
  final Json? projection;
  final IndicatorData? forecast;
  final String unit;
  final double font;
  final bool showSignals, rsi, showPatterns, showCrosses;
  final bool light = AtlasPalette.light;
  final String overlay;
  void label(
    Canvas c,
    String text,
    Offset p, {
    Color? color,
    double? size,
    bool background = false,
  }) {
    final t = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(fontSize: size ?? font, color: color ?? muted),
      ),
      textDirection: TextDirection.ltr,
      maxLines: 1,
    )..layout();
    if (background) {
      c.drawRRect(
        RRect.fromRectAndRadius(
          (p & t.size).inflate(2),
          const Radius.circular(2),
        ),
        Paint()..color = atlasColor(0xe609090b),
      );
    }
    t.paint(c, p);
  }

  double textWidth(String text, {double? size}) => (TextPainter(
    text: TextSpan(
      text: text,
      style: TextStyle(fontSize: size ?? font),
    ),
    textDirection: TextDirection.ltr,
  )..layout()).width;

  @override
  void paint(Canvas c, Size size) {
    if (data.bars.isEmpty) return;
    const left = ChartPlot.inset, right = ChartPlot.inset;
    final width = ChartPlot.width(size.width),
        n = end - start,
        drawData = forecast ?? data,
        future = forecast?.bars.sublist(end) ?? <Bar>[],
        drawEnd = end + future.length,
        step = width / math.max(1, n + future.length),
        parts =
            1 +
            (volume ? 1 : 0) +
            (macd ? 1 : 0) +
            (kdj ? 1 : 0) +
            (rsi ? 1 : 0),
        priceHeight = parts == 1
            ? size.height - 28
            : math.max(
                95.0,
                math.min(
                  size.height *
                      (parts == 2
                          ? .76
                          : parts == 3
                          ? .67
                          : .60),
                  size.height - 28 - (parts - 1) * 54,
                ),
              ),
        small = (size.height - priceHeight - 28) / math.max(1, parts - 1);
    double x(int i) => left + (i - start + .5) * step;
    final visible = data.bars.sublist(start, end);
    var lo = visible.map((b) => b.low).reduce(math.min),
        hi = visible.map((b) => b.high).reduce(math.max);
    for (final b in future) {
      lo = math.min(lo, b.low);
      hi = math.max(hi, b.high);
    }
    if (future.isNotEmpty) {
      final series = overlay == 'MA'
          ? drawData.mas
                .where((m) => m.enabled)
                .map((m) => drawData.averages[m.period]!)
          : overlay == 'BOLL'
          ? [drawData.bollUpper, drawData.bollLower]
          : [drawData.sar];
      for (final values in series) {
        for (final v in values.sublist(end, drawEnd).whereType<double>()) {
          lo = math.min(lo, v);
          hi = math.max(hi, v);
        }
      }
    }
    for (final ma in data.mas.where((m) => m.enabled && overlay == 'MA')) {
      for (final value
          in data.averages[ma.period]!
              .sublist(start, end)
              .whereType<double>()) {
        lo = math.min(lo, value);
        hi = math.max(hi, value);
      }
    }
    for (final series
        in overlay == 'BOLL'
            ? [data.bollUpper, data.bollLower]
            : overlay == 'SAR'
            ? [data.sar]
            : <List<double?>>[]) {
      for (final v in series.sublist(start, end).whereType<double>()) {
        lo = math.min(lo, v);
        hi = math.max(hi, v);
      }
    }
    final pad = (hi - lo) * .08;
    lo -= pad;
    hi += pad;
    if (hi - lo < .0001) hi = lo + 1;
    double y(double v) => 20 + (hi - v) / (hi - lo) * (priceHeight - 30);
    final grid = Paint()
      ..color = atlasColor(0xff29292f)
      ..strokeWidth = .6;
    final gridCount = priceHeight < 180 ? 3 : 5;
    for (var i = 0; i < gridCount; i++) {
      final value = lo + (hi - lo) * i / (gridCount - 1), py = y(value);
      c.drawLine(Offset(left, py), Offset(size.width - right, py), grid);
    }
    c.save();
    c.clipRect(Rect.fromLTRB(left, 15, size.width - right, priceHeight));
    for (var i = start; i < end; i++) {
      final bar = data.bars[i],
          paint = Paint()..color = bar.close >= bar.open ? up : down;
      final cx = x(i);
      c.drawLine(
        Offset(cx, y(bar.high)),
        Offset(cx, y(bar.low)),
        paint..strokeWidth = 1,
      );
      c.drawRect(
        Rect.fromLTRB(
          cx - step * .32,
          math.min(y(bar.open), y(bar.close)),
          cx + step * .32,
          math.max(y(bar.open), y(bar.close)) + 1,
        ),
        paint,
      );
    }
    for (final ma in data.mas.where((m) => m.enabled && overlay == 'MA')) {
      final path = Path();
      var began = false;
      for (var i = start; i < end; i++) {
        final v = data.averages[ma.period]![i];
        if (v == null) continue;
        if (!began) {
          path.moveTo(x(i), y(v));
          began = true;
        } else {
          path.lineTo(x(i), y(v));
        }
      }
      c.drawPath(
        path,
        Paint()
          ..color = chartColor(ma.color)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.1,
      );
    }
    if (overlay != 'MA') {
      final series = overlay == 'BOLL'
          ? [data.bollMid, data.bollUpper, data.bollLower]
          : [data.sar];
      for (var k = 0; k < series.length; k++) {
        final path = Path();
        var began = false;
        for (var i = start; i < end; i++) {
          final v = series[k][i];
          if (v == null) continue;
          if (overlay == 'SAR') {
            c.drawCircle(
              Offset(x(i), y(v)),
              1.8,
              Paint()..color = Colors.amber,
            );
          } else {
            if (!began) {
              path.moveTo(x(i), y(v));
              began = true;
            } else {
              path.lineTo(x(i), y(v));
            }
          }
        }
        c.drawPath(
          path,
          Paint()
            ..color = [ink, Colors.amber, atlasColor(0xffed89bf)][k]
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.1,
        );
      }
    }
    if (showCrosses) {
      for (final signal in data.signals) {
        final index = signal['index'] as int;
        if (index < start || index >= end) continue;
        final isDeath = signal['kind'] == 'death',
            px = x(index),
            py = isDeath
                ? y(data.bars[index].high) - 9
                : y(data.bars[index].low) + 9;
        if (signal['kind'] == 'bloom') {
          c.drawCircle(Offset(px, py + 8), 3.5, Paint()..color = Colors.amber);
        } else {
          final path = Path()
            ..moveTo(px, py + (isDeath ? 5 : -5))
            ..lineTo(px - 4, py + (isDeath ? -3 : 3))
            ..lineTo(px + 4, py + (isDeath ? -3 : 3))
            ..close();
          c.drawPath(path, Paint()..color = isDeath ? down : up);
          label(
            c,
            isDeath ? '死叉' : '金叉',
            Offset(
              (px - 8).clamp(left, size.width - right - 22),
              (py + (isDeath ? -20 : 7)).clamp(14, priceHeight - 16),
            ),
            color: isDeath ? down : up,
            size: 12,
            background: true,
          );
        }
      }
    }
    if (showPatterns && patterns.isNotEmpty) {
      final dates = {
        for (var i = 0; i < data.bars.length; i++) data.bars[i].time: i,
      };
      final visible =
          patterns.where((m) {
            if (m['chartVisible'] == false) return false;
            final index = dates[str(m['time'])];
            return index != null && index >= start && index < end;
          }).toList()..sort((a, b) {
            final current =
                (b['time'] == data.bars.last.time ? 1 : 0) -
                (a['time'] == data.bars.last.time ? 1 : 0);
            return current != 0
                ? current
                : (numOf(b['priority']) ?? 0).compareTo(
                    numOf(a['priority']) ?? 0,
                  );
          });
      final occupied = <Rect>[];
      for (final t in showSignals ? trades : <Json>[]) {
        final index = dates[str(t['time'])];
        if (index == null || index < start || index >= end) continue;
        final top = t['side'] == 'buy'
            ? y(data.bars[index].low) + 10
            : y(data.bars[index].high) - 25;
        occupied.add(Rect.fromLTWH(x(index) - 10, top, 45, 20));
      }
      for (final mark in visiblePatternRanges(
        patterns,
        data.bars.map((b) => b.time).toList(),
        start,
        end,
      )) {
        final range = obj(mark['range']),
            from = dates[str(range['from'])],
            to = dates[str(range['to'])],
            high = numOf(range['high']),
            low = numOf(range['low']);
        if (from == null ||
            to == null ||
            high == null ||
            low == null ||
            to < start ||
            from >= end) {
          continue;
        }
        final box = Rect.fromLTRB(
          x(math.max(start, from)) - step * .5,
          y(high),
          x(math.min(end - 1, to)) + step * .5,
          y(low),
        ).intersect(Rect.fromLTRB(left, 14, size.width - right, priceHeight));
        if (box.isEmpty) continue;
        c.drawRect(
          box,
          Paint()..color = const Color(0xff829bb4).withValues(alpha: .04),
        );
        c.drawRect(
          box,
          Paint()
            ..color = const Color(0xff829bb4).withValues(alpha: .6)
            ..style = PaintingStyle.stroke
            ..strokeWidth = .7,
        );
      }
      final usedDates = <String>{};
      var labels = 0;
      for (final mark in visible) {
        final date = str(mark['time']);
        if (!usedDates.add(date)) continue;
        final index = dates[date]!,
            bar = data.bars[index],
            px = x(index),
            markFont = math.max(11.0, math.min(13.0, font - 1));
        final title =
                str(mark['label']) + (mark['provisional'] == true ? '·预警' : ''),
            labelWidth = textWidth(title, size: markFont),
            colour = mark['direction'] == 'bullish'
                ? up
                : mark['direction'] == 'bearish'
                ? down
                : muted;
        final above = mark['position'] == 'above',
            dotY = above ? y(bar.high) - 4 : y(bar.low) + 5;
        c.drawCircle(Offset(px, dotY), 2.2, Paint()..color = colour);
        if (labels >= 6 || labelWidth > width) continue;
        final lx = (px - labelWidth / 2).clamp(
              left,
              size.width - right - labelWidth,
            ),
            candidates = [
              above ? y(bar.high) - 21 : y(bar.low) + 10,
              above ? y(bar.low) + 10 : y(bar.high) - 21,
              above ? y(bar.high) - 48 : y(bar.low) + 37,
              above ? y(bar.low) + 37 : y(bar.high) - 48,
            ];
        for (final ly in candidates) {
          final rect = Rect.fromLTWH(
            lx,
            ly,
            labelWidth,
            markFont + 4,
          ).inflate(3);
          if (rect.top < 14 ||
              rect.bottom > priceHeight ||
              occupied.any((r) => r.overlaps(rect))) {
            continue;
          }
          label(
            c,
            title,
            Offset(lx, ly),
            color: colour,
            size: markFont,
            background: true,
          );
          occupied.add(rect);
          labels++;
          break;
        }
      }
    }
    for (final event in showPatterns ? events : <Json>[]) {
      final index = data.bars.indexWhere((b) => b.time == event['date']);
      if (index >= start && index < end) {
        final px = x(index), py = y(data.bars[index].low) + 10;
        c.drawCircle(
          Offset(px, py),
          3,
          Paint()..color = atlasColor(0xffd9c89f),
        );
      }
    }
    if (showSignals) {
      for (final trade in trades) {
        final index = data.bars.indexWhere((b) => b.time == trade['time']);
        if (index < start || index >= end) continue;
        final buy = trade['side'] == 'buy',
            px = x(index),
            py = buy
                ? y(data.bars[index].low) + 15
                : y(data.bars[index].high) - 24;
        label(
          c,
          trade['confirmed'] == false
              ? str(trade['label'])
              : (buy ? '买 ↑' : '卖 ↓'),
          Offset(
            (px - 8).clamp(left, size.width - right - 24),
            py.clamp(15, priceHeight - 15),
          ),
          color: trade['confirmed'] == false
              ? const Color(0xffcfad6e)
              : buy
              ? up
              : down,
          size: 13,
          background: true,
        );
      }
    }
    c.restore();
    for (var i = 0; i < gridCount; i++) {
      final value = lo + (hi - lo) * i / (gridCount - 1);
      label(
        c,
        value.toStringAsFixed(2),
        Offset(left, y(value) - 7),
        background: true,
      );
    }
    void dash(Offset from, Offset to, Color color) {
      final delta = to - from, length = delta.distance;
      for (var d = 0.0; d < length; d += 7) {
        c.drawLine(
          from + delta * (d / math.max(1, length)),
          from + delta * (math.min(length, d + 4) / math.max(1, length)),
          Paint()
            ..color = color.withValues(alpha: .7)
            ..strokeWidth = 1.1,
        );
      }
    }

    if (future.isNotEmpty) {
      final boundary = x(end - 1) + step * .5;
      c.save();
      c.clipRect(Rect.fromLTRB(left, 14, size.width - right, priceHeight));
      c.drawRect(
        Rect.fromLTRB(boundary, 14, size.width - right, priceHeight),
        Paint()..color = const Color(0xffd5ae58).withValues(alpha: .06),
      );
      c.drawLine(
        Offset(boundary, 14),
        Offset(boundary, priceHeight),
        Paint()..color = const Color(0xffd5ae58).withValues(alpha: .5),
      );
      for (var j = 0; j < future.length; j++) {
        final bar = future[j],
            cx = x(end + j),
            color = bar.close >= bar.open ? up : down;
        c.drawLine(
          Offset(cx, y(bar.high)),
          Offset(cx, y(bar.low)),
          Paint()..color = color.withValues(alpha: .7),
        );
        final rect = Rect.fromLTRB(
          cx - step * .32,
          math.min(y(bar.open), y(bar.close)),
          cx + step * .32,
          math.max(y(bar.open), y(bar.close)) + 1,
        );
        c.drawRect(rect, Paint()..color = color.withValues(alpha: .18));
        c.drawRect(
          rect,
          Paint()
            ..color = color.withValues(alpha: .7)
            ..style = PaintingStyle.stroke
            ..strokeWidth = .8,
        );
      }
      final lines = <({List<double?> values, Color color})>[
        if (overlay == 'MA')
          for (final m in drawData.mas.where((m) => m.enabled))
            (values: drawData.averages[m.period]!, color: chartColor(m.color)),
        if (overlay == 'BOLL')
          ...(<({List<double?> values, Color color})>[
            (values: drawData.bollMid, color: ink),
            (values: drawData.bollUpper, color: Colors.amber),
            (values: drawData.bollLower, color: const Color(0xffed89bf)),
          ]),
        if (overlay == 'SAR') (values: drawData.sar, color: Colors.amber),
      ];
      for (final line in lines) {
        for (var i = end; i < drawEnd; i++) {
          final v = line.values[i], p = line.values[i - 1];
          if (v == null) continue;
          if (overlay == 'SAR') {
            c.drawCircle(
              Offset(x(i), y(v)),
              1.8,
              Paint()..color = line.color.withValues(alpha: .7),
            );
          } else if (p != null) {
            dash(Offset(x(i - 1), y(p)), Offset(x(i), y(v)), line.color);
          }
        }
      }
      label(
        c,
        '推演K线 · 假设指标',
        Offset(boundary + 3, 17),
        color: const Color(0xffd5ae58),
        size: 10,
      );
      c.restore();
    }
    var top = priceHeight + 4;
    void pane(
      String title,
      List<List<double?>> values,
      List<Color> colors, {
      bool histogram = false,
      bool volumeBars = false,
    }) {
      final h = small - 4;
      label(c, title, Offset(left, top), color: ink);
      final all = values
          .expand((r) => r.sublist(start, drawEnd).whereType<double>())
          .toList();
      if (all.isEmpty) {
        top += small;
        return;
      }
      var min = all.reduce(math.min), max = all.reduce(math.max);
      if (histogram || volumeBars) {
        min = math.min(0, min);
        max = math.max(0, max);
      }
      if (title.startsWith('RSI')) {
        min = 0;
        max = 100;
      }
      if (max - min < .0001) max = min + 1;
      double py(double v) =>
          top + 21 + (max - v) / (max - min) * math.max(5, h - 25);
      c.drawLine(
        Offset(left, top + 20),
        Offset(size.width - right, top + 20),
        grid,
      );
      for (var k = 0; k < values.length; k++) {
        final path = Path();
        var first = true;
        for (var i = start; i < drawEnd; i++) {
          final v = values[k][i];
          if (v == null) continue;
          if (k == 0 && (histogram || volumeBars)) {
            final color = volumeBars
                ? (drawData.bars[i].close >= drawData.bars[i].open ? up : down)
                : v >= 0
                ? up
                : down;
            c.drawRect(
              Rect.fromLTRB(
                x(i) - step * .3,
                math.min(py(v), py(0)),
                x(i) + step * .3,
                math.max(py(v), py(0)) + 1,
              ),
              Paint()..color = i >= end ? color.withValues(alpha: .3) : color,
            );
          } else if (i >= end) {
            final previous = values[k][i - 1];
            if (previous != null) {
              dash(
                Offset(x(i - 1), py(previous)),
                Offset(x(i), py(v)),
                colors[k],
              );
            }
          } else {
            if (first) {
              path.moveTo(x(i), py(v));
              first = false;
            } else {
              path.lineTo(x(i), py(v));
            }
          }
        }
        c.drawPath(
          path,
          Paint()
            ..color = colors[k]
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.1,
        );
      }
      label(
        c,
        volumeBars ? amount(max) : max.toStringAsFixed(2),
        Offset(left, top + 18),
        background: true,
      );
      if (small >= 60) {
        label(
          c,
          volumeBars ? '0' : min.toStringAsFixed(2),
          Offset(left, top + h - 10),
          background: true,
        );
      }
      {
        for (var k = 0; k < values.length; k++) {
          final v = values[k][hover ?? end - 1];
          if (v != null) {
            label(
              c,
              volumeBars ? amount(v) : v.toStringAsFixed(2),
              Offset(left + 58 + k * (size.width < 420 ? 55 : 90), top),
              color: colors[k],
              size: font - 1,
            );
          }
        }
      }
      final annotations =
          indicatorMarks
              .where((m) => str(m['pane']) == title.split(' ').first)
              .toList()
            ..sort(
              (a, b) =>
                  ((str(b['kind']).contains('divergence') ? 100000 : 0) +
                          data.bars.indexWhere((v) => v.time == b['time']))
                      .compareTo(
                        (str(a['kind']).contains('divergence') ? 100000 : 0) +
                            data.bars.indexWhere((v) => v.time == a['time']),
                      ),
            );
      final occupied = <Rect>[];
      for (final mark in annotations) {
        final index = data.bars.indexWhere((b) => b.time == mark['time']),
            value = numOf(mark['value']);
        if (index < start ||
            index >= end ||
            value == null ||
            occupied.length >= 3) {
          continue;
        }
        final text =
                '${str(mark['label'])}${mark['provisional'] == true ? '·预警' : ''}',
            w = textWidth(text, size: 11) + 6;
        if (h < 38 || w > width) {
          // Compact landscape panes still show the event; its full explanation
          // remains in annotation details when a text label cannot fit.
          final dot = Offset(
                x(index),
                py(value).clamp(top + 2, top + math.max(2.0, h - 2)),
              ),
              rect = Rect.fromCircle(center: dot, radius: 2);
          if (occupied.any((r) => r.inflate(5).overlaps(rect))) continue;
          occupied.add(rect);
          c.drawCircle(
            dot,
            2,
            Paint()..color = mark['bullish'] == true ? up : down,
          );
          continue;
        }
        final lx = (x(index) - w / 2).clamp(left, size.width - right - w),
            ly = (py(value) + (mark['bullish'] == true ? 5 : -19)).clamp(
              top + 22,
              top + h - 16,
            ),
            rect = Rect.fromLTWH(lx, ly, w, 16);
        if (occupied.any((r) => r.inflate(5).overlaps(rect))) continue;
        occupied.add(rect);
        label(
          c,
          text,
          Offset(lx, ly),
          size: 11,
          color: mark['bullish'] == true ? up : down,
          background: true,
        );
      }
      top += small;
    }

    if (volume) {
      pane(
        'VOL ($unit)',
        [
          drawData.bars.map<double?>((b) => b.volume).toList(),
          drawData.vol5,
          drawData.vol20,
        ],
        [ink, atlasColor(0xfff7cf65), atlasColor(0xffed89bf)],
        volumeBars: true,
      );
    }
    if (macd) {
      pane(
        'MACD',
        [drawData.hist, drawData.dif, drawData.dea],
        [up, ink, atlasColor(0xfff7cf65)],
        histogram: true,
      );
    }
    if (kdj) {
      pane(
        'KDJ',
        [drawData.kdjK, drawData.kdjD, drawData.kdjJ],
        [ink, atlasColor(0xfff7cf65), atlasColor(0xffd968e8)],
      );
    }
    if (rsi) pane('RSI (14)', [drawData.rsi14], [Colors.amber]);
    for (final index in [
      start,
      (start + end) ~/ 2,
      end - 1,
      if (future.isNotEmpty) drawEnd - 1,
    ]) {
      label(
        c,
        (drawData.bars[index].time.length > 10
            ? drawData.bars[index].time.substring(11)
            : drawData.bars[index].time.substring(5)),
        Offset(
          (x(index) -
                  textWidth(
                        (drawData.bars[index].time.length > 10
                            ? drawData.bars[index].time.substring(11)
                            : drawData.bars[index].time.substring(5)),
                        size: font - 1,
                      ) /
                      2)
              .clamp(
                left,
                size.width -
                    right -
                    textWidth(
                      (drawData.bars[index].time.length > 10
                          ? drawData.bars[index].time.substring(11)
                          : drawData.bars[index].time.substring(5)),
                      size: font - 1,
                    ),
              ),
          size.height - 17,
        ),
        size: font - 1,
      );
    }
    if (hover != null && hover! >= start && hover! < drawEnd) {
      final cross = Paint()
        ..color = ink.withValues(alpha: .54)
        ..strokeWidth = .8;
      c.drawLine(
        Offset(x(hover!), 15),
        Offset(x(hover!), size.height - 22),
        cross,
      );
      c.drawLine(
        Offset(left, y(drawData.bars[hover!].close)),
        Offset(size.width - right, y(drawData.bars[hover!].close)),
        cross,
      );
    }
  }

  @override
  bool shouldRepaint(covariant ChartPainter old) =>
      forecast != old.forecast ||
      projection != old.projection ||
      light != old.light ||
      data != old.data ||
      start != old.start ||
      end != old.end ||
      hover != old.hover ||
      volume != old.volume ||
      macd != old.macd ||
      kdj != old.kdj ||
      events != old.events ||
      font != old.font ||
      showSignals != old.showSignals ||
      showPatterns != old.showPatterns ||
      showCrosses != old.showCrosses ||
      patterns != old.patterns ||
      indicatorMarks != old.indicatorMarks ||
      overlay != old.overlay ||
      rsi != old.rsi ||
      trades != old.trades;
}
