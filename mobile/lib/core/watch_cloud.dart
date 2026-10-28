part of 'store.dart';

extension WatchCloud on AtlasStore {
  String get syncKey => prefs.getString('cloudSyncKey') ?? '';
  Json _watchState() => {
    'watchlist': List<String>.from(watchlist),
    'groups': jsonDecode(jsonEncode(groups)),
  };
  Future<void> connectCloud([String? key]) async {
    if (syncBusy) return;
    final remote = key == null
        ? await api.post('/api/watch-sync/create', {})
        : await api.get('/api/watch-sync', token: key);
    await prefs.setString('cloudSyncKey', key ?? str(remote['token']));
    await prefs.remove('cloudSyncBase');
    await syncCloud();
  }

  Future<void> disconnectCloud() async {
    await prefs.remove('cloudSyncKey');
    await prefs.remove('cloudSyncBase');
    syncStatus = '已断开，本机自选保留';
    notifyListeners();
  }

  Future<void> syncCloud() async {
    if (syncBusy || syncKey.isEmpty || _disposed) return;
    syncBusy = true;
    syncStatus = '正在同步…';
    notifyListeners();
    try {
      final before = _watchState(),
          base = obj(AtlasStore._decode(prefs.getString('cloudSyncBase')));
      final remote = await api.get('/api/watch-sync', token: syncKey);
      final ops = watchCloudDiff(obj(base['state']), before);
      final result = ops.isEmpty
          ? remote
          : await api.post('/api/watch-sync', {
              'id':
                  '${DateTime.now().microsecondsSinceEpoch}_${Random.secure().nextInt(0x7fffffff)}',
              'baseRevision': base['revision'] ?? remote['revision'],
              'ops': ops,
            }, token: syncKey);
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
    } catch (e) {
      syncStatus = '未同步：$e；本机修改保留';
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
