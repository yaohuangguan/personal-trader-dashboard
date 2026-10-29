import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/intraday_axis.dart';
import 'common.dart';

const _benchmarkNames = {
  '000001.SH': '上证指数',
  '399001.SZ': '深证成指',
  '399006.SZ': '创业板指',
  '000688.SH': '科创50',
  '000300.SH': '沪深300',
  '899050.BJ': '北证50',
};

class IntradayChart extends StatefulWidget {
  const IntradayChart(
    this.data, {
    super.key,
    this.height = 320,
    this.showSource = true,
  });
  final Json data;
  final double height;
  final bool showSource;
  @override
  State<IntradayChart> createState() => _IntradayChartState();
}

class _IntradayChartState extends State<IntradayChart> {
  bool auctionOpen = false, benchmarkOn = false;
  Json? board, benchmark, sector, auction;
  String? overlayError, auctionError;
  bool extraBusy = false;
  int generation = 0, auctionGeneration = 0;
  String segment = 'open';
  late String index;
  Timer? timer;
  Json? selected;
  String get symbol => str(widget.data['symbol']);
  @override
  void initState() {
    super.initState();
    index = defaultBenchmark(symbol);
    timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (!mounted ||
          !context.read<AtlasStore>().foreground ||
          !(ModalRoute.of(context)?.isCurrent ?? true)) {
        return;
      }
      if (benchmarkOn || board != null) refreshOverlays();
      if (auctionOpen) refreshAuction();
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    generation++;
    auctionGeneration++;
    super.dispose();
  }

  Future<void> refreshAuction() async {
    final g = ++auctionGeneration;
    try {
      final r = await context.read<AtlasStore>().api.get(
        '/api/desk/auction',
        parameters: {'symbol': symbol},
      );
      if (mounted && g == auctionGeneration) {
        setState(() {
          auction = r;
          auctionError = null;
        });
      }
    } catch (e) {
      if (mounted && g == auctionGeneration) {
        setState(() => auctionError = '$e');
      }
    }
  }

  Future<void> refreshOverlays() async {
    final g = ++generation;
    setState(() {
      extraBusy = true;
      overlayError = null;
    });
    final api = context.read<AtlasStore>().api;
    Future<void> load(bool market) async {
      if (market && !benchmarkOn || !market && board == null) return;
      try {
        final r = market
            ? await api.get('/api/desk/intraday', parameters: {'symbol': index})
            : await api.get(
                '/api/desk/sector-intraday',
                parameters: {
                  'code': str(board!['code']),
                  'name': str(board!['name']),
                },
              );
        if (!mounted || g != generation) return;
        if (r['date'] != widget.data['date'] ||
            (numOf(r['previous']) ?? 0) <= 0) {
          throw const FormatException('叠加来源交易日或昨收不匹配');
        }
        setState(() {
          if (market) {
            benchmark = r;
          } else {
            sector = r;
          }
        });
      } catch (e) {
        if (mounted && g == generation) {
          setState(() => overlayError = '${market ? '大盘' : '板块'}：$e');
        }
      }
    }

    await Future.wait([load(true), load(false)]);
    if (mounted && g == generation) setState(() => extraBusy = false);
  }

