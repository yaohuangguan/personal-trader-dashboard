import 'package:flutter/foundation.dart';

import 'api.dart';

const watchPhases = {
  'all': '全部状态',
  'launch': '放量启动',
  'turning': '回踩转强',
  'tracking': '趋势跟踪',
  'extension': '高位延续',
  'pullback': '回踩观察',
  'stalled': '转强滞后',
  'repair': '均线修复',
  'base': '蓄势等待',
  'broken': '结构破位',
  'downward': '向下开花',
  'pending': '待更新',
};

bool insightFresh(Json? data, [DateTime? at]) {
  final stamp = DateTime.tryParse(str(data?['generatedAt'], ''));
  final age = stamp == null ? null : (at ?? DateTime.now()).difference(stamp);
  return data?['quoteStale'] != true &&
      age != null &&
      age.inMilliseconds >= -60000 &&
      age.inMilliseconds < 90000;
}

String watchPhase(Json? data, [DateTime? at]) {
  final plan = obj(data?['operation']), phase = str(plan['phase'], '');
  return insightFresh(data, at) &&
          plan['ready'] == true &&
          phase != 'all' &&
          phase != 'pending' &&
          watchPhases.containsKey(phase)
      ? phase
      : 'pending';
}

double? watchTrendScore(Json? data, [DateTime? at]) {
  final trend = obj(data?['trend']), score = numOf(trend['score']);
  return insightFresh(data, at) &&
          trend['current'] == true &&
          score != null &&
          score.isFinite
      ? score
      : null;
}

List<String> rankWatch(
  List<String> symbols,
  Map<String, Json> data, [
  DateTime? at,
]) {
  final order = {for (var i = 0; i < symbols.length; i++) symbols[i]: i};
  return [...symbols]..sort((a, b) {
    final result = (watchTrendScore(data[b], at) ?? -1).compareTo(
      watchTrendScore(data[a], at) ?? -1,
    );
    return result == 0 ? order[a]!.compareTo(order[b]!) : result;
  });
}

/// Survives list item disposal; refreshes never remove the previous result.
class WatchInsights extends ChangeNotifier {
  WatchInsights(this.api, {DateTime Function()? clock})
    : clock = clock ?? DateTime.now;
  final AtlasApi api;
  final DateTime Function() clock;
  final Map<String, Json> values = {};
  final Map<String, Future<Json>> _pending = {};
  bool _disposed = false;
  Future<Json> load(String symbol, {bool force = false}) async {
    final saved = values[symbol], now = clock();
    final until = DateTime.tryParse(str(saved?['expiresAt'], ''));
    if (!force && saved != null && until != null && until.isAfter(now)) {
      return saved;
    }
    if (_pending[symbol] case final task?) return task;
    final task = _fetch(symbol);
    _pending[symbol] = task;
    try {
      return await task;
    } finally {
      _pending.remove(symbol);
    }
  }

  Future<Json> _fetch(String symbol) async {
    final data = await api.get(
      '/api/desk/insight',
      parameters: {'symbol': symbol},
    );
    if (data['symbol'] != symbol) throw const FormatException('研判代码不匹配');
    if (_disposed) return data;
    if (values.length >= 120 && !values.containsKey(symbol)) {
      values.remove(values.keys.first);
    }
    values[symbol] = data;
    notifyListeners();
    return data;
  }

  Future<void> loadMany(List<String> symbols, {bool force = false}) async {
    var index = 0;
    await Future.wait(
      List.generate(symbols.length.clamp(0, 3), (_) async {
        while (!_disposed && index < symbols.length) {
          final symbol = symbols[index++];
          try {
            await load(symbol, force: force);
          } catch (_) {
            /* Keep the previous snapshot. */
          }
        }
      }),
    );
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
