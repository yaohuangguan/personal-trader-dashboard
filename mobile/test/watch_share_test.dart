import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/watch_transfer_share.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'share code pattern accepts typed variants and rejects ambiguous letters',
    () {
      for (final ok in ['ABCD-2345', 'abcd2345', 'WXYZ-9876']) {
        expect(shareCodePattern.hasMatch(ok), isTrue, reason: ok);
      }
      for (final bad in ['ABC-2345', 'ABCD-23456', 'IOOL-0001', '300750']) {
        expect(shareCodePattern.hasMatch(bad), isFalse, reason: bad);
      }
    },
  );

  test('creating a code uploads only transferable fields; reading it yields an importable packet', () async {
    SharedPreferences.setMockInitialValues({
      'watchlist': ['NVDA', '300750.SZ'],
      'watchGroups': jsonEncode([
        {
          'id': 'private-id',
          'name': '核心',
          'symbols': ['NVDA'],
        },
      ]),
      'cloudSyncKey': 'CANARY-SECRET',
    });
    Json? uploaded;
    final api = AtlasApi(
      client: MockClient((r) async {
        if (r.method == 'POST' && r.url.path == '/api/watch-share') {
          uploaded = jsonDecode(r.body) as Json;
          return http.Response(
            jsonEncode({'code': 'ABCD-2345', 'count': 2}),
            200,
          );
        }
        if (r.url.path == '/api/watch-share/abcd2345') {
          return http.Response(
            jsonEncode({...?uploaded, 'code': 'ABCD-2345'}),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        if (r.url.path.startsWith('/api/watch-share/')) {
          return http.Response(
            jsonEncode({'error': '分享码不存在或已过期'}),
            404,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response('{"items":[]}', 200);
      }),
    );
    final store = AtlasStore(api, await SharedPreferences.getInstance(), {});
    final made = await createWatchShareCode(store);
    expect(made['code'], 'ABCD-2345');
    expect(jsonEncode(uploaded), isNot(contains('CANARY-SECRET')));
    expect(jsonEncode(uploaded), isNot(contains('private-id')));
    final packet = await readWatchShareCode(api, ' abcd2345 ');
    expect(packet.watchlist, ['NVDA', '300750.SZ']);
    expect(packet.groups.single['name'], '核心');
    await expectLater(
      readWatchShareCode(api, 'WXYZ-9876'),
      throwsA(isA<ApiException>()),
    );
    await expectLater(
      readWatchShareCode(api, 'nope'),
      throwsA(isA<FormatException>()),
    );
    store.dispose();
  });
}
