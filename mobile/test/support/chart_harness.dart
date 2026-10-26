import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/indicators.dart';
import 'package:market_atlas/widgets/market_chart.dart';

List<Bar> chartFixture([int n = 300]) => List.generate(n, (i) {
  final close = 40 + i * .025 + (i % 13 - 6) * .06;
  return Bar(
    DateTime.utc(
      2025,
      1,
      1,
    ).add(Duration(days: i)).toIso8601String().substring(0, 10),
    close - .12,
    close + .35,
    close - .5,
    close,
    1000.0 + (i % 7) * 100,
  );
});
Future<AtlasStore> chartStore() async {
  SharedPreferences.setMockInitialValues({});
  return AtlasStore(
    AtlasApi(
      client: MockClient((r) async => http.Response('{"items":[]}', 200)),
    ),
    await SharedPreferences.getInstance(),
    {},
  );
}

Widget chartHarness(AtlasStore store, ValueNotifier<List<Bar>> prices) =>
    ChangeNotifierProvider.value(
      value: store,
      child: MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: Scaffold(
          appBar: AppBar(title: const Text('Chart interaction validation')),
          body: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: ValueListenableBuilder<List<Bar>>(
                valueListenable: prices,
                builder: (_, bars, _) =>
                    MarketChart(bars: bars, symbol: '300545.SZ'),
              ),
            ),
          ),
        ),
      ),
    );
ChartPainter painter(WidgetTester tester) =>
    tester
            .widget<CustomPaint>(
              find.byKey(const ValueKey('candlestick-canvas')).last,
            )
            .painter!
        as ChartPainter;
Future<void> exerciseChart(
  WidgetTester tester, {
  Future<void> Function(String)? screenshot,
}) async {
  final target = find.byKey(const ValueKey('candlestick-canvas')).last;
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  final rect = tester.getRect(target), initial = painter(tester);
  final drag = await tester.startGesture(Offset(rect.center.dx, rect.top + 80));
  for (var i = 1; i <= 48; i++) {
    await drag.moveBy(const Offset(1, 0));
    await tester.pump(const Duration(milliseconds: 16));
  }
  await drag.up();
  await tester.pumpAndSettle();
  expect(
    painter(tester).end,
    lessThan(initial.end),
    reason: 'Slow rightward drags must reveal older candles',
  );
  final before = painter(tester), y = rect.top + 100;
  final a = await tester.startGesture(Offset(rect.left + 90, y), pointer: 7),
      b = await tester.startGesture(Offset(rect.left + 210, y), pointer: 8);
  await a.moveBy(const Offset(-28, 0));
  await b.moveBy(const Offset(28, 0));
  await tester.pump();
  await a.up();
  await b.up();
  await tester.pumpAndSettle();
  expect(
    painter(tester).end - painter(tester).start,
    lessThan(before.end - before.start),
  );
  final hold = await tester.startGesture(Offset(rect.left + 150, y));
  await tester.pump(const Duration(milliseconds: 650));
  await hold.moveBy(const Offset(24, 0));
  await tester.pump();
  await hold.up();
  await tester.pumpAndSettle();
  expect(
    painter(tester).hover,
    isNotNull,
    reason: 'Crosshair remains readable after lifting the finger',
  );
  expect(
    painter(tester).volume && painter(tester).macd && painter(tester).kdj,
    isTrue,
  );
  expect(tester.takeException(), isNull);
  if (screenshot != null) await screenshot('ios-chart-portrait-crosshair');
}
