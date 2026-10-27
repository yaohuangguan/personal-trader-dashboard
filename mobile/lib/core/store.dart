import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

class AtlasStore extends ChangeNotifier with WidgetsBindingObserver {
  AtlasStore(this.api, this.prefs, this.english) {
    watchlist =
        prefs.getStringList('watchlist') ??
        ['300545.SZ', '300308.SZ', '300502.SZ'];
    groups = rows(_decode(prefs.getString('watchGroups')));
    themeMode = prefs.getString('themeMode') ?? 'dark';
    locale = prefs.getString('locale') ?? 'zh-CN';
    fontSize = prefs.getDouble('fontSize') ?? 18;
    bookmarks = rows(_decode(prefs.getString('bookmarks')));
    alerts = rows(_decode(prefs.getString('alerts')));
    deviceToken =
        prefs.getString('deviceToken') ??
        List.generate(
          32,
          (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'),
        ).join();
    prefs.setString('deviceToken', deviceToken);
    WidgetsBinding.instance.addObserver(this);
  }
  final AtlasApi api;
  final SharedPreferences prefs;
  final Map<String, dynamic> english;
  late List<String> watchlist;
  late String locale, themeMode;
  late double fontSize;
  late List<Json> bookmarks, alerts, groups;
  late String deviceToken;
  final Map<String, Json> quotes = {};
  Json catalog = {};
  String? quoteError;
  DateTime? quoteReadAt;
  bool foreground = true;
  Timer? _timer;
  bool _running = false;
  final StreamController<String> messages = StreamController.broadcast();
  static dynamic _decode(String? s) {
    try {
      return s == null ? null : jsonDecode(s);
    } catch (_) {
      return null;
    }
  }

  String t(String key) =>
      locale == 'en' ? (english[key]?.toString() ?? key) : key;
  static Future<AtlasStore> load({
    AtlasApi? api,
    SharedPreferences? prefs,
  }) async {
    final data = jsonDecode(
      await rootBundle.loadString('assets/strings_en.json'),
    );
    return AtlasStore(
      api ?? AtlasApi(),
      prefs ?? await SharedPreferences.getInstance(),
      Map<String, dynamic>.from(data),
    );
  }

  void start() {
    refreshQuotes();
    api
        .get('/api/catalog')
        .then((data) {
          catalog = data;
          notifyListeners();
        })
        .catchError((Object _) {});
    _timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (foreground) refreshQuotes();
    });
  }

  Future<void> refreshQuotes() async {
    if (_running) return;
    final symbols = watchlist.where(cnStock).toList();
    if (symbols.isEmpty) return;
    _running = true;
    try {
      final data = await api.get(
        '/api/desk/quotes',
        parameters: {'symbols': symbols.join(',')},
      );
      for (final q in rows(data['items'])) {
        quotes[str(q['symbol'])] = q;
      }
      quoteError = null;
      quoteReadAt = DateTime.now();
      _evaluateAlerts();
    } catch (e) {
      quoteError = e.toString();
    } finally {
      _running = false;
      notifyListeners();
    }
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
          DateTime.now().difference(timestamp).inSeconds > 120) {
        continue;
      }
      final price = numOf(q['price']), target = numOf(rule['value']);
      if (price == null || target == null) continue;
      if (rule['direction'] == 'above' ? price >= target : price <= target) {
        rule['firedAt'] = DateTime.now().toIso8601String();
        if (!_disposed) messages.add('${rule['symbol']} ${t('价格提醒')} $price');
        changed = true;
      }
    }
    if (changed) prefs.setString('alerts', jsonEncode(alerts));
  }

  Future<void> toggleWatch(String symbol) async {
    symbol = normalize(symbol);
    if (watchlist.contains(symbol)) {
      watchlist.remove(symbol);
      for (final g in groups) {
        (g['symbols'] as List?)?.remove(symbol);
      }
      await prefs.setString('watchGroups', jsonEncode(groups));
    } else {
      watchlist.add(symbol);
    }
    await prefs.setStringList('watchlist', watchlist);
    notifyListeners();
    refreshQuotes();
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
    notifyListeners();
    return id;
  }

  Future<void> deleteGroup(String id) async {
    groups.removeWhere((g) => g['id'] == id);
    await prefs.setString('watchGroups', jsonEncode(groups));
    notifyListeners();
  }

  Future<void> groupStock(String id, String symbol, bool included) async {
    final group = groups.firstWhere((g) => g['id'] == id),
        symbols = List<String>.from(group['symbols'] ?? []);
    symbols.remove(symbol);
    if (included) {
      symbols.add(symbol);
      if (!watchlist.contains(symbol)) {
        watchlist.add(symbol);
        await prefs.setStringList('watchlist', watchlist);
      }
    }
    group['symbols'] = symbols;
    await prefs.setString('watchGroups', jsonEncode(groups));
    notifyListeners();
  }

  Future<void> reorderWatch(int oldIndex, int newIndex) async {
    if (newIndex > oldIndex) newIndex--;
    final s = watchlist.removeAt(oldIndex);
    watchlist.insert(newIndex, s);
    await prefs.setStringList('watchlist', watchlist);
    notifyListeners();
  }

  Future<void> setTheme(String value) async {
    themeMode = value == 'light' ? 'light' : 'dark';
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
  }

  Future<void> removeAlert(Json rule) async {
    alerts.removeWhere((r) => r['id'] == rule['id']);
    await prefs.setString('alerts', jsonEncode(alerts));
    notifyListeners();
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
    notifyListeners();
    refreshQuotes();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground = state == AppLifecycleState.resumed;
    if (foreground) refreshQuotes();
  }

  bool _disposed = false;
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    messages.close();
    api.dispose();
    super.dispose();
  }
}
