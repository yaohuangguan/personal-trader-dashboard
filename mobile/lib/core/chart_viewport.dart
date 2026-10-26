import 'dart:math' as math;

/// Viewport math is independent of gestures and price calculations.
class ChartViewport {
  ChartViewport({this.length = 0, this.count = 66, this.offset = 0});
  int length, count, offset;
  double _pan = 0, _anchor = 0, _distance = 1;
  int _pinchCount = 0;
  int get end => math.max(0, length - offset);
  int get start => math.max(0, end - count);
  int get visible => end - start;
  void reset([int bars = 66]) {
    count = bars;
    offset = 0;
    _pan = 0;
  }

  void beginPan() {
    _pan = offset.toDouble();
  }

  void pan(double pixels, double plotWidth) {
    if (length < 2 || plotWidth <= 0) return;
    _pan = (_pan + pixels / plotWidth * visible).clamp(
      0.0,
      math.max(0, length - math.min(count, length)).toDouble(),
    );
    offset = _pan.round();
  }

  void beginPinch(double distance, double fraction) {
    _distance = math.max(1, distance);
    _pinchCount = visible;
    _anchor = start + fraction.clamp(0.0, 1.0) * visible;
  }

  void pinch(double distance, double fraction) {
    if (length == 0 || distance < 8) return;
    count = (_pinchCount * _distance / distance).round().clamp(
      math.min(12, length),
      length,
    );
    final targetEnd = (_anchor + (1 - fraction.clamp(0.0, 1.0)) * count)
        .round()
        .clamp(math.min(count, length), length);
    offset = length - targetEnd.toInt();
    _pan = offset.toDouble();
  }

  int select(double fraction) => length == 0
      ? 0
      : (start + (fraction.clamp(0.0, 1.0) * visible).floor()).clamp(
          start,
          end - 1,
        );
}
