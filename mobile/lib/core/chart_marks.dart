import 'api.dart';
import 'pattern_ranges.dart';

/// A study mark already resolved to its candle index.
class ResolvedMark {
  const ResolvedMark(this.index, this.mark, [this.value]);
  final int index;
  final Json mark;
  final double? value;
}

/// Indicator-pane marks in paint priority: divergences first, then the most
/// recent candle first. Each group is index-descending, so the visible slice
/// is found by binary search instead of scanning every mark per frame.
class PaneMarks {
  const PaneMarks(this.divergences, this.others);
  final List<ResolvedMark> divergences, others;
  static const empty = PaneMarks([], []);
  int get length => divergences.length + others.length;

  Iterable<ResolvedMark> visible(int start, int end) sync* {
    for (final group in [divergences, others]) {
      // First position whose index is < end (group is index-descending).
      var lo = 0, hi = group.length;
      while (lo < hi) {
        final mid = (lo + hi) >> 1;
        if (group[mid].index >= end) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      for (var i = lo; i < group.length && group[i].index >= start; i++) {
        yield group[i];
      }
    }
  }
}

/// Study and guide marks resolved once per (candle list, study result), so the
/// painter never searches candles by time while panning or scrubbing.
class ChartMarks {
  ChartMarks._(
    this.timeIndex,
    this.trades,
    this.events,
    this.patterns,
    this.panes,
    this.rawPatterns,
  );

  factory ChartMarks.resolve(
    Map<String, int> timeIndex,
    String lastTime, {
    List<Json> trades = const [],
    List<Json> patterns = const [],
    List<Json> indicatorMarks = const [],
    List<Json> events = const [],
  }) {
    List<ResolvedMark> ascending(List<Json> marks, String field) {
      final out = <ResolvedMark>[];
      for (final m in marks) {
        final index = timeIndex[str(m[field], '')];
        if (index != null) out.add(ResolvedMark(index, m));
      }
      return _stableSort(out, (a, b) => a.index.compareTo(b.index));
    }

    final shapes = <ResolvedMark>[];
    for (final m in patterns) {
      if (m['chartVisible'] == false) continue;
      final index = timeIndex[str(m['time'], '')];
      if (index != null) shapes.add(ResolvedMark(index, m));
    }
    _stableSort(shapes, (a, b) {
      final current =
          (b.mark['time'] == lastTime ? 1 : 0) -
          (a.mark['time'] == lastTime ? 1 : 0);
      return current != 0
          ? current
          : (numOf(b.mark['priority']) ?? 0).compareTo(
              numOf(a.mark['priority']) ?? 0,
            );
    });
    final grouped = <String, (List<ResolvedMark>, List<ResolvedMark>)>{};
    for (final m in indicatorMarks) {
      final index = timeIndex[str(m['time'], '')];
      final value = numOf(m['value']);
      if (index == null || value == null) continue;
      final pane = grouped.putIfAbsent(str(m['pane'], ''), () => ([], []));
      (str(m['kind'], '').contains('divergence') ? pane.$1 : pane.$2).add(
        ResolvedMark(index, m, value),
      );
    }
    int descending(ResolvedMark a, ResolvedMark b) =>
        b.index.compareTo(a.index);
    return ChartMarks._(
      timeIndex,
      ascending(trades, 'time'),
      ascending(events, 'date'),
      shapes,
      {
        for (final e in grouped.entries)
          e.key: PaneMarks(
            _stableSort(e.value.$1, descending),
            _stableSort(e.value.$2, descending),
          ),
      },
      patterns,
    );
  }

  static final empty = ChartMarks._(const {}, [], [], [], const {}, const []);

  final Map<String, int> timeIndex;

  /// Index-ascending; [visibleRange] slices them for the viewport.
  final List<ResolvedMark> trades, events;

  /// Label priority order (latest candle first, then priority).
  final List<ResolvedMark> patterns;
  final Map<String, PaneMarks> panes;
  final List<Json> rawPatterns;

  PaneMarks pane(String name) => panes[name] ?? PaneMarks.empty;

  /// Marks of an index-ascending list inside [start, end).
  static Iterable<ResolvedMark> visibleRange(
    List<ResolvedMark> marks,
    int start,
    int end,
  ) sync* {
    var lo = 0, hi = marks.length;
    while (lo < hi) {
      final mid = (lo + hi) >> 1;
      if (marks[mid].index < start) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    for (var i = lo; i < marks.length && marks[i].index < end; i++) {
      yield marks[i];
    }
  }

  (int, int, List<Json>)? _ranges;

  /// Pattern range boxes for the viewport, memoised for repeated frames.
  List<Json> patternRanges(List<String> times, int start, int end) {
    final cached = _ranges;
    if (cached != null && cached.$1 == start && cached.$2 == end) {
      return cached.$3;
    }
    final ranges = rawPatterns.isEmpty
        ? const <Json>[]
        : visiblePatternRanges(rawPatterns, times, start, end);
    _ranges = (start, end, ranges);
    return ranges;
  }
}

List<T> _stableSort<T>(List<T> list, int Function(T, T) compare) {
  final indexed = [for (var i = 0; i < list.length; i++) (i, list[i])]
    ..sort((a, b) {
      final c = compare(a.$2, b.$2);
      return c != 0 ? c : a.$1.compareTo(b.$1);
    });
  for (var i = 0; i < list.length; i++) {
    list[i] = indexed[i].$2;
  }
  return list;
}
