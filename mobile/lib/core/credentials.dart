import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Where secrets are persisted. The default is the iOS Keychain; tests
/// substitute an in-memory backend or the plugin's mock platform.
abstract class SecretBackend {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class KeychainBackend implements SecretBackend {
  KeychainBackend([FlutterSecureStorage? storage])
    : storage =
          storage ??
          const FlutterSecureStorage(
            // This device only, readable after the first unlock so that
            // background refreshes work; excluded from iCloud backups.
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );
  final FlutterSecureStorage storage;
  @override
  Future<String?> read(String key) => storage.read(key: key);
  @override
  Future<void> write(String key, String value) =>
      storage.write(key: key, value: value);
  @override
  Future<void> delete(String key) => storage.delete(key: key);
}

/// Account session token, sync key and the device capability token.
///
/// Values are cached in memory so that synchronous getters keep working; every
/// write is serialized to the keychain. Older builds kept these values in
/// NSUserDefaults (plain text, part of device backups); [migrate] moves them
/// once and removes the old key only after the keychain write succeeded.
class CredentialStore {
  CredentialStore({SecretBackend? backend})
    : backend = backend ?? KeychainBackend();
  static const accountToken = 'accountToken',
      syncKey = 'cloudSyncKey',
      deviceToken = 'deviceToken';
  static const keys = [accountToken, syncKey, deviceToken];
  final SecretBackend backend;
  final _values = <String, String>{};
  Future<void> _writes = Future<void>.value();
  Object? lastError;

  Future<void> load() async {
    for (final key in keys) {
      try {
        final value = await backend.read(key);
        if (value != null && value.isNotEmpty) _values[key] = value;
      } catch (e) {
        lastError = e;
      }
    }
  }

  String read(String key) => _values[key] ?? '';

  void migrate(SharedPreferences prefs) {
    for (final key in keys) {
      final legacy = prefs.getString(key);
      if (legacy == null) continue;
      if (legacy.isEmpty) {
        unawaited(prefs.remove(key));
        continue;
      }
      // A value already in the keychain is newer than the legacy copy.
      final value = _values.putIfAbsent(key, () => legacy);
      _queue(() async {
        await backend.write(key, value);
        await prefs.remove(key);
      });
    }
  }

  /// Updates the in-memory value immediately; the keychain write is queued.
  /// Callers never wait on the keychain, see [flush].
  void write(String key, String value) {
    if (value.isEmpty) return delete(key);
    _values[key] = value;
    _queue(() => backend.write(key, value));
  }

  void delete(String key) {
    _values.remove(key);
    _queue(() => backend.delete(key));
  }

  /// Completes when every queued keychain write has finished.
  Future<void> flush() => _writes;

  void _queue(Future<void> Function() task) {
    _writes = _writes.then((_) => task()).catchError((Object e) {
      // The in-memory value stays usable for this session. Migration keeps the
      // legacy copy, so it is retried on the next launch.
      lastError = e;
      debugPrint('Keychain write failed: $e');
    });
  }
}

/// In-memory backend for tests and platforms without a keychain.
class MemorySecretBackend implements SecretBackend {
  MemorySecretBackend([Map<String, String>? values]) : values = values ?? {};
  final Map<String, String> values;
  bool fail = false;
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    if (fail) throw StateError('keychain unavailable');
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    if (fail) throw StateError('keychain unavailable');
    values.remove(key);
  }
}
