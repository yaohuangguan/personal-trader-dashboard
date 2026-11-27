import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/screens/watch.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('search sends one request after typing pauses', (tester) async {
    SharedPreferences.setMockInitialValues({
      'watchlist': ['NVDA'],
    });
    final searches = <String>[];
    final store = (await tester.runAsync(
      () async => AtlasStore(
        AtlasApi(
          client: MockClient((r) async {
            if (r.url.path == '/api/search') {
              searches.add(r.url.queryParameters['q']!);
              return http.Response(
                jsonEncode({
                  'items': [
                    {'symbol': 'AAPL', 'name': 'Apple'},
                  ],
                }),
                200,
              );
            }
            return http.Response('{"items":[]}', 200);
          }),
        ),
        await SharedPreferences.getInstance(),
        {},
      ),
    ))!;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: store,
        child: MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => showStockSearch(context),
                child: const Text('search'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('search'));
    await tester.pumpAndSettle();
    for (final q in ['a', 'ap', 'app', 'appl']) {
      await tester.enterText(find.byType(TextField), q);
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(searches, isEmpty);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(searches, ['appl']);
    expect(find.text('Apple'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    store.dispose();
  });

  testWidgets(
    'swiping in a group view removes only the membership and can be undone',
    (tester) async {
      SharedPreferences.setMockInitialValues({
        'watchlist': ['NVDA', 'AAPL'],
        'watchGroups': jsonEncode([
          {
            'id': 'g1',
            'name': 'Chips',
            'symbols': ['NVDA', 'AAPL'],
          },
        ]),
      });
      final store = (await tester.runAsync(
        () async => AtlasStore(
          AtlasApi(
            client: MockClient((r) async => http.Response('{"items":[]}', 200)),
          ),
          await SharedPreferences.getInstance(),
          {},
        ),
      ))!;
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: store,
          child: const MaterialApp(home: Scaffold(body: WatchPage())),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Chips'));
      await tester.pumpAndSettle();
      await tester.drag(find.text('NVDA').first, const Offset(-600, 0));
      await tester.pumpAndSettle();
      expect(store.watchlist, [
        'NVDA',
        'AAPL',
      ], reason: 'still a watched stock');
      expect(store.groups.single['symbols'], ['AAPL']);
      expect(find.textContaining('已移出分组'), findsOneWidget);
      await tester.tap(find.text('撤销'));
      await tester.pumpAndSettle();
      expect(store.groups.single['symbols'], ['AAPL', 'NVDA']);

      // In the full list the stock leaves the watchlist; undo restores its
      // position and group membership.
      await tester.tap(find.text('全部自选'));
      await tester.pumpAndSettle();
      await tester.drag(find.text('NVDA').first, const Offset(-600, 0));
      await tester.pumpAndSettle();
      expect(store.watchlist, ['AAPL']);
      expect(store.groups.single['symbols'], ['AAPL']);
      await tester.tap(find.text('撤销'));
      await tester.pumpAndSettle();
      expect(store.watchlist, ['NVDA', 'AAPL']);
      expect(store.groups.single['symbols'], ['AAPL', 'NVDA']);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
    },
  );
}
