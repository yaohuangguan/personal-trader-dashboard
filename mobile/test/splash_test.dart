import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:market_atlas/widgets/splash.dart';

class Counter extends StatefulWidget {
  const Counter({super.key});
  @override
  State<Counter> createState() => _CounterState();
}

class _CounterState extends State<Counter> {
  int taps = 0;
  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: TextButton(
        onPressed: () => setState(() => taps++),
        child: Text('home $taps'),
      ),
    ),
  );
}

/// Advances time in frames; pumpAndSettle would stop during the timed pause.
Future<void> advance(WidgetTester tester, int ms) async {
  for (var t = 0; t < ms; t += 50) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  testWidgets(
    'splash shows the slogan, then reveals home without rebuilding it',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: SplashGate(child: Counter())),
      );
      expect(find.text(atlasSlogan), findsOneWidget);
      expect(find.text('观澜'), findsOneWidget);
      expect(find.text('MARKET ATLAS'), findsOneWidget);
      // Home builds underneath immediately so data loading is never delayed.
      expect(find.text('home 0', skipOffstage: false), findsOneWidget);
      final state = tester.state(find.byType(Counter, skipOffstage: false));
      await tester.pump(const Duration(milliseconds: 1000));
      expect(
        find.text(atlasSlogan),
        findsOneWidget,
        reason: 'still showing mid-animation',
      );
      await advance(tester, 1600);
      expect(find.text(atlasSlogan), findsNothing);
      expect(
        tester.state(find.byType(Counter)),
        same(state),
        reason: 'home state survives',
      );
      await tester.tap(find.text('home 0'));
      await tester.pump();
      expect(find.text('home 1'), findsOneWidget);
    },
  );

  testWidgets('tapping skips the splash immediately', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: SplashGate(child: Counter())),
    );
    await tester.pump(const Duration(milliseconds: 200));
    await tester.tap(find.text(atlasSlogan), warnIfMissed: false);
    await advance(tester, 500);
    expect(find.text(atlasSlogan), findsNothing);
  });

  testWidgets(
    'reduce motion shows the finished splash briefly without animating',
    (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(
        tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
      );
      await tester.pumpWidget(
        const MaterialApp(home: SplashGate(child: Counter())),
      );
      await tester.pump();
      final text = tester.widget<Opacity>(
        find
            .ancestor(
              of: find.text(atlasSlogan),
              matching: find.byType(Opacity),
            )
            .first,
      );
      expect(text.opacity, 1, reason: 'content appears at once');
      await advance(tester, 1600);
      expect(find.text(atlasSlogan), findsNothing);
    },
  );

  testWidgets('English locale translates the slogan', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: SplashGate(
          translate: (s) => {atlasSlogan: 'Read the tides'}[s] ?? s,
          child: const Counter(),
        ),
      ),
    );
    expect(find.text('Read the tides'), findsOneWidget);
  });
}
