import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/widgets/flow_research.dart';

void main() {
  testWidgets(
    'independent history remains visible when four-bucket and tick sources fail on a small phone',
    (tester) async {
      tester.view.physicalSize = const Size(375, 812);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});
      final api = AtlasApi(
        client: MockClient((request) async {
          if (request.url.path.endsWith('flow-history')) {
            return http.Response(
              jsonEncode({
                'available': true,
                'source': 'Sina dated test fixture',
                'points': List.generate(
                  20,
                  (i) => {
                    'time': '2026-09-${(i + 1).toString().padLeft(2, '0')}',
                    'main': 1000000,
                    'totalNet': 2000000,
                    'mainRatio': 5,
                  },
                ),
              }),
              200,
            );
          }
          return http.Response(
            '{"available":false,"reason":"source temporarily unavailable"}',
            503,
          );
        }),
      );
      final store = AtlasStore(api, await SharedPreferences.getInstance(), {});
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: store,
          child: MaterialApp(
            home: MediaQuery(
              data: const MediaQueryData(textScaler: TextScaler.linear(1.22)),
              child: const Scaffold(
                body: SingleChildScrollView(
                  child: Padding(
                    padding: EdgeInsets.all(16),
                    child: FlowResearch('300545.SZ'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('100.00万'), findsWidgets);
      expect(find.textContaining('2026-09-20'), findsWidgets);
      expect(
        find.textContaining('source temporarily unavailable'),
        findsWidgets,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      store.dispose();
    },
  );
}
