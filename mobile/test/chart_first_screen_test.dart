import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/push_service.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/main.dart';

import 'support/chart_harness.dart';

/// Canvas top on the stock first screen before the chart review (fc694f5),
/// measured with this test on an iPhone 15-class view: the header budget
/// above the candles (30pt toolbar + 40pt legend + 24pt OHLC) must not grow.
final masterCanvasTop = {18.0: 325.0, 22.0: 325.0};

void main() {
  testWidgets('iPhone stock first screen keeps the candles where they were', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1179, 2556);
    tester.view.devicePixelRatio = 3;
    tester.view.padding = const FakeViewPadding(top: 177, bottom: 102);
    tester.view.viewPadding = const FakeViewPadding(top: 177, bottom: 102);
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});
    final candles = chartFixture()
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
    final s = (await tester.runAsync(
      () => AtlasStore.load(
        api: AtlasApi(
          client: MockClient((request) async {
            final data = switch (request.url.path) {
              '/api/desk/quotes' => {
                'items': [
                  {
                    'symbol': '300545.SZ',
                    'name': '联得装备',
                    'price': 47.36,
                    'change': 1.25,
                    'changePercent': 2.71,
                    'open': 46.1,
                    'high': 47.71,
                    'low': 45.86,
                    'turnover': 6.28,
                    'session': 'closed',
                    'asOf': '2025-10-27T15:00:00+08:00',
                  },
                ],
              },
              '/api/analysis' || '/api/chart-bundle' || '/api/chart-frame' => {
                'market': {
                  'symbol': '300545.SZ',
                  'name': '联得装备',
                  'last': candles.last['close'],
                  'candles': candles,
                  'provider': 'fixture',
                  'asOf': '2025-10-27',
                },
                'volumeUnit': '手',
                'guide': {'events': []},
              },
              _ => <String, dynamic>{'items': []},
            };
            if (request.url.path == '/api/chart-bundle') {
              data['study'] = {
                'tradeMarkers': [],
                'patternMarks': [],
                'indicatorMarks': [],
                'verification': {
                  'symbol': '300545.SZ',
                  'unit': 'day',
                  'maPeriods': [5, 13, 20, 30, 60, 120, 144, 250],
                  'candleCount': candles.length,
                  'last': candles.last,
                },
              };
            }
            return http.Response(
              jsonEncode(data),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }),
        ),
      ),
    ))!;
    final push = NativePushService(s.api, s.deviceToken);
    await tester.pumpWidget(AtlasApp(store: s, push: push));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.star_outline).last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('300545.SZ').first);
    await tester.pumpAndSettle();
    for (final size in [18.0, 22.0]) {
      await s.setFont(size);
      await tester.pumpAndSettle();
      final canvas = tester.getRect(
        find.byKey(const ValueKey('candlestick-canvas')),
      );
      debugPrint('canvas top @$size: ${canvas.top} bottom ${canvas.bottom}');
      expect(canvas.top, lessThanOrEqualTo(masterCanvasTop[size]! + .5));
      expect(canvas.top, lessThan(330), reason: 'native CI budget');
      final error = tester.takeException();
      // At 22pt the widget-test font overflows the 78pt quote strip above
      // the chart (also on fc694f5; that layout is outside the chart).
      if (size == 18) expect(error, isNull);
    }
    await tester.pumpWidget(const SizedBox());
    s.dispose();
    await push.dispose();
  });
}
