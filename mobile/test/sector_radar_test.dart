import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/screener.dart';
import 'package:market_atlas/widgets/sector_heatmap.dart';
import 'package:market_atlas/screens/sector_explorer.dart';

void main() {
  test(
    'heatmap cells cover bounds without overlap and have tappable dimensions',
    () {
      final rects = heatRects(
        List.generate(24, (i) => .6 + (i % 5) * .2),
        const Rect.fromLTWH(0, 0, 366, 520),
      );
      expect(rects.length, 24);
      expect(
        rects.fold<double>(0, (n, r) => n + r.width * r.height),
        closeTo(366 * 520, .1),
      );
      for (var i = 0; i < rects.length; i++) {
        expect(rects[i].shortestSide, greaterThan(42));
        for (var j = i + 1; j < rects.length; j++) {
          expect(
            rects[i].deflate(.001).overlaps(rects[j].deflate(.001)),
            false,
          );
        }
      }
    },
  );
  testWidgets(
    'concept heatmap has robot and innovative medicine cells and no ranking list at 22px',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});
      final prefs = await tester.runAsync(SharedPreferences.getInstance);
      final s = AtlasStore(
        AtlasApi(
          client: MockClient(
            (r) async => http.Response(
              jsonEncode({
                'items': [
                  {
                    'code': 'SN:gn_robot',
                    'name': '机器人概念',
                    'changePercent': 2.5,
                    'amount': 3e9,
                    'count': 45,
                  },
                  {
                    'code': 'SN:gn_cxy',
                    'name': '创新药',
                    'changePercent': -1.3,
                    'amount': 2e9,
                    'count': 100,
                  },
                ],
              }),
              200,
              headers: {'content-type': 'application/json'},
            ),
          ),
        ),
        prefs!,
        {},
      );
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: s,
          child: MaterialApp(
            home: Scaffold(
              body: MediaQuery(
                data: const MediaQueryData(
                  textScaler: TextScaler.linear(22 / 18),
                ),
                child: const SingleChildScrollView(child: SectorExplorer()),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(SectorHeatmap), findsOneWidget);
      expect(find.byType(ListTile), findsNothing);
      expect(find.text('机器人概念'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      s.dispose();
    },
  );
  test('full-market mobile scanning uses one durable task instead of pulling universe/history on the phone', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final paths = <String>[];
    final s = AtlasStore(
      AtlasApi(
        client: MockClient((r) async {
          paths.add('${r.method} ${r.url.path}');
          return http.Response(
            jsonEncode({
              'job': {
                'id': 'job',
                'phase': 'complete',
                'total': 5576,
                'registered': 5576,
                'targets': 1000,
                'cursor': 1000,
                'checked': 1000,
                'candidateCount': 0,
                'failed': 0,
                'rejected': {},
                'failureSample': [],
              },
              'candidates': [],
            }),
            200,
          );
        }),
      ),
      prefs,
      {},
    );
    final scan = ScreenerController(s);
    await scan.start('all', true, true, options: {'strategy': 'auto'});
    expect(paths, ['POST /api/desk/screen-job']);
    expect(scan.state['phase'], 'complete');
    expect(scan.state['cursor'], 1000);
    expect(scan.running, false);
    scan.dispose();
    s.dispose();
  });
}
