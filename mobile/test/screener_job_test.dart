import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/screener.dart';
import 'package:market_atlas/core/store.dart';
import 'package:shared_preferences/shared_preferences.dart';

Json candidate(int i) => {
  'symbol': '${600000 + i}.SH',
  'name': 'C$i',
  'amount': 3e8,
  'chip': {'concentration90': 10},
  'character': {'quiet': false, 'weakFollow': false},
  'patterns': [],
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'starting a full-market job sends the session; 401 is explained',
    () async {
      SharedPreferences.setMockInitialValues({});
      final auth = <String?>[];
      final s = AtlasStore(
        AtlasApi(
          client: MockClient((r) async {
            auth.add(r.headers['Authorization']);
            return http.Response.bytes(
              utf8.encode(
                jsonEncode({'error': '登录后可发起全市场扫描', 'code': 'AUTH_REQUIRED'}),
              ),
              401,
            );
          }),
        ),
        await SharedPreferences.getInstance(),
        {},
      );
      final scan = ScreenerController(s);
      await scan.start('all', true, true, options: {'strategy': 'auto'});
      expect(auth.single, isNull, reason: 'signed out: no token to send');
      expect(scan.state['phase'], 'paused');
      expect(scan.state['authRequired'], isTrue);
      expect(scan.state['message'], '登录后可发起全市场扫描');
      expect(scan.running, isFalse);
      scan.dispose();
      s.dispose();
    },
  );

  testWidgets(
    'polling asks only for new candidates and a background pause reconnects on resume',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final calls = <Uri>[];
      var count = 2;
      final s = (await tester.runAsync(
        () async => AtlasStore(
          AtlasApi(
            client: MockClient((r) async {
              calls.add(r.url);
              final since = int.tryParse(r.url.queryParameters['since'] ?? '');
              final all = [for (var i = 0; i < count; i++) candidate(i)];
              return http.Response(
                jsonEncode({
                  'job': {
                    'id': 'job-1',
                    'phase': 'screening',
                    'candidateCount': count,
                    'cursor': count * 10,
                    'targets': 100,
                  },
                  'candidates': since == null ? all : all.skip(since).toList(),
                  'since': ?since,
                }),
                200,
              );
            }),
          ),
          await SharedPreferences.getInstance(),
          {},
        ),
      ))!;
      final scan = ScreenerController(s, pollEvery: const Duration(seconds: 2));
      Future<void> settle([Duration step = Duration.zero]) async {
        await tester.pump(step);
        await tester.pump();
      }

      scan.connectShared();
      await settle();
      expect(calls.single.queryParameters.containsKey('id'), isFalse);
      expect(rows(scan.state['sharedCandidates']).length, 2);
      count = 3;
      await settle(const Duration(seconds: 2));
      expect(calls.last.queryParameters['since'], '2');
      expect(rows(scan.state['sharedCandidates']).map((c) => c['name']), [
        'C0',
        'C1',
        'C2',
      ]);
      s.didChangeAppLifecycleState(AppLifecycleState.paused);
      await settle(const Duration(seconds: 2));
      expect(scan.state['phase'], 'paused', reason: 'not stuck in scanning');
      expect(scan.running, isFalse);
      final before = calls.length;
      count = 4;
      s.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await settle();
      await settle();
      expect(calls.length, greaterThan(before));
      expect(calls[before].path, '/api/desk/screen-job');
      expect(
        calls[before].queryParameters['id'],
        'job-1',
        reason: 'reconnects to the running job instead of starting one',
      );
      expect(rows(scan.state['sharedCandidates']).length, 4);
      expect(scan.state['phase'], 'scanning');
      // Let the poll loop notice the background and stop before disposing.
      s.didChangeAppLifecycleState(AppLifecycleState.paused);
      await settle(const Duration(seconds: 3));
      scan.dispose();
      s.dispose();
    },
  );
}
