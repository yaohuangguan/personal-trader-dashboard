import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/credentials.dart';
import 'package:market_atlas/core/store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'legacy NSUserDefaults secrets move to the keychain exactly once',
    () async {
      SharedPreferences.setMockInitialValues({
        'accountToken': 'A' * 43,
        'cloudSyncKey': 'K' * 43,
        'deviceToken': 'd' * 64,
        'watchlist': ['NVDA'],
      });
      final prefs = await SharedPreferences.getInstance();
      final keychain = MemorySecretBackend();
      final store = AtlasStore(
        AtlasApi(client: MockClient((_) async => http.Response('{}', 200))),
        prefs,
        {},
        credentials: CredentialStore(backend: keychain),
      );
      expect(store.accountToken, 'A' * 43);
      expect(store.syncKey, 'K' * 43);
      expect(store.deviceToken, 'd' * 64);
      await store.credentials.flush();
      expect(keychain.values, {
        'accountToken': 'A' * 43,
        'cloudSyncKey': 'K' * 43,
        'deviceToken': 'd' * 64,
      });
      for (final key in CredentialStore.keys) {
        expect(prefs.containsKey(key), isFalse, reason: key);
      }
      expect(prefs.getStringList('watchlist'), ['NVDA']);
      store.dispose();

      // A second launch reads the keychain; nothing is left to migrate.
      final again = CredentialStore(backend: keychain);
      await again.load();
      again.migrate(prefs);
      expect(again.read(CredentialStore.accountToken), 'A' * 43);
    },
  );

  test(
    'a failed keychain write keeps the legacy copy for the next launch',
    () async {
      SharedPreferences.setMockInitialValues({'accountToken': 'A' * 43});
      final prefs = await SharedPreferences.getInstance();
      final keychain = MemorySecretBackend()..fail = true;
      final credentials = CredentialStore(backend: keychain)..migrate(prefs);
      expect(credentials.read(CredentialStore.accountToken), 'A' * 43);
      await credentials.flush();
      expect(prefs.getString('accountToken'), 'A' * 43);
      expect(credentials.lastError, isNotNull);
    },
  );

  test('the keychain value wins over a stale legacy copy', () async {
    SharedPreferences.setMockInitialValues({'cloudSyncKey': 'old'});
    final prefs = await SharedPreferences.getInstance();
    final keychain = MemorySecretBackend({'cloudSyncKey': 'new'});
    final credentials = CredentialStore(backend: keychain);
    await credentials.load();
    credentials.migrate(prefs);
    await credentials.flush();
    expect(credentials.read(CredentialStore.syncKey), 'new');
    expect(keychain.values['cloudSyncKey'], 'new');
    expect(prefs.containsKey('cloudSyncKey'), isFalse);
  });

  test('the default backend uses the mocked plugin keychain', () async {
    FlutterSecureStorage.setMockInitialValues({'deviceToken': 'f' * 64});
    final credentials = CredentialStore();
    await credentials.load();
    expect(credentials.read(CredentialStore.deviceToken), 'f' * 64);
    credentials.write(CredentialStore.accountToken, 'T' * 43);
    credentials.delete(CredentialStore.deviceToken);
    await credentials.flush();
    final reread = CredentialStore();
    await reread.load();
    expect(reread.read(CredentialStore.accountToken), 'T' * 43);
    expect(reread.read(CredentialStore.deviceToken), isEmpty);
  });
}
