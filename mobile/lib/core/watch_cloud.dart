part of 'store.dart';

extension WatchCloud on AtlasStore {
  String get syncKey => credentials.read(CredentialStore.syncKey);
  String get accountToken => credentials.read(CredentialStore.accountToken);
  Json get account =>
      obj(AtlasStore._decode(prefs.getString('accountProfile')));
  bool get cloudConnected => accountToken.isNotEmpty || syncKey.isNotEmpty;
  String get _cloudPath =>
      accountToken.isNotEmpty ? '/api/account/watch' : '/api/watch-sync';
  String get _cloudToken => accountToken.isNotEmpty ? accountToken : syncKey;

  Future<void> registerAccount(
    String email,
    String username,
    String password,
  ) => _signIn('/api/account/register', {
    'email': email.trim(),
    'username': username.trim(),
    'password': password,
  });

  Future<void> loginAccount(String login, String password) => _signIn(
    '/api/account/login',
    {'login': login.trim(), 'password': password},
  );

  /// Signing in replaces sync-key mode. The baseline is cleared so the first
  /// sync diffs against an empty list and merges every local stock and group
  /// into the account instead of overwriting either side.
  Future<void> _signIn(String path, Json body) async {
    if (syncBusy) throw const FormatException('正在同步，请稍候');
    final result = await api.post(path, body);
    credentials.write(CredentialStore.accountToken, str(result['token']));
    await prefs.setString('accountProfile', jsonEncode(obj(result['account'])));
    credentials.delete(CredentialStore.syncKey);
    await prefs.remove('cloudSyncBase');
    await syncCloud();
  }

  /// Permanently deletes the account and its synced watchlist on the server.
  /// The stocks on this device stay, so nothing visible disappears locally.
  Future<void> deleteAccount(String password) async {
    final token = accountToken;
    if (token.isEmpty) throw const FormatException('请先登录');
    await api.post('/api/account/delete', {'password': password}, token: token);
    credentials.delete(CredentialStore.accountToken);
    await prefs.remove('accountProfile');
    await prefs.remove('cloudSyncBase');
    syncStatus = '账号已删除，本机自选保留';
    notifyListeners();
  }

  Future<void> logoutAccount() async {
    final token = accountToken;
    credentials.delete(CredentialStore.accountToken);
    await prefs.remove('accountProfile');
    await prefs.remove('cloudSyncBase');
    syncStatus = '已退出登录，本机自选保留';
    notifyListeners();
    if (token.isNotEmpty) {
      try {
        await api.post('/api/account/logout', {}, token: token);
      } catch (_) {
        // The local session is already gone; the server copy expires on its own.
      }
    }
  }

  Json _watchState() => {
    'watchlist': List<String>.from(watchlist),
    'groups': jsonDecode(jsonEncode(groups)),
  };
  Future<void> connectCloud([String? key]) async {
    if (syncBusy) return;
    final remote = key == null
        ? await api.post('/api/watch-sync/create', {})
        : await api.get('/api/watch-sync', token: key);
    credentials.write(CredentialStore.syncKey, key ?? str(remote['token']));
    await prefs.remove('cloudSyncBase');
    await syncCloud();
  }

  Future<void> disconnectCloud() async {
    credentials.delete(CredentialStore.syncKey);
    await prefs.remove('cloudSyncBase');
    syncStatus = '已断开，本机自选保留';
    notifyListeners();
  }

