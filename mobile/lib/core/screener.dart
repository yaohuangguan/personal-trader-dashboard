import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'store.dart';

class ScreenerController extends ChangeNotifier {
  ScreenerController(this.store) {
    try {
      final raw = store.prefs.getString('scan-v2');
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
    await store.prefs.setString('scan-v2', jsonEncode(state));
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

  Future<void> start(
    String scope,
    bool excludeSt,
    bool minAmount, {
    Json? options,
  }) async {
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
      'minAmount': true,
      'options': options ?? {},
      'rejected': <String, dynamic>{},
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
          final pages = await Future.wait(
            List.generate(
              (numOf(state['total']) ?? 0) > 0
                  ? (((numOf(state['total']) ?? 0) / 80).ceil() - page + 1)
                        .clamp(1, 4)
                  : 1,
              (i) => store.api.get(
                '/api/desk/universe',
                parameters: {'page': '${page + i}'},
              ),
            ),
          );
          if (!active()) break;
          final all = Map<String, Json>.fromEntries(
            rows(state['universe']).map((r) => MapEntry(str(r['symbol']), r)),
          );
          for (final result in pages) {
            for (final r in rows(result['items'])) {
              all[str(r['symbol'])] = r;
            }
            state['total'] = result['total'];
            state['page'] = (numOf(result['page']) ?? page).toInt() + 1;
            if ((numOf(result['sourceRows']) ?? 0) <
                    (numOf(result['pageSize']) ?? 80) ||
                all.length >= (numOf(result['total']) ?? double.infinity)) {
              state['universeComplete'] = true;
              break;
            }
          }
          state['universe'] = all.values.toList();
          notifyListeners();
          await save();
          if (state['universeComplete'] == true) break;
          if (page >= 97) throw StateError('证券名单超过已验证范围');
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
        target = target.where((s) => (numOf(s['amount']) ?? 0) >= 2e8).toList();
        if (state['scope'] == 'quick') {
          target.sort((a, b) {
            final turn = (numOf(b['turnover']) ?? 0).compareTo(
              numOf(a['turnover']) ?? 0,
            );
            return turn != 0
                ? turn
                : (numOf(b['changePercent']) ?? 0).abs().compareTo(
                    (numOf(a['changePercent']) ?? 0).abs(),
                  );
          });
          target = target.take(200).toList();
        }
        state['targets'] = target;
      }
      state['phase'] = 'scanning';
      var consecutive = 0;
      final targets = rows(state['targets']);
      for (
        var i = (numOf(state['cursor']) ?? 0).toInt();
        i < targets.length && active();
        i += 4
      ) {
        final batch = targets.skip(i).take(4).toList(),
            options = obj(state['options']);
        try {
          final result = await store.api.get(
            '/api/desk/screen-batch',
            parameters: {
              'symbols': batch.map((s) => str(s['symbol'])).join(','),
              ...options.map((k, v) => MapEntry(k, '$v')),
            },
          );
          if (!active()) break;
          for (final item in rows(result['items'])) {
            if (item['unverified'] == true) {
              state['failed'] = [
                ...rows(state['failed']),
                {'symbol': item['symbol'], 'reason': item['reason']},
              ];
              consecutive++;
              continue;
            }
            consecutive = 0;
            final candidate = obj(item['candidate']);
            if (candidate.isNotEmpty) {
              state['candidates'] = [
                ...candidates.where((c) => c['symbol'] != candidate['symbol']),
                candidate,
              ];
            } else {
              final reason = str(item['reason']),
                  counts = obj(state['rejected']);
              counts[reason] = (numOf(counts[reason]) ?? 0) + 1;
              state['rejected'] = counts;
            }
          }
        } catch (e) {
          if (!active()) break;
          state['failed'] = [
            ...rows(state['failed']),
            ...batch.map(
              (s) => {'symbol': s['symbol'], 'reason': e.toString()},
            ),
          ];
          consecutive += batch.length;
        }
        state['cursor'] = i + batch.length;
        state['updatedAt'] = DateTime.now().toIso8601String();
        notifyListeners();
        await save();
        if (consecutive >= 5) {
          state['message'] = '来源连续失败，已暂停并保留进度。';
          await pause();
          return;
        }
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
