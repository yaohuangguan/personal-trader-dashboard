import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/chart_labels.dart';
import '../core/chart_marks.dart';
import '../core/chart_viewport.dart';
import '../core/indicators.dart';
import '../core/palette.dart';

/// Base series colours; every use goes through [chartColor]/[chartTextColor]
/// so the light theme gets darker, readable variants.
abstract final class ChartTone {
  static const amber = Color(0xffffc107),
      gold = Color(0xfff7cf65),
      pink = Color(0xffed89bf),
      violet = Color(0xffd968e8),
      projection = Color(0xffd5ae58),
      pending = Color(0xffcfad6e),
      event = Color(0xffd9c89f),
      range = Color(0xff829bb4);
  static Color line(Color c) => chartColor(c);
  static Color text(Color c) => chartTextColor(c);
}

/// Crosshair state: the selected real candle and, while a projection is
/// drawn, the selected future candle.
typedef ChartSelection = ({int? hover, int? forecast});

class ChartPane {
  ChartPane({
    required this.title,
    required this.key,
    required this.series,
    required this.colors,
    required this.top,
    required this.small,
    required this.min,
    required this.max,
    required this.empty,
    this.histogram = false,
    this.volumeBars = false,
  });
  final String title, key;
  final List<List<double?>> series;
  final List<Color> colors;
  final double top, small, min, max;
  final bool empty, histogram, volumeBars;
  double get h => small - 4;
  double y(double v) =>
      top + 21 + (max - v) / (max - min) * math.max(5, h - 25);
}

/// Everything both chart layers need to agree on for one viewport and size.
class ChartGeometry {
  ChartGeometry._({
    required this.data,
    required this.drawData,
    required this.future,
    required this.start,
    required this.end,
    required this.size,
    required this.step,
    required this.priceHeight,
    required this.small,
    required this.lo,
    required this.hi,
    required this.gridCount,
    required this.panes,
  });

