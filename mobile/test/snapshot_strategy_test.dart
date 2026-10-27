import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/snapshot.dart';
import 'package:market_atlas/screens/guide.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('image clipboard sends PNG bytes instead of a path or text', () async {
    final bytes = Uint8List.fromList([137, 80, 78, 71, 13, 10, 26, 10]);
    MethodCall? received;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(StockSnapshot.channel, (call) async {
          received = call;
          return true;
        });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(StockSnapshot.channel, null),
    );
    await StockSnapshot.copy(bytes);
    expect(received!.method, 'copyImage');
    expect(received!.arguments, bytes);
  });
  testWidgets(
    'capture contains exactly the repaint boundary viewport at requested resolution',
    (tester) async {
      final key = GlobalKey();
      await tester.pumpWidget(
        MaterialApp(
          home: Center(
            child: RepaintBoundary(
              key: key,
              child: const SizedBox(
                width: 120,
                height: 80,
                child: ColoredBox(color: Colors.red),
              ),
            ),
          ),
        ),
      );
      final future = tester.runAsync(
        () => StockSnapshot.capture(key, pixelRatio: 2),
      );
      await tester.pump();
      final png = await future;
      expect(png, isNotNull);
      final header = ByteData.sublistView(png!);
      expect(header.getUint32(16), 240);
      expect(header.getUint32(20), 160);
    },
  );
  testWidgets(
    'new mobile guide shows decision and prices before detailed evidence at large text',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});
      final prefs = await tester.runAsync(SharedPreferences.getInstance);
      final store = AtlasStore(AtlasApi(), prefs!, {});
      final analysis = <String, dynamic>{
        'strategy': {
          'version': '结构量价 v2.0',
          'plan': {
            'kind': 'breakout',
            'action': '等待回踩',
            'label': '蓄势关键位突破',
            'direction': 'bullish',
            'asOf': '2026-10-26',
            'entry': [23.2, 23.8],
            'stop': 22.3,
            'targets': [26.0],
            'reasons': ['先核验入场区间和结构风险'],
            'checks': [],
          },
        },
        'strength': {'score': 71},
        'context': {
          'structure': {
            'state': '多头排列',
            'period': '日线',
            'direction': 'bullish',
          },
          'priceVolume': {
            'label': '量增价涨',
            'explanation': '成交参与增加，偏多观察',
            'direction': 'bullish',
          },
        },
      };
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: store,
          child: MaterialApp(
            builder: (ctx, child) => MediaQuery(
              data: MediaQuery.of(ctx)
                  .copyWith(textScaler: const TextScaler.linear(1.22)),
              child: child!,
            ),
            home: Scaffold(
              body: SingleChildScrollView(
                child: GuidePanel('300031.SZ', analysis),
              ),
            ),
          ),
        ),
      );
      expect(find.text('等待回踩'), findsOneWidget);
      expect(find.text('23.20 – 23.80'), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('等待回踩')).dy,
        lessThan(tester.getTopLeft(find.text('结构与节奏')).dy),
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
    },
  );
}
