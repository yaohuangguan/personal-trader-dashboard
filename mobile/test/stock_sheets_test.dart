import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/screens/news.dart';
import 'package:market_atlas/screens/stock.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  Future<AtlasStore> make(
    Future<http.Response> Function(http.Request) handler,
  ) async {
    SharedPreferences.setMockInitialValues({'watchlist': <String>[]});
    return AtlasStore(
      AtlasApi(client: MockClient(handler)),
      await SharedPreferences.getInstance(),
      {},
    );
  }

  Widget app(AtlasStore s, Widget home) => ChangeNotifierProvider.value(
    value: s,
    child: MaterialApp(home: home),
  );

  testWidgets('an unsupported symbol says so instead of spinning', (
    tester,
  ) async {
    final s = (await tester.runAsync(
      () => make((_) async => http.Response('{}', 200)),
    ))!;
    await tester.pumpWidget(app(s, const StockPage('^GSPC')));
    await tester.pump(const Duration(seconds: 1));
    expect(find.textContaining('暂不支持该代码'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    await tester.pumpWidget(const SizedBox());
    s.dispose();
  });

  testWidgets('the order book follows the live quote while open', (
    tester,
  ) async {
    final s = (await tester.runAsync(
      () => make((_) async => http.Response('{}', 200)),
    ))!;
    Json quote(double bid) => {
      'previous': 10,
      'asks': [
        {'price': 10.2, 'volume': 5},
      ],
      'bids': [
        {'price': bid, 'volume': 7},
      ],
    };
    final live = ValueNotifier<Json>(quote(10.1));
    await tester.pumpWidget(
      app(
        s,
        Scaffold(
          body: SingleChildScrollView(
            child: BookPanel('600519.SH', quote(10.1), live: live),
          ),
        ),
      ),
    );
    expect(find.text('10.10'), findsOneWidget);
    live.value = quote(10.05);
    await tester.pump();
    expect(find.text('10.05'), findsOneWidget);
    expect(find.text('10.10'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    live.dispose();
    s.dispose();
  });

  testWidgets('a shared article that failed to load can be retried', (
    tester,
  ) async {
    var calls = 0;
    final s = (await tester.runAsync(
      () => make((r) async {
        calls++;
        if (calls == 1) return http.Response('error code: 1102', 503);
        return http.Response.bytes(
          utf8.encode(
            jsonEncode({
              'item': {
                'title': '共享标题',
                'url': 'https://example.com/a',
                'summary': '摘要',
              },
            }),
          ),
          200,
        );
      }),
    ))!;
    await tester.pumpWidget(app(s, const SharedReaderPage('AbCdEfGhIjKlMnOp')));
    await tester.pumpAndSettle();
    expect(find.text('服务繁忙，请稍后重试'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(calls, 1, reason: 'rebuilds do not refetch');
    await tester.tap(find.text('重试'));
    await tester.pumpAndSettle();
    expect(find.text('共享标题'), findsOneWidget);
    expect(find.text('打开原文'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    s.dispose();
  });
}
