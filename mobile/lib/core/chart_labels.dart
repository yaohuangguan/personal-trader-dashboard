/// Pure label rules for the candle chart (formatting, colouring, layout).
library;

/// A-share readout convention: each of open/high/low/close is compared with
/// the previous candle's close. 1 = above (red), -1 = below (green), 0 = flat
/// or no previous candle.
int ohlcDirection(double value, double? previousClose) {
  if (previousClose == null || !previousClose.isFinite) return 0;
  final tolerance = previousClose.abs() * 1e-9;
  if (value > previousClose + tolerance) return 1;
  if (value < previousClose - tolerance) return -1;
  return 0;
}

bool _intraday(String time) => time.length > 10;

/// X-axis labels for candle times shown left to right.
///
/// * month: `YYYY-MM`
/// * week: `MM-DD`, with the year on the first label and whenever the year
///   changes from the previous label
/// * day: `MM-DD`
/// * minute units: `HH:MM`, prefixed with `MM-DD` on the first label and at
///   every day boundary
List<String> axisLabels(List<String> times, String unit) {
  final out = <String>[];
  String? previous;
  for (final time in times) {
    out.add(axisLabel(time, unit, previous: previous));
    previous = time;
  }
  return out;
}

String axisLabel(String time, String unit, {String? previous}) {
  if (time.length < 10) return time;
  final date = time.substring(0, 10), year = time.substring(0, 4);
  if (_intraday(time)) {
    final clock = time.substring(11);
    final short = clock.length > 5 ? clock.substring(0, 5) : clock;
    final boundary =
        previous == null ||
        previous.length < 10 ||
        previous.substring(0, 10) != date;
    return boundary ? '${time.substring(5, 10)} $short' : short;
  }
  if (unit == 'month') return time.substring(0, 7);
  if (unit == 'week' &&
      (previous == null ||
          previous.length < 4 ||
          previous.substring(0, 4) != year)) {
    return date;
  }
  return time.substring(5, 10);
}

/// Greedy non-overlapping placement in priority order. [spans] are
/// (left, right) extents; returns the indices that were kept.
List<int> nonOverlapping(List<(double, double)> spans, {double gap = 6}) {
  final kept = <int>[];
  for (var i = 0; i < spans.length; i++) {
    final (l, r) = spans[i];
    if (kept.every((k) => r + gap <= spans[k].$1 || l >= spans[k].$2 + gap)) {
      kept.add(i);
    }
  }
  return kept;
}

/// Lays labels out one after another from [start] with [gap] between them and
/// drops the remainder once the next one would cross [limit].
List<double> sequentialLabels(
  List<double> widths, {
  required double start,
  required double limit,
  double gap = 10,
}) {
  final out = <double>[];
  var x = start;
  for (final w in widths) {
    if (x + w > limit) break;
    out.add(x);
    x += w + gap;
  }
  return out;
}
