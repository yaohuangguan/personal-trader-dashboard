import '../core/patch_daily_quote.dart';

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
  });
  final List<Bar> bars;
  final String symbol, unit, volumeUnit;
  final String name;
  final List<Json> events, trades, patterns;
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
  int? hover;
  List<Json> studyTrades = [], studyPatterns = [], studyIndicators = [];
  int studyRequest = 0;
  String studyKey = '', studyStatus = '标注依据当前MA · 核验中';
  bool volume = true, macd = true, kdj = true, markers = true;
  bool shapeMarkers = true, crossMarkers = false, indicatorLabels = true;
  Timer? studyRetry;
  int studyRetries = 0;
  bool studyBusy = false;
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
    viewport.length = widget.bars.length;
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
  }

  @override
  void dispose() {
    studyRetry?.cancel();
    super.dispose();
  }

  int get end => viewport.end;
  int get start => viewport.start;
  Bar? get current => widget.bars.isEmpty
      ? null
      : widget.bars[(hover ?? (end - 1)).clamp(0, widget.bars.length - 1)];
  void range(int days) => setState(() {
    viewport.reset(days);
    hover = null;
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
    final i = viewport.select(ChartPlot.fraction(p.dx, width));
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
      studyTrades = sameParameters
          ? studyTrades
                .where((m) => m['time'] != widget.bars.last.time)
                .toList()
          : [];
      studyPatterns = sameParameters
          ? studyPatterns
                .where((m) => m['time'] != widget.bars.last.time)
                .toList()
          : [];
      studyIndicators = sameParameters
          ? studyIndicators
                .where((m) => m['time'] != widget.bars.last.time)
                .toList()
          : [];
      studyStatus = '标注依据当前MA · 核验中';
    });
    try {
      final result = await context.read<AtlasStore>().api.post(
        '/api/chart-study',
        {
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
        },
      );
      if (!mounted || request != studyRequest || key != currentStudyKey) return;
      setState(() {
        studyTrades = rows(result['tradeMarkers']);
        studyPatterns = rows(result['patternMarks']);
        studyIndicators = rows(result['indicatorMarks']);
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
      if (mounted) refreshStudy();
    });
    if (widget.bars.isEmpty) {
      return const SizedBox(
        height: 200,
        child: Center(child: Text('No valid price history')),
      );
    }
    final c = current!, idx = hover ?? end - 1;
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
                          'MID ${fixed(indicators.bollMid[idx])}',
                          style: TextStyle(color: ink, fontSize: 12),
                        ),
                        Text(
                          'UP ${fixed(indicators.bollUpper[idx])}',
                          style: const TextStyle(
                            color: Colors.amber,
                            fontSize: 12,
                          ),
                        ),
                        Text(
                          'LOW ${fixed(indicators.bollLower[idx])}',
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
                          fixed(indicators.sar[idx]),
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
                          'MA${ma.period} ${ma.enabled ? fixed(indicators.averages[ma.period]?[idx]) : '—'}',
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
                    c.time,
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
                    painter: ChartPainter(
                      indicators,
                      start,
                      end,
                      hover,
                      drawVolume,
                      drawMacd,
                      drawKdj,
                      shapeMarkers ? widget.events : [],
                      widget.volumeUnit,
                      math.max(14, context.watch<AtlasStore>().fontSize * .72),
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
  });
  final List<Bar> bars;
  final String symbol, unit, volumeUnit;
  final String name;
  final List<Json> events, trades, patterns;
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
  double? quoteAmount;
  String? quoteDate;
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
  });
  final IndicatorData data;
  final int start, end;
  final int? hover;
  final bool volume, macd, kdj;
  final List<Json> events, trades, patterns;
  final List<Json> indicatorMarks;
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
        step = width / math.max(1, n),
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
      for (final mark
          in patterns
              .where((m) => m['range'] is Map)
              .toList()
              .reversed
              .take(3)) {
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
        );
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
        if (labels >= 6) continue;
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
          .expand((r) => r.sublist(start, end).whereType<double>())
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
        for (var i = start; i < end; i++) {
          final v = values[k][i];
          if (v == null) continue;
          if (k == 0 && (histogram || volumeBars)) {
            final color = volumeBars
                ? (data.bars[i].close >= data.bars[i].open ? up : down)
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
              Paint()..color = color,
            );
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
          data.bars.map<double?>((b) => b.volume).toList(),
          data.vol5,
          data.vol20,
        ],
        [ink, atlasColor(0xfff7cf65), atlasColor(0xffed89bf)],
        volumeBars: true,
      );
    }
    if (macd) {
      pane(
        'MACD',
        [data.hist, data.dif, data.dea],
        [up, ink, atlasColor(0xfff7cf65)],
        histogram: true,
      );
    }
    if (kdj) {
      pane(
        'KDJ',
        [data.kdjK, data.kdjD, data.kdjJ],
        [ink, atlasColor(0xfff7cf65), atlasColor(0xffd968e8)],
      );
    }
    if (rsi) pane('RSI (14)', [data.rsi14], [Colors.amber]);
    for (final index in [start, (start + end) ~/ 2, end - 1]) {
      label(
        c,
        (data.bars[index].time.length > 10
            ? data.bars[index].time.substring(11)
            : data.bars[index].time.substring(5)),
        Offset(
          (x(index) -
                  textWidth(
                        (data.bars[index].time.length > 10
                            ? data.bars[index].time.substring(11)
                            : data.bars[index].time.substring(5)),
                        size: font - 1,
                      ) /
                      2)
              .clamp(
                left,
                size.width -
                    right -
                    textWidth(
                      (data.bars[index].time.length > 10
                          ? data.bars[index].time.substring(11)
                          : data.bars[index].time.substring(5)),
                      size: font - 1,
                    ),
              ),
          size.height - 17,
        ),
        size: font - 1,
      );
    }
    if (hover != null && hover! >= start && hover! < end) {
      final cross = Paint()
        ..color = ink.withValues(alpha: .54)
        ..strokeWidth = .8;
      c.drawLine(
        Offset(x(hover!), 15),
        Offset(x(hover!), size.height - 22),
        cross,
      );
      c.drawLine(
        Offset(left, y(data.bars[hover!].close)),
        Offset(size.width - right, y(data.bars[hover!].close)),
        cross,
      );
    }
  }

  @override
  bool shouldRepaint(covariant ChartPainter old) =>
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

