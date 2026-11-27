part of 'market_chart.dart';

/// Joins the gesture arena for every pointer on the chart and claims all of
/// them as soon as two are down. The pinch itself is measured by the chart's
/// [Listener]; winning the arena is what stops an enclosing [ListView] (or the
/// chart's own horizontal pan) from also consuming a two-finger zoom.
class _PinchClaimRecognizer extends OneSequenceGestureRecognizer {
  _PinchClaimRecognizer({super.debugOwner});
  final _down = <int>{};
  bool _claimed = false;

  @override
  void addAllowedPointer(PointerDownEvent event) {
    super.addAllowedPointer(event);
    _down.add(event.pointer);
    if (_down.length >= 2 && !_claimed) {
      _claimed = true;
      resolve(GestureDisposition.accepted);
    } else if (_claimed) {
      resolvePointer(event.pointer, GestureDisposition.accepted);
    }
  }

  @override
  void handleEvent(PointerEvent event) {
    if (event is PointerUpEvent || event is PointerCancelEvent) {
      _down.remove(event.pointer);
      if (!_claimed) resolvePointer(event.pointer, GestureDisposition.rejected);
      stopTrackingPointer(event.pointer);
    }
  }

  @override
  void acceptGesture(int pointer) {}

  @override
  void rejectGesture(int pointer) {
    _down.remove(pointer);
    stopTrackingPointer(pointer);
  }

  @override
  void didStopTrackingLastPointer(int pointer) {
    _claimed = false;
    _down.clear();
  }

  @override
  String get debugDescription => 'chart pinch';
}

/// Horizontal pans that start inside the iOS back-swipe zone (left edge).
/// Accepts after a few pixels of horizontal travel — well before the route's
/// edge gesture reaches its slop — so dragging towards older candles from the
/// edge pans the chart instead of popping the page. Vertical intent is
/// released to the page scroll.
class _EdgePanRecognizer extends OneSequenceGestureRecognizer {
  _EdgePanRecognizer({super.debugOwner});
  double edge = 28;
  VoidCallback? onStart, onEnd;
  ValueChanged<double>? onUpdate;
  int? _pointer;
  Offset _origin = Offset.zero, _last = Offset.zero;
  bool _accepted = false;

  @override
  bool isPointerAllowed(PointerDownEvent event) =>
      _pointer == null &&
      event.kind == PointerDeviceKind.touch &&
      event.position.dx <= edge &&
      super.isPointerAllowed(event);

  @override
  void addAllowedPointer(PointerDownEvent event) {
    super.addAllowedPointer(event);
    _pointer = event.pointer;
    _origin = _last = event.position;
    _accepted = false;
  }

  @override
  void handleEvent(PointerEvent event) {
    if (event.pointer != _pointer) return;
    if (event is PointerMoveEvent) {
      if (_accepted) {
        onUpdate?.call(event.position.dx - _last.dx);
        _last = event.position;
        return;
      }
      final d = event.position - _origin;
      if (d.dx.abs() > 4 && d.dx.abs() > d.dy.abs() * 1.2) {
        _accepted = true;
        resolve(GestureDisposition.accepted);
        onStart?.call();
        onUpdate?.call(event.position.dx - _origin.dx);
        _last = event.position;
      } else if (d.dy.abs() > kTouchSlop) {
        resolve(GestureDisposition.rejected);
        stopTrackingPointer(event.pointer);
      }
    } else if (event is PointerUpEvent || event is PointerCancelEvent) {
      if (_accepted) {
        onEnd?.call();
      } else {
        resolve(GestureDisposition.rejected);
      }
      stopTrackingPointer(event.pointer);
    }
  }

  @override
  void acceptGesture(int pointer) {}

  @override
  void rejectGesture(int pointer) {
    if (pointer == _pointer) stopTrackingPointer(pointer);
  }

  @override
  void didStopTrackingLastPointer(int pointer) {
    _pointer = null;
    _accepted = false;
  }

  @override
  String get debugDescription => 'chart edge pan';
}