  Future<void> chooseOverlays() async {
    await showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) => SizedBox(
          height: MediaQuery.sizeOf(ctx).height * .7,
          child: Column(
            children: [
              ListTile(
                title: Text(tr(ctx, '叠加走势')),
                subtitle: Text(tr(ctx, '按各自昨收归一，比较涨跌幅；缺失分钟不填充')),
              ),
              SwitchListTile(
                title: Text(tr(ctx, '叠加大盘')),
                value: benchmarkOn,
                onChanged: (v) {
                  update(() => benchmarkOn = v);
                  setState(() {
                    benchmark = null;
                  });
                  refreshOverlays();
                },
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: DropdownButtonFormField<String>(
                  initialValue: index,
                  decoration: InputDecoration(labelText: tr(ctx, '大盘指数')),
                  items: _benchmarkNames.entries
                      .map(
                        (e) => DropdownMenuItem(
                          value: e.key,
                          child: Text(tr(ctx, e.value)),
                        ),
                      )
                      .toList(),
                  onChanged: (v) {
                    if (v == null) return;
                    update(() => index = v);
                    setState(() => benchmark = null);
                    if (benchmarkOn) refreshOverlays();
                  },
                ),
              ),
              ListTile(
                title: Text(tr(ctx, '所属板块')),
                trailing: TextButton(
                  onPressed: () {
                    update(() => board = null);
                    setState(() => sector = null);
                    refreshOverlays();
                  },
                  child: Text(tr(ctx, '不叠加')),
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  child: AsyncPanel(
                    load: () => context.read<AtlasStore>().api.get(
                      '/api/desk/sectors',
                      parameters: {'symbol': symbol},
                    ),
                    builder: (r) => Column(
                      children: [
                        if (rows(r['boards']).isEmpty)
                          ListTile(title: Text(tr(ctx, '暂无可核验的所属板块'))),
                        for (final b in rows(r['boards']))
                          ListTile(
                            selected: board?['code'] == b['code'],
                            title: Text(str(b['name'])),
                            subtitle: Text(str(b['code'])),
                            onTap: () {
                              update(() => board = b);
                              setState(() => sector = null);
                              refreshOverlays();
                            },
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final points = rows(widget.data['points']),
        shown = selected == null
            ? points.lastOrNull
            : points.where((p) => p['clock'] == selected!['clock']).firstOrNull;
    final comparisons = <Json>[
      if (benchmarkOn && benchmark?['date'] == widget.data['date'])
        {...benchmark!, 'label': _benchmarkNames[index], 'color': 0xffd5ae58},
      if (board != null && sector?['date'] == widget.data['date'])
        {...sector!, 'label': sector!['name'], 'color': 0xff758eef},
    ];
    return SizedBox(
      height: widget.height,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: 34,
            child: Row(
              children: [
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${str(widget.data['date'])} · ${str(shown?['clock'], '等待开盘')}',
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                ),
                TextButton(
                  onPressed: () {
                    setState(() => auctionOpen = !auctionOpen);
                    if (auctionOpen) refreshAuction();
                  },
                  child: Text(tr(context, auctionOpen ? '收起竞价' : '竞价')),
                ),
                TextButton(
                  onPressed: chooseOverlays,
                  child: Text(tr(context, '叠加')),
                ),
              ],
            ),
          ),
          SizedBox(
            height: 24,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  const SizedBox(width: 8),
                  Text(
                    '${fixed(shown?['price'])}  VOL ${amount(shown?['volume'])}',
                    style: const TextStyle(fontSize: 12),
                  ),
                  for (final r in comparisons)
                    Padding(
                      padding: const EdgeInsets.only(left: 14),
                      child: Text(
                        str(r['label']),
                        style: TextStyle(
                          fontSize: 11,
                          color: Color((numOf(r['color'])!).toInt()),
                        ),
                      ),
                    ),
                  if (extraBusy)
                    Text(
                      tr(context, ' · 加载叠加…'),
                      style: TextStyle(fontSize: 11, color: muted),
                    ),
                ],
              ),
            ),
          ),
          if (overlayError != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Text(
                overlayError!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, color: muted),
              ),
            ),
          Expanded(
            child: LayoutBuilder(
              builder: (ctx, c) => GestureDetector(
                onLongPressMoveUpdate: (e) =>
                    select(e.localPosition, c.maxWidth, points),
                onLongPressStart: (e) =>
                    select(e.localPosition, c.maxWidth, points),
                child: CustomPaint(
                  key: const ValueKey('intraday-canvas'),
                  size: Size(c.maxWidth, c.maxHeight),
                  painter: IntradayPainter(
                    points,
                    numOf(widget.data['previous']),
                    comparisons,
                    selected: shown,
                  ),
                ),
              ),
            ),
          ),
          if (auctionOpen)
            SizedBox(
              height: math.min(185, widget.height * .42),
              child: _auctionPanel(),
            ),
          if (widget.showSource) SourceLine(widget.data),
        ],
      ),
    );
  }