  factory ChartGeometry.compute({
    required IndicatorData data,
    IndicatorData? forecast,
    required int start,
    required int end,
    required Size size,
    required bool volume,
    required bool macd,
    required bool kdj,
    required bool rsi,
    required String overlay,
    required String volumeUnit,
  }) {
    final n = data.bars.length;
    end = end.clamp(0, n);
    start = start.clamp(0, math.max(0, end - 1));
    // A projection is drawn only right after the newest real candle and only
    // when it was built from exactly this candle list.
    final validForecast =
        forecast != null &&
        n > 0 &&
        end == n &&
        forecast.bars.length > n &&
        forecast.bars[n - 1].time == data.bars[n - 1].time &&
        forecast.bars[0].time == data.bars[0].time;
    final drawData = validForecast ? forecast : data;
    final future = validForecast ? forecast.bars.sublist(n) : const <Bar>[];
    final drawEnd = end + future.length;
    final width = ChartPlot.width(size.width),
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
        small = (size.height - priceHeight - 28) / math.max(1, parts - 1),
        step = width / math.max(1, end - start + future.length);
    var lo = double.infinity, hi = double.negativeInfinity;
    for (var i = start; i < end; i++) {
      lo = math.min(lo, data.bars[i].low);
      hi = math.max(hi, data.bars[i].high);
    }
    for (final b in future) {
      lo = math.min(lo, b.low);
      hi = math.max(hi, b.high);
    }
    void include(List<double?> values, int from, int to) {
      for (var i = from; i < to && i < values.length; i++) {
        final v = values[i];
        if (v == null) continue;
        lo = math.min(lo, v);
        hi = math.max(hi, v);
      }
    }

    final overlaySeries = overlay == 'MA'
        ? [
            for (final m in drawData.mas.where((m) => m.enabled))
              drawData.averages[m.period]!,
          ]
        : overlay == 'BOLL'
        ? [drawData.bollUpper, drawData.bollLower]
        : [drawData.sar];
    for (final values in overlaySeries) {
      include(values, start, drawEnd);
    }
    if (!lo.isFinite || !hi.isFinite) {
      lo = 0;
      hi = 1;
    }
    final pad = (hi - lo) * .08;
    lo -= pad;
    hi += pad;
    if (hi - lo < .0001) hi = lo + 1;
    final panes = <ChartPane>[];
    var top = priceHeight + 4;
    void pane(
      String title,
      List<List<double?>> series,
      List<Color> colors, {
      bool histogram = false,
      bool volumeBars = false,
    }) {
      var min = double.infinity, max = double.negativeInfinity;
      for (final values in series) {
        for (var i = start; i < drawEnd && i < values.length; i++) {
          final v = values[i];
          if (v == null) continue;
          min = math.min(min, v);
          max = math.max(max, v);
        }
      }
      final empty = !min.isFinite;
      if (empty) {
        min = 0;
        max = 1;
      }
      if (histogram || volumeBars) {
        min = math.min(0, min);
        max = math.max(0, max);
      }
      if (title.startsWith('RSI')) {
        min = 0;
        max = 100;
      }
      if (max - min < .0001) max = min + 1;
      panes.add(
        ChartPane(
          title: title,
          key: title.split(' ').first,
          series: series,
          colors: colors,
          top: top,
          small: small,
          min: min,
          max: max,
          empty: empty,
          histogram: histogram,
          volumeBars: volumeBars,
        ),
      );
      top += small;
    }

    if (volume) {
      pane(
        'VOL ($volumeUnit)',
        [drawData.volumes, drawData.vol5, drawData.vol20],
        [ink, ChartTone.line(ChartTone.gold), ChartTone.line(ChartTone.pink)],
        volumeBars: true,
      );
    }
    if (macd) {
      pane(
        'MACD',
        [drawData.hist, drawData.dif, drawData.dea],
        [up, ink, ChartTone.line(ChartTone.gold)],
        histogram: true,
      );
    }
    if (kdj) {
      pane(
        'KDJ',
        [drawData.kdjK, drawData.kdjD, drawData.kdjJ],
        [ink, ChartTone.line(ChartTone.gold), ChartTone.line(ChartTone.violet)],
      );
    }
    if (rsi) {
      pane('RSI (14)', [drawData.rsi14], [ChartTone.line(ChartTone.amber)]);
    }
    return ChartGeometry._(
      data: data,
      drawData: drawData,
      future: future,
      start: start,
      end: end,
      size: size,
      step: step,
      priceHeight: priceHeight,
      small: small,
      lo: lo,
      hi: hi,
      gridCount: priceHeight < 180 ? 3 : 5,
      panes: panes,
    );
  }

  static const left = ChartPlot.inset, right = ChartPlot.inset;
  final IndicatorData data, drawData;
  final List<Bar> future;
  final int start, end;
  final Size size;
  final double step, priceHeight, small, lo, hi;
  final int gridCount;
  final List<ChartPane> panes;
  int get drawEnd => end + future.length;
  bool get isEmpty => end <= start;
  double get width => ChartPlot.width(size.width);
  double x(int i) => left + (i - start + .5) * step;
  double y(double v) => 20 + (hi - v) / (hi - lo) * (priceHeight - 30);
}

TextPainter _text(
  String text,
  double size,
  Color color, {
  String Function(String)? translate,
}) => TextPainter(
  text: TextSpan(
    text: translate?.call(text) ?? text,
    style: TextStyle(fontSize: size, color: color),
  ),
  textDirection: TextDirection.ltr,
  maxLines: 1,
)..layout();

