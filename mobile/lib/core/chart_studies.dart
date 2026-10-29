import 'dart:convert';
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

/// Public OHLCV stays online; the bundled identical rules run off the UI thread on iOS.
class ChartStudies {
  ChartStudies(
    this.api,
    this.prefs, {
    Future<Json> Function(Json)? runner,
    bool? local,
  }) : _runner = runner,
       isLocal =
           local ??
           (runner != null ||
               !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS);
  final AtlasApi api;
  final SharedPreferences prefs;
  final bool isLocal;
  final Future<Json> Function(Json)? _runner;
  static const channel = MethodChannel('space.ps6.marketAtlas/study');
  Future<String>? _source;
  bool _ready = false;
  final _pending = <String, Future<Json>>{}, _results = <String, String>{};
  final _frames = <String, Json>{};
  Future<Json> compute(Json input) async {
    final cn = DateTime.now().toUtc().add(const Duration(hours: 8));
    final key =
        '${jsonEncode(input)}:${cn.toIso8601String().substring(0, 10)}:${cn.hour < 15}';
    final cached = _results[key];
    if (cached != null) return obj(jsonDecode(cached));
    final pending = _pending[key];
    if (pending != null) return pending;
    Future<Json> run() async {
      Json result;
      if (_runner != null) {
        result = await _runner(input);
      } else if (isLocal) {
        final raw = await channel
            .invokeMethod<String>('compute', {
              'payload': jsonEncode(input),
              if (!_ready)
                'source': await (_source ??= rootBundle.loadString(
                  'assets/chart_engine.js',
                )),
            })
            .timeout(
              const Duration(seconds: 15),
              onTimeout: () => throw TimeoutException('本机分析超时，请重试'),
            );
        if (raw == null) throw const FormatException('本机分析未返回结果');
        result = obj(jsonDecode(raw));
        _ready = true;
      } else {
        result = await api.post('/api/chart-study', input);
      }
      if (_results.length >= 8) _results.remove(_results.keys.first);
      _results[key] = jsonEncode(result);
      return result;
    }

    final task = run();
    _pending[key] = task;
    try {
      return await task;
    } finally {
      _pending.remove(key);
    }
  }

  Future<Json> pair(Json frame, List<int> ma, {Json? context}) async {
    final market = obj(frame['market']),
        candles = rows(market['candles']),
        quote = obj(frame['quote']);
    if (candles.isEmpty) throw const FormatException('行情快照缺少K线');
    final study = await compute({
      'symbol': market['symbol'],
      'name': market['name'],
      'unit': 'day',
      'ma': ma,
      'amount': str(quote['asOf'], '').split('T').first == candles.last['time']
          ? quote['amount']
          : null,
      'candles': candles,
      'market': market,
      if (quote.isNotEmpty) 'quote': quote,
      'context': ?context,
    });
    return {...frame, 'study': study};
  }

  Future<Json?> cachedFrame(String symbol, List<int> ma) async {
    try {
      final cached =
          _frames[symbol] ??
          obj(jsonDecode(prefs.getString('chart.frame.v2:$symbol') ?? '{}'));
      if (cached.isEmpty ||
          DateTime.now().millisecondsSinceEpoch -
                  (numOf(cached['savedAt']) ?? 0) >
              7 * 86400000) {
        return null;
      }
      final frame = obj(jsonDecode(jsonEncode(cached))),
          market = obj(frame['market']);
      if (market['symbol'] != symbol || rows(market['candles']).isEmpty) {
        return null;
      }
      frame['cached'] = true;
      market['stale'] = true;
      frame['market'] = market;
      if (frame['quote'] is Map) {
        frame['quote'] = {...obj(frame['quote']), 'stale': true};
      }
      return await pair(frame, ma);
    } catch (_) {
      return null;
    }
  }

  Future<Json> loadFrame(String symbol, List<int> ma) async {
    final frame = await api.get(
      '/api/chart-frame',
      parameters: {'symbol': symbol},
    );
    if (obj(frame['market'])['symbol'] != symbol ||
        rows(obj(frame['market'])['candles']).isEmpty) {
      throw const FormatException('行情快照不完整');
    }
    final paired = await pair(frame, ma);
    final saved = {...frame, 'savedAt': DateTime.now().millisecondsSinceEpoch};
    _frames[symbol] = saved;
    try {
      final order =
          (prefs.getStringList('chart.frame.index.v2') ?? [])
              .where((s) => s != symbol)
              .toList()
            ..add(symbol);
      while (order.length > 8) {
        final old = order.removeAt(0);
        _frames.remove(old);
        await prefs.remove('chart.frame.v2:$old');
      }
      await prefs.setStringList('chart.frame.index.v2', order);
      await prefs.setString('chart.frame.v2:$symbol', jsonEncode(saved));
    } catch (_) {
      /* Device persistence must not discard a valid newly computed frame. */
    }
    return paired;
  }
}
