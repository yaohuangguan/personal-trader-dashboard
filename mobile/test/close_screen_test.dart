import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/screener.dart';
import 'package:market_atlas/core/palette.dart';
import 'package:market_atlas/screens/auto_screener.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets(
    'phone automatic ranking displays evidence and removes illiquid candidates at 22px',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});
      final valid = {
        'symbol': '300031.SZ',
        'name': '测试候选',
        'asOf': '2026-10-26',
        'price': 27.01,
        'changePercent': 8.21,
        'amount': 3e8,
        'marketCap': 100e8,
        'bucket': '启动待确认',
        'chip': {'concentration90': 10},
        'character': {'quiet': false, 'weakFollow': false},
        'patterns': [
          {'label': '一阳多线'},
        ],
        'ranking': {
          'score': 75,
          'label': '优先复核',
          'parts': [
            {'label': '量价承接', 'score': 20, 'max': 30, 'reason': '来源证据'},
          ],
        },
        'advice': {
          'action': '观望',
          'reasons': ['收盘确认尚未完成'],
        },
      };
      final s = AtlasStore(
        AtlasApi(
          client: MockClient(
            (request) async => http.Response(
              jsonEncode({
                'report': {
                  'date': '2026-10-26',
                  'checked': 100,
                  'candidates': [
                    valid,
                    {
                      ...valid,
                      'symbol': '600000.SH',
                      'name': '成交不足样本',
                      'amount': 1e8,
                    },
                  ],
                },
              }),
              200,
              headers: {'content-type': 'application/json'},
            ),
          ),
        ),
        await SharedPreferences.getInstance(),
        {},
      );
      final scan = ScreenerController(s);
      AtlasPalette.light = true;
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: s),
            ChangeNotifierProvider.value(value: scan),
          ],
          child: MaterialApp(
            theme: ThemeData(brightness: Brightness.light),
            home: const Scaffold(
              body: MediaQuery(
                data: MediaQueryData(textScaler: TextScaler.linear(22 / 18)),
                child: SingleChildScrollView(child: AutomaticScreenPanel()),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('测试候选'), findsOneWidget);
      expect(find.text('成交不足样本'), findsNothing);
      expect(find.text('量价承接'), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(find.text('来源证据'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      scan.dispose();
      s.dispose();
      AtlasPalette.light = false;
    },
  );
}
