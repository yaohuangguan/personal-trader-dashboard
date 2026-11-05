import 'api.dart';
import 'indicators.dart';

String historyBasisFor(String source, String symbol) {
  if (!source.contains('新浪')) return 'tencent';
  return symbol.endsWith('.BJ') || RegExp('指数原值|不复权|未复权').hasMatch(source)
      ? 'sina-raw'
      : 'sina-qfq';
}

List<Bar> mergeChartHistory(
  List<Bar> current,
  Json page, {
  String? volumeUnit,
}) {
  if (volumeUnit != null) page = normalizeHistoryVolume(page, volumeUnit);
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

Json normalizeHistoryVolume(Json page, String target) {
  final source = str(page['volumeUnit']);
  if (rows(page['candles']).isEmpty || source == target) return page;
  if (!['股', '手'].contains(source) || !['股', '手'].contains(target)) {
    throw StateError('历史来源成交量口径不同，请刷新图表后重试');
  }
  Json convert(Json row) {
    final volume = numOf(row['volume']);
    if (volume == null || !volume.isFinite || volume < 0) {
      throw StateError('历史分页成交量异常');
    }
    return {...row, 'volume': volume * (source == '手' ? 100 : .01)};
  }

  return {
    ...page,
    'candles': rows(page['candles']).map(convert).toList(),
    if (obj(page['anchor']).isNotEmpty) 'anchor': convert(obj(page['anchor'])),
    'volumeUnit': target,
  };
}
