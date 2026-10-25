import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/main.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/push_service.dart';
import 'package:market_atlas/core/indicators.dart';
import 'package:market_atlas/widgets/market_chart.dart';
import 'package:provider/provider.dart';

List<Bar> prices(int n) => List.generate(
  n,
  (i) => Bar(
    DateTime.utc(
      2025,
      1,
      1,
    ).add(Duration(days: i)).toIso8601String().substring(0, 10),
    100 + i * .1,
    101 + i * .1,
    99 + i * .1,
    100 + i * .1,
    1000,
  ),
);
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('MA250 has full warmup and no future lookahead', () {
    final bars = prices(270), before = sma(bars, 250);
    expect(before[248], isNull);
    expect(before[249], closeTo(112.45, 1e-8));
    expect(
      sma([
        ...bars,
        const Bar('2027-01-01', 999, 1000, 998, 999, 10),
      ], 250).take(270),
      before,
    );
  });
  test('Chinese MACD multiplier and KDJ flat seed', () {
    final flat = IndicatorData(
      List.generate(30, (i) => Bar('$i', 100, 100, 100, 100, 100)),
      defaultMa,
    );
    expect(flat.hist.every((n) => n == 0), isTrue);
    expect(flat.kdjK.last, 50);
    expect(flat.kdjJ.last, 50);
    final trend = IndicatorData(prices(100), defaultMa);
    for (var i = 0; i < 100; i++) {
      expect(trend.hist[i], closeTo(2 * (trend.dif[i] - trend.dea[i]), 1e-10));
    }
  });
  test('chip mass, seed decay, no future turnover', () {
    final bars = prices(20),
        turns = List.filled(20, 10.0),
        model = chipModel(bars, turns)!;
    expect(
      rows(model['histogram']).fold(0.0, (sum, r) => sum + numOf(r['weight'])!),
      closeTo(1, 1e-9),
    );
    expect(numOf(model['seed']), closeTo(.13508517176729928, 1e-9));
    expect(
      chipModel(bars, turns, asOf: bars[9].time),
      chipModel(bars.take(10).toList(), turns.take(10).toList()),
    );
    expect(chipModel(bars, List.filled(20, double.nan)), isNull);
  });
  test(
    'source errors survive and device capability is never put in URL',
    () async {
      final api = AtlasApi(
        client: MockClient((r) async {
          expect(r.url.queryParameters.containsKey('token'), isFalse);
          expect(r.headers['Authorization'], 'Bearer private');
          return http.Response(
            '{"available":false,"reason":"upstream unavailable"}',
            503,
          );
        }),
      );
      await expectLater(
        api.get('/api/monitor/status', token: 'private'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 503)),
      );
      api.dispose();
    },
  );
  Future<AtlasStore> store({double font = 22}) async {
    SharedPreferences.setMockInitialValues({'fontSize': font});
    return AtlasStore.load(
      api: AtlasApi(
        client: MockClient((r) async {
          final data = switch (r.url.path) {
            '/api/monitor/status' => {
              'config': {'enabled': false},
              'events': [],
            },
            '/api/monitor/global' => {
              'total': 5576,
              'registered': 5576,
              'universeComplete': true,
              'shards': 35,
            },
            '/api/desk/quotes' => {
              'items': [
                {
                  'symbol': '300545.SZ',
                  'name': 'Test stock',
                  'price': 23.11,
                  'changePercent': 2.71,
                  'asOf': '2026-10-23T16:14:00+08:00',
                  'session': 'closed',
                  'bids': [],
                  'asks': [],
                },
              ],
            },
            '/api/analysis' => {
              'market': {
                'candles': prices(270)
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
                'provider': 'Unit fixture',
                'asOf': '2025-09-27',
              },
              'guide': {'stage': '数据不足'},
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
  }

  testWidgets('390px phone at 22px keeps watch/settings/signals usable', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final s = (await tester.runAsync(() => store()))!;
    final native = NativePushService(s.api, s.deviceToken);
    await tester.pumpWidget(AtlasApp(store: s, push: native));
    await tester.pumpAndSettle();
    expect(find.text('我的自选'), findsWidgets);
    await tester.tap(find.text('300545.SZ').first);
    await tester.pumpAndSettle();
    expect(find.text('Test stock'), findsOneWidget);
    expect(find.text('MA250 114.45'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('设置'));
    await tester.pumpAndSettle();
    expect(find.text('字体大小'), findsOneWidget);
    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    expect(find.text('Settings'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.sensors).last);
    await tester.pumpAndSettle();
    expect(find.byType(DropdownButtonFormField<String>), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    s.dispose();
    await native.dispose();
  });
  testWidgets('one candle chart touch handles a newly listed stock', (
    tester,
  ) async {
    final s = (await tester.runAsync(() => store(font: 18)))!;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: s,
        child: MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: MarketChart(bars: prices(1), symbol: 'test'),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CustomPaint).last, warnIfMissed: false);
    await tester.pump();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    s.dispose();
  });
}
