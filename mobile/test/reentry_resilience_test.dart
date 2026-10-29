import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/chart_studies.dart';
import 'package:market_atlas/core/store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('hiding every MA keeps an empty study selection instead of crashing page loading', () async {
    SharedPreferences.setMockInitialValues({
      'ma': jsonEncode([
        for (final period in [5, 13, 20, 30, 60, 120, 144, 250])
          {'period': period, 'enabled': false},
      ]),
    });
    final api = AtlasApi(
          client: MockClient((r) async => http.Response('{}', 200)),
        ),
        store = AtlasStore(api, await SharedPreferences.getInstance(), {});
    expect(store.chartMAPeriods, isEmpty);
    store.dispose();
    api.dispose();
  });
  test('re-entering shares pending public requests; errors never poison the next attempt', () async {
    var calls = 0;
    final gate = Completer<void>();
    final api = AtlasApi(
      client: MockClient((r) async {
        calls++;
        await gate.future;
        return http.Response(
          calls == 1 ? '{"error":"temporary"}' : '{"items":[]}',
          calls == 1 ? 503 : 200,
        );
      }),
    );
    final a = api.get('/api/chart-frame', parameters: {'symbol': '300001.SZ'}),
        b = api.get('/api/chart-frame', parameters: {'symbol': '300001.SZ'});
    final first = expectLater(a, throwsA(isA<ApiException>())),
        second = expectLater(b, throwsA(isA<ApiException>()));
    gate.complete();
    await Future.wait([first, second]);
    expect(calls, 1);
    await api.get('/api/chart-frame', parameters: {'symbol': '300001.SZ'});
    expect(calls, 2);
    await api.get('/api/chart-frame', parameters: {'symbol': '300001.SZ'});
    expect(calls, 2);
    api.dispose();
  });
  test('one price snapshot is computed locally once and survives reopening without a network; MA changes recompute', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    var computations = 0, requests = 0;
    final candles = [
      {
        'time': '2026-10-28',
        'open': 10,
        'high': 11,
        'low': 9,
        'close': 10.5,
        'volume': 1000,
      },
    ];
    final api = AtlasApi(
      client: MockClient((r) async {
        requests++;
        expect(r.url.path, '/api/chart-frame');
        return http.Response(
          jsonEncode({
            'market': {
              'symbol': '300001.SZ',
              'candles': candles,
              'provider': 'Tencent',
            },
            'volumeUnit': '手',
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    Future<Json> runner(Json input) async {
      computations++;
      return {
        'patternMarks': [
          {'label': 'paired'},
        ],
        'verification': {
          'maPeriods': input['ma'],
          'last': rows(input['candles']).last,
        },
      };
    }

    final service = ChartStudies(api, prefs, runner: runner),
        a = await service.loadFrame('300001.SZ', [5, 13]),
        b = await service.loadFrame('300001.SZ', [5, 13]);
    expect(requests, 1);
    expect(computations, 1);
    expect(obj(a['study'])['patternMarks'], obj(b['study'])['patternMarks']);
    final offline = AtlasApi(
          client: MockClient((r) async => throw StateError('offline')),
        ),
        reopened = ChartStudies(offline, prefs, runner: runner);
    final cached = await reopened.cachedFrame('300001.SZ', [5, 13]);
    expect(cached, isNotNull);
    expect(cached!['cached'], true);
    expect(obj(cached['market'])['stale'], true);
    expect(obj(obj(cached['study'])['verification'])['last'], candles.last);
    await reopened.cachedFrame('300001.SZ', [5, 20]);
    expect(computations, 3);
    expect(await reopened.cachedFrame('300002.SZ', [5, 13]), isNull);
    api.dispose();
    offline.dispose();
  });
}
