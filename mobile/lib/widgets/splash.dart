import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Brand slogan shown on the launch splash (also in README).
const atlasSlogan = '观量价之澜，辨市场之势';

/// The app icon's mark: a price line crossing three candle wicks.
/// Coordinates are in the 1024-unit space of the app icon artwork.
const _line = [
  Offset(245, 632),
  Offset(370, 465),
  Offset(490, 565),
  Offset(620, 345),
  Offset(780, 400),
];
const _wicks = [
  (x: 308.0, top: 430.0, bottom: 707.0),
  (x: 513.0, top: 388.0, bottom: 646.0),
  (x: 717.0, top: 244.0, bottom: 513.0),
];
const markBounds = Rect.fromLTRB(225, 244, 790, 707);

class AtlasMarkPainter extends CustomPainter {
  AtlasMarkPainter({
    required this.progress,
    required this.color,
    required this.wick,
  });
  final double progress;
  final Color color, wick;
  @override
  void paint(Canvas canvas, Size size) {
    final scale = math.min(
      size.width / markBounds.width,
      size.height / markBounds.height,
    );
    canvas
      ..translate(
        (size.width - markBounds.width * scale) / 2,
        (size.height - markBounds.height * scale) / 2,
      )
      ..scale(scale)
      ..translate(-markBounds.left, -markBounds.top);
    // Wicks rise first, then the price line draws across them.
    final wickT = Curves.easeOut.transform((progress / .45).clamp(0, 1));
    final wickPaint = Paint()
      ..color = wick
      ..strokeWidth = 10;
    for (final w in _wicks) {
      final mid = (w.top + w.bottom) / 2, half = (w.bottom - w.top) / 2 * wickT;
      canvas.drawLine(
        Offset(w.x, mid - half),
        Offset(w.x, mid + half),
        wickPaint,
      );
    }
    final lineT = Curves.easeInOutCubic.transform(
      ((progress - .2) / .8).clamp(0, 1),
    );
    if (lineT <= 0) return;
    final path = Path()..moveTo(_line.first.dx, _line.first.dy);
    for (final p in _line.skip(1)) {
      path.lineTo(p.dx, p.dy);
    }
    final metric = path.computeMetrics().first;
    canvas.drawPath(
      metric.extractPath(0, metric.length * lineT),
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 46
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(AtlasMarkPainter old) =>
      old.progress != progress || old.color != color;
}

/// Cold-start splash over the first screen. The home screen builds and loads
/// data underneath, so the splash never delays it; tap anywhere to skip.
class SplashGate extends StatefulWidget {
  const SplashGate({super.key, required this.child, this.translate});
  final Widget child;
  final String Function(String)? translate;
  @override
  State<SplashGate> createState() => _SplashGateState();
}

class _SplashGateState extends State<SplashGate> with TickerProviderStateMixin {
  late final intro = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  );
  late final exit = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 380),
  );
  bool done = false, started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (started) return;
    started = true;
    final still = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (still) intro.value = 1;
    intro.forward().whenComplete(() {
      Future<void>.delayed(Duration(milliseconds: still ? 500 : 420), dismiss);
    });
  }

  Future<void> dismiss() async {
    if (done || !mounted) return;
    await exit.forward();
    if (mounted) setState(() => done = true);
  }

  @override
  void dispose() {
    intro.dispose();
    exit.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.translate ?? (String s) => s;
    // Always the dark brand palette: it continues the native iOS launch
    // screen (#0b0b0e) without a flash, whichever theme the app uses.
    const bg = Color(0xff0b0b0e),
        ink = Color(0xffeeeef4),
        muted = Color(0xffb9b9c6);
    return Stack(
      fit: StackFit.expand,
      // The child keeps its slot when the overlay is removed, so the home
      // screen's state survives the hand-off.
      children: [
        widget.child,
        if (!done)
          AnnotatedRegion<SystemUiOverlayStyle>(
            value: SystemUiOverlayStyle.light,
            child: FadeTransition(
              opacity: ReverseAnimation(exit),
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: dismiss,
                child: Semantics(
                  label: '${t('观澜')} · ${t(atlasSlogan)}',
                  button: true,
                  onTapHint: t('跳过'),
                  // Material supplies the default text style; plain boxes
                  // would render Flutter's yellow "missing style" underline.
                  child: Material(
                    color: bg,
                    child: AnimatedBuilder(
                      animation: intro,
                      builder: (context, _) {
                        final v = intro.value;
                        double phase(double from, double to) => Curves.easeOut
                            .transform(((v - from) / (to - from)).clamp(0, 1));
                        Widget rise(double from, Widget child) => Opacity(
                          opacity: phase(from, from + .3),
                          child: Transform.translate(
                            offset: Offset(
                              0,
                              12 * (1 - phase(from, from + .3)),
                            ),
                            child: child,
                          ),
                        );
                        return Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(
                                width: 120,
                                height:
                                    120 * markBounds.height / markBounds.width,
                                child: CustomPaint(
                                  painter: AtlasMarkPainter(
                                    progress: phase(0, .62),
                                    color: ink,
                                    wick: muted,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 34),
                              rise(
                                .45,
                                Text(
                                  t('观澜'),
                                  style: TextStyle(
                                    color: ink,
                                    fontSize: 40,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 10,
                                    height: 1.1,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 8),
                              rise(
                                .55,
                                Text(
                                  'MARKET ATLAS',
                                  style: TextStyle(
                                    color: muted,
                                    fontSize: 12,
                                    letterSpacing: 5,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 30),
                              rise(
                                .7,
                                Padding(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 32,
                                  ),
                                  child: Text(
                                    t(atlasSlogan),
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      color: ink.withValues(alpha: .86),
                                      fontSize: 17,
                                      letterSpacing: 3,
                                      height: 1.5,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
