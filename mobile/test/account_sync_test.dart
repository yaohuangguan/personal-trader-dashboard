import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/widgets/cloud_sync.dart';

/// Minimal stand-in for the Worker account API with one server-side vault.
class FakeAccountServer {
  Json vault = {
    'revision': 0,
    'updatedAt': '2026-11-25T10:00:00.000Z',
    'state': {'watchlist': <String>[], 'groups': <Json>[]},
  };
  final requests = <String>[];
  bool expired = false;
  Future<http.Response> handle(http.Request r) async {
    requests.add('${r.method} ${r.url.path}');
    final auth = r.headers['Authorization'];
    Json body = r.body.isEmpty ? {} : jsonDecode(r.body) as Json;
    http.Response reply(Object v, [int status = 200]) =>
        http.Response(jsonEncode(v), status, headers: {'content-type': 'application/json'});
    switch (r.url.path) {
      case '/api/account/register':
      case '/api/account/login':
        if (body['password'] == 'wrong-pass') {
          return reply({'error': '邮箱/用户名或密码错误'}, 401);
        }
        return reply({
          'token': 'T' * 43,
          'account': {'id': 'acct-1', 'email': 'sam@example.com', 'username': 'Sam'},
        });
      case '/api/account/watch':
        if (auth != 'Bearer ${'T' * 43}' || expired) {
          return reply({'error': '登录已过期，请重新登录'}, 401);
        }
        if (r.method == 'POST') {
          vault = {
            'revision': (vault['revision'] as int) + 1,
            'updatedAt': '2026-11-25T10:01:00.000Z',
            'state': watchCloudApply(obj(vault['state']), rows(body['ops'])),
          };
        }
        return reply(vault);
      case '/api/account/logout':
        return reply({'ok': true});
      case '/api/desk/quotes':
        return reply({'items': []});
    }
    return reply({'error': 'unexpected ${r.url.path}'}, 404);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final english = Map<String, dynamic>.from(
    jsonDecode(File('assets/strings_en.json').readAsStringSync()),
  );
  Future<(AtlasStore, FakeAccountServer)> make({String? syncKey}) async {
    SharedPreferences.setMockInitialValues({
      'watchlist': ['002472.SZ', 'NVDA', '600519.SH'],
      'watchGroups': jsonEncode([
        {'id': 'core', 'name': '核心', 'symbols': ['NVDA']},
      ]),
      'cloudSyncKey': ?syncKey,
    });
    final server = FakeAccountServer();
    final store = AtlasStore(
      AtlasApi(client: MockClient(server.handle)),
      await SharedPreferences.getInstance(),
      english,
    );
    return (store, server);
  }

  test('registering uploads every local stock and group and replaces sync-key mode', () async {
    final (s, server) = await make(syncKey: 'K' * 43);
    await s.registerAccount(' sam@example.com ', 'Sam', 'correct-pass');
    expect(s.accountToken, 'T' * 43);
    expect(s.account['username'], 'Sam');
    expect(s.syncKey, isEmpty);
    expect(s.cloudConnected, isTrue);
    expect(obj(server.vault['state'])['watchlist'], ['002472.SZ', 'NVDA', '600519.SH']);
    expect(rows(obj(server.vault['state'])['groups']).single['symbols'], ['NVDA']);
    expect(server.requests, containsAllInOrder([
      'POST /api/account/register',
      'GET /api/account/watch',
      'POST /api/account/watch',
    ]));
    expect(s.syncStatus, startsWith('已同步'));
    s.dispose();
  });

  test('login merges with stocks already saved in the account', () async {
    final (s, server) = await make();
    server.vault['state'] = {
      'watchlist': ['AAPL', 'NVDA'],
      'groups': <Json>[],
    };
    await s.loginAccount('Sam', 'correct-pass');
    expect(s.watchlist.toSet(), {'AAPL', 'NVDA', '002472.SZ', '600519.SH'});
    expect(s.prefs.getStringList('watchlist')!.toSet(), s.watchlist.toSet());
    s.dispose();
  });

  test('a wrong password leaves the device signed out', () async {
    final (s, _) = await make();
    await expectLater(s.loginAccount('Sam', 'wrong-pass'), throwsA(isA<ApiException>()));
    expect(s.accountToken, isEmpty);
    s.dispose();
  });

  test('an expired session signs out but keeps the local watchlist', () async {
    final (s, server) = await make();
    await s.loginAccount('Sam', 'correct-pass');
    server.expired = true;
    await s.syncCloud();
    expect(s.accountToken, isEmpty);
    expect(s.syncStatus, '登录已过期，请重新登录；本机自选保留');
    expect(s.watchlist, contains('600519.SH'));
    s.dispose();
  });

  test('logout clears the session locally and on the server', () async {
    final (s, server) = await make();
    await s.loginAccount('Sam', 'correct-pass');
    await s.logoutAccount();
    expect(s.accountToken, isEmpty);
    expect(s.cloudConnected, isFalse);
    expect(s.watchlist.length, 3);
    expect(server.requests.last, 'POST /api/account/logout');
    s.dispose();
  });

  testWidgets('settings panel shows sign-in, then the signed-in account', (tester) async {
    final (s, _) = await make();
    Widget app() => ChangeNotifierProvider.value(
      value: s,
      child: const MaterialApp(
        home: Scaffold(body: SingleChildScrollView(child: CloudSyncPanel())),
      ),
    );
    await tester.pumpWidget(app());
    expect(find.text('邮箱或用户名'), findsOneWidget);
    expect(find.text('登录并同步自选'), findsOneWidget);
    await tester.tap(find.text('注册'));
    await tester.pump();
    expect(find.text('用户名'), findsOneWidget);
    await tester.runAsync(() => s.loginAccount('Sam', 'correct-pass'));
    await tester.pump();
    expect(find.text('已登录 · Sam'), findsOneWidget);
    expect(find.text('退出登录'), findsOneWidget);
    expect(find.text('使用同步密钥（无需账号）'), findsNothing);
    s.dispose();
  });
}
