import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'store.dart';

class ScreenerController extends ChangeNotifier {
  ScreenerController(this.store) {
    try {
      final raw = store.prefs.getString('scan');
      if (raw != null) {
        state = obj(jsonDecode(raw));
        if (['universe', 'scanning'].contains(state['phase'])) {
          state['phase'] = 'paused';
        }
      }
    } catch (_) {}
  }
  final AtlasStore store;
  Json state = {
    'phase': 'idle',
    'cursor': 0,
    'universe': <Json>[],
    'targets': <Json>[],
    'candidates': <Json>[],
    'failed': <Json>[],
    'page': 1,
    'total': 0,
    'universeComplete': false,
    'scope': 'quick',
    'insufficient': 0,
  };
  Future<void>? _inFlight;
  bool running = false;
  int generation = 0;
  List<Json> get candidates => rows(state['candidates']);
  Future<void> save() async {
    await store.prefs.setString('scan', jsonEncode(state));
  }

  Future<void> pause() async {
    generation++;
    running = false;
    if (['universe', 'scanning'].contains(state['phase'])) {
      state['phase'] = 'paused';
    }
    await save();
    notifyListeners();
  }

  Future<void> start(String scope, bool excludeSt, bool minAmount) async {
    await pause();
    await _inFlight;
    if (_disposed) return;
    state = {
      'phase': 'idle',
      'cursor': 0,
      'universe': <Json>[],
      'targets': <Json>[],
      'candidates': <Json>[],
      'failed': <Json>[],
      'page': 1,
      'total': 0,
      'universeComplete': scope == 'watchlist',
      'scope': scope,
      'excludeST': excludeSt,
      'minAmount': minAmount,
      'insufficient': 0,
      'startedAt': DateTime.now().toIso8601String(),
    };
    if (scope == 'watchlist') {
      state['universe'] = store.watchlist
          .where(cnStock)
          .map(
            (s) => {
              'symbol': s,
              'name': store.quotes[s]?['name'] ?? s,
              'price': store.quotes[s]?['price'],
              'amount': store.quotes[s]?['amount'],
            },
          )
          .toList();
      state['total'] = rows(state['universe']).length;
    }
    await resume();
  }

  Future<void> resume() async {
    if (running) return;
    await _inFlight;
    if (_disposed || running) return;
    final done = Completer<void>();
    _inFlight = done.future;
    running = true;
    final id = ++generation;
    bool active() => id == generation && store.foreground;
    try {
      if (state['universeComplete'] != true) {
        state['phase'] = 'universe';
        notifyListeners();
        while (active()) {
          final page = (numOf(state['page']) ?? 1).toInt();
          final result = await store.api.get(
            '/api/desk/universe',
            parameters: {'page': '$page'},
          );
          if (!active()) break;
          final all = Map<String, Json>.fromEntries(
            [
              ...rows(state['universe']),
              ...rows(result['items']),
            ].map((r) => MapEntry(str(r['symbol']), r)),
          );
          state['universe'] = all.values.toList();
          state['total'] = result['total'];
          state['page'] = page + 1;
          if ((numOf(result['sourceRows']) ?? 0) <
              (numOf(result['pageSize']) ?? 80)) {
            state['universeComplete'] = true;
            break;
          }
          if (page >= 100) throw StateError('证券名单超过已验证范围');
          notifyListeners();
          if (page % 4 == 0) await save();
          await Future<void>.delayed(const Duration(milliseconds: 900));
        }
      }
      if (!active()) {
        if (id == generation) {
          state['phase'] = 'paused';
        }
        return;
      }
      if (rows(state['targets']).isEmpty &&
          (numOf(state['cursor']) ?? 0) == 0) {
        var target = rows(state['universe'])
            .where(
              (s) =>
                  state['excludeST'] != true ||
                  !RegExp(
                    r'ST|退',
                    caseSensitive: false,
                  ).hasMatch(str(s['name'])),
            )
            .toList();
        if (state['scope'] == 'quick') {
          target = target
              .where(
                (s) =>
                    state['minAmount'] != true ||
                    (numOf(s['amount']) ?? 0) >= 2e8,
              )
              .toList();
          final calm =
              target
                  .where((s) => (numOf(s['changePercent']) ?? 999).abs() <= 2)
                  .toList()
                ..sort(
                  (a, b) => (numOf(b['amount']) ?? 0).compareTo(
                    numOf(a['amount']) ?? 0,
                  ),
                );
          final first = calm.take(100).toList(),
              seen = first.map((r) => r['symbol']).toSet(),
              rest = target.where((r) => !seen.contains(r['symbol'])).toList()
                ..sort(
                  (a, b) => (numOf(b['changePercent']) ?? -999).compareTo(
                    numOf(a['changePercent']) ?? -999,
                  ),
                );
          target = [...first, ...rest.take(200 - first.length)];
        }
        state['targets'] = target;
      }
      state['phase'] = 'scanning';
      var consecutive = 0;
      final targets = rows(state['targets']);
      for (
        var i = (numOf(state['cursor']) ?? 0).toInt();
        i < targets.length && active();
        i++
      ) {
        final stock = targets[i];
        try {
          final result = await store.api.get(
            '/api/analysis',
            parameters: {'symbol': str(stock['symbol']), 'compact': '1'},
          );
          if (!active()) break;
          final market = obj(result['market']),
              date = DateTime.tryParse(str(market['asOf']));
          if (date == null ||
              DateTime.now().difference(date).inDays > 7 ||
              market['stale'] == true) {
            throw StateError('日线过期');
          }
          final candidate = obj(result['candidate']);
          if (candidate.isNotEmpty) {
            candidate['name'] = stock['name'];
            state['candidates'] = [
              ...candidates.where((c) => c['symbol'] != candidate['symbol']),
              candidate,
            ];
          }
          if (obj(result['guide'])['ready'] != true) {
            state['insufficient'] = (numOf(state['insufficient']) ?? 0) + 1;
          }
          consecutive = 0;
        } catch (e) {
          if (!active()) break;
          state['failed'] = [
            ...rows(state['failed']),
            {'symbol': stock['symbol'], 'reason': e.toString()},
          ];
          consecutive++;
        }
        state['cursor'] = i + 1;
        state['updatedAt'] = DateTime.now().toIso8601String();
        notifyListeners();
        if (i % 8 == 0) await save();
        if (consecutive >= 5) {
          state['message'] = '连续5只来源失败，已暂停；失败不代表没有形态。';
          await pause();
          return;
        }
        await Future<void>.delayed(const Duration(milliseconds: 900));
      }
      if (id == generation) state['phase'] = active() ? 'complete' : 'paused';
    } catch (e) {
      if (id == generation) {
        state['phase'] = 'paused';
        state['message'] = e.toString();
      }
    } finally {
      if (id == generation) {
        running = false;
        await save();
        notifyListeners();
      }
      done.complete();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    generation++;
    running = false;
    super.dispose();
  }

  bool _disposed = false;
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }
}
