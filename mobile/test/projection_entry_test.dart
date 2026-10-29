import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/widgets/market_chart.dart';

import 'support/chart_harness.dart';

void main() {
  testWidgets(
    'the stock terminal exposes projection for day, week and minute charts and paints its separate future bars',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final requests = <String>[];
      final bars = chartFixture(300),
          future = [
            for (var i = 1; i <= 20; i++)
              {
                'time': '2026-01-${i.toString().padLeft(2, '0')}',
                'open': 48.0,
                'high': 49.0,
                'low': 47.0,
                'close': 48.5,
                'volume': 1500.0,
              },
          ];
      final api = AtlasApi(
        client: MockClient((request) async {
          final body = obj(jsonDecode(request.body));
          final horizon = (numOf(body['horizon']) ?? 10).toInt();
          final projected = future.take(horizon).toList();
          if (body['task'] == 'projection') requests.add(str(body['unit']));
          return http.Response(
            jsonEncode(
              body['task'] == 'projection'
                  ? {
                      'projection': {
                        'available': true,
                        'horizon': horizon,
                        'scenarios': [
                          {'id': 'base', 'candles': projected},
                        ],
                        'points': [
                          for (final c in projected) {'time': c['time']},
                        ],
                        'conditions': [],
                      },
                    }
                  : {
                      'patternMarks': [],
                      'tradeMarkers': [],
                      'indicatorMarks': [],
                    },
            ),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      final store = AtlasStore(api, await SharedPreferences.getInstance(), {});
      for (final unit in ['day', 'week', 'm5']) {
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: store,
            child: MaterialApp(
              home: Scaffold(
                body: MarketChart(
                  key: ValueKey(unit),
                  bars: bars,
                  symbol: '300031.SZ',
                  unit: unit,
                  terminal: true,
                  viewportHeight: 600,
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byTooltip('行情推演'), findsOneWidget);
        await tester.tap(find.byTooltip('行情推演'));
        await tester.pumpAndSettle();
        expect(painter(tester).forecast!.bars.length, bars.length + 10);
        expect(painter(tester).data.bars.length, bars.length);
        await tester.tap(find.text(unit == 'day' ? '约4周' : '20 根${unit}K'));
        await tester.pumpAndSettle();
        expect(painter(tester).forecast!.bars.length, bars.length + 20);
        expect(tester.takeException(), isNull);
        Navigator.of(tester.element(find.text('行情推演').last)).pop();
        await tester.pumpAndSettle();
        await tester.pumpWidget(const SizedBox());
      }
      expect(requests, ['day', 'day', 'week', 'week', 'm5', 'm5']);
      store.dispose();
      api.dispose();
    },
  );
}