  Future<void> syncCloud() async {
    if (syncBusy || _watchImporting || !cloudConnected || _disposed) return;
    syncBusy = true;
    syncStatus = '正在同步…';
    notifyListeners();
    try {
      final before = _watchState(),
          base = obj(AtlasStore._decode(prefs.getString('cloudSyncBase')));
      final path = _cloudPath, token = _cloudToken;
      final remote = await api.get(path, token: token);
      final ops = watchCloudDiff(obj(base['state']), before);
      final result = ops.isEmpty
          ? remote
          : await api.post(path, {
              'id':
                  '${DateTime.now().microsecondsSinceEpoch}_${Random.secure().nextInt(0x7fffffff)}',
              'baseRevision': base['revision'] ?? remote['revision'],
              'ops': ops,
            }, token: token);
      final pending = watchCloudDiff(before, _watchState());
      final applied = watchCloudApply(obj(result['state']), pending);
      watchlist = List<String>.from(applied['watchlist'] ?? []);
      groups = rows(applied['groups']);
      await prefs.setStringList('watchlist', watchlist);
      await prefs.setString('watchGroups', jsonEncode(groups));
      await prefs.setString(
        'cloudSyncBase',
        jsonEncode({'state': result['state'], 'revision': result['revision']}),
      );
      syncStatus =
          '已同步 · ${str(result['updatedAt']).replaceFirst('T', ' ').substring(0, 19)} UTC';
      if (pending.isNotEmpty) {
        _syncDebounce = Timer(const Duration(seconds: 1), syncCloud);
      }
    } on ApiException catch (e) {
      if (e.status == 401 && accountToken.isNotEmpty) {
        credentials.delete(CredentialStore.accountToken);
        await prefs.remove('accountProfile');
        await prefs.remove('cloudSyncBase');
        syncStatus = '登录已过期，请重新登录；本机自选保留';
      } else {
        syncStatus = '未同步：${describeError(e)}；本机修改保留';
      }
    } catch (e) {
      syncStatus = '未同步：${describeError(e)}；本机修改保留';
    } finally {
      syncBusy = false;
      _lastSyncAt = DateTime.now();
      notifyListeners();
    }
  }
}

List<Json> watchCloudDiff(Json base, Json current) {
  final old = List<String>.from(base['watchlist'] ?? []),
      next = List<String>.from(current['watchlist'] ?? []);
  final groups = rows(current['groups']), previous = rows(base['groups']);
  return [
    for (final s in old)
      if (!next.contains(s)) {'kind': 'remove', 'symbol': s},
    for (final s in next)
      if (!old.contains(s)) {'kind': 'add', 'symbol': s},
    for (final g in previous)
      if (!groups.any((v) => v['id'] == g['id']))
        {'kind': 'delete-group', 'id': g['id']},
    for (final g in groups)
      if (jsonEncode(g) !=
          jsonEncode(previous.where((v) => v['id'] == g['id']).firstOrNull))
        {
          'kind': 'group',
          'group': g,
          'previous': previous.where((v) => v['id'] == g['id']).firstOrNull,
        },
    if (jsonEncode(old) != jsonEncode(next)) {'kind': 'order', 'symbols': next},
  ];
}

Json watchCloudApply(Json state, List<Json> ops) {
  var watch = List<String>.from(state['watchlist'] ?? []),
      groups = rows(state['groups']);
  for (final op in ops) {
    switch (op['kind']) {
      case 'add':
        if (!watch.contains(op['symbol'])) watch.add(str(op['symbol']));
      case 'remove':
        watch.remove(op['symbol']);
        for (final g in groups) {
          g['symbols'] = (g['symbols'] as List)
              .where((s) => s != op['symbol'])
              .toList();
        }
      case 'delete-group':
        groups.removeWhere((g) => g['id'] == op['id']);
      case 'group':
        final g = obj(op['group']),
            prior = obj(op['previous']),
            existing = groups.where((v) => v['id'] == g['id']).firstOrNull;
        if (existing == null && prior.isNotEmpty) break;
        final oldMembers = List<String>.from(prior['symbols'] ?? []),
            members = List<String>.from(g['symbols'] ?? []);
        g['symbols'] = <dynamic>{
          ...List<String>.from(existing?['symbols'] ?? [])
              .where((s) => !oldMembers.contains(s) || members.contains(s)),
          ...members.where((s) => !oldMembers.contains(s)),
        }.where(watch.contains).toList();
        if (existing != null && prior['name'] == g['name']) {
          g['name'] = existing['name'];
        }
        groups.removeWhere((v) => v['id'] == g['id']);
        groups.add(g);
      case 'order':
        watch = <String>{
          ...(op['symbols'] as List).cast<String>().where(watch.contains),
          ...watch,
        }.toList();
    }
  }
  return {'watchlist': watch, 'groups': groups};
}
