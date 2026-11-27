import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:market_atlas/core/chart_history.dart';
import 'package:market_atlas/core/chart_labels.dart';
import 'package:market_atlas/core/chart_marks.dart';
import 'package:market_atlas/core/chart_studies.dart';
import 'package:market_atlas/core/indicators.dart';
import 'package:market_atlas/core/palette.dart';

import 'support/chart_harness.dart';

void expectSameIndicators(IndicatorData a, IndicatorData b) {
  expect(a.bars.length, b.bars.length);
  for (final p in b.averages.keys) {
    expect(a.averages[p], b.averages[p], reason: 'MA$p');
  }
  for (final (name, x, y) in [
    ('bollMid', a.bollMid, b.bollMid),
    ('bollUpper', a.bollUpper, b.bollUpper),
    ('bollLower', a.bollLower, b.bollLower),
    ('rsi', a.rsi14, b.rsi14),
    ('sar', a.sar, b.sar),
    ('vol5', a.vol5, b.vol5),
    ('vol20', a.vol20, b.vol20),
    ('dif', a.dif, b.dif),
    ('dea', a.dea, b.dea),
    ('hist', a.hist, b.hist),
    ('k', a.kdjK, b.kdjK),
    ('d', a.kdjD, b.kdjD),
    ('j', a.kdjJ, b.kdjJ),
    ('volumes', a.volumes, b.volumes),
  ]) {
    expect(x, y, reason: name);
  }
  expect(a.signals, b.signals);
}

