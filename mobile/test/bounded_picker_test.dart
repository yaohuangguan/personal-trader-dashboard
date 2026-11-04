import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:market_atlas/widgets/compact_picker.dart';
import 'package:provider/provider.dart';

import 'support/chart_harness.dart';

void main() {
  testWidgets(
    'long selector stays below two thirds of phone, searches and dismisses outside',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      String? chosen;
      final store = await chartStore();
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: store,
          child: MaterialApp(
            home: Scaffold(
              body: MediaQuery(
                data: const MediaQueryData(
                  size: Size(390, 844),
                  textScaler: TextScaler.linear(22 / 18),
                ),
                child: Column(
                  children: [
                    CompactPicker(
                      label: '分析行业',
                      items: {for (var i = 0; i < 100; i++) '$i': '行业$i'},
                      onChanged: (v) => chosen = v,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byType(CompactPicker));
      await tester.pumpAndSettle();
      expect(
        tester.getSize(find.byType(BottomSheet)).height,
        lessThanOrEqualTo(844 * .62 + 1),
      );
      expect(
        tester.getTopLeft(find.byType(BottomSheet)).dy,
        greaterThan(844 * .3),
      );
      await tester.enterText(find.byType(TextField), '行业99');
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ListTile, '行业99'));
      await tester.pumpAndSettle();
      expect(chosen, '99');
      await tester.tap(find.byType(CompactPicker));
      await tester.pumpAndSettle();
      await tester.tapAt(const Offset(10, 80));
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
