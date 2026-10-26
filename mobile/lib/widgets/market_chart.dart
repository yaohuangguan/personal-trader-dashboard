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
    this.unit = 'day',
    this.name = '',
    this.terminal = false,
    this.viewportHeight,
    this.volumeUnit = '手',
    this.events = const [],
    this.expanded = false,
  });
  final List<Bar> bars;
  final String symbol, unit, volumeUnit;
  final String name;
  final List<Json> events;
  final bool expanded;
  final bool terminal;
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
  String paneMode = 'macd';
  int? hover;
  bool volume = true, macd = true, kdj = true, markers = true;
  final Map<int, Offset> pointers = {};
  double? pinchDistance;

  @override
  void initState() {
    super.initState();
    final raw = context.read<AtlasStore>().prefs.getString('ma');
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
              MediaQuery.viewInsetsOf(ctx).bottom + 22,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    tr(ctx, '均线参数'),
                    style: Theme.of(ctx).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 16),
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
                  if (error != null)
                    Text(error!, style: const TextStyle(color: up)),
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
    final i = viewport.select((p.dx - 52) / (width - 106));
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
        ),
      ),
    );
    if (!mounted) return;
    final raw = context.read<AtlasStore>().prefs.getString('ma');
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
  int _months(int n) => widget.unit == 'month'
      ? n
      : widget.unit == 'week'
      ? {1: 4, 3: 13, 6: 26}[n]!
      : n * 22;
  @override
  Widget build(BuildContext context) {
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
        ? math.max(160.0, (widget.viewportHeight ?? 500) - 94)
        : compact
        ? math.max(
            paneMode == 'all' ? 460.0 : 190.0,
            MediaQuery.sizeOf(context).height -
                MediaQuery.paddingOf(context).vertical -
                138,
          )
        : widget.expanded
        ? math.max(450.0, MediaQuery.sizeOf(context).height - 280)
        : (280 + (volume ? 100 : 0) + (macd ? 100 : 0) + (kdj ? 100 : 0))
              .toDouble();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
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
                          n == 1
                              ? '1个月'
                              : n == 3
                              ? '3个月'
                              : '6个月',
                        ),
                        style: TextStyle(
                          fontSize: 11,
                          height: 1,
                          color: count == _months(n) ? Colors.white : muted,
                        ),
                      ),
                    ),
                  ),
                const Spacer(),
                if (offset > 0)
                  _smallIcon(Icons.skip_next, '回到最新', () => range(count)),
                _smallIcon(Icons.tune, '均线参数', settings),
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
                              color: count == item.$2 ? Colors.white : muted,
                              fontSize: 13,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
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
          children: mas
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
                      color: ma.enabled ? ma.color : muted,
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
                    style: const TextStyle(
                      fontSize: 11,
                      height: 1,
                      color: muted,
                    ),
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
                              : Colors.white,
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
                style: const TextStyle(fontSize: 13, color: muted),
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
                        : Colors.white,
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
                  ((pointers.values.first.dx + pointers.values.last.dx) / 2 -
                          52) /
                      (constraints.maxWidth - 106),
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
                      ((pointers.values.first.dx + pointers.values.last.dx) /
                                  2 -
                              52) /
                          (constraints.maxWidth - 106),
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
                    () => viewport.pan(e.delta.dx, constraints.maxWidth - 106),
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
                hint: tr(context, '双指缩放 · 横滑平移 · 长按联动十字光标'),
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
                      markers ? widget.events : [],
                      widget.volumeUnit,
                      math.max(14, context.watch<AtlasStore>().fontSize * .72),
                      markers,
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
                label: Text(tr(context, '交叉 / 展开标记')),
                selected: markers,
                onSelected: (v) => setState(() => markers = v),
              ),
            ],
          ),
        if (!compact && !widget.terminal)
          Text(
            tr(context, '双指缩放 · 横滑平移 · 长按联动十字光标'),
            style: const TextStyle(fontSize: 12, color: muted),
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
  });
  final List<Bar> bars;
  final String symbol, unit, volumeUnit;
  final String name;
  final List<Json> events;
  @override
  State<FullscreenChart> createState() => _FullscreenChartState();
}

