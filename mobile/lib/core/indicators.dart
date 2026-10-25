import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'api.dart';

class Bar {
  const Bar(this.time, this.open, this.high, this.low, this.close, this.volume);
  final String time;
  final double open, high, low, close, volume;
  factory Bar.fromJson(Json r) => Bar(
    str(r['time']),
    numOf(r['open']) ?? 0,
    numOf(r['high']) ?? 0,
    numOf(r['low']) ?? 0,
    numOf(r['close']) ?? 0,
    numOf(r['volume']) ?? 0,
  );
}

class MaLine {
  const MaLine(this.period, this.color, [this.enabled = true]);
  final int period;
  final Color color;
  final bool enabled;
  Json toJson() => {
    'period': period,
    'color': color.toARGB32(),
    'enabled': enabled,
  };
  factory MaLine.fromJson(Json r) => MaLine(
    (numOf(r['period']) ?? 5).toInt(),
    Color((numOf(r['color']) ?? 0xffffffff).toInt()),
    r['enabled'] != false,
  );
}

const defaultMa = [
  MaLine(5, Color(0xfff4f5f7)),
  MaLine(13, Color(0xfff7cf65)),
  MaLine(20, Color(0xffed89bf)),
  MaLine(30, Color(0xff52c6e5)),
  MaLine(60, Color(0xff8affb7)),
  MaLine(120, Color(0xffff9b60)),
  MaLine(144, Color(0xff728acf)),
  MaLine(250, Color(0xffbf9ce5)),
];
List<double?> sma(List<Bar> rows, int period, {bool volume = false}) {
  var sum = 0.0;
  return List.generate(rows.length, (i) {
    sum += volume ? rows[i].volume : rows[i].close;
    if (i >= period) {
      sum -= volume ? rows[i - period].volume : rows[i - period].close;
    }
    return i + 1 >= period ? sum / period : null;
  });
}

class IndicatorData {
  IndicatorData(this.bars, this.mas) {
    for (final ma in mas) {
      averages[ma.period] = sma(bars, ma.period);
    }
    vol5 = sma(bars, 5, volume: true);
    vol20 = sma(bars, 20, volume: true);
    double? fast, slow;
    var signal = 0.0, k = 50.0, d = 50.0;
    for (var i = 0; i < bars.length; i++) {
      final close = bars[i].close;
      fast = fast == null ? close : fast + (close - fast) * 2 / 13;
      slow = slow == null ? close : slow + (close - slow) * 2 / 27;
      final difference = fast - slow;
      signal = i == 0 ? difference : signal + (difference - signal) * 2 / 10;
      dif.add(difference);
      dea.add(signal);
      hist.add(2 * (difference - signal));
      final window = bars.sublist(math.max(0, i - 8), i + 1),
          high = window.map((c) => c.high).reduce(math.max),
          low = window.map((c) => c.low).reduce(math.min);
      final rsv = high == low ? 50.0 : (close - low) / (high - low) * 100;
      k = k * 2 / 3 + rsv / 3;
      d = d * 2 / 3 + k / 3;
      kdjK.add(k);
      kdjD.add(d);
      kdjJ.add(3 * k - 2 * d);
    }
    final periods =
        mas.where((m) => m.enabled).map((m) => m.period).toSet().toList()
          ..sort();
    var expanded = false;
    for (var i = 1; i < bars.length; i++) {
      if (periods.length >= 2) {
        final a = averages[periods[0]]![i],
            b = averages[periods[1]]![i],
            pa = averages[periods[0]]![i - 1],
            pb = averages[periods[1]]![i - 1];
        if (a != null && b != null && pa != null && pb != null) {
          if (pa <= pb && a > b) signals.add({'index': i, 'kind': 'golden'});
          if (pa >= pb && a < b) signals.add({'index': i, 'kind': 'death'});
        }
      }
      final values = periods.map((p) => averages[p]![i]).toList(),
          complete = periods.length >= 2 && values.every((v) => v != null);
      final ordered =
          complete &&
          List.generate(
            values.length - 1,
            (k) => values[k]! > values[k + 1]!,
          ).every((v) => v);
      final rising =
          i >= 5 &&
          complete &&
          periods.every(
            (p) =>
                averages[p]![i - 5] != null &&
                averages[p]![i]! > averages[p]![i - 5]!,
          );
      final now =
          ordered && rising && bars[i].close > values[0]! && hist[i] > 0;
      if (now && !expanded) signals.add({'index': i, 'kind': 'bloom'});
      expanded = now;
    }
  }
  final List<Bar> bars;
  final List<MaLine> mas;
  final List<Json> signals = [];
  final Map<int, List<double?>> averages = {};
  late List<double?> vol5, vol20;
  final List<double> dif = [],
      dea = [],
      hist = [],
      kdjK = [],
      kdjD = [],
      kdjJ = [];
}

