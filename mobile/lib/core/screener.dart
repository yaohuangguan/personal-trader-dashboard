import 'multi_filters.dart';

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'store.dart';

class ScreenerController extends ChangeNotifier {
  ScreenerController(
    this.store, {
    this.saveEvery = const Duration(seconds: 15),
    this.pollEvery = const Duration(seconds: 2),
  }) {
    try {
      final raw = store.prefs.getString('scan-v2');
      if (raw != null) {
        _savedJson = raw;
        state = obj(jsonDecode(raw));
        if (['universe', 'scanning'].contains(state['phase'])) {
          state['phase'] = 'paused';
        }
      }
    } catch (_) {}
    store.foregroundListenable.addListener(_lifecycle);
  }
  final AtlasStore store;

  /// Scan state is persisted at most this often (and when a run stops).
  final Duration saveEvery;
  final Duration pollEvery;
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

  /// Bumped on every notification; views memoize derived lists on it.
  int revision = 0;
  bool _pausedByBackground = false;

  Object? _candidateSource;
  List<Json> _candidates = const [];
  List<Json> get candidates {
    final raw = state['candidates'];
    if (!identical(raw, _candidateSource)) {
      _candidateSource = raw;
      _candidates = rows(raw);
    }
    return _candidates;
  }

  String? _savedJson;
  DateTime _savedAt = DateTime.fromMillisecondsSinceEpoch(0);
  Timer? _saveTimer;

  /// Throttled and diffed: during a scan the state changes every couple of
  /// seconds, but it is encoded and written at most every [saveEvery], and
  /// never when nothing changed. [now] flushes immediately.
  Future<void> save({bool now = false}) async {
    final elapsed = DateTime.now().difference(_savedAt);
    if (!now && elapsed < saveEvery) {
      _saveTimer ??= Timer(saveEvery - elapsed, () {
        _saveTimer = null;
        save(now: true);
      });
      return;
    }
    _saveTimer?.cancel();
    _saveTimer = null;
    final text = jsonEncode(state);
    _savedAt = DateTime.now();
    if (text == _savedJson) return;
    _savedJson = text;
    await store.prefs.setString('scan-v2', text);
  }

  void _lifecycle() {
    if (_disposed) return;
    if (!store.foreground) {
      if (running) _pausedByBackground = true;
      save(now: true);
      return;
    }
    if (_pausedByBackground) {
      _pausedByBackground = false;
      resume();
    }
  }

  Future<void> pause() async {
    generation++;
    running = false;
    _pausedByBackground = false;
    if (['universe', 'scanning'].contains(state['phase'])) {
      state['phase'] = 'paused';
    }
    await save(now: true);
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
    await resume(startNew: true);
  }

  /// Continues the current run. A server job that is still running is
  /// reconnected by id (GET); only a new or server-paused job is POSTed.
  Future<void> resume({bool startNew = false}) async {
    if (running) return;
    await _inFlight;
    if (_disposed || running) return;
    final done = Completer<void>();
    _inFlight = done.future;
    running = true;
    final id = ++generation;
    bool active() => id == generation && store.foreground;
    void halt() {
      if (id != generation) return;
      state['phase'] = 'paused';
      if (!store.foreground) _pausedByBackground = true;
    }

    try {
      if (state['scope'] != 'watchlist') {
        final job = obj(state['serverJob']);
        final live =
            !startNew &&
            job['id'] != null &&
            !['complete', 'paused'].contains(job['phase']);
        await shared(id, reconnect: live);
        return;
      }
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
        halt();
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
              (s) => {'symbol': s['symbol'], 'reason': describeError(e)},
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
      if (id == generation) {
        if (active()) {
          state['phase'] = 'complete';
        } else {
          halt();
        }
      }
    } catch (e) {
      if (id == generation) {
        state['phase'] = 'paused';
        state['message'] = describeError(e);
      }
    } finally {
      if (id == generation) {
        running = false;
        await save(now: true);
        notifyListeners();
      }
      done.complete();
    }
  }

