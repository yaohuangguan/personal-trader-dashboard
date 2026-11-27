import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Large JSON blobs (cached chart frames, screener scan state) stored as files
/// in Application Support instead of NSUserDefaults. NSUserDefaults is read
/// completely into memory before the first frame and rewritten as a whole, so
/// hundreds of kilobytes there slow every cold start and every save.
class BlobStore {
  BlobStore(this.directory);
  final Directory? directory;
  final _cache = <String, String?>{};
  Future<void> _writes = Future<void>.value();

  /// Without a directory (tests, unsupported platforms) nothing is stored
  /// here and callers keep using preferences.
  bool get available => directory != null;

  static Future<BlobStore> open() async {
    try {
      final base = await getApplicationSupportDirectory();
      final dir = Directory('${base.path}/blobs');
      await dir.create(recursive: true);
      return BlobStore(dir);
    } catch (e) {
      debugPrint('Blob storage unavailable: $e');
      return BlobStore(null);
    }
  }

  File _file(String key) => File(
    '${directory!.path}/${key.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_')}.json',
  );

  bool contains(String key) => read(key) != null;

  /// Synchronous so it can sit behind the SharedPreferences getters; each
  /// blob is read from disk at most once and then served from memory.
  String? read(String key) {
    if (_cache.containsKey(key)) return _cache[key];
    if (directory == null) return null;
    String? value;
    try {
      final file = _file(key);
      value = file.existsSync() ? file.readAsStringSync() : null;
    } catch (_) {
      value = null;
    }
    _cache[key] = value;
    return value;
  }

  Future<void> write(String key, String value) {
    _cache[key] = value;
    if (directory == null) return Future<void>.value();
    return _queue(() async {
      // Write-then-rename keeps the previous copy if the app is killed.
      final file = _file(key), temp = File('${file.path}.tmp');
      await temp.writeAsString(value, flush: true);
      await temp.rename(file.path);
    });
  }

  Future<void> remove(String key) {
    _cache[key] = null;
    if (directory == null) return Future<void>.value();
    return _queue(() async {
      final file = _file(key);
      if (await file.exists()) await file.delete();
    });
  }

  Future<void> flush() => _writes;

  Future<void> _queue(Future<void> Function() task) {
    final next = _writes.then((_) => task()).catchError((Object e) {
      debugPrint('Blob write failed: $e');
    });
    _writes = next;
    return next;
  }
}

/// SharedPreferences whose large keys live in a [BlobStore]. Everything else
/// (settings, watchlist, alerts) stays in NSUserDefaults. Values found under
/// blob keys in NSUserDefaults are moved once.
class AtlasPreferences implements SharedPreferences {
  AtlasPreferences(this.inner, this.blobs) {
    if (!blobs.available) return;
    for (final key in inner.getKeys().where(isBlobKey).toList()) {
      final value = inner.getString(key);
      if (value != null) {
        blobs.write(key, value).then((_) => inner.remove(key));
      } else {
        inner.remove(key);
      }
    }
  }
  final SharedPreferences inner;
  final BlobStore blobs;

  static bool isBlobKey(String key) =>
      key == 'scan-v2' || key.startsWith('chart.frame.v2:');
  bool _blob(String key) => blobs.available && isBlobKey(key);

  @override
  Set<String> getKeys() => inner.getKeys();
  @override
  Object? get(String key) => _blob(key) ? blobs.read(key) : inner.get(key);
  @override
  bool? getBool(String key) => inner.getBool(key);
  @override
  int? getInt(String key) => inner.getInt(key);
  @override
  double? getDouble(String key) => inner.getDouble(key);
  @override
  String? getString(String key) =>
      _blob(key) ? blobs.read(key) : inner.getString(key);
  @override
  bool containsKey(String key) =>
      _blob(key) ? blobs.contains(key) : inner.containsKey(key);
  @override
  List<String>? getStringList(String key) => inner.getStringList(key);
  @override
  Future<bool> setBool(String key, bool value) => inner.setBool(key, value);
  @override
  Future<bool> setInt(String key, int value) => inner.setInt(key, value);
  @override
  Future<bool> setDouble(String key, double value) =>
      inner.setDouble(key, value);
  @override
  Future<bool> setString(String key, String value) async {
    if (!_blob(key)) return inner.setString(key, value);
    await blobs.write(key, value);
    return true;
  }

  @override
  Future<bool> setStringList(String key, List<String> value) =>
      inner.setStringList(key, value);
  @override
  Future<bool> remove(String key) async {
    if (!_blob(key)) return inner.remove(key);
    await blobs.remove(key);
    return true;
  }

  @override
  // ignore: deprecated_member_use
  Future<bool> commit() => inner.commit();
  @override
  Future<bool> clear() => inner.clear();
  @override
  Future<void> reload() => inner.reload();
}
