import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Two vaults like the Worker: a sync-key vault and an account vault. A POST
/// whose baseRevision is ahead of the vault is rejected with 400.
class TwoVaults {
  final vaults = <String, Json>{
    'key': {
      'revision': 9,
      'updatedAt': '2026-11-25T10:00:00.000Z',
      'state': {
        'watchlist': ['AAA', 'BBB'],
        'groups': <Json>[],
      },
    },
    'account': {
      'revision': 0,
      'updatedAt': '2026-11-25T10:00:00.000Z',
      'state': {'watchlist': <String>[], 'groups': <Json>[]},
    },
  };
  final requests = <String>[];
  Completer<void>? holdLogin, holdKeyRead;
  int rejected = 0;

  Future<http.Response> handle(http.Request r) async {
    requests.add('${r.method} ${r.url.path}');
    http.Response reply(Object v, [int status = 200]) =>
        http.Response.bytes(utf8.encode(jsonEncode(v)), status);
    final body = r.body.isEmpty ? <String, dynamic>{} : obj(jsonDecode(r.body));
    switch (r.url.path) {
      case '/api/account/login':
        await holdLogin?.future;
        return reply({
          'token': 'T' * 43,
          'account': {'id': 'acct-1', 'username': 'Sam'},
        });
      case '/api/watch-sync':
      case '/api/account/watch':
        final name = r.url.path == '/api/watch-sync' ? 'key' : 'account';
        if (name == 'key') await holdKeyRead?.future;
        final vault = vaults[name]!;
        if (r.method == 'POST') {
          if ((body['baseRevision'] as int) > (vault['revision'] as int)) {
            rejected++;
            return reply({'error': '无效同步请求'}, 400);
          }
          vaults[name] = {
            'revision': (vault['revision'] as int) + 1,
            'updatedAt': '2026-11-25T10:05:00.000Z',
            'state': watchCloudApply(obj(vault['state']), rows(body['ops'])),
          };
        }
        return reply(vaults[name]!);
      case '/api/desk/quotes':
        return reply({'items': []});
    }
    return reply({'error': 'unexpected'}, 404);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  Future<(AtlasStore, TwoVaults)> make(Map<String, Object> prefs) async {
    SharedPreferences.setMockInitialValues(prefs);
    final server = TwoVaults();
    final store = AtlasStore(
      AtlasApi(client: MockClient(server.handle)),
      await SharedPreferences.getInstance(),
      {},
    );
    return (store, server);
  }

  Map<String, Object> keyMode() => {
    'watchlist': ['AAA', 'BBB'],
    'cloudSyncKey': 'K' * 43,
  };

  test(
    'a sync started while signing in never writes into the new vault',
    () async {
      final (s, server) = await make(keyMode());
      await s.syncCloud(); // establishes a sync-key base at revision 9
      server.holdLogin = Completer<void>();
      final login = s.loginAccount('Sam', 'pass-word');
      await Future<void>.delayed(Duration.zero);
      // The periodic sync fires while the login request is in flight.
      final timer = s.syncCloud();
      server.holdLogin!.complete();
      await Future.wait([login, timer]);
      expect(server.rejected, 0);
      expect(obj(server.vaults['account']!['state'])['watchlist'], [
        'AAA',
        'BBB',
      ]);
      expect(s.watchlist, ['AAA', 'BBB']);
      expect(s.syncStatus, startsWith('已同步'));
      expect(
        obj(jsonDecode(s.prefs.getString('cloudSyncBase')!))['vault'],
        'account:acct-1',
      );
      // Later syncs keep working (no stale revision from the old vault).
      await s.syncCloud();
      expect(server.rejected, 0);
      s.dispose();
    },
  );

  test('signing in waits for an in-flight sync instead of failing', () async {
    final (s, server) = await make(keyMode());
    server.holdKeyRead = Completer<void>();
    final running = s.syncCloud();
    final login = s.loginAccount('Sam', 'pass-word');
    await Future<void>.delayed(Duration.zero);
    expect(server.requests, isNot(contains('POST /api/account/login')));
    server.holdKeyRead!.complete();
    await Future.wait([running, login]);
    expect(server.rejected, 0);
    expect(s.accountToken, 'T' * 43);
    expect(obj(server.vaults['account']!['state'])['watchlist'], [
      'AAA',
      'BBB',
    ]);
    s.dispose();
  });

  test('a stored base from another vault is ignored, not diffed', () async {
    final (s, server) = await make({
      ...keyMode(),
      'watchlist': ['AAA', 'CCC'],
      'cloudSyncBase': jsonEncode({
        'vault': 'key:00000000',
        'state': {
          'watchlist': ['AAA', 'BBB', 'CCC', 'DDD'],
          'groups': [],
        },
        'revision': 40,
      }),
    });
    await s.syncCloud();
    expect(server.rejected, 0, reason: 'revision 40 belongs to another vault');
    expect((obj(server.vaults['key']!['state'])['watchlist'] as List).toSet(), {
      'AAA',
      'BBB',
      'CCC',
    }, reason: 'nothing was removed because of the foreign base');
    expect(s.watchlist.toSet(), {'AAA', 'BBB', 'CCC'});
    s.dispose();
  });

  test(
    'untouched demo stocks are dropped when the account already has a list',
    () async {
      final (s, server) = await make({});
      expect(s.watchlist, AtlasStore.seedWatchlist);
      expect(s.untouchedSeed, isTrue);
      server.vaults['account']!['state'] = {
        'watchlist': ['AAPL'],
        'groups': <Json>[],
      };
      await s.loginAccount('Sam', 'pass-word');
      expect(s.watchlist, ['AAPL']);
      expect(obj(server.vaults['account']!['state'])['watchlist'], ['AAPL']);
      expect(s.untouchedSeed, isFalse);
      s.dispose();
    },
  );

  test(
    'demo stocks the user edited, or an empty account, keep the list',
    () async {
      final (s, server) = await make({});
      await s.toggleWatch('NVDA');
      expect(s.untouchedSeed, isFalse);
      server.vaults['account']!['state'] = {
        'watchlist': ['AAPL'],
        'groups': <Json>[],
      };
      await s.loginAccount('Sam', 'pass-word');
      expect(s.watchlist.toSet(), {
        ...AtlasStore.seedWatchlist,
        'NVDA',
        'AAPL',
      });
      s.dispose();

      final (fresh, empty) = await make({});
      await fresh.loginAccount('Sam', 'pass-word');
      expect(
        obj(empty.vaults['account']!['state'])['watchlist'],
        AtlasStore.seedWatchlist,
      );
      fresh.dispose();
    },
  );
}
