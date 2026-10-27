import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:integration_test/integration_test.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/push_service.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/snapshot.dart';
import 'package:market_atlas/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../test/support/chart_harness.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'iPhone stock first screen fits every indicator at both text sizes',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final candles = chartFixture()
          .map(
            (b) => {
              'time': b.time,
              'open': b.open,
              'high': b.high,
              'low': b.low,
              'close': b.close,
              'volume': b.volume,
            },
          )
          .toList();
      final s = await AtlasStore.load(
        api: AtlasApi(
          client: MockClient((request) async {
            final data = switch (request.url.path) {
              '/api/desk/quotes' => {
                'items': [
                  {
                    'symbol': '300545.SZ',
                    'name': '联得装备',
                    'price': 47.36,
                    'change': 1.25,
                    'changePercent': 2.71,
                    'open': 46.1,
                    'high': 47.71,
                    'low': 45.86,
                    'turnover': 6.28,
                    'session': 'closed',
                    'asOf': '2025-10-27T15:00:00+08:00',
                  },
                ],
              },
              '/api/analysis' => {
                'market': {
                  'candles': candles,
                  'provider': 'Native integration fixture',
                  'asOf': '2025-10-27',
                },
                'guide': {'events': []},
              },
              _ => {'items': []},
            };
            return http.Response(
              jsonEncode(data),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }),
        ),
      );
      final push = NativePushService(s.api, s.deviceToken);
      await tester.pumpWidget(AtlasApp(store: s, push: push));
      await tester.pumpAndSettle();
      await tester.tap(find.text('300545.SZ').first);
      await tester.pumpAndSettle();
      for (final mode in ['dark', 'light']) {
        await s.setTheme(mode);
        for (final size in [18.0, 22.0]) {
          await s.setFont(size);
          await tester.pumpAndSettle();
          final canvas = tester.getRect(
            find.byKey(const ValueKey('candlestick-canvas')),
          );
          final navigation = tester.getRect(find.text('看盘'));
          expect(canvas.top, lessThan(330));
          expect(canvas.bottom, lessThan(navigation.top));
          expect(
            painter(tester).volume &&
                painter(tester).macd &&
                painter(tester).kdj,
            isTrue,
          );
          expect(find.byType(OutlinedButton), findsNothing);
          expect(tester.takeException(), isNull);
          expect(
            Theme.of(tester.element(find.byType(Scaffold).last)).brightness,
            mode == 'light' ? Brightness.light : Brightness.dark,
          );
          await binding.takeScreenshot(
            'ios-stock-first-screen-$mode-${size.toInt()}',
          );
        }
      }
      await s.setTheme('dark');
      await tester.pumpWidget(const SizedBox());
      s.dispose();
      await push.dispose();
    },
  );
  testWidgets('iOS native chart gestures, full-screen panes and MA editing', (
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
    final viewport = MediaQuery.sizeOf(
      tester.element(find.byKey(const ValueKey('candlestick-canvas')).last),
    );
    final orientation = viewport.width > viewport.height
        ? 'landscape'
        : 'portrait';
    binding.reportData = {
      ...?binding.reportData,
      'fullscreenOrientation': orientation,
      'viewportWidth': viewport.width,
      'viewportHeight': viewport.height,
    };
    expect(find.byTooltip('副图布局'), findsOneWidget);
    await binding.takeScreenshot('ios-chart-fullscreen-$orientation-default');
    await tester.tap(find.byTooltip('副图布局'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('全部副图').last);
    await tester.pumpAndSettle();
    await binding.takeScreenshot('ios-chart-fullscreen-$orientation-all-upper');
    await tester.drag(
      find.byKey(const ValueKey('candlestick-canvas')).last,
      const Offset(0, -180),
    );
    await tester.pumpAndSettle();
    await binding.takeScreenshot('ios-chart-fullscreen-$orientation-all-lower');
    await tester.ensureVisible(find.byTooltip('副图布局'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('副图布局'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('VOL + MACD').last);
    await tester.pumpAndSettle();
    expect(painter(tester).volume, isTrue);
    expect(painter(tester).kdj, isFalse);
    await binding.takeScreenshot('ios-chart-fullscreen-$orientation-macd');
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
  }, timeout: const Timeout(Duration(minutes: 5)));
  testWidgets(
    'native screenshot PNG copies to image clipboard without Photos',
    (tester) async {
      final key = GlobalKey();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: RepaintBoundary(
                key: key,
                child: const SizedBox(
                  width: 120,
                  height: 80,
                  child: ColoredBox(color: Colors.red),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      // Live tests still require an explicit pump for endOfFrame callbacks.
      final capture = StockSnapshot.capture(key, pixelRatio: 2);
      await tester.pump();
      final png = await capture.timeout(const Duration(seconds: 20));
      expect(png.sublist(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
      await StockSnapshot.copy(png);
      expect(tester.takeException(), isNull);
      binding.reportData = {...?binding.reportData, 'nativePngClipboard': true};
    },
  );
}
