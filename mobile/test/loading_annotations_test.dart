import 'dart:async';
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
    'first paint pairs candles with annotations despite optional analysis errors; switches persist',
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
      final ready = Completer<void>();
      final history = bars
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
      final study = <String, dynamic>{
        'patternMarks': [
          {
            'time': day,
            'kind': 'trend-start',
            'label': '趋势开启',
            'direction': 'bullish',
            'detail': 'dated test evidence',
            'priority': 99,
            'position': 'below',
          },
        ],
        'tradeMarkers': [],
        'indicatorMarks': [
          {
            'time': day,
            'pane': 'macd',
            'label': '金叉',
            'kind': 'golden',
            'position': 'below',
          },
        ],
        'verification': {
          'symbol': '300545.SZ',
          'unit': 'day',
          'maPeriods': [5, 13, 20, 30, 60, 120, 144, 250],
          'candleCount': bars.length,
          'last': history.last,
        },
      };
      final bundle = {
        'market': {'name': 'Stock', 'provider': '腾讯公开日线', 'candles': history},
        'study': study,
      };
      final api = AtlasApi(
        client: MockClient((r) async {
          if (r.url.path == '/api/analysis') {
            return http.Response(
              '<title>Worker exceeded resource limits</title>',
              503,
            );
          }
          if (r.url.path == '/api/chart-bundle') await ready.future;
          if (r.url.path == '/api/chart-study') studyCalls++;
          final data = switch (r.url.path) {
            '/api/chart-bundle' => bundle,
            '/api/chart-study' => study,
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
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.byType(MarketChart), findsNothing);
      ready.complete();
      await tester.pumpAndSettle();
      expect(find.byType(MarketChart), findsOneWidget);
      expect(
        tester.widget<MarketChart>(find.byType(MarketChart)).bars.length,
        100,
      );
      expect(
        studyCalls,
        0,
        reason: 'the verified first snapshot does not start a second annotation request',
      );
      expect(painter(tester).patterns.single['label'], '趋势开启');
      expect(painter(tester).indicatorMarks.single['label'], '金叉');
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