class ChartPainter extends CustomPainter {
  ChartPainter(
    this.data,
    this.start,
    this.end,
    this.volume,
    this.macd,
    this.kdj,
    this.events,
    this.unit,
    this.font,
    this.showSignals, {
    this.translate,
    this.locale = 'zh-CN',
    this.overlay = 'MA',
    this.rsi = false,
    this.trades = const [],
    this.patterns = const [],
    this.indicatorMarks = const [],
    this.showPatterns = true,
    this.showCrosses = false,
    this.projection,
    this.forecast,
    this.period = 'day',
    this.marks,
    this.geometry,
  });
  final String Function(String)? translate;
  final String locale;
  final IndicatorData data;
  final int start, end;
  final bool volume, macd, kdj;
  final List<Json> events, trades, patterns;
  final List<Json> indicatorMarks;
  final Json? projection;
  final IndicatorData? forecast;

  /// Volume unit shown in the VOL pane title.
  final String unit;

  /// Candle interval (day/week/month/m5…) for axis labels.
  final String period;
  final double font;
  final bool showSignals, rsi, showPatterns, showCrosses;
  final bool light = AtlasPalette.light;
  final String overlay;
  final ChartGeometry? geometry;

  /// Marks pre-resolved by the chart State; resolved here when painting
  /// standalone.
  final ChartMarks? marks;
  late final ChartMarks resolved =
      marks ??
      ChartMarks.resolve(
        data.timeIndex,
        data.bars.isEmpty ? '' : data.bars.last.time,
        trades: trades,
        patterns: patterns,
        indicatorMarks: indicatorMarks,
        events: events,
      );

  ChartGeometry geometryFor(Size size) {
    final g = geometry;
    if (g != null && g.size == size && identical(g.data, data)) return g;
    return ChartGeometry.compute(
      data: data,
      forecast: forecast,
      start: start,
      end: end,
      size: size,
      volume: volume,
      macd: macd,
      kdj: kdj,
      rsi: rsi,
      overlay: overlay,
      volumeUnit: unit,
    );
  }

