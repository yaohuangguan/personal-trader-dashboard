import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/screens/trade_review.dart';

import 'support/chart_harness.dart';

void main() {
  testWidgets(
    'phone review keeps both stances and follow-up evidence open at large text',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final store = await chartStore();
      final analysis = <String, dynamic>{
        'strategy': {
          'plan': {
            'label': '回踩后放量转强',
            'structureScore': 85,
            'score': 75,
            'exitRisk': 18,
            'asOf': '2026-10-28',
            'provisional': true,
            'entry': [12.1, 12.5],
            'stop': 11.8,
            'holdingStop': 11.9,
            'metrics': {'volumeLabel': '放量转强', 'volumeDetail': '仍需核验位置与风险'},
            'flat': {'action': '盘中预警', 'reason': '等待收盘及可交易性核验'},
            'holding': {'action': '持有观察', 'reason': '关注既定风控线'},
          },
          'episodes': [
            {
              'setup': {'date': '2026-10-23', 'kind': 'multi'},
              'failedAt': null,
              'follow': [
                {
                  'day': 1,
                  'date': '2026-10-26',
                  'state': '均线密集',
                  'supportHeld': true,
                  'volume20': .8,
                  'volumeLaunch': .4,
                  'adhesion': 2.1,
                },
              ],
            },
          ],
          'timeline': [
            {'date': '2026-10-28', 'label': '回踩后放量转强', 'reason': '新的承接证据'},
          ],
        },
        'review': {
          'entryScore': null,
          'coverage': 60,
          'exitRisk': 18,
          'asOf': '2026-10-28',
          'flat': {'action': '等待行情核验', 'reason': '快照日期尚未核验'},
          'holding': {'action': '持有观察', 'reason': '关注既定风控线'},
          'evidence': [
            {
              'id': 'sector',
              'label': '板块联动',
              'status': 'unverified',
              'score': null,
              'weight': 5,
              'detail': '日期未核验，不作为今日加分',
              'source': '来源样本',
            },
          ],
          'buyConditions': ['先核验主动承接'],
          'sellConditions': ['支撑失守优先风控'],
        },
        'patternMarks': [
          {'time': '2026-10-23', 'label': '一阳多线', 'detail': '观察形态，不代表已成交'},
        ],
      };
      await tester.pumpWidget(
        ChangeNotifierProvider<AtlasStore>.value(
          value: store,
          child: MaterialApp(
            home: Scaffold(
              body: MediaQuery(
                data: const MediaQueryData(
                  textScaler: TextScaler.linear(22 / 18),
                ),
                child: SingleChildScrollView(
                  child: Column(
                    children: [
                      DecisionSummary(analysis),
                      DecisionDetails(analysis),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('等待行情核验'), findsOneWidget);
      expect(find.text('持有观察'), findsOneWidget);
      expect(
        find.text('—'),
        findsOneWidget,
      ); // Missing review score must not fall back to 75.
      expect(find.text('日期未核验，不作为今日加分'), findsOneWidget);
      expect(find.text('先核验主动承接'), findsOneWidget);
      expect(find.text('支撑失守优先风控'), findsOneWidget);
      expect(find.textContaining('D1'), findsOneWidget);
      await tester.ensureVisible(find.text('新的承接证据'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
    },
  );
}
