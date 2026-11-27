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

/// Same OHLCV values; identity is irrelevant for chart updates.
bool sameBar(Bar a, Bar b) =>
    identical(a, b) ||
    a.time == b.time &&
        a.open == b.open &&
        a.high == b.high &&
        a.low == b.low &&
        a.close == b.close &&
        a.volume == b.volume;

/// Whether [next] equals [previous] except for the values of the final candle.
bool onlyLastBarChanged(List<Bar> previous, List<Bar> next) {
  if (previous.length != next.length || next.isEmpty) return false;
  if (previous.last.time != next.last.time) return false;
  for (var i = next.length - 2; i >= 0; i--) {
    if (!sameBar(previous[i], next[i])) return false;
  }
  return true;
}

bool sameBars(List<Bar> a, List<Bar> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = a.length - 1; i >= 0; i--) {
    if (!sameBar(a[i], b[i])) return false;
  }
  return true;
}

/// Running state of every recursive indicator, captured before the final
/// candle so a live tick can recompute that candle alone.
class _Walk {
  _Walk(Iterable<int> periods) : sums = {for (final p in periods) p: 0.0};
  _Walk._copy(_Walk w)
    : sums = Map.of(w.sums),
      boll = w.boll,
      vol5 = w.vol5,
      vol20 = w.vol20,
      gain = w.gain,
      loss = w.loss,
      sarRising = w.sarRising,
      sarPoint = w.sarPoint,
      sarExtreme = w.sarExtreme,
      sarAf = w.sarAf,
      fast = w.fast,
      slow = w.slow,
      signal = w.signal,
      k = w.k,
      d = w.d,
      expanded = w.expanded;
  final Map<int, double> sums;
  double boll = 0, vol5 = 0, vol20 = 0, gain = 0, loss = 0;
  bool sarRising = false;
  double sarPoint = 0, sarExtreme = 0, sarAf = .02;
  double? fast, slow;
  double signal = 0, k = 50, d = 50;
  bool expanded = false;
  _Walk copy() => _Walk._copy(this);
}

class IndicatorData {
  IndicatorData(this.bars, this.mas) {
    final n = bars.length;
    for (final p in _periods) {
      averages[p] = List<double?>.filled(n, null);
    }
    bollMid = List<double?>.filled(n, null);
    bollUpper = List<double?>.filled(n, null);
    bollLower = List<double?>.filled(n, null);
    rsi14 = List<double?>.filled(n, null);
    sar = List<double?>.filled(n, null);
    vol5 = List<double?>.filled(n, null);
    vol20 = List<double?>.filled(n, null);
    dif = List<double>.filled(n, 0);
    dea = List<double>.filled(n, 0);
    hist = List<double>.filled(n, 0);
    kdjK = List<double>.filled(n, 0);
    kdjD = List<double>.filled(n, 0);
    kdjJ = List<double>.filled(n, 0);
    _walk(_Walk(_periods), 0);
  }

  IndicatorData._tail(IndicatorData previous, this.bars) : mas = previous.mas {
    for (final e in previous.averages.entries) {
      averages[e.key] = List.of(e.value);
    }
    bollMid = List.of(previous.bollMid);
    bollUpper = List.of(previous.bollUpper);
    bollLower = List.of(previous.bollLower);
    rsi14 = List.of(previous.rsi14);
    sar = List.of(previous.sar);
    vol5 = List.of(previous.vol5);
    vol20 = List.of(previous.vol20);
    dif = List.of(previous.dif);
    dea = List.of(previous.dea);
    hist = List.of(previous.hist);
    kdjK = List.of(previous.kdjK);
    kdjD = List.of(previous.kdjD);
    kdjJ = List.of(previous.kdjJ);
    final last = bars.length - 1;
    signals.addAll(previous.signals.where((s) => s['index'] != last));
    _timeIndex = previous._timeIndex;
    _times = previous._times;
    _walk(previous._beforeLast!.copy(), last);
  }

  /// Recomputes only the final candle when [bars] differs from
  /// [previous.bars] in that candle alone; otherwise rebuilds everything.
  /// The result is identical to a full pass over [bars].
  factory IndicatorData.updateLast(IndicatorData previous, List<Bar> bars) =>
      bars.length >= 3 &&
          previous._beforeLast != null &&
          onlyLastBarChanged(previous.bars, bars)
      ? IndicatorData._tail(previous, bars)
      : IndicatorData(bars, previous.mas);

  late final List<int> _periods = mas.map((m) => m.period).toSet().toList();
  late final List<int> _enabled =
      mas.where((m) => m.enabled).map((m) => m.period).toSet().toList()..sort();
  _Walk? _beforeLast;

  void _walk(_Walk w, int from) {
    final n = bars.length;
    for (var i = from; i < n; i++) {
      if (i == n - 1) _beforeLast = w.copy();
      _step(w, i);
    }
  }

