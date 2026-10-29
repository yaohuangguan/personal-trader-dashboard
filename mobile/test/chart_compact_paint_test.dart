import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:market_atlas/core/indicators.dart';
import 'package:market_atlas/widgets/market_chart.dart';

import 'support/chart_harness.dart';

void main() {
  testWidgets(
    'compact and narrow annotated panes paint without invalid bounds',
    (tester) async {
      final bars = chartFixture(100), data = IndicatorData(bars, defaultMa);
      for (final size in [
        const Size(750, 190),
        const Size(90, 260),
        const Size(390, 500),
      ]) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Center(
                child: SizedBox.fromSize(
                  size: size,
                  child: CustomPaint(
                    painter: ChartPainter(
                      data,
                      0,
                      bars.length,
                      null,
                      true,
                      forecast: IndicatorData([
                        ...bars,
                        for (var j = 1; j <= 15; j++)
                          Bar(
                            '2026-01-${j.toString().padLeft(2, '0')}',
                            43 + j * .1,
                            44 + j * .1,
                            42 + j * .1,
                            43.5 + j * .1,
                            1500,
                          ),
                      ], defaultMa),
                      true,
                      true,
                      [],
                      '股',
                      12,
                      true,
                      patterns: [
                        {
                          'time': bars.last.time,
                          'label': '多头排列一阳多线放量突破',
                          'direction': 'bullish',
                          'position': 'below',
                        },
                      ],
                      indicatorMarks: [
                        for (final pane in ['VOL', 'MACD', 'KDJ'])
                          {
                            'time': bars.last.time,
                            'pane': pane,
                            'kind': 'expansion',
                            'label': '放量上攻动能持续增强',
                            'value': pane == 'VOL' ? bars.last.volume : .1,
                            'bullish': true,
                          },
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        expect(tester.takeException(), isNull, reason: 'Canvas $size');
      }
    },
  );
}
