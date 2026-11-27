import 'dart:async';

import 'api.dart';

/// What a market is doing at a given instant, from the device clock alone.
enum MarketPhase { open, extended, lunch, closed }

const _beijing = Duration(hours: 8);

/// Shanghai / Shenzhen / Beijing exchanges, Asia/Shanghai (UTC+8, no DST).
/// 09:15–11:30 (opening call auction included), lunch break until 13:00,
/// 13:00–15:00 plus a short grace for the closing prints. Weekends closed;
/// exchange holidays are detected from the quotes themselves.
MarketPhase cnPhase(DateTime now) {
  final t = now.toUtc().add(_beijing);
  if (t.weekday > DateTime.friday) return MarketPhase.closed;
  final m = t.hour * 60 + t.minute;
  if (m >= 9 * 60 + 15 && m < 11 * 60 + 30) return MarketPhase.open;
  if (m >= 11 * 60 + 30 && m < 13 * 60) return MarketPhase.lunch;
  if (m >= 13 * 60 && m < 15 * 60 + 5) return MarketPhase.open;
  return MarketPhase.closed;
}

/// Beijing calendar date (yyyy-MM-dd) for an instant.
String beijingDate(DateTime now) =>
    now.toUtc().add(_beijing).toIso8601String().substring(0, 10);

/// US daylight saving: second Sunday of March 02:00 local to the first Sunday
/// of November 02:00 local.
bool usDaylightSaving(DateTime now) {
  final utc = now.toUtc();
  DateTime nthSunday(int month, int n) {
    final first = DateTime.utc(utc.year, month);
    final offset = (DateTime.sunday - first.weekday) % 7;
    return DateTime.utc(utc.year, month, 1 + offset + 7 * (n - 1));
  }

  final start = nthSunday(3, 2).add(const Duration(hours: 7)); // 02:00 EST
  final end = nthSunday(11, 1).add(const Duration(hours: 6)); // 02:00 EDT
  return !utc.isBefore(start) && utc.isBefore(end);
}

DateTime newYorkTime(DateTime now) =>
    now.toUtc().subtract(Duration(hours: usDaylightSaving(now) ? 4 : 5));

/// NYSE / Nasdaq, America/New_York: pre-market 04:00–09:30, regular
/// 09:30–16:00, after-hours 16:00–20:00.
MarketPhase usPhase(DateTime now) {
  final t = newYorkTime(now);
  if (t.weekday > DateTime.friday) return MarketPhase.closed;
  final m = t.hour * 60 + t.minute;
  if (m >= 9 * 60 + 30 && m < 16 * 60) return MarketPhase.open;
  if (m >= 4 * 60 && m < 20 * 60) return MarketPhase.extended;
  return MarketPhase.closed;
}

MarketPhase phaseFor(String symbol, DateTime now) =>
    cnStock(symbol) ? cnPhase(now) : usPhase(now);

bool _active(MarketPhase p) =>
    p == MarketPhase.open || p == MarketPhase.extended;

/// Time until [phase] reports an active session again, at most [limit].
/// All session boundaries fall on five-minute marks.
Duration untilActive(
  MarketPhase Function(DateTime) phase,
  DateTime now, {
  Duration limit = const Duration(days: 4),
}) {
  if (_active(phase(now))) return Duration.zero;
  final utc = now.toUtc();
  var t = DateTime.utc(
    utc.year,
    utc.month,
    utc.day,
    utc.hour,
    utc.minute - utc.minute % 5,
  ).add(const Duration(minutes: 5));
  final stop = utc.add(limit);
  while (t.isBefore(stop)) {
    if (_active(phase(t))) return t.difference(utc);
    t = t.add(const Duration(minutes: 5));
  }
  return limit;
}

/// Poll cadence for a set of symbols: fast while any of their markets trades,
/// slower in US extended hours, and backed off (but never past the next open)
/// during the lunch break, nights, weekends and detected holidays.
Duration? pollInterval(
  Iterable<String> symbols,
  DateTime now, {
  Duration open = const Duration(seconds: 5),
  Duration extended = const Duration(seconds: 15),
  Duration closed = const Duration(minutes: 5),
  bool cnHoliday = false,
}) {
  final list = symbols.toList();
  if (list.isEmpty) return null;
  final markets = <MarketPhase Function(DateTime)>[
    if (list.any(cnStock))
      cnHoliday
          ? (DateTime t) => beijingDate(t) == beijingDate(now)
                ? MarketPhase.closed
                : cnPhase(t)
          : cnPhase,
    if (list.any((s) => !cnStock(s))) usPhase,
  ];
  var best = closed;
  for (final market in markets) {
    final phase = market(now);
    final Duration wait = switch (phase) {
      MarketPhase.open => open,
      MarketPhase.extended => extended,
      _ => untilActive(market, now, limit: closed),
    };
    if (wait < best) best = wait;
  }
  return best < const Duration(seconds: 1) ? const Duration(seconds: 1) : best;
}

/// One timer for all periodic work. The next wake-up is asked from [delay]
/// after each run, so cadence follows market hours and failures.
class PollScheduler {
  PollScheduler(this.task, this.delay);
  final Future<void> Function() task;
  final Duration? Function() delay;
  Timer? _timer;
  bool _paused = true, _running = false, _disposed = false;
  bool get paused => _paused;

  void start() => resume();

  void resume() {
    if (_disposed) return;
    _paused = false;
    poke();
  }

  void pause() {
    _paused = true;
    _timer?.cancel();
    _timer = null;
  }

  /// Runs now (or right after the current run) instead of waiting.
  void poke() {
    if (_paused || _disposed) return;
    _timer?.cancel();
    _timer = null;
    if (_running) {
      _again = true;
      return;
    }
    _run();
  }

  bool _again = false;
  Future<void> _run() async {
    _running = true;
    try {
      await task();
    } catch (_) {
      /* Every job reports its own failure; the schedule continues. */
    } finally {
      _running = false;
    }
    if (_paused || _disposed) return;
    if (_again) {
      _again = false;
      _run();
      return;
    }
    _schedule();
  }

  void _schedule() {
    _timer?.cancel();
    final wait = delay();
    _timer = wait == null ? null : Timer(wait, _run);
  }

  /// Re-evaluates the next wake-up after inputs changed (e.g. new symbols).
  void reschedule() {
    if (_paused || _disposed || _running) return;
    _schedule();
  }

  void dispose() {
    _disposed = true;
    pause();
  }
}
