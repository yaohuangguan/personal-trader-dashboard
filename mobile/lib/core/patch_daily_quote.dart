import 'dart:math' as math;

import 'api.dart';
import 'indicators.dart';

/// Update only when the quote and history have a verified adjustment basis.
List<Bar> patchDailyQuote(List<Bar> bars, Json q, String unit) {
  if (bars.isEmpty || q['stale'] == true) return bars;
  final stamp = str(q['asOf'], ''),
      day = stamp.length >= 10 ? stamp.substring(0, 10) : '';
  final price = numOf(q['price']),
      open = numOf(q['open']),
      high = numOf(q['high']),
      low = numOf(q['low']),
      volume = numOf(q['volume']),
      previous = numOf(q['previous']);
  if (price == null ||
      open == null ||
      high == null ||
      low == null ||
      volume == null ||
      previous == null) {
    return bars;
  }
  if (![price, open, high, low, volume, previous].every((v) => v.isFinite) ||
      price <= 0 ||
      low <= 0 ||
      volume < 0 ||
      high < math.max(open, price) ||
      low > math.min(open, price)) {
    return bars;
  }
  final last = bars.last, same = bars.last.time == day;
  final prior = same ? (bars.length >= 2 ? bars[bars.length - 2] : null) : last;
  final date = DateTime.tryParse(day), lastDate = DateTime.tryParse(last.time);
  if (date == null || lastDate == null || prior == null) return bars;
  final gap = date.difference(lastDate).inDays;
  if ((!same && (gap <= 0 || gap > 7)) ||
      (prior.close - previous).abs() > math.max(.005, previous * .0005)) {
    return bars;
  }
  final actualVolume =
      volume * (q['volumeUnit'] == '手' ? 100 : 1) / (unit == '手' ? 100 : 1);
  if (same && actualVolume + math.max(1, last.volume * .001) < last.volume) {
    return bars;
  }
  return [
    ...bars.take(same ? bars.length - 1 : bars.length),
    Bar(day, open, high, low, price, actualVolume),
  ];
}