  /// Reads the shared job without starting one (signed-out users can still
  /// follow the closing report and a running server job).
  Future<void> connectShared() async {
    if (running || _disposed) return;
    try {
      final result = await store.api.get('/api/desk/screen-job');
      if (_disposed || running || obj(result['job']).isEmpty) return;
      state['scope'] = 'all';
      state['options'] = {
        'strategy': 'auto',
        'modes': 'bloom,bullish,multi,strongmulti,beauty,spider,cannon,limitup',
        'concentration': '20',
        'maxCap': '',
        'activity': '0',
      };
      running = true;
      final id = ++generation;
      try {
        await shared(id, initial: result);
      } finally {
        if (!_disposed && generation == id) {
          running = false;
          await save(now: true);
          notifyListeners();
        }
      }
    } catch (_) {
      /* Existing report stays available; reading does not start a job. */
    }
  }

  Future<void> retryShared() async {
    if (running) return;
    await _inFlight;
    if (_disposed) return;
    running = true;
    final id = ++generation;
    notifyListeners();
    try {
      await shared(id, retry: true);
    } finally {
      if (!_disposed && generation == id) {
        running = false;
        await save(now: true);
        notifyListeners();
      }
    }
  }

  /// Whether the server answers `since=` (it echoes `since`). Unknown until
  /// the first poll; older servers ignore it and need `count` instead.
  bool? _sinceSupported;

  /// Polls job progress. Current servers get `since=n` and return only the
  /// candidates discovered after index n; older servers get `count`, which
  /// suppresses an unchanged list.
  Future<Json> _status(Json job) async {
    final since = rows(state['sharedCandidates']).length;
    final sameJob = job['id'] != null;
    final result = await store.api.get(
      '/api/desk/screen-job',
      parameters: {
        'id': str(job['id']),
        if (_sinceSupported != false && sameJob) 'since': '$since',
        if (_sinceSupported == false) 'count': str(job['candidateCount'], '-1'),
      },
      timeout: const Duration(seconds: 10),
    );
    if (result.containsKey('candidates')) {
      _sinceSupported = result.containsKey('since');
    }
    return result;
  }

  Json sharedJob = {};
  Future<void> shared(
    int id, {
    bool retry = false,
    Json? initial,
    bool reconnect = false,
  }) async {
    var failures = 0;
    void halt([String? message]) {
      if (_disposed || generation != id) return;
      state['phase'] = 'paused';
      if (message != null) state['message'] = message;
      if (!store.foreground) _pausedByBackground = true;
    }

    Json response;
    var since = 0;
    try {
      if (initial != null) {
        response = initial;
      } else if (reconnect) {
        since = rows(state['sharedCandidates']).length;
        response = await _status(obj(state['serverJob']));
      } else {
        // Starting a full-market job requires a signed-in account; retrying
        // an existing job's unfinished symbols does not.
        final token = store.accountToken;
        response = await store.api.post('/api/desk/screen-job', {
          'retry': retry,
        }, token: token.isEmpty ? null : token);
      }
    } on ApiException catch (e) {
      if (e.status == 401 || e.code == 'AUTH_REQUIRED') {
        state['authRequired'] = true;
        halt('登录后可发起全市场扫描');
      } else if (e.status == 429 || e.code == 'RATE_LIMITED') {
        halt(describeError(e));
      } else {
        halt('无法连接服务端扫描任务，已有结果和进度已保留，请重试连接。');
      }
      return;
    } catch (_) {
      halt('无法连接服务端扫描任务，已有结果和进度已保留，请重试连接。');
      return;
    }
    state.remove('authRequired');
    while (!_disposed && generation == id && store.foreground) {
      final job = _applyShared(response, since);
      notifyListeners();
      await save();
      if (['complete', 'paused'].contains(job['phase'])) return;
      await Future<void>.delayed(pollEvery);
      if (_disposed || generation != id || !store.foreground) {
        halt();
        return;
      }
      try {
        since = rows(state['sharedCandidates']).length;
        response = await _status(job);
        failures = 0;
      } catch (_) {
        failures++;
        since = 0;
        state['message'] = '进度连接暂时中断，服务端仍在继续；正在重新连接。';
        notifyListeners();
        if (failures >= 3) {
          halt('进度连接暂不可用，服务端任务继续。点击继续即可重新连接，不会重新扫全市场。');
          return;
        }
      }
    }
    halt();
  }