  void label(
    Canvas c,
    String text,
    Offset p, {
    Color? color,
    double? size,
    bool background = false,
  }) {
    final t = _text(text, size ?? font, color ?? muted, translate: translate);
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

  double textWidth(String text, {double? size}) =>
      _text(text, size ?? font, muted, translate: translate).width;

  /// Adds a polyline for [values] over [from, to); when candles are thinner
  /// than a pixel only one point per pixel column is kept.
  static Path linePath(
    List<double?> values,
    int from,
    int to,
    double Function(int) x,
    double Function(double) y, {
    bool decimate = false,
  }) {
    final path = Path();
    var began = false;
    var lastX = double.negativeInfinity;
    for (var i = from; i < to && i < values.length; i++) {
      final v = values[i];
      if (v == null) continue;
      final px = x(i);
      if (decimate && began && px - lastX < 1 && i != to - 1) continue;
      if (!began) {
        path.moveTo(px, y(v));
        began = true;
      } else {
        path.lineTo(px, y(v));
      }
      lastX = px;
    }
    return path;
  }

  @override
  void paint(Canvas c, Size size) {
    if (data.bars.isEmpty) return;
    final g = geometryFor(size);
    if (g.isEmpty) return;
    const left = ChartGeometry.left, right = ChartGeometry.right;
    final start = g.start,
        end = g.end,
        drawEnd = g.drawEnd,
        step = g.step,
        future = g.future,
        drawData = g.drawData,
        width = g.width,
        priceHeight = g.priceHeight,
        thin = step < 1;
    double x(int i) => g.x(i);
    double y(double v) => g.y(v);
    final grid = Paint()
      ..color = atlasColor(0xff29292f)
      ..strokeWidth = .6;
    for (var i = 0; i < g.gridCount; i++) {
      final value = g.lo + (g.hi - g.lo) * i / (g.gridCount - 1), py = y(value);
      c.drawLine(Offset(left, py), Offset(size.width - right, py), grid);
    }
    c.save();
    c.clipRect(Rect.fromLTRB(left, 15, size.width - right, priceHeight));
    final upWicks = Path(),
        downWicks = Path(),
        upBodies = Path(),
        downBodies = Path();
    if (thin) {
      // More candles than pixels: one aggregated candle per pixel column.
      int? column;
      late double open, high, low, close;
      void flush() {
        if (column == null) return;
        final cx = left + column + .5, rising = close >= open;
        (rising ? upWicks : downWicks)
          ..moveTo(cx, y(high))
          ..lineTo(cx, y(low) + .5);
      }

      for (var i = start; i < end; i++) {
        final bar = data.bars[i], col = ((i - start + .5) * step).floor();
        if (col != column) {
          flush();
          column = col;
          open = bar.open;
          high = bar.high;
          low = bar.low;
        } else {
          high = math.max(high, bar.high);
          low = math.min(low, bar.low);
        }
        close = bar.close;
      }
      flush();
    } else {
      for (var i = start; i < end; i++) {
        final bar = data.bars[i], cx = x(i), rising = bar.close >= bar.open;
        (rising ? upWicks : downWicks)
          ..moveTo(cx, y(bar.high))
          ..lineTo(cx, y(bar.low));
        (rising ? upBodies : downBodies).addRect(
          Rect.fromLTRB(
            cx - step * .32,
            math.min(y(bar.open), y(bar.close)),
            cx + step * .32,
            math.max(y(bar.open), y(bar.close)) + 1,
          ),
        );
      }
    }
    final upStroke = Paint()
          ..color = up
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1,
        downStroke = Paint()
          ..color = down
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1;
    c.drawPath(upWicks, upStroke);
    c.drawPath(downWicks, downStroke);
    c.drawPath(upBodies, Paint()..color = up);
    c.drawPath(downBodies, Paint()..color = down);
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.1;
    if (overlay == 'MA') {
      for (final ma in data.mas.where((m) => m.enabled)) {
        c.drawPath(
          linePath(data.averages[ma.period]!, start, end, x, y, decimate: thin),
          stroke..color = chartColor(ma.color),
        );
      }
    } else if (overlay == 'BOLL') {
      for (final (values, color) in [
        (data.bollMid, ink),
        (data.bollUpper, ChartTone.line(ChartTone.amber)),
        (data.bollLower, ChartTone.line(ChartTone.pink)),
      ]) {
        c.drawPath(
          linePath(values, start, end, x, y, decimate: thin),
          stroke..color = color,
        );
      }
    } else {
      final dot = Paint()..color = ChartTone.line(ChartTone.amber);
      var lastX = double.negativeInfinity;
      for (var i = start; i < end; i++) {
        final v = data.sar[i];
        if (v == null || thin && x(i) - lastX < 1) continue;
        lastX = x(i);
        c.drawCircle(Offset(x(i), y(v)), 1.8, dot);
      }
    }
    if (showCrosses) {
      final bloom = Paint()..color = ChartTone.line(ChartTone.amber),
          upFill = Paint()..color = up,
          downFill = Paint()..color = down;
      for (final signal in data.signals) {
        final index = signal['index'] as int;
        if (index < start || index >= end) continue;
        final isDeath = signal['kind'] == 'death',
            px = x(index),
            py = isDeath
                ? y(data.bars[index].high) - 9
                : y(data.bars[index].low) + 9;
        if (signal['kind'] == 'bloom') {
          c.drawCircle(Offset(px, py + 8), 3.5, bloom);
        } else {
          final path = Path()
            ..moveTo(px, py + (isDeath ? 5 : -5))
            ..lineTo(px - 4, py + (isDeath ? -3 : 3))
            ..lineTo(px + 4, py + (isDeath ? -3 : 3))
            ..close();
          c.drawPath(path, isDeath ? downFill : upFill);
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
    final m = resolved;
    if (showPatterns && patterns.isNotEmpty) {
      final occupied = <Rect>[];
      if (showSignals && trades.isNotEmpty) {
        for (final t in ChartMarks.visibleRange(m.trades, start, end)) {
          final top = t.mark['side'] == 'buy'
              ? y(data.bars[t.index].low) + 10
              : y(data.bars[t.index].high) - 25;
          occupied.add(Rect.fromLTWH(x(t.index) - 10, top, 45, 20));
        }
      }
      final rangeFill = Paint()..color = ChartTone.range.withValues(alpha: .04),
          rangeStroke = Paint()
            ..color = ChartTone.line(ChartTone.range).withValues(alpha: .6)
            ..style = PaintingStyle.stroke
            ..strokeWidth = .7;
      for (final mark in m.patternRanges(data.times, start, end)) {
        final range = obj(mark['range']),
            from = data.indexOf(range['from']),
            to = data.indexOf(range['to']),
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
        c.drawRect(box, rangeFill);
        c.drawRect(box, rangeStroke);
      }
      final usedDates = <int>{};
      final dot = Paint();
      var labels = 0;
      final markFont = math.max(11.0, math.min(13.0, font - 1));
      for (final r in m.patterns) {
        if (r.index < start || r.index >= end || !usedDates.add(r.index)) {
          continue;
        }
        final mark = r.mark, bar = data.bars[r.index], px = x(r.index);
        final title =
                str(mark['label']) + (mark['provisional'] == true ? '·预警' : ''),
            colour = mark['direction'] == 'bullish'
                ? up
                : mark['direction'] == 'bearish'
                ? down
                : muted;
        final above = mark['position'] == 'above',
            dotY = above ? y(bar.high) - 4 : y(bar.low) + 5;
        c.drawCircle(Offset(px, dotY), 2.2, dot..color = colour);
        if (labels >= 6) continue;
        final labelWidth = textWidth(title, size: markFont);
        if (labelWidth > width) continue;
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
    if (showPatterns && events.isNotEmpty) {
      final dot = Paint()..color = ChartTone.line(ChartTone.event);
      for (final e in ChartMarks.visibleRange(m.events, start, end)) {
        c.drawCircle(
          Offset(x(e.index), y(data.bars[e.index].low) + 10),
          3,
          dot,
        );
      }
    }
    if (showSignals && trades.isNotEmpty) {
      for (final t in ChartMarks.visibleRange(m.trades, start, end)) {
        final trade = t.mark,
            buy = trade['side'] == 'buy',
            px = x(t.index),
            py = buy
                ? y(data.bars[t.index].low) + 15
                : y(data.bars[t.index].high) - 24;
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
              ? ChartTone.text(ChartTone.pending)
              : buy
              ? up
              : down,
          size: 13,
          background: true,
        );
      }
    }
    c.restore();
    for (var i = 0; i < g.gridCount; i++) {
      final value = g.lo + (g.hi - g.lo) * i / (g.gridCount - 1);
      label(
        c,
        value.toStringAsFixed(2),
        Offset(left, y(value) - 7),
        background: true,
      );
    }
    final dashPaints = <Color, Paint>{};
    Paint dashPaint(Color color) => dashPaints.putIfAbsent(
      color,
      () => Paint()
        ..color = color.withValues(alpha: .7)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.1,
    );
    void dash(Path path, Offset from, Offset to) {
      final delta = to - from, length = delta.distance;
      for (var d = 0.0; d < length; d += 7) {
        path
          ..moveTo(
            (from + delta * (d / math.max(1, length))).dx,
            (from + delta * (d / math.max(1, length))).dy,
          )
          ..lineTo(
            (from + delta * (math.min(length, d + 4) / math.max(1, length))).dx,
            (from + delta * (math.min(length, d + 4) / math.max(1, length))).dy,
          );
      }
    }

    if (future.isNotEmpty) {
      final boundary = x(end - 1) + step * .5,
          tint = ChartTone.line(ChartTone.projection);
      c.save();
      c.clipRect(Rect.fromLTRB(left, 14, size.width - right, priceHeight));
      c.drawRect(
        Rect.fromLTRB(boundary, 14, size.width - right, priceHeight),
        Paint()..color = tint.withValues(alpha: .06),
      );
      c.drawLine(
        Offset(boundary, 14),
        Offset(boundary, priceHeight),
        Paint()..color = tint.withValues(alpha: .5),
      );
      final upLine = Paint()..color = up.withValues(alpha: .7),
          downLine = Paint()..color = down.withValues(alpha: .7),
          upFill = Paint()..color = up.withValues(alpha: .18),
          downFill = Paint()..color = down.withValues(alpha: .18),
          upEdge = Paint()
            ..color = up.withValues(alpha: .7)
            ..style = PaintingStyle.stroke
            ..strokeWidth = .8,
          downEdge = Paint()
            ..color = down.withValues(alpha: .7)
            ..style = PaintingStyle.stroke
            ..strokeWidth = .8;
      for (var j = 0; j < future.length; j++) {
        final bar = future[j], cx = x(end + j), rising = bar.close >= bar.open;
        c.drawLine(
          Offset(cx, y(bar.high)),
          Offset(cx, y(bar.low)),
          rising ? upLine : downLine,
        );
        final rect = Rect.fromLTRB(
          cx - step * .32,
          math.min(y(bar.open), y(bar.close)),
          cx + step * .32,
          math.max(y(bar.open), y(bar.close)) + 1,
        );
        c.drawRect(rect, rising ? upFill : downFill);
        c.drawRect(rect, rising ? upEdge : downEdge);
      }
      final lines = <(List<double?>, Color)>[
        if (overlay == 'MA')
          for (final m in drawData.mas.where((m) => m.enabled))
            (drawData.averages[m.period]!, chartColor(m.color)),
        if (overlay == 'BOLL') ...[
          (drawData.bollMid, ink),
          (drawData.bollUpper, ChartTone.line(ChartTone.amber)),
          (drawData.bollLower, ChartTone.line(ChartTone.pink)),
        ],
        if (overlay == 'SAR') (drawData.sar, ChartTone.line(ChartTone.amber)),
      ];
      for (final (values, color) in lines) {
        final path = Path(),
            dotPaint = Paint()..color = color.withValues(alpha: .7);
        for (var i = end; i < drawEnd; i++) {
          final v = values[i], p = values[i - 1];
          if (v == null) continue;
          if (overlay == 'SAR') {
            c.drawCircle(Offset(x(i), y(v)), 1.8, dotPaint);
          } else if (p != null) {
            dash(path, Offset(x(i - 1), y(p)), Offset(x(i), y(v)));
          }
        }
        c.drawPath(path, dashPaint(color));
      }
      label(
        c,
        '推演K线 · 假设指标',
        Offset(boundary + 3, 17),
        color: ChartTone.text(ChartTone.projection),
        size: 10,
      );
      c.restore();
    }
    for (final pane in g.panes) {
      final top = pane.top, h = pane.h;
      label(c, pane.title, Offset(left, top), color: ink);
      if (pane.empty) continue;
      double py(double v) => pane.y(v);
      c.drawLine(
        Offset(left, top + 20),
        Offset(size.width - right, top + 20),
        grid,
      );
      for (var k = 0; k < pane.series.length; k++) {
        final values = pane.series[k];
        if (k == 0 && (pane.histogram || pane.volumeBars)) {
          final paths = {
            for (final key in ['up', 'down', 'upFuture', 'downFuture'])
              key: Path(),
          };
          void bar(int i, double v, double cx, double half, bool rising) {
            paths['${rising ? 'up' : 'down'}${i >= end ? 'Future' : ''}']!
                .addRect(
                  Rect.fromLTRB(
                    cx - half,
                    math.min(py(v), py(0)),
                    cx + half,
                    math.max(py(v), py(0)) + 1,
                  ),
                );
          }

          if (thin) {
            int? column;
            var value = 0.0, open = 0.0, close = 0.0, at = start;
            void flush() {
              if (column == null) return;
              bar(
                at,
                value,
                left + column + .5,
                .5,
                pane.volumeBars ? close >= open : value >= 0,
              );
            }

            for (var i = start; i < drawEnd && i < values.length; i++) {
              final v = values[i];
              if (v == null) continue;
              final col = ((i - start + .5) * step).floor();
              if (col != column) {
                flush();
                column = col;
                value = v;
                open = drawData.bars[i].open;
                at = i;
              } else if (v.abs() > value.abs()) {
                value = v;
              }
              close = drawData.bars[i].close;
            }
            flush();
          } else {
            for (var i = start; i < drawEnd && i < values.length; i++) {
              final v = values[i];
              if (v == null) continue;
              bar(
                i,
                v,
                x(i),
                step * .3,
                pane.volumeBars
                    ? drawData.bars[i].close >= drawData.bars[i].open
                    : v >= 0,
              );
            }
          }
          c.drawPath(paths['up']!, Paint()..color = up);
          c.drawPath(paths['down']!, Paint()..color = down);
          c.drawPath(
            paths['upFuture']!,
            Paint()..color = up.withValues(alpha: .3),
          );
          c.drawPath(
            paths['downFuture']!,
            Paint()..color = down.withValues(alpha: .3),
          );
          continue;
        }
        c.drawPath(
          linePath(values, start, end, x, py, decimate: thin),
          stroke..color = pane.colors[k],
        );
        if (future.isNotEmpty) {
          final path = Path();
          for (var i = end; i < drawEnd && i < values.length; i++) {
            final v = values[i], previous = values[i - 1];
            if (v == null || previous == null) continue;
            dash(path, Offset(x(i - 1), py(previous)), Offset(x(i), py(v)));
          }
          c.drawPath(path, dashPaint(pane.colors[k]));
        }
      }
      label(
        c,
        pane.volumeBars ? amount(pane.max) : pane.max.toStringAsFixed(2),
        Offset(left, top + 18),
        background: true,
      );
      if (pane.small >= 60) {
        label(
          c,
          pane.volumeBars ? '0' : pane.min.toStringAsFixed(2),
          Offset(left, top + h - 10),
          background: true,
        );
      }
      if (indicatorMarks.isEmpty) continue;
      final occupied = <Rect>[];
      final dot = Paint();
      for (final r in m.pane(pane.key).visible(start, end)) {
        if (occupied.length >= 3) break;
        final mark = r.mark,
            value = r.value!,
            bullish = mark['bullish'] == true;
        final text =
                '${str(mark['label'])}${mark['provisional'] == true ? '·预警' : ''}',
            w = textWidth(text, size: 11) + 6;
        if (h < 38 || w > width) {
          // Compact landscape panes still show the event; its full explanation
          // remains in annotation details when a text label cannot fit.
          final point = Offset(
                x(r.index),
                py(value).clamp(top + 2, top + math.max(2.0, h - 2)),
              ),
              rect = Rect.fromCircle(center: point, radius: 2);
          if (occupied.any((o) => o.inflate(5).overlaps(rect))) continue;
          occupied.add(rect);
          c.drawCircle(point, 2, dot..color = bullish ? up : down);
          continue;
        }
        final lx = (x(r.index) - w / 2).clamp(left, size.width - right - w),
            ly = (py(value) + (bullish ? 5 : -19)).clamp(
              top + 22,
              top + math.max(22, h - 16),
            ),
            rect = Rect.fromLTWH(lx, ly, w, 16);
        if (occupied.any((o) => o.inflate(5).overlaps(rect))) continue;
        occupied.add(rect);
        label(
          c,
          text,
          Offset(lx, ly),
          size: 11,
          color: bullish ? up : down,
          background: true,
        );
      }
    }
    paintAxis(c, size, g);
  }

  void paintAxis(Canvas c, Size size, ChartGeometry g) {
    final indices = <int>{
      g.start,
      (g.start + g.end) ~/ 2,
      g.end - 1,
      if (g.future.isNotEmpty) g.drawEnd - 1,
    }.toList()..sort();
    final texts = axisLabels([
      for (final i in indices) g.drawData.bars[i].time,
    ], period);
    final painters = [
      for (final t in texts) _text(t, font - 1, muted, translate: translate),
    ];
    final spans = <(double, double)>[];
    for (var k = 0; k < indices.length; k++) {
      final w = painters[k].width,
          lx = (g.x(indices[k]) - w / 2).clamp(
            ChartGeometry.left,
            math.max(ChartGeometry.left, size.width - ChartGeometry.right - w),
          );
      spans.add((lx.toDouble(), lx + w));
    }
    // Ends first, then the middle; overlapping labels are skipped.
    final order = <int>{
      0,
      indices.length - 1,
      if (g.future.isNotEmpty && indices.length > 2) indices.length - 2,
      for (var k = 1; k < indices.length - 1; k++) k,
    }.toList();
    final kept = nonOverlapping([for (final k in order) spans[k]]);
    for (final j in kept) {
      final k = order[j];
      painters[k].paint(c, Offset(spans[k].$1, size.height - 17));
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
      volume != old.volume ||
      macd != old.macd ||
      kdj != old.kdj ||
      events != old.events ||
      locale != old.locale ||
      font != old.font ||
      showSignals != old.showSignals ||
      showPatterns != old.showPatterns ||
      showCrosses != old.showCrosses ||
      patterns != old.patterns ||
      indicatorMarks != old.indicatorMarks ||
      overlay != old.overlay ||
      rsi != old.rsi ||
      trades != old.trades ||
      period != old.period ||
      unit != old.unit ||
      marks != old.marks ||
      geometry != old.geometry;
}

/// Crosshair lines and the per-pane value readouts. Repaints on its own layer
/// from [selection] without touching the candle layer.
class CrosshairPainter extends CustomPainter {
  CrosshairPainter(
    this.geometry,
    this.selection, {
    required this.font,
    this.projection = false,
    this.translate,
  }) : super(repaint: selection);
  final ChartGeometry geometry;
  final ValueListenable<ChartSelection> selection;
  final double font;
  final bool projection;
  final String Function(String)? translate;
  final bool light = AtlasPalette.light;

  /// The candle the crosshair is on (a future index while projecting).
  int? get hover {
    final s = selection.value;
    return (projection ? s.forecast : null) ?? s.hover;
  }

  @override
  void paint(Canvas c, Size size) {
    final g = geometry;
    if (g.isEmpty) return;
    final index = hover, drawEnd = g.drawEnd;
    final readAt = (index ?? g.end - 1).clamp(0, drawEnd - 1);
    for (final pane in g.panes) {
      final title = _text(pane.title, font, ink, translate: translate);
      final values = <(String, Color)>[];
      for (var k = 0; k < pane.series.length; k++) {
        final series = pane.series[k];
        final v = readAt < series.length ? series[readAt] : null;
        if (v == null) continue;
        values.add((
          pane.volumeBars ? amount(v) : v.toStringAsFixed(2),
          pane.colors[k],
        ));
      }
      final painters = [
        for (final (text, color) in values) _text(text, font - 1, color),
      ];
      final xs = sequentialLabels(
        [for (final p in painters) p.width],
        start: ChartGeometry.left + title.width + 8,
        limit: size.width - ChartGeometry.right,
      );
      for (var k = 0; k < xs.length; k++) {
        painters[k].paint(c, Offset(xs[k], pane.top));
      }
    }
    if (index == null || index < g.start || index >= drawEnd) return;
    final cross = Paint()
      ..color = ink.withValues(alpha: .54)
      ..strokeWidth = .8;
    final px = g.x(index);
    c.drawLine(Offset(px, 15), Offset(px, size.height - 22), cross);
    final py = g.y(g.drawData.bars[index].close);
    c.drawLine(
      Offset(ChartGeometry.left, py),
      Offset(size.width - ChartGeometry.right, py),
      cross,
    );
  }

  @override
  bool shouldRepaint(covariant CrosshairPainter old) =>
      geometry != old.geometry ||
      selection != old.selection ||
      font != old.font ||
      projection != old.projection ||
      light != old.light;
}
