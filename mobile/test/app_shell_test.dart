import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/app_links.dart';
import 'package:market_atlas/core/push_service.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('deep links: custom scheme, https site and push payloads', () {
    AppLink? p(String s) => AppLink.parse(s);
    expect(p('guanlan://stock/600519')!.value, '600519.SH');
    expect(p('guanlan://stock?symbol=nvda')!.value, 'NVDA');
    expect(p('guanlan://n/AbCdEfGhIjKlMnOp')!.kind, AppLinkKind.share);
    expect(p('guanlan://signals')!.value, 'signals');
    expect(p('/?view=signals')!.kind, AppLinkKind.view);
    expect(p('/n/AbCdEfGhIjKlMnOp')!.value, 'AbCdEfGhIjKlMnOp');
    expect(
      p('https://guanlan.nzs.workers.dev/?symbol=300750.SZ')!.kind,
      AppLinkKind.stock,
    );
    expect(p('guanlan://open?article=abc')!.kind, AppLinkKind.article);
    expect(p('https://evil.example/?symbol=AAPL'), isNull);
    expect(p('guanlan://unknown'), isNull);
    expect(appTextScale(18, .85), closeTo(.85, 1e-9));
    expect(appTextScale(22, 3), closeTo(22 / 18 * 1.5, 1e-9));
  });

  Future<AtlasStore> store() async {
    SharedPreferences.setMockInitialValues({
      'watchlist': ['NVDA'],
    });
    return AtlasStore(
      AtlasApi(
        client: MockClient(
          (r) async => http.Response(jsonEncode({'items': []}), 200),
        ),
      ),
      await SharedPreferences.getInstance(),
      {},
    );
  }

  testWidgets(
    'tabs keep their state, and a signals push pops covering pages first',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final s = (await tester.runAsync(store))!;
      final push = NativePushService(s.api, s.deviceToken);
      await tester.pumpWidget(AtlasApp(store: s, push: push));
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.star_outline).last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('今日走势排序'));
      await tester.pumpAndSettle();
      expect(find.text('走势评分从高到低，待更新项置后'), findsOneWidget);
      await tester.tap(find.byIcon(Icons.article_outlined).last);
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.star_outline).last);
      await tester.pumpAndSettle();
      expect(
        find.text('走势评分从高到低，待更新项置后'),
        findsOneWidget,
        reason: 'the watch tab kept its selected view',
      );

      Navigator.of(tester.element(find.text('走势评分从高到低，待更新项置后'))).push(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('covering page')),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('covering page'), findsOneWidget);
      push.opened.add('/?view=signals');
      await tester.pumpAndSettle();
      expect(find.text('covering page'), findsNothing);
      expect(find.text('收盘信号中心'), findsWidgets);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      s.dispose();
      await push.dispose();
    },
  );
}
