import 'ui_translation.dart';
import 'extended_quotes.dart';

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'chart_studies.dart';
import 'credentials.dart';
import 'market_hours.dart';
import 'quote_book.dart';
import 'watch_transfer.dart';
import 'watch_insights.dart';
part 'watch_cloud.dart';

class Pulse extends ChangeNotifier {
  void notify() => notifyListeners();
}

/// App-wide state. Listeners of the store itself hear only about settings,
/// the watchlist/groups, bookmarks, alerts, sync status and the catalog.
/// Quotes ([quoteBook]) and watch insights ([watchInsights]) have their own
/// notifiers, so a 5 s quote poll never rebuilds the whole tree.
class AtlasStore extends ChangeNotifier with WidgetsBindingObserver {
  AtlasStore(
    this.api,
    this.prefs,
    this.english, {
    CredentialStore? credentials,
    DateTime Function()? clock,
  }) : credentials = credentials ?? CredentialStore(),
       clock = clock ?? DateTime.now {
    this.credentials.migrate(prefs);
    final saved = prefs.getStringList('watchlist');
    if (saved == null) {
      // A fresh install shows demo stocks. They are marked so that the first
      // connection to an account that already has a list does not add them.
      watchlist = List.of(seedWatchlist);
      prefs.setStringList(seedKey, seedWatchlist);
    } else {
      watchlist = saved;
    }
    groups = rows(_decode(prefs.getString('watchGroups')));
    themeMode = _themeOf(prefs.getString('themeMode'));
    locale = prefs.getString('locale') ?? 'zh-CN';
    fontSize = prefs.getDouble('fontSize') ?? 18;
    bookmarks = rows(_decode(prefs.getString('bookmarks')));
    alerts = rows(_decode(prefs.getString('alerts')));
    deviceToken = this.credentials.read(CredentialStore.deviceToken);
    if (deviceToken.isEmpty) {
      deviceToken = List.generate(
        32,
        (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'),
      ).join();
      this.credentials.write(CredentialStore.deviceToken, deviceToken);
    }
    WidgetsBinding.instance.addObserver(this);
  }
  static const seedWatchlist = ['300545.SZ', '300308.SZ', '300502.SZ'];
  static const seedKey = 'watchSeed';
  static const syncEvery = Duration(seconds: 30);
  final AtlasApi api;
  final DateTime Function() clock;

  /// Keychain-backed secrets: account session, sync key, device capability.
  final CredentialStore credentials;
  late final chartStudies = ChartStudies(api, prefs);
  late final watchInsights = WatchInsights(api, clock: clock);
  late final extendedQuotes = ExtendedQuotes(api);
  final quoteBook = QuoteBook();
  final SharedPreferences prefs;
  final Map<String, dynamic> english;
  late List<String> watchlist;
  late String locale, themeMode;
  late double fontSize;
  late List<Json> bookmarks, alerts, groups;
  late String deviceToken;
  Map<String, Json> get quotes => quoteBook.values;
  String? get quoteError => quoteBook.error;
  DateTime? get quoteReadAt => quoteBook.readAt;
  Json catalog = {};

  final _foreground = ValueNotifier<bool>(true);

  /// False only while the app is hidden or in the background. `inactive`
  /// (Control Centre, an incoming-call banner) keeps the app foreground.
  bool get foreground => _foreground.value;
  set foreground(bool value) => _foreground.value = value;
  ValueListenable<bool> get foregroundListenable => _foreground;

  late final poller = PollScheduler(_tick, _nextDelay);
  bool _started = false;
  DateTime _nextQuotesAt = DateTime.fromMillisecondsSinceEpoch(0),
      _nextInsightsAt = DateTime.fromMillisecondsSinceEpoch(0),
      _catalogTriedAt = DateTime.fromMillisecondsSinceEpoch(0);
  int _quoteFailures = 0;
  Duration? _quoteRetryAfter;
  String? _cnHolidayDate;

  final chartRevision = ValueNotifier<int>(0);

  /// Sync progress ([syncBusy], [syncStatus]) without rebuilding the app.
  final syncChanges = Pulse();
  bool _running = false, syncBusy = false;
  String syncStatus = '未连接云同步';
  DateTime _lastSyncAt = DateTime.fromMillisecondsSinceEpoch(0);
  Timer? _syncDebounce;
  Future<void>? _syncTask;
  bool _syncAgain = false, _switching = false;
  final StreamController<String> messages = StreamController.broadcast();
  static dynamic _decode(String? s) {
    try {
      return s == null ? null : jsonDecode(s);
    } catch (_) {
      return null;
    }
  }

  static String _themeOf(String? value) =>
      value == 'light' || value == 'system' ? value! : 'dark';

  late final _translator = UITranslation(english);
  String t(String key) => locale == 'en' ? _translator(key) : key;
  static Future<AtlasStore> load({
    AtlasApi? api,
    SharedPreferences? prefs,
    CredentialStore? credentials,
  }) async {
    final data = jsonDecode(
      await rootBundle.loadString('assets/strings_en.json'),
    );
    final secrets = credentials ?? CredentialStore();
    await secrets.load();
    return AtlasStore(
      api ?? AtlasApi(),
      prefs ?? await SharedPreferences.getInstance(),
      Map<String, dynamic>.from(data),
      credentials: secrets,
    );
  }

  /// The watchlist plus every symbol with a pending price alert, so alerts on
  /// stocks outside the watchlist are evaluated too.
  List<String> get pollSymbols => <String>{
    ...watchlist.where(supportedStock),
    for (final rule in alerts)
      if (rule['firedAt'] == null && supportedStock(str(rule['symbol'], '')))
        str(rule['symbol']),
  }.toList();

  void start() {
    _started = true;
    if (foreground) poller.start();
  }

  Future<void> _tick() async {
    final now = clock();
    final jobs = <Future<void>>[];
    if (!now.isBefore(_nextQuotesAt)) jobs.add(refreshQuotes());
    if (cloudConnected && now.difference(_lastSyncAt) >= syncEvery) {
      jobs.add(syncCloud());
    }
    final visible = watchInsights.tracked.toList();
    if (visible.isNotEmpty && !now.isBefore(_nextInsightsAt)) {
      _nextInsightsAt = now.add(
        pollInterval(
              visible,
              now,
              open: const Duration(seconds: 10),
              extended: const Duration(seconds: 30),
              cnHoliday: _cnHolidayDate == beijingDate(now),
            ) ??
            const Duration(minutes: 5),
      );
      jobs.add(watchInsights.loadMany(visible));
    }
    watchInsights.checkFreshness();
    if (catalog.isEmpty &&
        now.difference(_catalogTriedAt) >= const Duration(seconds: 30)) {
      jobs.add(loadCatalog());
    }
    await Future.wait(jobs);
  }

  Duration? _nextDelay() {
    final now = clock();
    final waits = [
      _nextQuotesAt.difference(now),
      if (cloudConnected) _lastSyncAt.add(syncEvery).difference(now),
      if (watchInsights.tracked.isNotEmpty) ...[
        _nextInsightsAt.difference(now),
        const Duration(seconds: 30), // freshness labels age out
      ],
      if (catalog.isEmpty)
        _catalogTriedAt.add(const Duration(seconds: 30)).difference(now),
    ];
    var wait = waits.reduce((a, b) => a < b ? a : b);
    if (wait < const Duration(milliseconds: 500)) {
      wait = const Duration(milliseconds: 500);
    }
    return wait;
  }

  /// Session-aware cadence: 5 s while a watched market trades, 15 s in US
  /// extended hours, at most 5 min (never past the next open) otherwise;
  /// failures back off and honour Retry-After.
  Duration _quoteInterval() {
    final now = clock();
    var wait =
        pollInterval(
          pollSymbols,
          now,
          cnHoliday: _cnHolidayDate == beijingDate(now),
        ) ??
        const Duration(minutes: 5);
    if (_quoteFailures > 0) {
      final backoff = Duration(seconds: 5 * (1 << _quoteFailures.clamp(0, 4)));
      if (backoff > wait) wait = backoff;
    }
    final retry = _quoteRetryAfter;
    if (retry != null && retry > wait) wait = retry;
    return wait;
  }

  Future<void> loadCatalog() async {
    _catalogTriedAt = clock();
    try {
      final data = await api.get('/api/catalog');
      if (_disposed) return;
      catalog = data;
      notifyListeners();
    } catch (_) {
      /* Retried by the scheduler and on resume. */
    }
  }

  Future<void> refreshQuotes() async {
    if (_running) return;
    final symbols = pollSymbols;
    if (symbols.isEmpty) {
      _nextQuotesAt = clock().add(const Duration(minutes: 5));
      return;
    }
    _running = true;
    try {
      final data = await api.get(
        '/api/desk/quotes',
        parameters: {'symbols': symbols.join(',')},
      );
      if (_disposed) return;
      final items = rows(data['items']);
      quoteBook.apply(items, clock());
      _quoteFailures = 0;
      _quoteRetryAfter = null;
      _detectHoliday(items);
      _evaluateAlerts();
    } catch (e) {
      _quoteFailures++;
      _quoteRetryAfter = e is ApiException ? e.retryAfter : null;
      quoteBook.fail(describeError(e));
    } finally {
      _running = false;
      _nextQuotesAt = clock().add(_quoteInterval());
    }
  }

  /// A weekday without any A-share print today is an exchange holiday.
  void _detectHoliday(List<Json> items) {
    final now = clock(), today = beijingDate(now);
    final local = now.toUtc().add(const Duration(hours: 8));
    if (cnPhase(now) != MarketPhase.open ||
        local.hour * 60 + local.minute < 9 * 60 + 35) {
      return;
    }
    final cn = items.where((q) => cnStock(str(q['symbol'], ''))).toList();
    if (cn.isEmpty) return;
    final idle = cn.every(
      (q) =>
          q['session'] != 'trading' &&
          str(q['asOf'], '').length >= 10 &&
          str(q['asOf']).substring(0, 10).compareTo(today) < 0,
    );
    _cnHolidayDate = idle ? today : null;
  }

  void _evaluateAlerts() {
    var changed = false;
    for (final rule in alerts) {
      if (rule['firedAt'] != null) continue;
      final q = quotes[rule['symbol']];
      if (q == null || q['stale'] == true || q['session'] != 'trading') {
        continue;
      }
      final timestamp = DateTime.tryParse(str(q['asOf']));
      if (timestamp == null ||
          clock().difference(timestamp).inSeconds.abs() > 120) {
        continue;
      }
      final price = numOf(q['price']), target = numOf(rule['value']);
      if (price == null || target == null) continue;
      if (rule['direction'] == 'above' ? price >= target : price <= target) {
        rule['firedAt'] = clock().toIso8601String();
        if (!_disposed) messages.add('${rule['symbol']} ${t('价格提醒')} $price');
        changed = true;
      }
    }
    if (changed) {
      prefs.setString('alerts', jsonEncode(alerts));
      notifyListeners();
    }
  }

  /// Seed stocks a fresh install shows that the user never changed.
  bool get untouchedSeed {
    final seed = prefs.getStringList(seedKey);
    return seed != null &&
        groups.isEmpty &&
        seed.length == watchlist.length &&
        seed.every(watchlist.contains);
  }

  /// Every user edit of the watchlist or groups: the seed is no longer
  /// untouched, cloud sync is scheduled and new symbols are polled.
  void _watchEdited({
    bool symbolsChanged = true,
    Duration syncDelay = const Duration(milliseconds: 900),
  }) {
    prefs.remove(seedKey);
    notifyListeners();
    if (cloudConnected) {
      _syncDebounce?.cancel();
      _syncDebounce = Timer(syncDelay, syncCloud);
    }
    if (symbolsChanged) refreshQuotes();
  }

  Future<void> _saveWatch() async {
    await prefs.setStringList('watchlist', watchlist);
    await prefs.setString('watchGroups', jsonEncode(groups));
  }

  Future<void> toggleWatch(String symbol) async {
    symbol = normalize(symbol);
    if (watchlist.contains(symbol)) {
      watchlist.remove(symbol);
      for (final g in groups) {
        (g['symbols'] as List?)?.remove(symbol);
      }
    } else {
      watchlist.add(symbol);
    }
    await _saveWatch();
    _watchEdited();
  }

  /// Removes a stock from the watchlist and every group. The cloud upload
  /// waits until the undo snack bar has gone, so an undo never round-trips.
  Future<void> removeWatch(String symbol) async {
    symbol = normalize(symbol);
    if (!watchlist.remove(symbol)) return;
    for (final g in groups) {
      (g['symbols'] as List?)?.remove(symbol);
    }
    await _saveWatch();
    _watchEdited(symbolsChanged: false, syncDelay: const Duration(seconds: 6));
  }

  /// Snapshot for undoing a removal: position and group memberships.
  ({String symbol, int index, List<String> groupIds}) removalOf(
    String symbol,
  ) => (
    symbol: symbol,
    index: watchlist.indexOf(symbol),
    groupIds: [
      for (final g in groups)
        if ((g['symbols'] as List?)?.contains(symbol) == true) str(g['id']),
    ],
  );

  Future<void> restoreWatch(
    ({String symbol, int index, List<String> groupIds}) removed,
  ) async {
    if (!watchlist.contains(removed.symbol)) {
      watchlist.insert(
        removed.index.clamp(0, watchlist.length),
        removed.symbol,
      );
    }
    for (final g in groups) {
      final members = List<String>.from(g['symbols'] ?? []);
      if (removed.groupIds.contains(g['id']) &&
          !members.contains(removed.symbol)) {
        g['symbols'] = [...members, removed.symbol];
      }
    }
    await _saveWatch();
    _watchEdited();
  }

  Future<String?> saveGroup(String name, {String? id}) async {
    name = name.trim();
    if (name.isEmpty || name.length > 24) {
      throw const FormatException('分组名称需要1–24个字');
    }
    if (groups.any((g) => g['name'] == name && g['id'] != id)) {
      throw const FormatException('分组名称已存在');
    }
    if (id == null) {
      if (groups.length >= 20) throw const FormatException('最多创建20个分组');
      id =
          '${DateTime.now().microsecondsSinceEpoch}_${Random.secure().nextInt(0x7fffffff)}';
      groups.add({'id': id, 'name': name, 'symbols': <String>[]});
    } else {
      groups.firstWhere((g) => g['id'] == id)['name'] = name;
    }
    await prefs.setString('watchGroups', jsonEncode(groups));
    _watchEdited(symbolsChanged: false);
    return id;
  }

  Future<void> deleteGroup(String id) async {
    groups.removeWhere((g) => g['id'] == id);
    await prefs.setString('watchGroups', jsonEncode(groups));
    _watchEdited(symbolsChanged: false);
  }

  Future<void> groupStock(String id, String symbol, bool included) async {
    final group = groups.firstWhere((g) => g['id'] == id),
        symbols = List<String>.from(group['symbols'] ?? []);
    symbols.remove(symbol);
    var added = false;
    if (included) {
      symbols.add(symbol);
      if (!watchlist.contains(symbol)) {
        watchlist.add(symbol);
        added = true;
      }
    }
    group['symbols'] = symbols;
    await _saveWatch();
    _watchEdited(symbolsChanged: added);
  }

  Future<void> reorderWatch(int oldIndex, int newIndex) async {
    if (newIndex > oldIndex) newIndex--;
    final s = watchlist.removeAt(oldIndex);
    watchlist.insert(newIndex, s);
    await prefs.setStringList('watchlist', watchlist);
    _watchEdited(symbolsChanged: false);
  }

  Map<String, String> get chartMAParameters {
    try {
      final lines = rows(_decode(prefs.getString('ma')));
      return lines.isEmpty
          ? {}
          : {
              'ma': lines
                  .where((m) => m['enabled'] != false)
                  .map((m) => '${m['period']}')
                  .join(','),
            };
    } catch (_) {
      return {};
    }
  }

  List<int> get chartMAPeriods =>
      (chartMAParameters['ma'] ?? '5,13,20,30,60,120,144,250')
          .split(',')
          .where((p) => p.isNotEmpty)
          .map(int.parse)
          .toList();

  /// 'dark', 'light' or 'system' (follow the iOS appearance).
  Future<void> setTheme(String value) async {
    themeMode = _themeOf(value);
    await prefs.setString('themeMode', themeMode);
    notifyListeners();
  }

  Future<void> setLocale(String value) async {
    locale = value;
    await prefs.setString('locale', value);
    notifyListeners();
  }

  Future<void> setFont(double value) async {
    fontSize = value;
    await prefs.setDouble('fontSize', value);
    notifyListeners();
  }

  bool saved(Json item) => bookmarks.any((r) => r['url'] == item['url']);
  Future<void> toggleSaved(Json item) async {
    if (saved(item)) {
      bookmarks.removeWhere((r) => r['url'] == item['url']);
    } else {
      bookmarks.insert(0, item);
    }
    await prefs.setString(
      'bookmarks',
      jsonEncode(bookmarks.take(200).toList()),
    );
    notifyListeners();
  }

  Future<void> addAlert(String symbol, double value, String direction) async {
    alerts.add({
      'id': DateTime.now().microsecondsSinceEpoch.toString(),
      'symbol': symbol,
      'value': value,
      'direction': direction,
    });
    await prefs.setString('alerts', jsonEncode(alerts));
    notifyListeners();
    // The alert's symbol joins the quote poll right away.
    refreshQuotes();
  }

  Future<void> removeAlert(Json rule) async {
    alerts.removeWhere((r) => r['id'] == rule['id']);
    await prefs.setString('alerts', jsonEncode(alerts));
    notifyListeners();
  }

  bool _watchImporting = false;
  Future<WatchImportPlan> mergeWatchTransfer(WatchTransfer input) async {
    if (_watchImporting || syncBusy) throw const FormatException('正在同步，请稍后导入');
    _watchImporting = true;
    final oldWatch = prefs.getStringList('watchlist'),
        oldGroups = prefs.getString('watchGroups');
    try {
      final plan = planWatchImport(watchlist, groups, input);
      if (!await prefs.setString('watchGroups', jsonEncode(plan.groups)) ||
          !await prefs.setStringList('watchlist', plan.watchlist)) {
        throw StateError('无法保存自选，请重试');
      }
      watchlist = plan.watchlist;
      groups = plan.groups;
      _watchImporting = false;
      _watchEdited();
      return plan;
    } catch (_) {
      if (oldWatch == null) {
        await prefs.remove('watchlist');
      } else {
        await prefs.setStringList('watchlist', oldWatch);
      }
      if (oldGroups == null) {
        await prefs.remove('watchGroups');
      } else {
        await prefs.setString('watchGroups', oldGroups);
      }
      rethrow;
    } finally {
      _watchImporting = false;
    }
  }

  Future<int> mergeWatch(List<String> symbols, {String? groupId}) async {
    final target = groupId == null
        ? null
        : groups.where((g) => g['id'] == groupId).firstOrNull;
    if (groupId != null && target == null) {
      throw const FormatException('分组已不存在');
    }
    final unique = symbols.map(normalize).toSet(), before = watchlist.length;
    for (final symbol in unique) {
      if (!watchlist.contains(symbol) && watchlist.length < 60) {
        watchlist.add(symbol);
      }
    }
    if (groupId != null) {
      final group = target!;
      group['symbols'] = <dynamic>{
        ...List<String>.from(group['symbols'] ?? []),
        ...unique.where(watchlist.contains),
      }.toList();
    }
    await _saveWatch();
    _watchEdited();
    return watchlist.length - before;
  }

  Future<void> importWatch(String text) async {
    final raw = jsonDecode(text);
    final list = raw is List ? raw : obj(raw)['watchlist'];
    if (list is! List) throw const FormatException('需要股票代码 JSON 数组');
    final next = list
        .map((v) => normalize('$v'))
        .where((s) => RegExp(r'^[A-Z0-9.^-]{1,18}(\.(SH|SZ|BJ))?$').hasMatch(s))
        .toSet()
        .take(60)
        .toList();
    if (next.isEmpty) throw const FormatException('没有有效代码');
    watchlist = next;
    await prefs.setStringList('watchlist', watchlist);
    _watchEdited();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        foreground = true;
        if (_started) {
          if (catalog.isEmpty) _catalogTriedAt = DateTime(0);
          poller.resume();
        }
      case AppLifecycleState.inactive:
        // Still visible: Control Centre, notification shade, call banner.
        break;
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
        foreground = false;
        poller.pause();
    }
  }

  bool _disposed = false;
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    poller.dispose();
    _syncDebounce?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    chartRevision.dispose();
    watchInsights.dispose();
    quoteBook.dispose();
    syncChanges.dispose();
    _foreground.dispose();
    messages.close();
    api.dispose();
    super.dispose();
  }
}
