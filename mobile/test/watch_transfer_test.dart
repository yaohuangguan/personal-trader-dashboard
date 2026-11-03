import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/watch_transfer.dart';
import 'package:market_atlas/core/watch_transfer_share.dart';
import 'package:market_atlas/screens/watch_import.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final fixture = File('../tests/fixtures/watch-transfer.json')
      .readAsStringSync();
  test('shared web fixture and mobile serialization round trip without credentials or IDs', () {
    final packet = WatchTransfer.parse('\ufeff$fixture');
    expect(packet.toJson(), jsonDecode(fixture));
    final encoded = serializeWatchTransfer(
      packet.watchlist,
      packet.groups
          .map((g) => {...g, 'id': 'private-id', 'secret': 'CANARY'})
          .toList(),
    );
    expect(jsonDecode(encoded), jsonDecode(fixture));
    expect(encoded, isNot(contains('CANARY')));
    expect(encoded, isNot(contains('private-id')));
    expect(WatchTransfer.parse('["300031","aapl","510300"]').watchlist, [
      '300031.SZ',
      'AAPL',
      '510300.SH',
    ]);
  });
  test('mobile import preserves existing IDs, membership and ordering and is idempotent', () {
    final before = ['NVDA', '300031.SZ'],
        groups = <Json>[
          {
            'id': 'mine',
            'name': '科技',
            'symbols': ['NVDA'],
          },
        ];
    final plan = planWatchImport(
      before,
      groups,
      WatchTransfer.parse(fixture),
      newId: () => 'new-local',
    );
    expect(plan.watchlist, [
      'NVDA',
      '300031.SZ',
      '920571.BJ',
      'AAPL',
      '510300.SH',
    ]);
    expect(plan.added, 3);
    expect(plan.existing, 1);
    expect(plan.groups, [
      {
        'id': 'mine',
        'name': '科技',
        'symbols': ['NVDA', '300031.SZ', 'AAPL'],
      },
      {
        'id': 'new-local',
        'name': '观察',
        'symbols': ['920571.BJ', '510300.SH'],
      },
    ]);
    expect(groups.single['symbols'], ['NVDA']);
    expect(before, ['NVDA', '300031.SZ']);
    final again = planWatchImport(
      plan.watchlist,
      plan.groups,
      WatchTransfer.parse(fixture),
    );
    expect(again.added, 0);
    expect(again.groups, plan.groups);
    final full = planWatchImport(
      List.generate(59, (i) => 'TEST$i'),
      List.generate(
        20,
        (i) => {'id': 'g$i', 'name': '组$i', 'symbols': <String>[]},
      ),
      WatchTransfer.parse(fixture),
    );
    expect(full.added, 1);
    expect(full.skipped, 3);
    expect(full.groupsSkipped, 2);
  });
  test(
    'invalid and oversized exchange files never become partially accepted data',
    () {
      for (final text in [
        '{}',
        'null',
        'not json',
        '{"format":"other","watchlist":[]}',
        '{"format":"guanlan-watchlist","version":2,"watchlist":[]}',
        '{"watchlist":[3]}',
        '{"watchlist":["AAPL"],"groups":[{"name":"科技","symbols":["NVDA"]}]}',
        '{"watchlist":[],"groups":null}',
      ]) {
        expect(() => WatchTransfer.parse(text), throwsFormatException);
      }
      expect(
        () => WatchTransfer.parse(' ' * (watchTransferMaxBytes + 1)),
        throwsFormatException,
      );
      expect(
        () => WatchTransfer.parse(
          jsonEncode({'watchlist': List.filled(201, 'AAPL')}),
        ),
        throwsFormatException,
      );
    },
  );
  Future<AtlasStore> store(List<Uri> requests) async {
    SharedPreferences.setMockInitialValues({
      'watchlist': ['NVDA', '300031.SZ'],
      'watchGroups': jsonEncode([
        {
          'id': 'mine',
          'name': '科技',
          'symbols': ['NVDA'],
        },
      ]),
      'cloudSyncKey': 'CANARY-CLOUD-SECRET',
    });
    return AtlasStore(
      AtlasApi(
        client: MockClient((r) async {
          requests.add(r.url);
          expect(r.url.path, '/api/desk/quotes');
          return http.Response('{"items":[]}', 200);
        }),
      ),
      await SharedPreferences.getInstance(),
      {},
    );
  }

  test('store import persists merged groups and stocks while preserving cloud credentials', () async {
    final s = await store([]);
    final result = await s.mergeWatchTransfer(WatchTransfer.parse(fixture));
    expect(result.added, 3);
    expect(s.prefs.getStringList('watchlist'), [
      'NVDA',
      '300031.SZ',
      '920571.BJ',
      'AAPL',
      '510300.SH',
    ]);
    expect(jsonDecode(s.prefs.getString('watchGroups')!), s.groups);
    expect(s.syncKey, 'CANARY-CLOUD-SECRET');
    await s.mergeWatchTransfer(WatchTransfer.parse(fixture));
    expect(s.watchlist.length, 5);
    s.dispose();
  });
  testWidgets(
    'iOS file import previews offline and one confirmation merges stock groups',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final requests = <Uri>[], s = await store(requests);
      const channel = MethodChannel('space.ps6.marketAtlas/watch-import');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            expect(call.method, 'pickTextFile');
            return {'text': fixture};
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null),
      );
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: s,
          child: MaterialApp(
            home: Builder(
              builder: (c) => Scaffold(
                body: TextButton(
                  onPressed: () => showWatchImport(c, pickFile: true),
                  child: const Text('打开导入'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('打开导入'));
      await tester.pumpAndSettle();
      expect(requests, isEmpty);
      expect(find.text('同时导入分组'), findsOneWidget);
      expect(find.text('一键合并导入'), findsOneWidget);
      await tester.tap(find.text('一键合并导入'));
      await tester.pumpAndSettle();
      expect(s.watchlist, [
        'NVDA',
        '300031.SZ',
        '920571.BJ',
        'AAPL',
        '510300.SH',
      ]);
      expect(s.groups.length, 2);
      expect(s.groups.first['id'], 'mine');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      s.dispose();
      debugDefaultTargetPlatformOverride = null;
    },
  );
  testWidgets(
    'native share sends a named JSON file with stock groups and no account secret',
    (tester) async {
      final s = await store([]),
          temp = (await tester.runAsync(
            () => Directory.systemTemp.createTemp('guanlan-watch-test-'),
          ))!;
      addTearDown(() => temp.deleteSync(recursive: true));
      const pathChannel = MethodChannel('plugins.flutter.io/path_provider'),
          shareChannel = MethodChannel('dev.fluttercommunity.plus/share');
      Map<dynamic, dynamic>? sent;
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(pathChannel, (call) async {
        expect(call.method, 'getTemporaryDirectory');
        return temp.path;
      });
      messenger.setMockMethodCallHandler(shareChannel, (call) async {
        expect(call.method, 'share');
        sent = call.arguments;
        return 'dev.fluttercommunity.plus/share/dismissed';
      });
      addTearDown(() {
        messenger.setMockMethodCallHandler(pathChannel, null);
        messenger.setMockMethodCallHandler(shareChannel, null);
      });
      late BuildContext context;
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: s,
          child: MaterialApp(
            home: Builder(
              builder: (c) {
                context = c;
                return const Scaffold(body: Text('export'));
              },
            ),
          ),
        ),
      );
      await tester.runAsync(() => shareWatchTransfer(context));
      expect(sent, isNotNull);
      expect(sent!['mimeTypes'], ['application/json']);
      final path = (sent!['paths'] as List).single as String;
      expect(path, endsWith('.json'));
      expect(
        File(path).uri.pathSegments.last,
        startsWith('guanlan-watchlist-'),
      );
      final content = File(path).readAsStringSync();
      expect(content, isNot(contains('CANARY')));
      expect(WatchTransfer.parse(content).groups.single['name'], '科技');
      await tester.pumpWidget(const SizedBox());
      s.dispose();
    },
  );
}
