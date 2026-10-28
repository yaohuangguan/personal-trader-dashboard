import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/widgets/market_chart.dart';

import 'support/chart_harness.dart';

void main() {
  testWidgets(
    'shape, timing alert and indicator annotations reach the native canvas and their reasons open',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});
      final bars = chartFixture(100), day = bars.last.time;
      final store = AtlasStore(
        AtlasApi(
          client: MockClient(
            (r) async => http.Response(
              jsonEncode({
                'tradeMarkers': [
                  {
                    'time': day,
                    'side': 'sell',
                    'label': '卖预警',
                    'reason': '放量冲高回落；核验防守线',
                    'confirmed': false,
                    'provisional': true,
                  },
                ],
                'patternMarks': [
                  {
                    'time': day,
                    'kind': 'vp-stall',
                    'label': '量大滞涨',
                    'detail': '已发生量为20日均量2倍',
                    'position': 'above',
                    'priority': 88,
                    'provisional': true,
                  },
                ],
                'indicatorMarks': [
                  {
                    'time': day,
                    'pane': 'MACD',
                    'kind': 'death',
                    'label': '死叉',
                    'detail': '快线下穿',
                    'value': .1,
                    'bullish': false,
                    'provisional': true,
                  },
                  {
                    'time': day,
                    'pane': 'VOL',
                    'kind': 'expansion',
                    'label': '放量回落',
                    'detail': '参与量增加',
                    'value': bars.last.volume,
                    'bullish': false,
                    'provisional': true,
                  },
                ],
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            ),
          ),
        ),
        await SharedPreferences.getInstance(),
        {},
      );
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: store,
          child: MaterialApp(
            home: Scaffold(
              body: MarketChart(
                bars: bars,
                symbol: '300545.SZ',
                terminal: true,
                viewportHeight: 844,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final p = painter(tester);
      expect(p.trades.single['label'], '卖预警');
      expect(p.patterns.single['label'], '量大滞涨');
      expect(p.indicatorMarks.length, 2);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byTooltip('标注依据'));
      await tester.pumpAndSettle();
      expect(find.text('量大滞涨'), findsOneWidget);
      expect(find.textContaining('核验防守线'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      store.dispose();
    },
  );
}