class IntradayChart extends StatelessWidget {
  const IntradayChart(
    this.data, {
    super.key,
    this.height = 280,
    this.showSource = true,
  });
  final double height;
  final bool showSource;
  final Json data;
  @override
  Widget build(BuildContext context) {
    final points = rows(data['points']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${data['date']} · ${tr(context, '北京时间')}',
          style: TextStyle(color: muted, fontSize: 13),
        ),
        SizedBox(
          height: height,
          width: double.infinity,
          child: CustomPaint(
            painter: _IntradayPainter(points, numOf(data['previous'])),
          ),
        ),
        if (showSource) SourceLine(data),
      ],
    );
  }
}

class _IntradayPainter extends CustomPainter {
  _IntradayPainter(this.points, this.previous);
  final List<Json> points;
  final double? previous;
  @override
  void paint(Canvas c, Size size) {
    if (points.isEmpty) return;
    final prices = points.map((p) => numOf(p['price']) ?? 0).toList(),
        min = prices.reduce(math.min),
        max = prices.reduce(math.max),
        lo = math.min(min, previous ?? min) * .999,
        hi = math.max(max, previous ?? max) * 1.001;
    final width = size.width - 61, height = (size.height - 45) * .72;
    double y(double value) => 15 + (hi - value) / (hi - lo) * height;
    final path = Path();
    for (var i = 0; i < prices.length; i++) {
      final p = Offset(
        8 + i / math.max(1, prices.length - 1) * width,
        y(prices[i]),
      );
      if (i == 0) {
        path.moveTo(p.dx, p.dy);
      } else {
        path.lineTo(p.dx, p.dy);
      }
    }
    for (var i = 0; i < 4; i++) {
      final v = lo + (hi - lo) * i / 3;
      final text = TextPainter(
        text: TextSpan(
          text: v.toStringAsFixed(2),
          style: TextStyle(color: muted, fontSize: 12),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      text.paint(c, Offset(width + 13, y(v) - 6));
      c.drawLine(
        Offset(8, y(v)),
        Offset(width + 8, y(v)),
        Paint()..color = atlasColor(0xff303038),
      );
    }
    c.drawPath(
      path,
      Paint()
        ..color = atlasColor(0xffdddded)
        ..strokeWidth = 1.8
        ..style = PaintingStyle.stroke,
    );
    if (previous != null) {
      c.drawLine(
        Offset(8, y(previous!)),
        Offset(width + 8, y(previous!)),
        Paint()..color = Colors.amber.withValues(alpha: .4),
      );
    }
    final volumes = points
            .map((p) => math.max(0, numOf(p['volume']) ?? 0))
            .toList(),
        maxVolume = volumes.fold<double>(
          0,
          (n, v) => math.max(n, v).toDouble(),
        ),
        volTop = height + 35,
        volBottom = size.height - 25,
        barWidth = math.max(.8, width / math.max(1, points.length) * .7);
    final title = TextPainter(
      text: TextSpan(
        text: 'VOL  ${amount(volumes.last)}',
        style: TextStyle(color: muted, fontSize: 12),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    title.paint(c, Offset(8, volTop - 17));
    c.drawLine(
      Offset(8, volTop),
      Offset(8 + width, volTop),
      Paint()..color = atlasColor(0xff303038),
    );
    if (maxVolume > 0) {
      for (var i = 0; i < points.length; i++) {
        final px = 8 + i / math.max(1, points.length - 1) * width,
            barHeight =
                volumes[i] / maxVolume * math.max(5, volBottom - volTop);
        c.drawRect(
          Rect.fromLTWH(
            px - barWidth / 2,
            volBottom - barHeight,
            barWidth,
            barHeight,
          ),
          Paint()
            ..color =
                prices[i] >= (i == 0 ? previous ?? prices[i] : prices[i - 1])
                ? up
                : down,
        );
      }
    }
    for (final pair in [
      (0, str(points.first['clock'])),
      (points.length ~/ 2, str(points[points.length ~/ 2]['clock'])),
      (points.length - 1, str(points.last['clock'])),
    ]) {
      final t = TextPainter(
        text: TextSpan(
          text: pair.$2,
          style: TextStyle(color: muted, fontSize: 12),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      t.paint(
        c,
        Offset(
          (8 + pair.$1 / math.max(1, points.length - 1) * width - 12).clamp(
            0,
            size.width - 40,
          ),
          size.height - 20,
        ),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _IntradayPainter old) => true;
}
