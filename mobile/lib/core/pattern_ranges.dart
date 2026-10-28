import 'api.dart';

List<Json> visiblePatternRanges(
  List<Json> marks,
  List<String> times,
  int start,
  int end,
) {
  final dates = {for (var i = 0; i < times.length; i++) times[i]: i};
  final modern = marks.any(
    (m) =>
        m['kind'] == 'box-range' &&
        (dates[str(m['knownAt'], str(m['time']))] ?? end) < end,
  );
  final selected = <String, Json>{};
  for (final m in marks) {
    if (m['range'] is! Map ||
        modern && m['kind'] != 'box-range' ||
        (dates[str(m['knownAt'], str(m['time']))] ?? end) >= end) {
      continue;
    }
    final range = obj(m['range']),
        a = dates[str(range['from'])],
        b = dates[str(range['to'])];
    if (a == null || b == null || b < start || a >= end) continue;
    final key = str(m['anchorTime'], str(range['from']));
    if (!selected.containsKey(key) ||
        str(selected[key]!['time']).compareTo(str(m['time'])) <= 0) {
      selected[key] = m;
    }
  }
  return (selected.values.toList()
        ..sort((a, b) => str(b['time']).compareTo(str(a['time']))))
      .take(3)
      .toList();
}