  Json _applyShared(Json response, int since) {
    final job = obj(response['job']);
    final sameJob = obj(state['serverJob'])['id'] == job['id'];
    sharedJob = job;
    state['serverJob'] = job;
    if (response['previousReport'] != null) {
      state['previousReport'] = response['previousReport'];
    }
    if (response.containsKey('candidates')) {
      final next = rows(response['candidates']);
      final total = numOf(job['candidateCount'])?.toInt();
      // New servers answer `since=n` with candidates from index n; old ones
      // resend the whole list.
      final from =
          numOf(response['since'])?.toInt() ??
          (since > 0 && total != null && next.length + since == total
              ? since
              : 0);
      final merged = from > 0 && sameJob
          ? [...rows(state['sharedCandidates']).take(from), ...next]
          : next;
      state['sharedCandidates'] = merged;
      state['candidates'] = merged;
    }
    final options = obj(state['options']), auto = options['strategy'] == 'auto';
    state['candidates'] = rows(state['candidates']).where((c) {
      final chip = obj(c['chip']), char = obj(c['character']);
      final modes = str(options['modes'], 'bloom').split(',');
      return (!rows(c['patterns'])
                  .any((p) => ['multi', 'strongmulti'].contains(p['mode'])) ||
              obj(c['multiLine'])['version'] == 2) &&
          (numOf(c['amount']) ?? 0) >= 2e8 &&
          (numOf(chip['concentration90']) ?? 99) <
              (numOf(options['concentration']) ?? 20) &&
          (options['maxCap'] == '' ||
              (numOf(c['marketCap']) ?? double.infinity) <=
                  (numOf(options['maxCap']) ?? 1000) * 1e8) &&
          (options['activity'] == '0' ||
              char['quiet'] == false && char['weakFollow'] == false) &&
          (options['recentLimitUp'] != '1' ||
              ((c['limitUpDates'] as List?) ?? []).isNotEmpty) &&
          (auto ||
              rows(c['patterns']).any(
                (p) =>
                    modes.contains(p['mode']) &&
                    (!['multi', 'strongmulti'].contains(p['mode']) ||
                        passesMultiEvidence(
                          obj(c['multiLine']),
                          str(p['mode']),
                          options,
                        )) &&
                    (numOf(chip['concentration90']) ?? 99) <
                        (['multi', 'strongmulti'].contains(p['mode'])
                            ? 15
                            : 20),
              ));
    }).toList();
    state['phase'] = job['phase'] == 'screening'
        ? 'scanning'
        : job['phase'] == 'quotes'
        ? 'universe'
        : job['phase'];
    state['cursor'] = job['cursor'] ?? 0;
    state['total'] = job['total'] ?? 0;
    state['message'] = job['message'];
    state['rejected'] = obj(job['rejected']);
    state['failed'] = rows(job['failureSample']);
    return job;
  }

  @override
  void dispose() {
    _disposed = true;
    generation++;
    running = false;
    store.foregroundListenable.removeListener(_lifecycle);
    if (_saveTimer != null) save(now: true);
    _saveTimer?.cancel();
    super.dispose();
  }

  bool _disposed = false;
  @override
  void notifyListeners() {
    if (_disposed) return;
    revision++;
    super.notifyListeners();
  }
}
