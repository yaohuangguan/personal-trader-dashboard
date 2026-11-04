import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/chart_history.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/indicators.dart';
import 'package:market_atlas/widgets/market_chart.dart';

import 'support/chart_harness.dart';

Json jsonBar(Bar b) => {
  'time': b.time,
  'open': b.open,
  'close': b.close,
  'high': b.high,
  'low': b.low,
  'volume': b.volume,
};
void main() {
  test(
    'history merge preserves live quotes and rejects incompatible adjustment',
    () {
      final bars = chartFixture(3),
          page = {
            'candles': [jsonBar(bars[0])],
            'anchor': jsonBar(bars[1]),
          };
      expect(
        mergeChartHistory(bars.sublist(1), page).map((b) => b.time),
        bars.map((b) => b.time),
      );
      expect(
        () => mergeChartHistory(bars.sublist(1), {
          ...page,
          'anchor': {...jsonBar(bars[1]), 'close': 1},
        }),
        throwsStateError,
      );
    },
  );
  testWidgets(
    'drag loads once, preserves date anchors, and refresh retains older candles for day/week/month',
    (tester) async {
      for (final unit in ['day', 'week', 'month']) {
        SharedPreferences.setMockInitialValues({});
        final all = chartFixture(120), prices = ValueNotifier(all.sublist(60));
        final completion = Completer<http.Response>();
        var calls = 0;
        final api = AtlasApi(
          client: MockClient((request) async {
            if (request.url.path == '/api/desk/history') {
              calls++;
              expect(request.url.queryParameters['before'], all[60].time);
              expect(request.url.queryParameters['period'], unit);
              return completion.future;
            }
            return http.Response(
              '{"tradeMarkers":[],"patternMarks":[],"indicatorMarks":[]}',
              200,
            );
          }),
        );
        final store = AtlasStore(
          api,
          await SharedPreferences.getInstance(),
          {},
        );
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: store,
            child: MaterialApp(
              home: Scaffold(
                body: ValueListenableBuilder<List<Bar>>(
                  valueListenable: prices,
                  builder: (_, bars, _) => MarketChart(
                    key: ValueKey(unit),
                    bars: bars,
                    symbol: '300545.SZ',
                    unit: unit,
                    terminal: true,
                    viewportHeight: 600,
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(calls, 0);
        final target = find.byKey(const ValueKey('candlestick-canvas'));
        await tester.drag(target, const Offset(1800, 0));
        await tester.pump();
        expect(calls, 1);
        final before = painter(tester),
            right = before.data.bars[before.end - 1].time;
        completion.complete(
          http.Response(
            jsonEncode({
              'candles': all.take(60).map(jsonBar).toList(),
              'anchor': jsonBar(all[60]),
              'hasMore': true,
              'volumeUnit': '手',
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          ),
        );
        await tester.pumpAndSettle();
        expect(painter(tester).data.bars.length, 120);
        expect(painter(tester).data.bars[painter(tester).end - 1].time, right);
        prices.value = [...prices.value];
        await tester.pumpAndSettle();
        expect(painter(tester).data.bars.length, 120);
        expect(calls, 1);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        prices.dispose();
        store.dispose();
        api.dispose();
      }
    },
  );
}
