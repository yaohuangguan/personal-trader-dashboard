import 'api.dart';

const extendedLabels = {'pre': '盘前', 'post': '盘后', 'overnight': '夜盘 24h'};
bool usStock(String symbol) =>
    RegExp(r'^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$').hasMatch(symbol);

/// Completed snapshots survive list recycling. A failed refresh retains its timestamp.
class ExtendedQuotes {
  ExtendedQuotes(this.api, {DateTime Function()? clock})
    : clock = clock ?? DateTime.now;
  final AtlasApi api;
  final DateTime Function() clock;
  final values = <String, Json>{};
  final _readAt = <String, DateTime>{};
  final _pending = <String, Future<Json>>{};

  Future<Json> load(String symbol) async {
    final readAt = _readAt[symbol];
    if (readAt != null && clock().difference(readAt).inSeconds < 60) {
      return values[symbol]!;
    }
    if (_pending[symbol] case final task?) return task;
    final task = api.get(
      '/api/desk/extended-quote',
      parameters: {'symbol': symbol},
    );
    _pending[symbol] = task;
    try {
      final data = await task;
      values[symbol] = data;
      _readAt[symbol] = clock();
      return data;
    } finally {
      _pending.remove(symbol);
    }
  }
}
