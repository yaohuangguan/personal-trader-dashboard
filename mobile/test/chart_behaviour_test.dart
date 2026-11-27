import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/chart_viewport.dart';
import 'package:market_atlas/core/indicators.dart';
import 'package:market_atlas/core/palette.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/widgets/market_chart.dart';

import 'support/chart_harness.dart';

Json jsonBar(Bar b) => {
  'time': b.time,
  'open': b.open,
  'high': b.high,
  'low': b.low,
  'close': b.close,
  'volume': b.volume,
};

http.Response ok(Object body) => http.Response(
  jsonEncode(body),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Future<AtlasStore> storeWith(
  Future<http.Response> Function(http.Request) handler,
) async {
  SharedPreferences.setMockInitialValues({});
  return AtlasStore(
    AtlasApi(client: MockClient(handler)),
    await SharedPreferences.getInstance(),
    {},
  );
}

Widget app(AtlasStore store, Widget child, {ThemeData? theme}) =>
    ChangeNotifierProvider.value(
      value: store,
      child: MaterialApp(
        theme: theme,
        home: Scaffold(body: child),
      ),
    );

Widget liveChart(
  ValueNotifier<List<Bar>> prices, {
  String unit = 'day',
  String symbol = '300545.SZ',
}) => ValueListenableBuilder<List<Bar>>(
  valueListenable: prices,
  builder: (_, bars, _) => MarketChart(
    bars: bars,
    symbol: symbol,
    unit: unit,
    terminal: true,
    viewportHeight: 600,
  ),
);

void phone(WidgetTester tester, [Size size = const Size(390, 844)]) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Rect canvasRect(WidgetTester tester) =>
    tester.getRect(find.byKey(const ValueKey('candlestick-canvas')).last);

void main() {
  testWidgets('a single tap selects a candle at once (no double-tap wait)', (
    tester,
  ) async {
    phone(tester);
    final store = await chartStore(), prices = ValueNotifier(chartFixture());
    await tester.pumpWidget(chartHarness(store, prices));
    await tester.pumpAndSettle();
    expect(crosshair(tester).hover, isNull);
    final rect = canvasRect(tester);
    await tester.tapAt(Offset(rect.left + 120, rect.top + 60));
    await tester.pump();
    expect(crosshair(tester).hover, isNotNull);
    final first = crosshair(tester).hover;
    // A quick second tap elsewhere is another selection, not a zoom reset.
    await tester.tapAt(Offset(rect.right - 40, rect.top + 60));
    await tester.pump();
    expect(crosshair(tester).hover, isNot(first));
    expect(
      painter(tester).end - painter(tester).start,
      defaultChartBarCount('day'),
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    prices.dispose();
    store.dispose();
  });

  testWidgets('pinching inside a scrolling page zooms without scrolling it', (
    tester,
  ) async {
    phone(tester);
    final store = await chartStore(), prices = ValueNotifier(chartFixture());
    final scroll = ScrollController();
    await tester.pumpWidget(
      app(
        store,
        ListView(
          controller: scroll,
          children: [
            SizedBox(height: 600, child: liveChart(prices)),
            const SizedBox(height: 1600),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    final before = painter(tester).end - painter(tester).start;
    final rect = canvasRect(tester);
    final a = await tester.startGesture(
          Offset(rect.left + 150, rect.top + 120),
          pointer: 11,
        ),
        b = await tester.startGesture(
          Offset(rect.left + 230, rect.top + 260),
          pointer: 12,
        );
    for (var i = 0; i < 12; i++) {
      // Spread apart diagonally: the moving finger has a strong upward
      // component that a page scroll would otherwise pick up.
      await a.moveBy(const Offset(-3, 0));
      await b.moveBy(const Offset(4, -8));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await a.up();
    await b.up();
    await tester.pumpAndSettle();
    expect(scroll.offset, 0, reason: 'the page must not scroll while zooming');
    expect(painter(tester).end - painter(tester).start, lessThan(before));
    // One finger still scrolls the page.
    await tester.drag(find.byType(ListView), const Offset(0, -300));
    await tester.pumpAndSettle();
    expect(scroll.offset, greaterThan(0));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    scroll.dispose();
    prices.dispose();
    store.dispose();
  });

  testWidgets('a left-edge pan on iOS pans the chart instead of popping', (
    tester,
  ) async {
    phone(tester);
    final store = await chartStore(), prices = ValueNotifier(chartFixture());
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: store,
        child: MaterialApp(
          theme: ThemeData(platform: TargetPlatform.iOS),
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute<void>(
                  builder: (_) => Scaffold(body: liveChart(prices)),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    final end = painter(tester).end, rect = canvasRect(tester);
    final edge = await tester.startGesture(Offset(4, rect.top + 100));
    for (var i = 0; i < 40; i++) {
      await edge.moveBy(const Offset(3, 0));
      await tester.pump(const Duration(milliseconds: 8));
    }
    await edge.up();
    await tester.pumpAndSettle();
    expect(find.byType(MarketChart), findsOneWidget, reason: 'not popped');
    expect(painter(tester).end, lessThan(end), reason: 'panned to older');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    prices.dispose();
    store.dispose();
  });

  testWidgets(
    'fullscreen is a modal route and rotation keeps the same chart state',
    (tester) async {
      phone(tester);
      final store = await chartStore(), prices = ValueNotifier(chartFixture());
      await tester.pumpWidget(chartHarness(store, prices));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('展开图表'));
      await tester.pumpAndSettle();
      final chart = find.byType(MarketChart).last;
      final route = ModalRoute.of(tester.element(chart))! as PageRoute;
      expect(route.fullscreenDialog, isTrue);
      // Zoom out in portrait, then rotate.
      final rect = canvasRect(tester);
      final a = await tester.startGesture(
            Offset(rect.left + 120, rect.top + 100),
            pointer: 21,
          ),
          b = await tester.startGesture(
            Offset(rect.left + 260, rect.top + 100),
            pointer: 22,
          );
      await a.moveBy(const Offset(40, 0));
      await b.moveBy(const Offset(-40, 0));
      await tester.pump();
      await a.up();
      await b.up();
      await tester.pumpAndSettle();
      final state = tester.state(chart),
          span = painter(tester).end - painter(tester).start;
      expect(span, greaterThan(defaultChartBarCount('day')));
      tester.view.physicalSize = const Size(844, 390);
      await tester.pumpAndSettle();
      expect(
        identical(tester.state(find.byType(MarketChart).last), state),
        isTrue,
      );
      expect(painter(tester).end - painter(tester).start, span);
      expect(find.text('正在同步 K线与标注'), findsNothing);
      tester.view.physicalSize = const Size(390, 844);
      await tester.pumpAndSettle();
      expect(
        identical(tester.state(find.byType(MarketChart).last), state),
        isTrue,
      );
      expect(tester.takeException(), isNull);
      await tester.tap(find.byTooltip('关闭全屏'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
      prices.dispose();
      store.dispose();
    },
  );

  testWidgets('OHLC readout compares every value with the previous close', (
    tester,
  ) async {
    phone(tester);
    final bars = chartFixture(), store = await chartStore();
    final prices = ValueNotifier(bars);
    await tester.pumpWidget(chartHarness(store, prices));
    await tester.pumpAndSettle();
    Color colorOf(String prefix) => tester
        .widget<Text>(find.textContaining(RegExp('^$prefix ')).last)
        .style!
        .color!;
    final last = bars.last, previous = bars[bars.length - 2].close;
    for (final (prefix, value) in [
      ('开', last.open),
      ('高', last.high),
      ('低', last.low),
      ('收', last.close),
    ]) {
      expect(
        colorOf(prefix),
        value > previous
            ? up
            : value < previous
            ? down
            : ink,
        reason: prefix,
      );
    }
    // The fixture's last candle gaps down: even its high is below the
    // previous close, so "高" is green (it used to be red unconditionally).
    expect(last.high, lessThan(previous));
    expect(colorOf('高'), down);
    await tester.pumpWidget(const SizedBox());
    prices.dispose();
    store.dispose();
  });

  testWidgets('a failed study keeps candles painted and offers a retry', (
    tester,
  ) async {
    phone(tester);
    var calls = 0;
    final store = await storeWith((r) async {
      calls++;
      return http.Response('{"error":"engine down"}', 503);
    });
    final prices = ValueNotifier(chartFixture(120));
    await tester.pumpWidget(app(store, liveChart(prices)));
    await tester.pumpAndSettle();
    expect(painter(tester).data.bars.length, 120);
    expect(find.text('正在同步 K线与标注'), findsNothing);
    expect(find.text('标注更新失败 · 重试'), findsOneWidget);
    final before = calls;
    await tester.tap(find.text('标注更新失败 · 重试'));
    await tester.pumpAndSettle();
    expect(calls, greaterThan(before));
    expect(painter(tester).data.bars.length, 120);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    prices.dispose();
    store.dispose();
  });

  testWidgets(
    'live ticks keep marks, are throttled, and a new candle date refreshes at once',
    (tester) async {
      phone(tester);
      var calls = 0;
      Completer<void>? hold;
      final store = await storeWith((r) async {
        if (r.url.path != '/api/chart-study') return ok({});
        calls++;
        await hold?.future;
        final body = obj(jsonDecode(r.body));
        final last = rows(body['candles']).last;
        return ok({
          'tradeMarkers': [],
          'indicatorMarks': [],
          'patternMarks': [
            {
              'time': last['time'],
              'label': '量大滞涨',
              'position': 'above',
              'provisional': true,
            },
          ],
        });
      });
      var bars = chartFixture(120);
      final prices = ValueNotifier(bars);
      await tester.pumpWidget(app(store, liveChart(prices)));
      await tester.pumpAndSettle();
      expect(calls, 1);
      expect(painter(tester).patterns.single['label'], '量大滞涨');
      Bar tick(Bar b, double close) =>
          Bar(b.time, b.open, b.high + 1, b.low, close, b.volume + 50);
      for (var i = 1; i <= 3; i++) {
        bars = [...bars.take(bars.length - 1), tick(bars.last, 50.0 + i)];
        prices.value = bars;
        await tester.pump(const Duration(seconds: 5));
        expect(
          painter(tester).patterns.single['label'],
          '量大滞涨',
          reason: 'provisional marks stay until a new result swaps them',
        );
        expect(painter(tester).data.bars.last.close, 50.0 + i);
      }
      expect(calls, 1, reason: 'live ticks are throttled');
      await tester.pump(const Duration(seconds: 45));
      await tester.pumpAndSettle();
      expect(calls, 2, reason: 'the trailing tick is still studied');
      hold = Completer<void>();
      bars = [...bars, Bar('2099-01-01', 50, 51, 49, 50.5, 900)];
      prices.value = bars;
      await tester.pump();
      await tester.pump();
      expect(calls, 3, reason: 'a new candle date refreshes immediately');
      expect(
        painter(tester).patterns.single['label'],
        '量大滞涨',
        reason: 'old marks stay visible while the new study is pending',
      );
      hold.complete();
      await tester.pumpAndSettle();
      expect(painter(tester).patterns.single['time'], '2099-01-01');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      prices.dispose();
      store.dispose();
    },
  );

  testWidgets('a relabelled in-progress week replaces the old week bar', (
    tester,
  ) async {
    phone(tester);
    final store = await chartStore();
    Bar week(String time, double close) =>
        Bar(time, close - .5, close + 1, close - 1, close, 1000);
    final weeks = [
      for (var i = 0; i < 60; i++)
        week(
          DateTime.utc(
            2025,
            1,
            3,
          ).add(Duration(days: 7 * i)).toIso8601String().substring(0, 10),
          30 + i * .1,
        ),
    ];
    final thursday = weeks.last;
    final prices = ValueNotifier(weeks);
    await tester.pumpWidget(app(store, liveChart(prices, unit: 'week')));
    await tester.pumpAndSettle();
    final friday = DateTime.parse(thursday.time)
        .add(const Duration(days: 1))
        .toIso8601String()
        .substring(0, 10);
    prices.value = [
      ...weeks.take(weeks.length - 1),
      week(friday, thursday.close + .3),
    ];
    await tester.pumpAndSettle();
    final times = painter(tester).data.bars.map((b) => b.time).toList();
    expect(times.length, 60);
    expect(times, isNot(contains(thursday.time)));
    expect(times.last, friday);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    prices.dispose();
    store.dispose();
  });

  testWidgets(
    'paging older candles with a projection on never paints a stale forecast',
    (tester) async {
      phone(tester);
      final all = chartFixture(160), prices = ValueNotifier(all.sublist(60));
      final store = await storeWith((r) async {
        if (r.url.path == '/api/desk/history') {
          return ok({
            'candles': all.take(60).map(jsonBar).toList(),
            'anchor': jsonBar(all[60]),
            'hasMore': false,
            'volumeUnit': '手',
          });
        }
        final body = obj(jsonDecode(r.body));
        if (body['task'] != 'projection') {
          return ok({'tradeMarkers': [], 'patternMarks': []});
        }
        final horizon = (numOf(body['horizon']) ?? 10).toInt();
        final future = [
          for (var i = 1; i <= horizon; i++)
            {
              'time': '2099-01-${i.toString().padLeft(2, '0')}',
              'open': 44.0,
              'high': 45.0,
              'low': 43.0,
              'close': 44.5,
              'volume': 1200.0,
            },
        ];
        return ok({
          'projection': {
            'available': true,
            'horizon': horizon,
            'scenarios': [
              {'id': 'base', 'candles': future},
            ],
            'points': [
              for (final c in future) {'time': c['time']},
            ],
          },
        });
      });
      await tester.pumpWidget(app(store, liveChart(prices)));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('行情推演'));
      await tester.pumpAndSettle();
      Navigator.of(tester.element(find.text('行情推演').last)).pop();
      await tester.pumpAndSettle();
      expect(painter(tester).forecast!.bars.length, 100 + 10);
      // Select a projected candle so the legend reads from the forecast.
      final rect = canvasRect(tester);
      await tester.tapAt(Offset(rect.right - 12, rect.top + 60));
      await tester.pump();
      await tester.tap(find.text('加载更早'));
      await tester.pump();
      expect(tester.takeException(), isNull);
      final p = painter(tester);
      expect(p.data.bars.length, 160);
      expect(
        p.forecast == null || p.forecast!.bars.length == 160 + 10,
        isTrue,
        reason: 'a forecast built from the shorter history is never drawn',
      );
      await tester.pumpAndSettle();
      expect(painter(tester).forecast!.bars.length, 160 + 10);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      prices.dispose();
      store.dispose();
    },
  );

  test('chart geometry ignores a forecast built from other candles', () {
    final bars = chartFixture(100), data = IndicatorData(bars, defaultMa);
    final stale = IndicatorData([
      ...bars.sublist(40),
      for (var j = 1; j <= 10; j++) Bar('2099-01-0$j', 40, 41, 39, 40.5, 10),
    ], defaultMa);
    final g = ChartGeometry.compute(
      data: data,
      forecast: stale,
      start: 60,
      end: 100,
      size: const Size(390, 500),
      volume: true,
      macd: true,
      kdj: true,
      rsi: false,
      overlay: 'MA',
      volumeUnit: '手',
    );
    expect(g.future, isEmpty);
    expect(identical(g.drawData, data), isTrue);
  });

  testWidgets('the chart survives being scrolled out of a list', (
    tester,
  ) async {
    phone(tester);
    final store = await chartStore(), prices = ValueNotifier(chartFixture());
    await tester.pumpWidget(
      app(
        store,
        ListView.builder(
          itemCount: 8,
          itemBuilder: (_, i) => i == 0
              ? SizedBox(
                  height: 700,
                  child: ChartKeepAlive(child: liveChart(prices)),
                )
              : const SizedBox(height: 900),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final state = tester.state(find.byType(MarketChart));
    await tester.drag(find.byType(ListView), const Offset(0, -4000));
    await tester.pumpAndSettle();
    expect(find.byType(MarketChart, skipOffstage: false), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, 8000));
    await tester.pumpAndSettle();
    expect(identical(tester.state(find.byType(MarketChart)), state), isTrue);
    await tester.pumpWidget(const SizedBox());
    prices.dispose();
    store.dispose();
  });

  testWidgets(
    'MA legend taps do not change the setup; controls have 44pt targets',
    (tester) async {
      phone(tester);
      final store = await chartStore(), prices = ValueNotifier(chartFixture());
      await tester.pumpWidget(chartHarness(store, prices));
      await tester.pumpAndSettle();
      await tester.tap(find.textContaining('MA5 ').first);
      await tester.pump();
      expect(painter(tester).data.mas.first.enabled, isTrue);
      expect(store.prefs.getString('ma'), isNull);
      for (final tip in ['图表指标', '均线参数', '行情推演', '标注设置', '标注依据', '展开图表']) {
        final size = tester.getSize(find.byTooltip(tip));
        expect(size.width, greaterThanOrEqualTo(44), reason: tip);
        expect(size.height, greaterThanOrEqualTo(44), reason: tip);
      }
      expect(
        tester.getSize(find.widgetWithText(TextButton, '加载更早')).height,
        greaterThanOrEqualTo(44),
      );
      await tester.longPress(find.textContaining('MA5 ').first);
      await tester.pumpAndSettle();
      expect(find.text('均线参数'), findsWidgets);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      prices.dispose();
      store.dispose();
    },
  );

  testWidgets(
    'intraday long-press paints a crosshair and repaints only on change',
    (tester) async {
      phone(tester);
      final store = await chartStore();
      final data = <String, dynamic>{
        'symbol': '000001.SH',
        'date': '2026-10-29',
        'previous': 10,
        'points': [
          for (var m = 0; m < 120; m++)
            {
              'clock':
                  '${(9 + (30 + m) ~/ 60).toString().padLeft(2, '0')}:${((30 + m) % 60).toString().padLeft(2, '0')}',
              'price': 10 + m * .01,
              'volume': 100 + m,
            },
        ],
      };
      await tester.pumpWidget(
        app(store, IntradayChart(data, height: 600, showSource: false)),
      );
      await tester.pumpAndSettle();
      IntradayPainter intraday() =>
          tester
                  .widget<CustomPaint>(
                    find.byKey(const ValueKey('intraday-canvas')),
                  )
                  .painter!
              as IntradayPainter;
      final first = intraday();
      expect(first.selected, isNull);
      expect(first.shouldRepaint(first), isFalse);
      final rect = tester.getRect(
        find.byKey(const ValueKey('intraday-canvas')),
      );
      await tester.longPressAt(Offset(rect.left + 100, rect.top + 100));
      await tester.pumpAndSettle();
      expect(intraday().selected, isNotNull);
      expect(intraday().shouldRepaint(first), isTrue);
      expect(identical(intraday().points, first.points), isTrue);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
    },
  );
}
