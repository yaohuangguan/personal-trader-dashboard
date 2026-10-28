import 'package:flutter_test/flutter_test.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/pattern_ranges.dart';

void main() {
  test('historical viewport selects its known box snapshot before limiting newer ranges', () {
    final times = List.generate(
      150,
      (i) => DateTime.utc(
        2026,
        1,
        1,
      ).add(Duration(days: i)).toIso8601String().substring(0, 10),
    );
    Json box(int from, int to) => {
      'time': times[to],
      'kind': 'box-range',
      'anchorTime': times[from],
      'chartVisible': false,
      'range': {'from': times[from], 'to': times[to], 'high': 11, 'low': 9},
    };
    final ranges = [
      box(0, 20),
      box(0, 25),
      box(0, 30),
      box(55, 80),
      box(90, 115),
      box(120, 145),
    ];
    final selected = visiblePatternRanges(ranges, times, 10, 28);
    expect(selected.length, 1);
    expect(obj(selected.single['range'])['to'], times[25]);
    expect(
      visiblePatternRanges(ranges, times, 100, 140).map((m) => m['time']),
      [times[115]],
    );
  });
}
