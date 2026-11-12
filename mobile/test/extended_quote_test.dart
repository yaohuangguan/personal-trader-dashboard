import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/extended_quotes.dart';
import 'package:market_atlas/screens/watch.dart';
import 'package:market_atlas/widgets/extended_quote.dart';

void main() {
  testWidgets(
    'phone list keeps regular quotes above all three extended sessions at large text',
    (tester) async {
      tester.view.physicalSize = const Size(320, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final entry in {
        'pre': '盘前',
        'post': '盘后',
        'overnight': '夜盘 24h',
      }.entries) {
        SharedPreferences.setMockInitialValues({
          'watchlist': ['AAPL'],
          'fontSize': 22.0,
        });
        final store = AtlasStore(
          AtlasApi(
            client: MockClient((request) async {
              switch (request.url.path) {
                case '/api/desk/quotes':
                  return http.Response(
                    jsonEncode({
                      'items': [
                        {
                          'symbol': 'AAPL',
                          'name': 'Apple Inc.',
                          'price': 355.63,
                          'changePercent': 2.04,
                        },
                      ],
                    }),
                    200,
                  );
                case '/api/desk/extended-quote':
                  return http.Response(
                    jsonEncode({
                      'activeSession': entry.key,
                      'current': {
                        'session': entry.key,
                        'price': 356.35,
                        'changePercent': .20,
                        'reference': 355.63,
                        'source': 'Yahoo Finance',
                        'asOf': DateTime.now().toIso8601String(),
                        'stale': false,
                      },
                    }),
                    200,
                  );
                case '/api/desk/insight':
                  return http.Response('{}', 200);
                default:
                  throw StateError('Unexpected ${request.url}');
              }
            }),
          ),
          await SharedPreferences.getInstance(),
          {},
        );
        await store.refreshQuotes();
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: store,
            child: MaterialApp(
              home: MediaQuery(
                data: const MediaQueryData(
                  size: Size(320, 844),
                  textScaler: TextScaler.linear(22 / 18),
                ),
                child: const WatchPage(),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final extended = find.text(
          '${entry.value}  356.35  +0.20%',
          findRichText: true,
        );
        expect(extended, findsOneWidget);
        expect(find.text('355.63'), findsOneWidget);
        expect(find.text('+2.04%'), findsOneWidget);
        expect(
          tester.getRect(extended).top,
          greaterThan(tester.getRect(find.text('+2.04%')).bottom),
        );
        expect(tester.getRect(extended).right, lessThanOrEqualTo(320));
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        store.dispose();
      }
    },
  );

  testWidgets(
    'stale snapshots retain their price and clearly mark it pending',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      var calls = 0;
      final store = AtlasStore(
        AtlasApi(
          client: MockClient((request) async {
            expect(request.url.path, '/api/desk/extended-quote');
            if (++calls > 1) return http.Response('unavailable', 503);
            return http.Response(
              jsonEncode({
                'current': {
                  'session': 'overnight',
                  'price': 356.35,
                  'changePercent': .2,
                  'source': 'Yahoo Finance / Blue Ocean ATS',
                  'asOf': '2026-01-01T01:00:00Z',
                  'stale': true,
                },
              }),
              200,
            );
          }),
        ),
        await SharedPreferences.getInstance(),
        {},
      );
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: store,
          child: const MaterialApp(
            home: Scaffold(body: ExtendedQuoteLine('AAPL')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('待更新', findRichText: true), findsOneWidget);
      expect(find.textContaining('356.35', findRichText: true), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
    },
  );

  test('cache deduplicates reads and retains the last quote after a failed refresh', () async {
    var at = DateTime.utc(2026, 11, 12), calls = 0;
    final api = AtlasApi(
      client: MockClient((request) async {
        if (++calls > 1) return http.Response('unavailable', 503);
        return http.Response(
          '{"current":{"price":356.35,"asOf":"2026-11-12T00:00:00Z"}}',
          200,
        );
      }),
    );
    final cache = ExtendedQuotes(api, clock: () => at);
    await Future.wait([cache.load('AAPL'), cache.load('AAPL')]);
    expect(calls, 1);
    await cache.load('AAPL');
    expect(calls, 1);
    at = at.add(const Duration(seconds: 61));
    await expectLater(cache.load('AAPL'), throwsA(isA<Exception>()));
    expect(obj(cache.values['AAPL']?['current'])['price'], 356.35);
    expect(
      obj(cache.values['AAPL']?['current'])['asOf'],
      '2026-11-12T00:00:00Z',
    );
    api.dispose();
  });
}
