import 'package:flutter/foundation.dart';

import 'api.dart';
import 'quote_book.dart';

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

/// Fresh for 90 s after it was received on this device (`receivedAt`, local
/// clock). Snapshots without a receive time fall back to `generatedAt`.
bool insightFresh(Json? data, [DateTime? at]) {
  final stamp = DateTime.tryParse(
    str(data?['receivedAt'] ?? data?['generatedAt'], ''),
  );
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
///
/// Expiry and freshness use the local receive time: the server's
/// `expiresAt - generatedAt` is a duration, so a fast or slow device clock
/// can neither defeat the cache nor mark every row "待更新".
class WatchInsights extends ChangeNotifier {
  WatchInsights(this.api, {DateTime Function()? clock})
    : clock = clock ?? DateTime.now;
  final AtlasApi api;
  final DateTime Function() clock;
  final Map<String, Json> values = {};
  final Map<String, Future<Json>> _pending = {};
  final _expires = <String, DateTime>{};
  final _rows = <String, ChangeNotifier>{};
  final _fresh = <String, bool>{};
  final _tracked = <String, int>{};
  bool _disposed = false;

  /// Fires only when this symbol's visible insight changed.
  Listenable listen(String symbol) =>
      _rows.putIfAbsent(symbol, ChangeNotifier.new);

  /// Symbols currently on screen; the store's scheduler refreshes these.
  Iterable<String> get tracked => _tracked.keys;
  void track(String symbol) =>
      _tracked.update(symbol, (n) => n + 1, ifAbsent: () => 1);
  void untrack(String symbol) {
    final n = (_tracked[symbol] ?? 0) - 1;
    if (n <= 0) {
      _tracked.remove(symbol);
    } else {
      _tracked[symbol] = n;
    }
  }

  Future<Json> load(String symbol, {bool force = false}) async {
    final saved = values[symbol], until = _expires[symbol];
    if (!force && saved != null && until != null && until.isAfter(clock())) {
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
    final received = clock();
    final generated = DateTime.tryParse(str(data['generatedAt'], '')),
        expires = DateTime.tryParse(str(data['expiresAt'], ''));
    var ttl = generated == null || expires == null
        ? const Duration(seconds: 20)
        : expires.difference(generated);
    if (ttl < const Duration(seconds: 5)) ttl = const Duration(seconds: 5);
    if (ttl > const Duration(minutes: 2)) ttl = const Duration(minutes: 2);
    _expires[symbol] = received.add(ttl);
    data['receivedAt'] = received.toIso8601String();
    if (values.length >= 120 && !values.containsKey(symbol)) {
      final oldest = values.keys.first;
      values.remove(oldest);
      _expires.remove(oldest);
    }
    final previous = values[symbol];
    values[symbol] = data;
    final fresh = insightFresh(data, received);
    if (!_sameContent(previous, data) || _fresh[symbol] != fresh) {
      _fresh[symbol] = fresh;
      _rows[symbol]?.notifyListeners();
      notifyListeners();
    }
    return data;
  }

  static bool _sameContent(Json? a, Json b) {
    if (a == null) return false;
    const volatile = {'generatedAt', 'expiresAt', 'receivedAt'};
    Json strip(Json v) => {
      for (final e in v.entries)
        if (!volatile.contains(e.key)) e.key: e.value,
    };
    return jsonEquals(strip(a), strip(b));
  }

  /// Rows turn "待更新" when their snapshot ages out even if no new data
  /// arrives (e.g. offline). Called by the scheduler on each tick.
  void checkFreshness() {
    final now = clock();
    var changed = false;
    for (final symbol in _rows.keys) {
      final data = values[symbol];
      if (data == null) continue;
      final fresh = insightFresh(data, now);
      if (_fresh[symbol] == fresh) continue;
      _fresh[symbol] = fresh;
      _rows[symbol]!.notifyListeners();
      changed = true;
    }
    if (changed) notifyListeners();
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
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final n in _rows.values) {
      n.dispose();
    }
    super.dispose();
  }
}
