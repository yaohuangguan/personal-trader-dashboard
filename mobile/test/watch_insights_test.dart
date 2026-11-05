import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/watch_insights.dart';

void main() {
  final start = DateTime.utc(2026, 11, 5, 2);
  Json data(String symbol, int score) => {
    'symbol': symbol,
    'generatedAt': start.toIso8601String(),
    'expiresAt': start.add(const Duration(seconds: 20)).toIso8601String(),
    'trend': {'score': score, 'current': true},
    'operation': {'phase': 'pullback', 'ready': true},
  };
  test('list recycling shares requests, preserves scores, expires and retries without blanking', () async {
    var now = start, calls = 0, failed = false;
    final api = AtlasApi(
      client: MockClient((request) async {
        calls++;
        expect(request.url.path, '/api/desk/insight');
        if (failed) return http.Response('{"error":"offline"}', 502);
        return http.Response(
          jsonEncode(data(request.url.queryParameters['symbol']!, 78)),
          200,
        );
      }),
    );
    final cache = WatchInsights(api, clock: () => now);
    final results = await Future.wait([cache.load('NVDA'), cache.load('NVDA')]);
    expect(calls, 1);
    expect(identical(results[0], results[1]), true);
    now = start.add(const Duration(seconds: 19));
    await cache.load('NVDA');
    expect(calls, 1);
    now = start.add(const Duration(seconds: 20));
    failed = true;
    await expectLater(cache.load('NVDA'), throwsA(isA<Exception>()));
    expect(cache.values['NVDA']?['trend']['score'], 78);
    failed = false;
    await cache.load('NVDA');
    expect(calls, 3);
    cache.dispose();
    api.dispose();
  });
  test('preset ranking is stable and never ranks stale or historical scores as current', () {
    final a = data('a', 80),
        b = data('b', 40),
        c = data('c', 99),
        d = data('d', 80);
    c['trend']['current'] = false;
    expect(
      rankWatch(
        ['b', 'a', 'missing', 'd', 'c'],
        {'a': a, 'b': b, 'c': c, 'd': d},
        start,
      ),
      ['a', 'd', 'b', 'missing', 'c'],
    );
    expect(watchPhase(a, start), 'pullback');
    expect(watchPhase(a, start.add(const Duration(seconds: 90))), 'pending');
    expect(watchTrendScore(c, start), null);
    a['quoteStale'] = true;
    expect(watchPhase(a, start), 'pending');
  });
}
