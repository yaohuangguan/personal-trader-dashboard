import 'package:flutter/foundation.dart';

import 'api.dart';

/// Deep equality for decoded JSON values.
bool jsonEquals(Object? a, Object? b) {
  if (identical(a, b)) return true;
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final entry in a.entries) {
      if (!b.containsKey(entry.key) || !jsonEquals(entry.value, b[entry.key])) {
        return false;
      }
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!jsonEquals(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
}

/// Latest polled quotes. Listeners of the book hear about any real change;
/// [listen] gives one row a listenable that fires only for its own symbol.
class QuoteBook extends ChangeNotifier {
  final values = <String, Json>{};
  final _symbols = <String, ValueNotifier<Json?>>{};
  String? error;
  DateTime? readAt;
  bool _disposed = false;

  /// Fires only when the poll error appears, changes or clears.
  final errors = ValueNotifier<String?>(null);

  ValueListenable<Json?> listen(String symbol) =>
      _symbols.putIfAbsent(symbol, () => ValueNotifier(values[symbol]));

  /// Stores a poll result; returns whether anything visible changed.
  bool apply(Iterable<Json> items, DateTime at) {
    var changed = error != null;
    error = null;
    if (!_disposed) errors.value = null;
    readAt = at;
    for (final q in items) {
      final symbol = str(q['symbol'], '');
      if (symbol.isEmpty || jsonEquals(values[symbol], q)) continue;
      values[symbol] = q;
      _symbols[symbol]?.value = q;
      changed = true;
    }
    if (changed && !_disposed) notifyListeners();
    return changed;
  }

  void fail(String message) {
    if (error == message || _disposed) return;
    error = message;
    errors.value = message;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final n in _symbols.values) {
      n.dispose();
    }
    errors.dispose();
    super.dispose();
  }
}
