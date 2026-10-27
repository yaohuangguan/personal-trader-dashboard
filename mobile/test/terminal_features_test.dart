import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/indicators.dart';
import 'package:market_atlas/screens/news.dart';
import 'package:market_atlas/screens/stock.dart';
import 'package:market_atlas/main.dart';
import 'package:market_atlas/core/push_service.dart';
import 'package:market_atlas/core/palette.dart';

import 'support/chart_harness.dart';

void main() {
  testWidgets(
    'white mode persists and updates native surface and chart colors',
    (tester) async {
      final s = await chartStore(),
          push = NativePushService(s.api, s.deviceToken);
      await s.setTheme('light');
      await tester.pumpWidget(AtlasApp(store: s, push: push));
      await tester.pumpAndSettle();
      expect(AtlasPalette.light, true);
      expect(
        Theme.of(tester.element(find.byType(Scaffold).first)).brightness,
        Brightness.light,
      );
      expect(ink.computeLuminance(), lessThan(.15));
      expect(surface.computeLuminance(), greaterThan(.9));
      expect(chartColor(Colors.white).computeLuminance(), lessThan(.2));
      expect(s.prefs.getString('themeMode'), 'light');
      await s.setTheme('dark');
      await tester.pumpAndSettle();
      expect(AtlasPalette.light, false);
      await tester.pumpWidget(const SizedBox.shrink());
      s.dispose();
      await push.dispose();
    },
  );
  test(
    'groups persist, support multiple membership and keep stocks when deleted',
    () async {
      final s = await chartStore(),
          a = (await s.saveGroup('突破'))!,
          b = (await s.saveGroup('科技'))!;
      await s.groupStock(a, '300031.SZ', true);
      await s.groupStock(b, '300031.SZ', true);
      final restored = AtlasStore(s.api, s.prefs, {});
      expect(restored.groups.length, 2);
      expect(restored.watchlist, contains('300031.SZ'));
      await s.deleteGroup(a);
      expect(s.watchlist, contains('300031.SZ'));
      expect(s.groups.single['id'], b);
      await expectLater(s.saveGroup('科技'), throwsFormatException);
      await s.toggleWatch('300031.SZ');
      expect(s.groups.single['symbols'], isEmpty);
      s.dispose();
    },
  );
  test('native share links round trip Chinese and reject executable URLs', () {
    final u = articleLink({
      'title': '宝通科技',
      'url': 'https://example.com',
      'summary': '摘要',
    });
    expect(parseArticleLink(u)?['title'], '宝通科技');
    expect(Uri.parse(u).host, 'personal-market-atlas.nzs.workers.dev');
    expect(
      parseArticleLink(
        articleLink({'title': 'bad', 'url': 'javascript:alert(1)'}),
      ),
      isNull,
    );
  });
  test('native indicators preserve warmup, flat RSI and causal SAR', () {
    final bars = List.generate(40, (i) => Bar('$i', 100, 101, 99, 100, 1000)),
        d = IndicatorData(bars, defaultMa);
    expect(d.bollUpper[18], isNull);
    expect(d.bollUpper[19], 100);
    expect(d.rsi14[13], isNull);
    expect(d.rsi14[14], 50);
    expect(
      d.sar.take(21),
      IndicatorData(bars.take(21).toList(), defaultMa).sar,
    );
  });
  testWidgets(
    'phone indicator sheet changes the actual painter without clipping panes',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final s = await chartStore(), prices = ValueNotifier(chartFixture());
      await tester.pumpWidget(chartHarness(s, prices));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('图表指标'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('BOLL (20,2)'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(SwitchListTile, 'RSI (14)'));
      await tester.pumpAndSettle();
      await tester.tapAt(const Offset(15, 60));
      await tester.pumpAndSettle();
      expect(painter(tester).overlay, 'BOLL');
      expect(painter(tester).rsi, true);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      s.dispose();
      prices.dispose();
    },
  );
  testWidgets(
    'stock first screen remains complete and scrolls into real funding and F10 content',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final api = AtlasApi(
        client: MockClient((r) async {
          final body = switch (r.url.path) {
            '/api/analysis' => {
              'market': {
                'name': '宝通科技',
                'candles': chartFixture()
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
                    .toList(),
              },
              'strength': {'score': 48},
              'action': {
                'action': '观望',
                'reasons': ['等待确认'],
              },
            },
            '/api/desk/quotes' => {
              'items': [
                {
                  'symbol': '300031.SZ',
                  'name': '宝通科技',
                  'price': 26.28,
                  'asOf': '2026-10-26T15:00:00+08:00',
                },
              ],
            },
            '/api/desk/flow' => {
              'points': [
                {'time': '2026-10-26', 'main': 123456},
              ],
              'source': '测试来源',
            },
            '/api/desk/f10' => {
              'profile': {'name': '宝通科技'},
              'financials': [
                {'date': '2026-06-30', 'revenue': 1234567, 'profit': 10000},
              ],
            },
            _ => <String, dynamic>{},
          };
          return http.Response(
            jsonEncode(body),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      final s = AtlasStore(api, prefs, {});
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: s,
          child: MaterialApp(
            theme: ThemeData.dark(useMaterial3: true),
            home: const StockPage('300031.SZ'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final chart = find.byKey(const ValueKey('candlestick-canvas'));
      expect(tester.getRect(chart).bottom, lessThan(794));
      expect(painter(tester).volume, true);
      expect(painter(tester).macd, true);
      expect(painter(tester).kdj, true);
      final list = find.byKey(const ValueKey('details-300031.SZ'));
      await tester.drag(list, const Offset(0, -650));
      await tester.pumpAndSettle();
      expect(find.text('资金面'), findsOneWidget);
      expect(find.text('12.35万'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('财务报表'),
        350,
        scrollable: find
            .descendant(of: list, matching: find.byType(Scrollable))
            .first,
      );
      await tester.pumpAndSettle();
      expect(find.text('财务报表'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      s.dispose();
    },
  );
}
