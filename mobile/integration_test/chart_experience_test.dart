import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import '../test/support/chart_harness.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('iOS native chart gestures, landscape and MA editing', (
    tester,
  ) async {
    final s = await chartStore(), prices = ValueNotifier(chartFixture());
    await tester.pumpWidget(chartHarness(s, prices));
    await tester.pumpAndSettle();
    await exerciseChart(
      tester,
      screenshot: (name) async {
        await binding.takeScreenshot(name);
      },
    );
    await tester.ensureVisible(find.byTooltip('展开图表'));
    await tester.tap(find.byTooltip('展开图表'));
    await tester.pumpAndSettle();
    await SystemChrome.setPreferredOrientations([
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
    await tester.pumpAndSettle(const Duration(milliseconds: 300));
    await Future<void>.delayed(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(find.byTooltip('副图布局'), findsOneWidget);
    await binding.takeScreenshot('ios-chart-landscape-all');
    await tester.tap(find.byTooltip('副图布局'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('MACD').last);
    await tester.pumpAndSettle();
    expect(painter(tester).volume || painter(tester).kdj, isFalse);
    await binding.takeScreenshot('ios-chart-landscape-macd');
    await tester.tap(find.byTooltip('均线参数'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(1), '10');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.ensureVisible(find.text('应用参数'));
    await tester.tap(find.text('应用参数'));
    await tester.pumpAndSettle();
    expect(painter(tester).data.mas[1].period, 10);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('关闭全屏'));
    await tester.pumpAndSettle();
    await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(const ValueKey('candlestick-canvas')),
    );
    await tester.pumpAndSettle();
    await binding.takeScreenshot('ios-chart-return-portrait');
    await tester.pumpWidget(const SizedBox());
    s.dispose();
    prices.dispose();
  });
}
