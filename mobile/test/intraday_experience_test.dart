import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/intraday_axis.dart';
import 'package:market_atlas/widgets/intraday_chart.dart';

void main() {
  test('clock positions keep untraded time blank and compress lunch', () {
    expect(sessionMinute('10:00'), 30);
    expect(sessionMinute('15:00'), 240);
    expect(sessionMinute('12:00'), null);
  });
  testWidgets(
    'auction expands without stretching morning prices; overlay uses the correct day',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});
      final requested = <String>[];
      final data = <String, dynamic>{
        'symbol': '300031.SZ',
        'date': '2026-10-29',
        'previous': 10,
        'points': [
          {'clock': '09:30', 'price': 10.1, 'volume': 100},
          {'clock': '10:00', 'price': 10.2, 'volume': 200},
        ],
      };
      final api = AtlasApi(
        client: MockClient((r) async {
          requested.add(r.url.path);
          final result = switch (r.url.path) {
            '/api/desk/intraday' => {...data, 'symbol': '399006.SZ'},
            '/api/desk/sectors' => {'boards': <dynamic>[]},
            '/api/desk/auction' => {
              'date': data['date'],
              'segments': [
                {
                  'key': 'open',
                  'notice': 'fixture',
                  'points': [
                    {
                      'clock': '09:25',
                      'sourceClock': '09:25:00',
                      'price': 10.1,
                      'volume': 100,
                      'amount': 101000,
                      'indicative': false,
                    },
                  ],
                },
              ],
            },
            _ => {},
          };
          return http.Response(
            jsonEncode(result),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      final store = AtlasStore(api, await SharedPreferences.getInstance(), {});
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: store,
          child: MaterialApp(
            home: Scaffold(
              body: IntradayChart(data, height: 600, showSource: false),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(requested, contains('/api/desk/intraday'));
      await tester.tap(find.text('竞价'));
      await tester.pumpAndSettle();
      expect(find.text('撮合成交', findRichText: true), findsNothing);
      expect(find.textContaining('09:25:00'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('叠加'));
      await tester.pumpAndSettle();
      expect(tester.widget<Switch>(find.byType(Switch).first).value, isTrue);

      expect(requested, contains('/api/desk/intraday'));
      Navigator.of(tester.element(find.byType(Switch).first)).pop();
      await tester.pumpAndSettle();
      final painter =
          tester
                  .widget<CustomPaint>(
                    find.byKey(const ValueKey('intraday-canvas')),
                  )
                  .painter!
              as IntradayPainter;
      expect(painter.comparisons.single['symbol'], '399006.SZ');
      expect(painter.points.length, 2);
      expect(sessionMinute(painter.points.last['clock'])! / 240, lessThan(.2));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
      api.dispose();
    },
  );
}
