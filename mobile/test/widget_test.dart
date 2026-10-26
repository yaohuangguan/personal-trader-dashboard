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
import 'package:market_atlas/widgets/live_chart_feed.dart';
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
  Future<AtlasStore> store({
    double font = 22,
    bool globalUnavailable = false,
  }) async {
    SharedPreferences.setMockInitialValues({'fontSize': font});
    return AtlasStore.load(
      api: AtlasApi(
        client: MockClient((r) async {
          if (globalUnavailable && r.url.path == '/api/monitor/global') {
            return http.Response('{"error":"Monitoring quota exhausted"}', 503);
          }
          final data = switch (r.url.path) {
            '/api/desk/trend' => {
              'score': 81,
              'label': '强势',
              'date': '2026-10-26',
              'current': true,
              'provisional': true,
              'coveredWeight': 75,
              'observations': ['现价高于分时价量均价估算 23.00'],
              'dimensions': [],
              'risks': ['盘中评分随行情变化，等待收盘复核'],
              'levels': {'support': 22.8, 'resistance': 24.1},
            },
            '/api/monitor/status' => {
              'config': {'enabled': globalUnavailable},
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

  testWidgets('global outage preserves the device monitoring state', (
    tester,
  ) async {
    final s = (await tester.runAsync(() => store(globalUnavailable: true)))!;
    final native = NativePushService(s.api, s.deviceToken);
    await tester.pumpWidget(AtlasApp(store: s, push: native));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.sensors).last);
    await tester.pumpAndSettle();
    expect(find.text('Monitoring quota exhausted'), findsOneWidget);
    expect(find.text('暂停盯盘'), findsOneWidget);
    expect(find.text('开启盯盘'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    s.dispose();
    await native.dispose();
  });
  testWidgets(
    'chart refresh retains history on errors and pauses in background',
    (tester) async {
      final s = (await tester.runAsync(() => store()))!;
      var calls = 0;
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: s,
          child: MaterialApp(
            home: Scaffold(
              body: LiveChartFeed(
                refreshSeconds: 15,
                load: () async {
                  calls++;
                  if (calls == 2) throw Exception('upstream unavailable');
                  return {'asOf': '2025-10-27', 'version': '$calls'};
                },
                builder: (data) =>
                    Center(child: Text('Chart ${data['version']}')),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Chart 1'), findsOneWidget);
      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();
      expect(find.text('Chart 1'), findsOneWidget);
      expect(find.textContaining('刷新失败，保留上一快照'), findsOneWidget);
      s.foreground = false;
      await tester.pump(const Duration(seconds: 15));
      expect(calls, 2);
      s.foreground = true;
      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();
      expect(find.text('Chart 3'), findsOneWidget);
      expect(find.textContaining('刷新失败，保留上一快照'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      s.dispose();
    },
  );
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
    final theme = Theme.of(tester.element(find.text('我的自选').first));
    expect(theme.textTheme.headlineSmall?.color, const Color(0xffeeeef4));
    expect(theme.textTheme.bodyMedium?.color, const Color(0xffeeeef4));
    await tester.tap(find.text('300545.SZ').first);
    await tester.pumpAndSettle();
    expect(find.text('Test stock'), findsOneWidget);
    expect(find.text('MA250 114.45'), findsOneWidget);
    final canvas = tester.getRect(
      find.byKey(const ValueKey('candlestick-canvas')),
    );
    expect(
      canvas.top,
      lessThan(300),
      reason: 'Quote and chart controls must remain compact',
    );
    expect(
      canvas.bottom,
      lessThan(790),
      reason: 'The full candle and all three indicator panes must fit before the bottom navigation',
    );
    expect(
      painterForStock(tester).volume &&
          painterForStock(tester).macd &&
          painterForStock(tester).kdj,
      isTrue,
    );
    expect(
      find.byType(OutlinedButton),
      findsNothing,
      reason: 'No large chart action buttons on the trading first screen',
    );
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('走势 81'));
    await tester.pumpAndSettle();
    expect(find.text('当日走势分析'), findsOneWidget);
    expect(find.text('81'), findsOneWidget);
    expect(find.text('现价高于分时价量均价估算 23.00'), findsOneWidget);
    expect(find.textContaining('75/100'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('关闭'));
    await tester.pumpAndSettle();
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
    await tester.tap(find.text('Monitor settings'));
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

ChartPainter painterForStock(WidgetTester tester) =>
    tester
            .widget<CustomPaint>(
              find.byKey(const ValueKey('candlestick-canvas')),
            )
            .painter!
        as ChartPainter;
