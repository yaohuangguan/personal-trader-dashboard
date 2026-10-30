import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/palette.dart';
import 'package:market_atlas/widgets/earnings_board.dart';
import 'package:market_atlas/screens/news.dart';

void main() {
  testWidgets(
    '390px large text earnings cards paginate and change server-side sorting without overflow',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});
      final requests = <Uri>[];
      final store = AtlasStore(
        AtlasApi(
          client: MockClient((r) async {
            requests.add(r.url);
            return http.Response(
              jsonEncode({
                'period': '2026-09-30',
                'periods': ['2026-09-30', '2026-06-30'],
                'page': int.parse(r.url.queryParameters['page']!),
                'pageSize': 40,
                'pages': 2,
                'total': 41,
                'items': [
                  {
                    'name': '国航远洋',
                    'symbol': '920571.BJ',
                    'industry': '航运港口',
                    'profitGrowth': 98070.64,
                    'revenueGrowth': 46.43,
                    'profit': 201343464.17,
                    'revenue': 1014113188.79,
                    'eps': .36,
                    'roe': 14.41,
                    'disclosed': '2026-10-29',
                  },
                ],
                'source': '正式业绩报表',
                'notice': '同报告期累计值',
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }),
        ),
        await SharedPreferences.getInstance(),
        {},
      );
      for (final light in [false, true]) {
        AtlasPalette.light = light;
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: store,
            child: MaterialApp(
              theme: light ? ThemeData.light() : ThemeData.dark(),
              home: MediaQuery(
                data: const MediaQueryData(
                  textScaler: TextScaler.linear(22 / 18),
                ),
                child: const Scaffold(
                  body: SingleChildScrollView(child: EarningsBoard()),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('全市场财报披露'), findsOneWidget);
        expect(tester.widget<Text>(find.text('+98070.64%')).style?.color, up);
        expect(tester.takeException(), isNull);
        if (!light) {
          await tester.tap(find.byType(DropdownButtonFormField<String>).at(1));
          await tester.pumpAndSettle();
          await tester.tap(find.text('营收同比').last);
          await tester.pumpAndSettle();
          expect(requests.last.queryParameters['sort'], 'revenueGrowth');
          await tester.ensureVisible(find.text('下一页'));
          await tester.tap(find.text('下一页'));
          await tester.pumpAndSettle();
          expect(requests.last.queryParameters['page'], '2');
          await tester.ensureVisible(find.byType(TextField));
          await tester.enterText(find.byType(TextField), '国航远洋');
          await tester.testTextInput.receiveAction(TextInputAction.search);
          await tester.pumpAndSettle();
          expect(requests.last.queryParameters['q'], '国航远洋');
          expect(requests.last.queryParameters['page'], '1');
          expect(tester.takeException(), isNull);
        }
        await tester.pumpWidget(const SizedBox());
      }
      store.dispose();
      AtlasPalette.light = false;
    },
  );
  testWidgets(
    'only source-marked important mobile news receives red emphasis',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      AtlasPalette.light = false;
      final store = AtlasStore(
        AtlasApi(client: MockClient((r) async => http.Response('{}', 200))),
        await SharedPreferences.getInstance(),
        {},
      );
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: store,
          child: const MaterialApp(
            home: Scaffold(
              body: Column(
                children: [
                  NewsTile({'title': '重要消息', 'important': true}),
                  NewsTile({'title': '普通消息'}),
                ],
              ),
            ),
          ),
        ),
      );
      expect(tester.widget<Text>(find.text('重要消息')).style?.color, up);
      expect(tester.widget<Text>(find.text('普通消息')).style?.color, ink);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
    },
  );
}
