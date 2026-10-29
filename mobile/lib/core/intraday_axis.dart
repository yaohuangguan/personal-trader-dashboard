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

bool isMarketIndex(String symbol) =>
    RegExp(r'^(000\d{3}\.SH|399\d{3}\.SZ|899050\.BJ)$').hasMatch(symbol);
List<Map<String, dynamic>> intradayStudy(
  List<Map<String, dynamic>> points,
  double? previous,
) {
  final valid = points
      .where(
        (p) =>
            sessionMinute('${p['clock']}') != null &&
            (p['price'] as num?) != null,
      )
      .toList();
  var fast = valid.isEmpty ? 0.0 : (valid.first['price'] as num).toDouble(),
      slow = fast,
      dea = 0.0;
  final out = <Map<String, dynamic>>[];
  for (var i = 0; i < valid.length; i++) {
    final p = valid[i], price = (p['price'] as num).toDouble();
    fast += 2 / 13 * (price - fast);
    slow += 2 / 27 * (price - slow);
    final dif = fast - slow;
    dea += .2 * (dif - dea);
    out.add({
      ...p,
      'rising':
          price >=
          (i == 0
              ? previous ?? price
              : (valid[i - 1]['price'] as num).toDouble()),
      'dif': dif,
      'dea': dea,
      'histogram': 2 * (dif - dea),
      'warmup': i < 33,
    });
  }
  return out;
}
