import 'package:flutter_test/flutter_test.dart';
import 'package:market_atlas/core/market_hours.dart';

void main() {
  // Beijing = UTC+8. 2026-11-25 is a Wednesday, 2026-11-28 a Saturday.
  DateTime bj(int day, int hour, int minute) =>
      DateTime.utc(2026, 11, day, hour - 8, minute);

  test('A-share sessions follow Asia/Shanghai with the lunch break', () {
    expect(cnPhase(bj(25, 9, 14)), MarketPhase.closed);
    expect(cnPhase(bj(25, 9, 15)), MarketPhase.open);
    expect(cnPhase(bj(25, 11, 29)), MarketPhase.open);
    expect(cnPhase(bj(25, 11, 30)), MarketPhase.lunch);
    expect(cnPhase(bj(25, 12, 59)), MarketPhase.lunch);
    expect(cnPhase(bj(25, 13, 0)), MarketPhase.open);
    expect(cnPhase(bj(25, 15, 4)), MarketPhase.open);
    expect(cnPhase(bj(25, 15, 5)), MarketPhase.closed);
    expect(cnPhase(bj(28, 10, 0)), MarketPhase.closed);
    // 00:30 Beijing on Thursday is still Wednesday in UTC.
    expect(beijingDate(DateTime.utc(2026, 11, 25, 16, 30)), '2026-11-26');
  });

  test(
    'US sessions follow America/New_York including DST and extended hours',
    () {
      // November 25, 2026 is after DST ended (UTC-5).
      expect(usPhase(DateTime.utc(2026, 11, 25, 14, 29)), MarketPhase.extended);
      expect(usPhase(DateTime.utc(2026, 11, 25, 14, 30)), MarketPhase.open);
      expect(usPhase(DateTime.utc(2026, 11, 25, 21, 0)), MarketPhase.extended);
      expect(usPhase(DateTime.utc(2026, 11, 26, 1, 0)), MarketPhase.closed);
      expect(usPhase(DateTime.utc(2026, 11, 25, 9, 0)), MarketPhase.extended);
      // July: UTC-4, so 13:30 UTC is the 09:30 open.
      expect(usPhase(DateTime.utc(2026, 7, 1, 13, 30)), MarketPhase.open);
      expect(usPhase(DateTime.utc(2026, 7, 1, 13, 29)), MarketPhase.extended);
      // 2026: DST from March 8 07:00 UTC to November 1 06:00 UTC.
      expect(usDaylightSaving(DateTime.utc(2026, 3, 8, 6, 59)), isFalse);
      expect(usDaylightSaving(DateTime.utc(2026, 3, 8, 7)), isTrue);
      expect(usDaylightSaving(DateTime.utc(2026, 11, 1, 5, 59)), isTrue);
      expect(usDaylightSaving(DateTime.utc(2026, 11, 1, 6)), isFalse);
      // Saturday is closed even in "extended" clock hours.
      expect(usPhase(DateTime.utc(2026, 11, 28, 15)), MarketPhase.closed);
    },
  );

  test('poll cadence is fast in session and backs off without overshooting the open', () {
    const cn = ['600519.SH'], us = ['AAPL'];
    expect(pollInterval(cn, bj(25, 10, 0)), const Duration(seconds: 5));
    expect(pollInterval(cn, bj(25, 12, 0)), const Duration(minutes: 5));
    expect(pollInterval(cn, bj(25, 12, 57)), const Duration(minutes: 3));
    expect(pollInterval(cn, bj(28, 10, 0)), const Duration(minutes: 5));
    expect(
      pollInterval(us, DateTime.utc(2026, 11, 25, 12)),
      const Duration(seconds: 15),
    );
    // A watched US stock in session keeps the fast cadence at Beijing night.
    expect(
      pollInterval([...cn, ...us], DateTime.utc(2026, 11, 25, 15)),
      const Duration(seconds: 5),
    );
    // Holiday detected from quotes: no fast polling for the rest of the day.
    expect(
      pollInterval(cn, bj(25, 10, 0), cnHoliday: true),
      const Duration(minutes: 5),
    );
    expect(pollInterval(const [], bj(25, 10, 0)), isNull);
    expect(untilActive(cnPhase, bj(25, 12, 40)), const Duration(minutes: 20));
  });

  testWidgets('one scheduler asks for its next delay after every run', (
    tester,
  ) async {
    var runs = 0;
    var wait = const Duration(seconds: 5);
    final scheduler = PollScheduler(() async => runs++, () => wait);
    scheduler.start();
    await tester.pump();
    expect(runs, 1);
    await tester.pump(const Duration(seconds: 5));
    expect(runs, 2);
    wait = const Duration(minutes: 5);
    await tester.pump(const Duration(seconds: 5));
    expect(runs, 3);
    await tester.pump(const Duration(minutes: 1));
    expect(runs, 3, reason: 'backed off');
    scheduler.pause();
    await tester.pump(const Duration(minutes: 10));
    expect(runs, 3, reason: 'paused in the background');
    scheduler.resume();
    await tester.pump();
    expect(runs, 4, reason: 'resuming refreshes at once');
    scheduler.dispose();
  });
}
