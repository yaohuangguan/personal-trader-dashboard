import 'dart:io';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/screens/watch.dart';
import 'package:market_atlas/core/ui_translation.dart';

void main() {
  testWidgets(
    'English phone watch home shows groups, quotes and a bounded secondary management menu',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({
        'watchlist': ['NVDA'],
        'locale': 'en',
        'fontSize': 22.0,
      });
      final calls = <String>[];
      final store = AtlasStore(
        AtlasApi(
          client: MockClient((request) async {
            calls.add(request.url.toString());
            if (request.url.path == '/api/desk/insight') {
              return http.Response(
                jsonEncode({
                  'symbol': 'NVDA',
                  'generatedAt': DateTime.now().toIso8601String(),
                  'expiresAt': DateTime.now()
                      .add(const Duration(seconds: 20))
                      .toIso8601String(),
                  'trend': {'score': 78, 'current': true},
                  'operation': {'phase': 'tracking', 'ready': true},
                }),
                200,
              );
            }
            expect(request.url.queryParameters['symbols'], 'NVDA');
            return http.Response(
              jsonEncode({
                'items': [
                  {
                    'symbol': 'NVDA',
                    'name': 'Nvidia Corporation',
                    'price': 202.22,
                    'changePercent': -2.16,
                  },
                ],
              }),
              200,
            );
          }),
        ),
        await SharedPreferences.getInstance(),
        Map<String, dynamic>.from(
          jsonDecode(File('assets/strings_en.json').readAsStringSync()),
        ),
      );
      await store.refreshQuotes();
      expect(calls.single, contains('/api/desk/quotes'));
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: store,
          child: MaterialApp(
            home: Scaffold(
              body: MediaQuery(
                data: const MediaQueryData(
                  size: Size(390, 844),
                  textScaler: TextScaler.linear(22 / 18),
                ),
                child: WatchPage(),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('202.22'), findsOneWidget);
      expect(find.text('My watchlist'), findsNothing);
      expect(find.text(store.t('全部自选')), findsOneWidget);
      expect(find.text(store.t('导出自选')), findsNothing);
      expect(find.text(store.t('从其他App导入自选')), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byTooltip('Manage watchlist'));
      await tester.pumpAndSettle();
      expect(find.text(store.t('导出自选')), findsOneWidget);
      expect(find.text('Import from another app'), findsOneWidget);
      expect(
        tester.getRect(find.text('Import from another app')).bottom,
        lessThan(844),
      );
      await tester.tapAt(const Offset(12, 760));
      await tester.pumpAndSettle();
      expect(find.text('Import from another app'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
    },
  );
  testWidgets(
    'scrolling a row out and back keeps its score without another request',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final symbols = ['NVDA', for (var i = 0; i < 20; i++) 'A$i'];
      SharedPreferences.setMockInitialValues({'watchlist': symbols});
      var firstCalls = 0;
      final store = AtlasStore(
        AtlasApi(
          client: MockClient((request) async {
            expect(request.url.path, '/api/desk/insight');
            final symbol = request.url.queryParameters['symbol']!;
            if (symbol == 'NVDA') firstCalls++;
            return http.Response(
              jsonEncode({
                'symbol': symbol,
                'generatedAt': DateTime.now().toIso8601String(),
                'expiresAt': DateTime.now()
                    .add(const Duration(seconds: 20))
                    .toIso8601String(),
                'trend': {'score': symbol == 'NVDA' ? 87 : 12, 'current': true},
                'operation': {'phase': 'pullback', 'ready': true},
              }),
              200,
            );
          }),
        ),
        await SharedPreferences.getInstance(),
        {},
      );
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: store,
          child: const MaterialApp(home: Scaffold(body: WatchPage())),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('今日走势 87'), findsOneWidget);
      final list = find.byType(ListView).first;
      await tester.drag(list, const Offset(0, -1600));
      await tester.pumpAndSettle();
      expect(find.text('今日走势 87'), findsNothing);
      await tester.drag(list, const Offset(0, 2000));
      await tester.pump();
      expect(find.text('今日走势 87'), findsOneWidget);
      await tester.pumpAndSettle();
      expect(firstCalls, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
    },
  );
  test('native templates translate dynamic projection facts without rewriting articles', () async {
    final dict = Map<String, dynamic>.from(
      jsonDecode(File('assets/strings_en.json').readAsStringSync()),
    );
    final t = UITranslation(dict);
    expect(
      t('当前结构：多头趋势延续；近5根涨跌 2.35%。'),
      'Current structure: Uptrend continuation; five-bar change: 2.35%.',
    );
    expect(
      t('从12段同股相似窗口中选整段路径'),
      'Whole paths selected from 12 similar windows in this stock',
    );
    expect(t('2.50亿'), '250M');
    expect(t('招商银行发布年度业绩报告'), '招商银行发布年度业绩报告');
  });
}
