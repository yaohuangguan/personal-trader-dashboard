import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/chart_harness.dart';

void main() {
  testWidgets(
    'landscape indicator settings scroll to independent pattern and trade controls',
    (tester) async {
      tester.view.physicalSize = const Size(844, 390);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final store = await chartStore(), prices = ValueNotifier(chartFixture());
      await tester.pumpWidget(chartHarness(store, prices));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('图表指标'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('MA交叉'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('MA交叉'));
      await tester.pumpAndSettle();
      expect(painter(tester).showCrosses, isTrue);
      expect(painter(tester).showSignals, isTrue);
      expect(painter(tester).showPatterns, isTrue);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
      prices.dispose();
    },
  );
  testWidgets('MA editor survives negative iOS keyboard insets in landscape', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(844, 390);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetViewInsets);
    final store = await chartStore(), prices = ValueNotifier(chartFixture());
    await tester.pumpWidget(chartHarness(store, prices));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('均线参数'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(1), '10');
    tester.view.viewInsets = const FakeViewPadding(bottom: -280);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.ensureVisible(find.text('应用参数'));
    await tester.tap(find.text('应用参数'));
    await tester.pumpAndSettle();
    expect(painter(tester).data.mas[1].period, 10);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    store.dispose();
    prices.dispose();
  });
}
