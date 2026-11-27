import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // Wednesday 2026-11-25 10:00 Beijing: A-shares trading.
  final trading = DateTime.utc(2026, 11, 25, 2);

  Future<(AtlasStore, List<Uri>)> make({
    List<String> watchlist = const ['600519.SH'],
    List<Json> alerts = const [],
    required DateTime Function() clock,
    double price = 101,
  }) async {
    SharedPreferences.setMockInitialValues({
      'watchlist': watchlist,
      'alerts': jsonEncode(alerts),
    });
    final requests = <Uri>[];
    final store = AtlasStore(
      AtlasApi(
        clock: clock,
        client: MockClient((r) async {
          requests.add(r.url);
          final symbols = (r.url.queryParameters['symbols'] ?? '').split(',');
          return http.Response(
            jsonEncode({
              'items': [
                for (final s in symbols)
                  {
                    'symbol': s,
                    'name': s,
                    'price': price,
                    'session': 'trading',
                    'asOf': clock().toIso8601String(),
                  },
              ],
            }),
            200,
          );
        }),
      ),
      await SharedPreferences.getInstance(),
      {},
      clock: clock,
    );
    return (store, requests);
  }

  test(
    'price alerts on stocks outside the watchlist are polled and fire',
    () async {
      final (s, requests) = await make(
        clock: () => trading,
        alerts: [
          {
            'id': '1',
            'symbol': '300750.SZ',
            'value': 100.0,
            'direction': 'above',
          },
        ],
      );
      final fired = <String>[];
      s.messages.stream.listen(fired.add);
      await s.refreshQuotes();
      expect(requests.single.queryParameters['symbols'], '600519.SH,300750.SZ');
      await Future<void>.delayed(Duration.zero);
      expect(fired.single, startsWith('300750.SZ'));
      expect(s.alerts.single['firedAt'], isNotNull);
      await s.refreshQuotes();
      expect(
        requests.last.queryParameters['symbols'],
        '600519.SH',
        reason: 'a fired alert no longer needs quotes',
      );
      s.dispose();
    },
  );

  test(
    'quote polls notify only the quote book and only on real changes',
    () async {
      var now = trading;
      final (s, _) = await make(clock: () => now);
      var storeEvents = 0, bookEvents = 0, rowEvents = 0, otherRow = 0;
      s.addListener(() => storeEvents++);
      s.quoteBook.addListener(() => bookEvents++);
      s.quoteBook.listen('600519.SH').addListener(() => rowEvents++);
      s.quoteBook.listen('NVDA').addListener(() => otherRow++);
      await s.refreshQuotes();
      expect((storeEvents, bookEvents, rowEvents), (0, 1, 1));
      // Same payload (same asOf): nothing to rebuild.
      await s.refreshQuotes();
      expect((storeEvents, bookEvents, rowEvents), (0, 1, 1));
      now = now.add(const Duration(seconds: 5));
      await s.refreshQuotes();
      expect((storeEvents, bookEvents, rowEvents, otherRow), (0, 2, 2, 0));
      s.dispose();
    },
  );

  testWidgets(
    'the scheduler polls every 5 s in session and backs off when closed',
    (tester) async {
      final start = trading;
      var offset = Duration.zero;
      DateTime clock() => start.add(offset);
      final (s, requests) = (await tester.runAsync(() => make(clock: clock)))!;
      int quotes() =>
          requests.where((u) => u.path == '/api/desk/quotes').length;
      s.start();
      await tester.pump();
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      expect(quotes(), 1);
      offset += const Duration(seconds: 5);
      await tester.pump(const Duration(seconds: 5));
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      expect(quotes(), 2);
      // Jump to the lunch break: the next poll waits (≤ 5 min), not 5 s.
      offset = const Duration(hours: 1, minutes: 45); // 11:45 Beijing
      await tester.pump(const Duration(seconds: 5));
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      final afterLunchPoll = quotes();
      offset += const Duration(seconds: 30);
      await tester.pump(const Duration(seconds: 30));
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      expect(quotes(), afterLunchPoll);
      s.dispose();
    },
  );

  test('inactive is not background; paused and hidden are', () async {
    final (s, _) = await make(clock: () => trading);
    s.didChangeAppLifecycleState(AppLifecycleState.inactive);
    expect(s.foreground, isTrue);
    s.didChangeAppLifecycleState(AppLifecycleState.hidden);
    expect(s.foreground, isFalse);
    s.didChangeAppLifecycleState(AppLifecycleState.resumed);
    expect(s.foreground, isTrue);
    s.didChangeAppLifecycleState(AppLifecycleState.paused);
    expect(s.foreground, isFalse);
    expect(s.poller.paused, isTrue);
    s.dispose();
  });
}