class _FullscreenChartState extends State<FullscreenChart> {
  late List<Bar> bars = widget.bars;
  late List<Json> events = widget.events;
  Timer? timer;
  bool loading = false;
  @override
  void initState() {
    super.initState();
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
    timer = Timer.periodic(const Duration(seconds: 60), (_) => refresh());
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
          parameters: {'symbol': widget.symbol},
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
    SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: MarketChart(
            bars: bars,
            symbol: widget.symbol,
            name: widget.name,
            unit: widget.unit,
            volumeUnit: widget.volumeUnit,
            events: events,
            expanded: true,
          ),
        ),
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
    this.showSignals,
  );
  final IndicatorData data;
  final int start, end;
  final int? hover;
  final bool volume, macd, kdj;
  final List<Json> events;
  final String unit;
  final double font;
  final bool showSignals;
  void label(
    Canvas c,
    String text,
    Offset p, {
    Color color = muted,
    double? size,
  }) {
    final t = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(fontSize: size ?? font, color: color),
      ),
      textDirection: TextDirection.ltr,
      maxLines: 1,
    )..layout();
    t.paint(c, p);
  }

  @override
  void paint(Canvas c, Size size) {
    if (data.bars.isEmpty) return;
    const left = 52.0, right = 54.0;
    final width = size.width - left - right,
        n = end - start,
        step = width / math.max(1, n),
        parts = 1 + (volume ? 1 : 0) + (macd ? 1 : 0) + (kdj ? 1 : 0),
        priceHeight = parts == 1
            ? size.height - 28
            : (size.height * .49).clamp(95.0, 285.0),
        small = (size.height - priceHeight - 28) / math.max(1, parts - 1);
    double x(int i) => left + (i - start + .5) * step;
    final visible = data.bars.sublist(start, end);
    var lo = visible.map((b) => b.low).reduce(math.min),
        hi = visible.map((b) => b.high).reduce(math.max);
    for (final ma in data.mas.where((m) => m.enabled)) {
      for (final value
          in data.averages[ma.period]!
              .sublist(start, end)
              .whereType<double>()) {
        lo = math.min(lo, value);
        hi = math.max(hi, value);
      }
    }
    final pad = (hi - lo) * .08;
    lo -= pad;
    hi += pad;
    if (hi - lo < .0001) hi = lo + 1;
    double y(double v) => 20 + (hi - v) / (hi - lo) * (priceHeight - 30);
    final grid = Paint()
      ..color = const Color(0xff29292f)
      ..strokeWidth = .6;
    final gridCount = priceHeight < 180 ? 3 : 5;
    for (var i = 0; i < gridCount; i++) {
      final value = lo + (hi - lo) * i / (gridCount - 1), py = y(value);
      c.drawLine(Offset(left, py), Offset(size.width - right, py), grid);
      label(c, value.toStringAsFixed(2), Offset(1, py - 7));
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
    for (final ma in data.mas.where((m) => m.enabled)) {
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
          ..color = ma.color
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.1,
      );
    }
    if (events.isNotEmpty || showSignals) {
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
        }
      }
    }
    for (final event in events) {
      final index = data.bars.indexWhere((b) => b.time == event['date']);
      if (index >= start && index < end) {
        final px = x(index), py = y(data.bars[index].low) + 10;
        c.drawCircle(
          Offset(px, py),
          3,
          Paint()..color = const Color(0xffd9c89f),
        );
      }
    }
    c.restore();
    final last = data.bars[end - 1];
    label(
      c,
      last.close.toStringAsFixed(2),
      Offset(size.width - right + 3, y(last.close) - 7),
      color: last.close >= last.open ? up : down,
      size: font,
    );
    var top = priceHeight + 4;
    void pane(
      String title,
      List<List<double?>> values,
      List<Color> colors, {
      bool histogram = false,
      bool volumeBars = false,
    }) {
      final h = small - 4;
      label(c, title, Offset(left, top), color: Colors.white);
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
      if (max - min < .0001) max = min + 1;
      double py(double v) =>
          top + 21 + (max - v) / (max - min) * math.max(5, h - 25);
      c.drawLine(
        Offset(left, top + 20),
        Offset(size.width - right, top + 20),
        grid,
      );
      label(
        c,
        volumeBars ? amount(max) : max.toStringAsFixed(2),
        Offset(1, top + 18),
      );
      if (small >= 60) {
        label(
          c,
          volumeBars ? '0' : min.toStringAsFixed(2),
          Offset(1, top + h - 10),
        );
      }
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
        [Colors.white, const Color(0xfff7cf65), const Color(0xffed89bf)],
        volumeBars: true,
      );
    }
    if (macd) {
      pane(
        'MACD',
        [data.hist, data.dif, data.dea],
        [up, Colors.white, const Color(0xfff7cf65)],
        histogram: true,
      );
    }
    if (kdj) {
      pane(
        'KDJ',
        [data.kdjK, data.kdjD, data.kdjJ],
        [Colors.white, const Color(0xfff7cf65), const Color(0xffd968e8)],
      );
    }
    for (final index in [start, (start + end) ~/ 2, end - 1]) {
      label(
        c,
        data.bars[index].time.substring(5),
        Offset(
          (x(index) - 15).clamp(left, size.width - right - 25),
          size.height - 17,
        ),
        size: font - 1,
      );
    }
    if (hover != null && hover! >= start && hover! < end) {
      final cross = Paint()
        ..color = Colors.white54
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
      data != old.data ||
      start != old.start ||
      end != old.end ||
      hover != old.hover ||
      volume != old.volume ||
      macd != old.macd ||
      kdj != old.kdj ||
      events != old.events ||
      font != old.font ||
      showSignals != old.showSignals;
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
          style: const TextStyle(color: muted, fontSize: 13),
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
    final width = size.width - 85, height = size.height - 45;
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
          style: const TextStyle(color: muted, fontSize: 12),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      text.paint(c, Offset(width + 13, y(v) - 6));
      c.drawLine(
        Offset(8, y(v)),
        Offset(width + 8, y(v)),
        Paint()..color = const Color(0xff303038),
      );
    }
    c.drawPath(
      path,
      Paint()
        ..color = const Color(0xffdddded)
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
    for (final pair in [
      (0, str(points.first['clock'])),
      (points.length ~/ 2, str(points[points.length ~/ 2]['clock'])),
      (points.length - 1, str(points.last['clock'])),
    ]) {
      final t = TextPainter(
        text: TextSpan(
          text: pair.$2,
          style: const TextStyle(color: muted, fontSize: 12),
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
