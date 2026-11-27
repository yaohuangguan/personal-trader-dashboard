import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/push_service.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/screens/signals.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('server config maps back to the page scope', () {
    final watch = ['600519.SH', '300750.SZ', 'NVDA'];
    expect(monitorScopeOf({'scope': 'all'}, watch).scope, 'all');
    final mine = monitorScopeOf({
      'scope': 'selected',
      'symbols': ['300750.SZ', '600519.SH'],
      'activityFilter': false,
    }, watch);
    expect((mine.scope, mine.activity), ('watch', false));
    final pool = monitorScopeOf({
      'scope': 'selected',
      'symbols': ['000001.SZ'],
    }, watch);
    expect(pool.scope, 'candidates');
    expect(pool.symbols, ['000001.SZ']);
    expect(
      monitorConfigBody(
        enabled: false,
        scope: 'watch',
        items: const ['600519.SH'],
        activity: false,
        locale: 'zh-CN',
      ),
      {
        'enabled': false,
        'scope': 'selected',
        'symbols': ['600519.SH'],
        'activityFilter': false,
        'locale': 'zh-CN',
      },
    );
  });

  testWidgets(
    'a saved watchlist scope survives a restart and pausing keeps it',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({
        'watchlist': ['600519.SH', '300750.SZ'],
      });
      final posted = <Json>[];
      var config = <String, dynamic>{
        'enabled': true,
        'scope': 'selected',
        'symbols': ['600519.SH', '300750.SZ'],
        'activityFilter': false,
      };
      final store = (await tester.runAsync(
        () async => AtlasStore(
          AtlasApi(
            client: MockClient((r) async {
              if (r.url.path == '/api/monitor/config') {
                final body = obj(jsonDecode(r.body));
                posted.add(body);
                config = body;
                return http.Response('{"ok":true}', 200);
              }
              if (r.url.path == '/api/monitor/status') {
                return http.Response(
                  jsonEncode({'config': config, 'events': []}),
                  200,
                );
              }
              if (r.url.path == '/api/desk/close-report') {
                return http.Response.bytes(
                  utf8.encode(
                    jsonEncode({
                      'report': {'date': '2026-11-13', 'candidates': []},
                      'stale': true,
                      'expectedDate': '2026-11-26',
                    }),
                  ),
                  200,
                );
              }
              return http.Response('{}', 200);
            }),
          ),
          await SharedPreferences.getInstance(),
          {},
        ),
      ))!;
      final push = NativePushService(store.api, store.deviceToken);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: store),
            Provider.value(value: push),
          ],
          child: const MaterialApp(home: Scaffold(body: SignalsPage())),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('收盘报告未更新：最新为 2026-11-13，应为 2026-11-26'), findsOneWidget);
      expect(find.text('自定义名单最多60只'), findsWidgets);
      await tester.tap(find.text('暂停收盘推送'));
      await tester.pumpAndSettle();
      expect(posted.single, {
        'enabled': false,
        'scope': 'selected',
        'symbols': ['600519.SH', '300750.SZ'],
        'activityFilter': false,
        'locale': 'zh-CN',
      });
      await tester.tap(find.text('开启收盘推送'));
      await tester.pumpAndSettle();
      expect(posted.last['scope'], 'selected');
      expect(posted.last['enabled'], true);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
      await push.dispose();
    },
  );
}
