import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/multi_filters.dart';
import 'package:market_atlas/widgets/multi_filters.dart';

import 'support/chart_harness.dart';

void main() {
  test('missing and three-line cached records cannot pass the four-line or strong mode', () {
    expect(passesMultiEvidence({}, 'multi', {}), false);
    final e = <String, dynamic>{
      'version': 3,
      'normal': true,
      'strong': false,
      'lines': 4,
      'includes60': false,
      'dispersion': 2,
      'middleOffset': .1,
      'volume20': 2.2,
      'volume5': 2,
      'gain': 6,
      'closeLocation': .95,
    };
    expect(passesMultiEvidence(e, 'multi', {}), true);
    expect(passesMultiEvidence({...e, 'lines': 3}, 'multi', {}), false);
    expect(passesMultiEvidence(e, 'strongmulti', {}), false);
    expect(passesMultiEvidence(e, 'multi', {'multi60': '1'}), false);
  });
  testWidgets('native filter controls are usable at 390px and large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final store = await chartStore();
    Json filters = {...multiDefaults};
    await tester.pumpWidget(
      ChangeNotifierProvider<AtlasStore>.value(
        value: store,
        child: MaterialApp(
          home: Scaffold(
            body: MediaQuery(
              data: const MediaQueryData(
                textScaler: TextScaler.linear(22 / 18),
              ),
              child: StatefulBuilder(
                builder: (context, update) => SingleChildScrollView(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: MultiLineFilters(
                      values: filters,
                      onChanged: (v) => update(() => filters = v),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('穿线必须包含MA60或55'));
    await tester.tap(find.text('穿线必须包含MA60或55'));
    await tester.pumpAndSettle();
    expect(filters['multi60'], '1');
    await tester.ensureVisible(find.text('密集线束位于实体中轴'));
    await tester.tap(find.text('密集线束位于实体中轴'));
    await tester.pumpAndSettle();
    expect(filters['multiMiddle'], '1');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    store.dispose();
  });
}