  void _step(_Walk w, int i) {
    final bar = bars[i], close = bar.close;
    for (final p in _periods) {
      var s = w.sums[p]! + close;
      if (i >= p) s -= bars[i - p].close;
      w.sums[p] = s;
      averages[p]![i] = i + 1 >= p ? s / p : null;
    }
    w.boll += close;
    if (i >= 20) w.boll -= bars[i - 20].close;
    bollMid[i] = i + 1 >= 20 ? w.boll / 20 : null;
    if (i >= 19) {
      final mid = bollMid[i]!;
      var acc = 0.0;
      for (var j = i - 19; j <= i; j++) {
        acc += math.pow(bars[j].close - mid, 2).toDouble();
      }
      final sd = math.sqrt(acc / 20);
      bollUpper[i] = mid + 2 * sd;
      bollLower[i] = mid - 2 * sd;
    }
    if (i > 0) {
      final delta = close - bars[i - 1].close,
          g = math.max(0.0, delta),
          l = math.max(0.0, -delta);
      if (i <= 14) {
        w.gain += g / 14;
        w.loss += l / 14;
      } else {
        w.gain = (w.gain * 13 + g) / 14;
        w.loss = (w.loss * 13 + l) / 14;
      }
      if (i >= 14) {
        rsi14[i] = w.gain + w.loss == 0 ? 50 : 100 * w.gain / (w.gain + w.loss);
      }
      if (i == 1) {
        w.sarRising = bars[1].close >= bars[0].close;
        w.sarPoint = w.sarRising ? bars[0].low : bars[0].high;
        w.sarExtreme = w.sarRising ? bars[0].high : bars[0].low;
        w.sarAf = .02;
      }
      var next = w.sarPoint + w.sarAf * (w.sarExtreme - w.sarPoint);
      if (w.sarRising) {
        next = math.min(
          next,
          math.min(bars[i - 1].low, bars[math.max(0, i - 2)].low),
        );
        if (bar.low < next) {
          w.sarRising = false;
          next = w.sarExtreme;
          w.sarExtreme = bar.low;
          w.sarAf = .02;
        } else if (bar.high > w.sarExtreme) {
          w.sarExtreme = bar.high;
          w.sarAf = math.min(.2, w.sarAf + .02);
        }
      } else {
        next = math.max(
          next,
          math.max(bars[i - 1].high, bars[math.max(0, i - 2)].high),
        );
        if (bar.high > next) {
          w.sarRising = true;
          next = w.sarExtreme;
          w.sarExtreme = bar.high;
          w.sarAf = .02;
        } else if (bar.low < w.sarExtreme) {
          w.sarExtreme = bar.low;
          w.sarAf = math.min(.2, w.sarAf + .02);
        }
      }
      w.sarPoint = next;
      sar[i] = next;
    }
    w.vol5 += bar.volume;
    if (i >= 5) w.vol5 -= bars[i - 5].volume;
    vol5[i] = i + 1 >= 5 ? w.vol5 / 5 : null;
    w.vol20 += bar.volume;
    if (i >= 20) w.vol20 -= bars[i - 20].volume;
    vol20[i] = i + 1 >= 20 ? w.vol20 / 20 : null;
    final fast = w.fast = w.fast == null
        ? close
        : w.fast! + (close - w.fast!) * 2 / 13;
    final slow = w.slow = w.slow == null
        ? close
        : w.slow! + (close - w.slow!) * 2 / 27;
    final difference = fast - slow;
    w.signal = i == 0
        ? difference
        : w.signal + (difference - w.signal) * 2 / 10;
    dif[i] = difference;
    dea[i] = w.signal;
    hist[i] = 2 * (difference - w.signal);
    var high = bars[math.max(0, i - 8)].high,
        low = bars[math.max(0, i - 8)].low;
    for (var j = math.max(0, i - 8) + 1; j <= i; j++) {
      high = math.max(high, bars[j].high);
      low = math.min(low, bars[j].low);
    }
    final rsv = high == low ? 50.0 : (close - low) / (high - low) * 100;
    w.k = w.k * 2 / 3 + rsv / 3;
    w.d = w.d * 2 / 3 + w.k / 3;
    kdjK[i] = w.k;
    kdjD[i] = w.d;
    kdjJ[i] = 3 * w.k - 2 * w.d;
    if (i < 1) return;
    final periods = _enabled;
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
    final now = ordered && rising && close > values[0]! && hist[i] > 0;
    if (now && !w.expanded) signals.add({'index': i, 'kind': 'bloom'});
    w.expanded = now;
  }

  final List<Bar> bars;
  final List<MaLine> mas;
  final List<Json> signals = [];
  final Map<int, List<double?>> averages = {};
  late List<double?> vol5, vol20, bollMid, bollUpper, bollLower, rsi14, sar;
  late List<double> dif, dea, hist, kdjK, kdjD, kdjJ;

  Map<String, int>? _timeIndex;
  List<String>? _times;
  List<double?>? _volumes;

  /// Candle time → index, built once per candle list (shared by live ticks).
  Map<String, int> get timeIndex =>
      _timeIndex ??= {for (var i = 0; i < bars.length; i++) bars[i].time: i};
  List<String> get times =>
      _times ??= List.unmodifiable(bars.map((b) => b.time));
  List<double?> get volumes =>
      _volumes ??= List<double?>.unmodifiable(bars.map((b) => b.volume));
  int? indexOf(Object? time) => time is String ? timeIndex[time] : null;
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