void main() {
  test(
    'a live tail update equals a full indicator pass and keeps the index',
    () {
      final random = math.Random(7);
      var bars = chartFixture(260);
      var data = IndicatorData(bars, defaultMa);
      final index = data.timeIndex;
      for (var tick = 0; tick < 6; tick++) {
        final last = bars.last,
            close = last.close * (1 + (random.nextDouble() - .5) * .08);
        bars = [
          ...bars.take(bars.length - 1),
          Bar(
            last.time,
            last.open,
            math.max(last.high, close),
            math.min(last.low, close),
            close,
            last.volume + random.nextInt(900),
          ),
        ];
        data = IndicatorData.updateLast(data, bars);
        expectSameIndicators(data, IndicatorData(bars, defaultMa));
      }
      expect(identical(data.timeIndex, index), isTrue);
      expect(data.indexOf(bars[42].time), 42);
      expect(data.indexOf('1999-01-01'), isNull);
      // A new candle date is a structural change: full rebuild, new index.
      final appended = [...bars, Bar('2099-01-01', 1, 2, .5, 1.5, 10)];
      final next = IndicatorData.updateLast(data, appended);
      expectSameIndicators(next, IndicatorData(appended, defaultMa));
      expect(next.indexOf('2099-01-01'), appended.length - 1);
    },
  );

  test('marks are resolved, grouped per pane and sliced to the viewport', () {
    final bars = chartFixture(50), data = IndicatorData(bars, defaultMa);
    String t(int i) => bars[i].time;
    final marks = ChartMarks.resolve(
      data.timeIndex,
      bars.last.time,
      trades: [
        {'time': t(30), 'side': 'buy'},
        {'time': t(5), 'side': 'sell'},
        {'time': 'missing', 'side': 'sell'},
      ],
      events: [
        {'date': t(12)},
      ],
      patterns: [
        {'time': t(20), 'priority': 90},
        {'time': t(49), 'priority': 1},
        {'time': t(21), 'priority': 99, 'chartVisible': false},
        {'time': t(10), 'priority': 95},
      ],
      indicatorMarks: [
        {'time': t(40), 'pane': 'MACD', 'kind': 'golden', 'value': .1},
        {'time': t(10), 'pane': 'MACD', 'kind': 'top-divergence', 'value': .2},
        {'time': t(45), 'pane': 'MACD', 'kind': 'death', 'value': .1},
        {'time': t(44), 'pane': 'VOL', 'kind': 'expansion', 'value': 9},
        {'time': t(44), 'pane': 'KDJ', 'kind': 'golden'},
      ],
    );
    expect(marks.trades.map((m) => m.index), [5, 30]);
    expect(marks.events.single.index, 12);
    expect(marks.patterns.map((m) => m.index), [
      49,
      10,
      20,
    ], reason: 'latest candle first, then priority; hidden marks dropped');
    expect(marks.pane('MACD').visible(0, 50).map((m) => m.index), [10, 45, 40]);
    expect(marks.pane('MACD').visible(11, 45).map((m) => m.index), [40]);
    expect(marks.pane('VOL').visible(0, 50).single.value, 9);
    expect(marks.pane('KDJ').length, 0, reason: 'no value, nothing to place');
    expect(ChartMarks.visibleRange(marks.trades, 6, 31).map((m) => m.index), [
      30,
    ]);
  });

  test('refreshed weekly candles replace the in-progress week instead of duplicating it', () {
    Bar week(String time, double close) =>
        Bar(time, close - 1, close + 1, close - 2, close, 100);
    final paged = [week('2026-10-30', 9), week('2026-11-06', 10)];
    final before = [
      ...paged,
      week('2026-11-13', 11),
      week('2026-11-19', 12), // in-progress week labelled with Thursday
    ];
    final refreshed = [
      week('2026-11-13', 11),
      week('2026-11-20', 12.5), // same week, now labelled with Friday
    ];
    final merged = mergeLatestBars(before, refreshed);
    expect(merged.map((b) => b.time), [
      '2026-10-30',
      '2026-11-06',
      '2026-11-13',
      '2026-11-20',
    ]);
    expect(merged.last.close, 12.5);
    expect(identical(mergeLatestBars(before, before), before), isTrue);
    expect(mergeLatestBars(before, const []), before);
    expect(
      mergeLatestBars([], refreshed.reversed.toList()).map((b) => b.time),
      ['2026-11-13', '2026-11-20'],
    );
  });

  test('x-axis labels follow the unit', () {
    expect(axisLabels(['2024-11-29', '2025-06-30', '2026-10-30'], 'month'), [
      '2024-11',
      '2025-06',
      '2026-10',
    ]);
    expect(axisLabels(['2025-11-21', '2025-12-26', '2026-01-09'], 'week'), [
      '2025-11-21',
      '12-26',
      '2026-01-09',
    ]);
    expect(axisLabels(['2026-10-20', '2026-11-26'], 'day'), ['10-20', '11-26']);
    expect(
      axisLabels([
        '2026-11-25 14:30',
        '2026-11-25 14:55',
        '2026-11-26 10:05',
      ], 'm5'),
      ['11-25 14:30', '14:55', '11-26 10:05'],
    );
  });

  test('OHLC readout colours compare each value with the previous close', () {
    expect(ohlcDirection(10.2, 10), 1);
    expect(ohlcDirection(9.8, 10), -1);
    expect(ohlcDirection(10, 10), 0);
    expect(ohlcDirection(10, null), 0);
  });

  test(
    'labels are placed without overlap and dropped when they do not fit',
    () {
      expect(nonOverlapping([(0, 40), (300, 340), (20, 60), (150, 190)]), [
        0,
        1,
        3,
      ]);
      expect(sequentialLabels([40, 40, 40], start: 50, limit: 150), [50, 100]);
    },
  );

  test('study cache keys are small but track the series', () {
    Map<String, Object> candle(String t, double c) => {
      'time': t,
      'open': c,
      'high': c,
      'low': c,
      'close': c,
      'volume': 1,
    };
    final candles = [
      for (var i = 0; i < 2000; i++)
        candle('2020-01-${(i % 28 + 1).toString().padLeft(2, '0')}', 10.0 + i),
    ];
    final input = {
      'symbol': '300545.SZ',
      'unit': 'day',
      'ma': [5, 13],
      'candles': candles,
    };
    final key = studyCacheKey(input);
    expect(key.length, lessThan(400));
    expect(studyCacheKey({...input, 'candles': List.of(candles)}), key);
    final changed = List.of(candles)..[1000] = candle('2020-01-01', 1);
    expect(studyCacheKey({...input, 'candles': changed}), isNot(key));
    expect(
      studyCacheKey({
        ...input,
        'ma': [5],
      }),
      isNot(key),
    );
  });

  test('light-theme chart colours keep line and text contrast on white', () {
    double contrast(Color c) =>
        (1.05) / (c.computeLuminance() + .05); // against white
    AtlasPalette.light = true;
    addTearDown(() => AtlasPalette.light = false);
    for (final c in [
      Colors.amber,
      const Color(0xfff7cf65),
      const Color(0xffed89bf),
      const Color(0xffd968e8),
      const Color(0xffd5ae58),
      ...defaultMa.map((m) => m.color),
    ]) {
      expect(contrast(chartColor(c)), greaterThanOrEqualTo(3), reason: '$c');
      expect(
        contrast(chartTextColor(c)),
        greaterThanOrEqualTo(4.5),
        reason: '$c',
      );
    }
    AtlasPalette.light = false;
    expect(chartColor(Colors.amber), Colors.amber);
  });
}
