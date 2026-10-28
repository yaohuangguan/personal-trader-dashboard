import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/screens/stock.dart';
import 'package:market_atlas/widgets/market_chart.dart';

import 'support/chart_harness.dart';

void main() {
  testWidgets(
    'raw chart survives strategy resource errors, failed annotations retry, and named switches persist',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance(),
          bars = chartFixture(100),
          day = bars.last.time;
      var studyCalls = 0;
      final api = AtlasApi(
        client: MockClient((r) async {
          if (r.url.path == '/api/analysis' ||
              r.url.path == '/api/chart-study' && ++studyCalls == 1) {
            return http.Response(
              '<title>Worker exceeded resource limits</title>',
              503,
            );
          }
          final data = switch (r.url.path) {
            '/api/market' => {
              'name': 'Stock',
              'provider': '腾讯公开日线',
              'candles': bars
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
            '/api/chart-study' => {
              'patternMarks': [
                {
                  'time': day,
                  'kind': 'box',
                  'label': '箱体放量换手',
                  'detail': 'dated test evidence',
                  'priority': 65,
                  'position': 'above',
                },
              ],
              'tradeMarkers': [],
              'indicatorMarks': [],
            },
            _ => <String, dynamic>{},
          };
          return http.Response(
            jsonEncode(data),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      final store = AtlasStore(api, prefs, {});
      Widget page() => ChangeNotifierProvider.value(
        value: store,
        child: const MaterialApp(home: StockPage('300545.SZ')),
      );
      await tester.pumpWidget(page());
      await tester.pumpAndSettle();
      expect(find.byType(MarketChart), findsOneWidget);
      expect(
        tester.widget<MarketChart>(find.byType(MarketChart)).bars.length,
        100,
      );
      expect(studyCalls, 1);
      await tester.pump(const Duration(seconds: 6));
      await tester.pumpAndSettle();
      expect(studyCalls, 2);
      expect(painter(tester).patterns.single['label'], '箱体放量换手');
      await tester.tap(find.byTooltip('标注设置').first);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(SwitchListTile, '形态标注'));
      await tester.pumpAndSettle();
      expect(
        obj(jsonDecode(prefs.getString('chart.annotations.v1')!))['shapes'],
        false,
      );
      tester.state<NavigatorState>(find.byType(Navigator).first).pop();
      await tester.pumpAndSettle();
      expect(painter(tester).showPatterns, false);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(page());
      await tester.pumpAndSettle();
      expect(painter(tester).showPatterns, false);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      store.dispose();
    },
  );
}
