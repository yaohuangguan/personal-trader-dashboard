import 'package:flutter_test/flutter_test.dart';
import 'package:market_atlas/core/indicators.dart';
import 'package:market_atlas/core/patch_daily_quote.dart';

void main() {
  test('live daily candle follows verified quote price and cumulative volume without changing prior bars', () {
    final bars = [
      const Bar('2026-10-27', 10, 10.5, 9.8, 10, 1000),
      const Bar('2026-10-28', 10.1, 10.4, 10, 10.3, 500),
    ];
    final quote = <String, dynamic>{
      'asOf': '2026-10-28T11:00:00+08:00',
      'previous': 10,
      'price': 10.6,
      'open': 10.1,
      'high': 10.7,
      'low': 10,
      'volume': 800,
      'volumeUnit': '手',
      'stale': false,
    };
    final patched = patchDailyQuote(bars, quote, '手');
    expect(patched.last.close, 10.6);
    expect(patched.last.volume, 800);
    expect(identical(patched.first, bars.first), true);
    expect(
      identical(patchDailyQuote(bars, {...quote, 'previous': 9}, '手'), bars),
      true,
    );
    expect(
      identical(patchDailyQuote(bars, {...quote, 'volume': 400}, '手'), bars),
      true,
    );
    expect(
      identical(patchDailyQuote(bars, {...quote, 'stale': true}, '手'), bars),
      true,
    );
    expect(
      patchDailyQuote(bars, {
        ...quote,
        'volume': 80000,
        'volumeUnit': '股',
      }, '手').last.volume,
      800,
    );
  });
}
