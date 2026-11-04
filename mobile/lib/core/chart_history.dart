import 'api.dart';
import 'indicators.dart';

List<Bar> mergeChartHistory(List<Bar> current, Json page) {
  final older = rows(page['candles']).map(Bar.fromJson).toList();
  final anchor = obj(page['anchor']);
  if (older.isNotEmpty && anchor.isEmpty) {
    throw StateError('历史页缺少重叠校验，暂不拼接不同来源行情');
  }
  final existing = current.where((b) => b.time == anchor['time']).firstOrNull;
  if (existing != null) {
    final incoming = Bar.fromJson(anchor);
    for (final pair in [
      (existing.open, incoming.open),
      (existing.high, incoming.high),
      (existing.low, incoming.low),
      (existing.close, incoming.close),
    ]) {
      if ((pair.$1 - pair.$2).abs() > .011 + pair.$1.abs() * .0002) {
        throw StateError('历史复权口径已变化，请刷新图表后重试');
      }
    }
  }
  return {
    ...{for (final b in older) b.time: b},
    ...{for (final b in current) b.time: b},
  }.values.toList()..sort((a, b) => a.time.compareTo(b.time));
}
