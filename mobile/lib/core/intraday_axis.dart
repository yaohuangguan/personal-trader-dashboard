int? sessionMinute(String clock) {
  final m = RegExp(r'^(\d{2}):(\d{2})').firstMatch(clock);
  if (m == null) return null;
  final minute = int.parse(m[1]!) * 60 + int.parse(m[2]!);
  if (minute >= 570 && minute <= 690) return minute - 570;
  if (minute >= 780 && minute <= 900) return 120 + minute - 780;
  return null;
}

String defaultBenchmark(String symbol) => RegExp(r'^(300|301)').hasMatch(symbol)
    ? '399006.SZ'
    : RegExp(r'^68[89]').hasMatch(symbol)
    ? '000688.SH'
    : symbol.endsWith('.SH')
    ? '000001.SH'
    : symbol.endsWith('.BJ')
    ? '899050.BJ'
    : '399001.SZ';