  void select(Offset p, double width, List<Json> points) {
    final target = ((p.dx - 8) / math.max(1, width - 65) * 240).clamp(0, 240);
    Json? best;
    double distance = 4;
    for (final v in points) {
      final minute = sessionMinute(str(v['clock']));
      if (minute != null && (minute - target).abs() < distance) {
        best = v;
        distance = (minute - target).abs().toDouble();
      }
    }
    setState(() => selected = best);
  }

  Widget _auctionPanel() {
    final segments = rows(auction?['segments']),
        chosen = segments.where((s) => s['key'] == segment).firstOrNull,
        points = rows(chosen?['points']);
    final validDate = auction?['date'] == widget.data['date'];
    return Container(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: muted.withValues(alpha: .2))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: 30,
            child: Row(
              children: [
                for (final entry in [
                  ('open', '盘前竞价'),
                  ('close', '收盘竞价'),
                  ('after', '盘后定价'),
                ])
                  Expanded(
                    child: InkWell(
                      onTap: () => setState(() => segment = entry.$1),
                      child: Center(
                        child: Text(
                          tr(context, entry.$2),
                          style: TextStyle(
                            fontSize: 12,
                            color: segment == entry.$1 ? ink : muted,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: validDate && points.isNotEmpty
                ? CustomPaint(painter: AuctionPainter(points, segment))
                : Center(
                    child: Text(
                      tr(
                        context,
                        auctionError ??
                            (auction == null ? '正在核验竞价数据…' : '该时段暂未取得可核验数据'),
                      ),
                      style: TextStyle(fontSize: 11, color: muted),
                    ),
                  ),
          ),
          if (validDate && points.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Text(
                '${points.last['sourceClock']}  ${fixed(points.last['price'])} · ${points.last['observation'] == true
                    ? '分钟观测'
                    : points.last['indicative'] == true
                    ? '虚拟撮合'
                    : '撮合成交'}  ${amount(points.last['volume'])}手  ${amount(points.last['amount'])}元',
                style: const TextStyle(fontSize: 11),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 3, 8, 5),
            child: Text(
              str(
                chosen?['notice'],
                str(auction?['notice'], '公开快照 · 非Level-2'),
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 10, color: muted),
            ),
          ),
        ],
      ),
    );
  }
}

class IntradayPainter extends CustomPainter {
  IntradayPainter(
    this.points,
    this.previous,
    this.comparisons, {
    this.selected,
  });
  final List<Json> points, comparisons;
  final double? previous;
  final Json? selected;
  @override
  void paint(Canvas c, Size size) {
    if (size.width < 70 || size.height < 80) return;
    final width = size.width - 65,
        priceBottom = size.height * .70,
        volTop = priceBottom + 22,
        volBottom = size.height - 25;
    final base = previous != null && previous! > 0
        ? previous!
        : numOf(points.firstOrNull?['price']) ?? 1;
    double normalized(Json p, double prev) =>
        ((numOf(p['price']) ?? prev) / prev - 1) * 100;
    final values = [
      0.0,
      ...points.map((p) => normalized(p, base)),
      for (final r in comparisons)
        ...rows(r['points']).map((p) => normalized(p, numOf(r['previous'])!)),
    ];
    final bound = math.max(
          .3,
          values.map((v) => v.abs()).fold<double>(0, math.max) * 1.08,
        ),
        hi = bound,
        lo = -bound;
    double y(double v) => 14 + (hi - v) / (hi - lo) * (priceBottom - 18);
    double x(String clock) => 8 + (sessionMinute(clock) ?? 0) / 240 * width;
    void text(String s, Offset p, Color color, [double font = 11]) {
      final t = TextPainter(
        text: TextSpan(
          text: s,
          style: TextStyle(color: color, fontSize: font),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      t.paint(c, p);
    }

    for (var i = 0; i < 5; i++) {
      final v = lo + (hi - lo) * i / 4;
      c.drawLine(
        Offset(8, y(v)),
        Offset(8 + width, y(v)),
        Paint()..color = muted.withValues(alpha: .16),
      );
      text(
        comparisons.isEmpty
            ? (base * (1 + v / 100)).toStringAsFixed(2)
            : '${v.toStringAsFixed(1)}%',
        Offset(width + 12, y(v) - 6),
        v > 0
            ? up
            : v < 0
            ? down
            : muted,
      );
    }
    c.drawLine(
      Offset(8, y(0)),
      Offset(8 + width, y(0)),
      Paint()..color = Colors.amber.withValues(alpha: .3),
    );
    void line(List<Json> rows, double prev, Color color) {
      final path = Path();
      int? prior;
      for (final p in rows) {
        final m = sessionMinute(str(p['clock']));
        if (m == null) continue;
        final px = x(str(p['clock'])), py = y(normalized(p, prev));
        if (prior == null || m - prior > 2) {
          path.moveTo(px, py);
        } else {
          path.lineTo(px, py);
        }
        prior = m;
      }
      c.drawPath(
        path,
        Paint()
          ..color = color
          ..strokeWidth = 1.5
          ..style = PaintingStyle.stroke,
      );
      if (rows.length == 1) {
        c.drawCircle(
          Offset(x(str(rows.first['clock'])), y(normalized(rows.first, prev))),
          2,
          Paint()..color = color,
        );
      }
    }

    c.save();
    c.clipRect(Rect.fromLTRB(8, 0, width + 9, priceBottom + 2));
    line(points, base, ink);
    for (final r in comparisons) {
      line(
        rows(r['points']),
        numOf(r['previous'])!,
        Color(numOf(r['color'])!.toInt()),
      );
    }
    c.restore();
    final maxVol = points.fold<double>(
      0,
      (v, p) => math.max(v, numOf(p['volume']) ?? 0),
    );
    text('VOL', Offset(8, volTop - 16), muted);
    for (var i = 0; i < points.length; i++) {
      final p = points[i], m = sessionMinute(str(p['clock']));
      if (m == null) continue;
      final h =
              math.max(0, volBottom - volTop) *
              (numOf(p['volume']) ?? 0) /
              math.max(1, maxVol),
          price = numOf(p['price']) ?? base,
          prior = i == 0 ? base : numOf(points[i - 1]['price']) ?? base;
      c.drawRect(
        Rect.fromLTWH(
          x(str(p['clock'])) - .6,
          volBottom - h,
          math.max(.8, width / 240 * .7),
          h,
        ),
        Paint()..color = price >= prior ? up : down,
      );
    }
    for (final entry in [
      (0, '09:30'),
      (60, '10:30'),
      (120, '11:30/13:00'),
      (180, '14:00'),
      (240, '15:00'),
    ]) {
      text(
        entry.$2,
        Offset(
          (8 + entry.$1 / 240 * width - 20).clamp(0, size.width - 58),
          size.height - 18,
        ),
        muted,
        9,
      );
    }
    if (points.isEmpty) {
      text('等待成交 · 全日时间轴', Offset(12, priceBottom / 2), muted);
    }
  }

  @override
  bool shouldRepaint(covariant IntradayPainter old) => true;
}

class AuctionPainter extends CustomPainter {
  AuctionPainter(this.points, this.segment);
  final List<Json> points;
  final String segment;
  @override
  void paint(Canvas c, Size size) {
    if (points.isEmpty || size.height < 12) return;
    final prices = points.map((p) => numOf(p['price']) ?? 0),
        low = prices.reduce(math.min),
        high = prices.reduce(math.max),
        span = math.max(.02, high - low);
    final start = segment == 'open'
            ? 555
            : segment == 'close'
            ? 897
            : 905,
        end = segment == 'open'
            ? 565
            : segment == 'close'
            ? 900
            : 930;
    final path = Path();
    var first = true;
    for (final p in points) {
      final clock = str(p['clock']).split(':'),
          m = int.parse(clock[0]) * 60 + int.parse(clock[1]),
          x = 8 + (m - start) / (end - start) * (size.width - 65),
          y =
              5 +
              (high - (numOf(p['price']) ?? low)) / span * (size.height - 12);
      if (first) {
        path.moveTo(x, y);
        first = false;
      } else {
        path.lineTo(x, y);
      }
      c.drawCircle(
        Offset(x, y),
        2,
        Paint()
          ..color = p['indicative'] == true ? const Color(0xffd5ae58) : ink,
      );
    }
    c.drawPath(
      path,
      Paint()
        ..color = const Color(0xffd5ae58)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );
  }

  @override
  bool shouldRepaint(covariant AuctionPainter old) => true;
}
