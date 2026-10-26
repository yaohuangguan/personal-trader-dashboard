import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:market_atlas/core/chart_viewport.dart';

import 'support/chart_harness.dart';

void main() {
  test('phone plot fills the width and touch fractions match both edges', () {
    expect(ChartPlot.width(390), 378);
    expect(ChartPlot.fraction(6, 390), 0);
    expect(ChartPlot.fraction(384, 390), 1);
    expect(ChartPlot.fraction(195, 390), .5);
  });
  test('slow pan accumulates subpixel deltas in the natural direction', () {
    final v = ChartViewport(length: 300);
    v.beginPan();
    for (var i = 0; i < 50; i++) {
      v.pan(1, 250);
    }
    expect(v.offset, 13);
    expect(v.end, 287);
  });
  test(
    'pinch stays anchored, clamps new listings, and never leaves valid history',
    () {
      final v = ChartViewport(length: 300);
      v.beginPinch(100, .4);
      final anchor = v.start + .4 * v.visible;
      v.pinch(200, .4);
      expect(v.count, 33);
      expect((v.start + .4 * v.visible - anchor).abs(), lessThanOrEqualTo(1));
      v.beginPinch(100, .5);
      v.pinch(9, .5);
      expect(v.start, greaterThanOrEqualTo(0));
      expect(v.end, lessThanOrEqualTo(300));
      final fresh = ChartViewport(length: 1);
      fresh.beginPinch(40, .5);
      fresh.pinch(200, .5);
      expect(fresh.count, 1);
      expect(fresh.select(.9), 0);
    },
  );
  testWidgets('iPhone gestures, append anchoring and compact landscape panes', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final s = (await tester.runAsync(chartStore))!,
        prices = ValueNotifier(chartFixture());
    await tester.pumpWidget(chartHarness(s, prices));
    await tester.pumpAndSettle();
    await exerciseChart(tester);
    final right = painter(tester).data.bars[painter(tester).end - 1].time;
    prices.value = chartFixture(301);
    await tester.pumpAndSettle();
    expect(
      painter(tester).data.bars[painter(tester).end - 1].time,
      right,
      reason: 'Refreshing a historical viewport must keep its right-hand date',
    );
    await tester.ensureVisible(find.byTooltip('展开图表'));
    await tester.tap(find.byTooltip('展开图表'));
    await tester.pumpAndSettle();
    final full = tester.getRect(
      find.byKey(const ValueKey('candlestick-canvas')).last,
    );
    expect(full.width, 390);
    expect(
      full.bottom,
      greaterThan(820),
      reason: 'Portrait fullscreen must fill the available screen',
    );
    expect(tester.takeException(), isNull);
    tester.view.physicalSize = const Size(844, 390);
    await tester.pumpAndSettle();
    expect(find.byTooltip('副图布局'), findsOneWidget);
    expect(
      painter(tester).volume && painter(tester).macd && !painter(tester).kdj,
      isTrue,
    );
    await tester.tap(find.byTooltip('副图布局'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('VOL + MACD').last);
    await tester.pumpAndSettle();
    expect(painter(tester).macd, isTrue);
    expect(painter(tester).volume, isTrue);
    expect(painter(tester).kdj, isFalse);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('均线参数'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(1), '10');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.ensureVisible(find.byTooltip('自定义颜色').first);
    await tester.tap(find.byTooltip('自定义颜色').first);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, '#F4F5F7'),
      '#91ABC0',
    );
    await tester.tap(find.text('应用参数').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('应用参数'));
    await tester.tap(find.text('应用参数'));
    await tester.pumpAndSettle();
    expect(painter(tester).data.mas[1].period, 10);
    expect(painter(tester).data.mas[0].color, const Color(0xff91abc0));
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('关闭全屏'));
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox());
    prices.dispose();
    s.dispose();
  });
}