Json? chipModel(List<Bar> input, List<double> turnover, {String? asOf}) {
  final indices = List.generate(input.length, (i) => i)
      .where(
        (i) =>
            (asOf == null || input[i].time.compareTo(asOf) <= 0) &&
            i < turnover.length &&
            turnover[i].isFinite &&
            turnover[i] >= 0,
      )
      .toList();
  if (indices.length < 2) return null;
  final data = indices.map((i) => input[i]).toList(),
      lo = data.map((b) => b.low).reduce(math.min),
      hi = data.map((b) => b.high).reduce(math.max),
      pad = hi == lo ? lo * .02 : (hi - lo) * .02;
  final prices = List.generate(
    300,
    (i) => lo - pad + (hi - lo + 2 * pad) * i / 299,
  );
  var chips = List.filled(300, 0.0), seed = 1.0;
  for (var n = 0; n < indices.length; n++) {
    final index = indices[n],
        bar = input[index],
        mid = ((bar.high + bar.low + bar.close) / 3).clamp(bar.low, bar.high);
    final weights = prices
        .map(
          (p) => p < bar.low || p > bar.high
              ? 0.0
              : p <= mid
              ? (mid == bar.low ? 1.0 : (p - bar.low) / (mid - bar.low))
              : (bar.high == mid ? 1.0 : (bar.high - p) / (bar.high - mid)),
        )
        .toList();
    var total = weights.fold(0.0, (a, b) => a + b);
    if (total == 0) {
      var best = 0;
      for (var i = 1; i < prices.length; i++) {
        if ((prices[i] - mid).abs() < (prices[best] - mid).abs()) best = i;
      }
      weights[best] = 1;
      total = 1;
    }
    final turn = (turnover[index] / 100).clamp(0.0, 1.0);
    chips = List.generate(
      300,
      (i) => n == 0
          ? weights[i] / total
          : chips[i] * (1 - turn) + weights[i] / total * turn,
    );
    if (n > 0) seed *= 1 - turn;
  }
  double at(double q) {
    var sum = 0.0;
    for (var i = 0; i < chips.length; i++) {
      sum += chips[i];
      if (sum >= q) return prices[i];
    }
    return prices.last;
  }

  final range90 = [at(.05), at(.95)], range70 = [at(.15), at(.85)];
  var peak = 0, average = 0.0, profit = 0.0;
  for (var i = 0; i < chips.length; i++) {
    if (chips[i] > chips[peak]) peak = i;
    average += prices[i] * chips[i];
    if (prices[i] <= data.last.close) profit += chips[i];
  }
  return {
    'date': data.last.time,
    'start': data.first.time,
    'peak': prices[peak],
    'average': average,
    'profit': profit,
    'seed': seed,
    'range90': range90,
    'range70': range70,
    'concentration90':
        (range90[1] - range90[0]) / (range90[1] + range90[0]) * 100,
    'concentration70':
        (range70[1] - range70[0]) / (range70[1] + range70[0]) * 100,
    'histogram': List.generate(
      60,
      (i) => {
        'price': prices[i * 5 + 2],
        'weight': chips.sublist(i * 5, i * 5 + 5).fold(0.0, (a, b) => a + b),
      },
    ),
  };
}

Json? sentiment(Json pools) {
  final up = obj(pools['up']),
      down = obj(pools['down']),
      broken = obj(pools['broken']),
      yesterday = obj(pools['yesterday']);
  if ([up, down, broken, yesterday].any((r) => r['available'] != true)) {
    return null;
  }
  final u = numOf(up['total']),
      d = numOf(down['total']),
      sealed = rows(up['items']).map((r) => r['symbol']).toSet(),
      b = rows(broken['items'])
          .where((r) => !sealed.contains(r['symbol']))
          .length;
  final returns = rows(yesterday['items'])
      .map((r) => numOf(r['changePercent']))
      .whereType<double>()
      .toList();
  if (u == null || d == null || u + d == 0 || u + b == 0 || returns.isEmpty) {
    return null;
  }
  final premium = returns.reduce((a, b) => a + b) / returns.length,
      score =
          (.4 * u / (u + d) * 100 +
                  .3 * u / (u + b) * 100 +
                  .3 * (50 + premium * 5).clamp(0, 100))
              .round();
  return {
    'score': score,
    'up': u.toInt(),
    'down': d.toInt(),
    'broken': b,
    'premium': premium,
  };
}
