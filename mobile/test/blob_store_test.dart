import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:market_atlas/core/blob_store.dart';
import 'package:market_atlas/core/chart_studies.dart';
import 'package:market_atlas/core/api.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('atlas-blobs'));
  tearDown(() => dir.deleteSync(recursive: true));

  test(
    'chart frames and scan state move out of NSUserDefaults into files',
    () async {
      final frame = jsonEncode({
        'market': {'symbol': 'X', 'candles': []},
      });
      SharedPreferences.setMockInitialValues({
        'chart.frame.v2:600519.SH': frame,
        'scan-v2': '{"phase":"paused"}',
        'themeMode': 'light',
      });
      final raw = await SharedPreferences.getInstance();
      final blobs = BlobStore(dir);
      final prefs = AtlasPreferences(raw, blobs);
      expect(prefs.getString('chart.frame.v2:600519.SH'), frame);
      expect(prefs.getString('themeMode'), 'light');
      await blobs.flush();
      await Future<void>.delayed(Duration.zero);
      expect(raw.containsKey('chart.frame.v2:600519.SH'), isFalse);
      expect(raw.containsKey('scan-v2'), isFalse);
      expect(raw.getString('themeMode'), 'light');

      await prefs.setString('scan-v2', '{"phase":"complete"}');
      expect(raw.containsKey('scan-v2'), isFalse);
      // A new process reads the file back.
      final reopened = AtlasPreferences(raw, BlobStore(dir));
      expect(reopened.getString('scan-v2'), '{"phase":"complete"}');
      expect(reopened.containsKey('chart.frame.v2:600519.SH'), isTrue);
      await reopened.remove('chart.frame.v2:600519.SH');
      expect(
        AtlasPreferences(
          raw,
          BlobStore(dir),
        ).getString('chart.frame.v2:600519.SH'),
        isNull,
      );
    },
  );

  test('the chart engine cache works unchanged through the wrapper', () async {
    SharedPreferences.setMockInitialValues({});
    final raw = await SharedPreferences.getInstance();
    final prefs = AtlasPreferences(raw, BlobStore(dir));
    final candles = [
      {
        'time': '2026-11-25',
        'open': 1,
        'high': 2,
        'low': 1,
        'close': 2,
        'volume': 9,
      },
    ];
    final studies = ChartStudies(
      AtlasApi(
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'market': {'symbol': '600519.SH', 'candles': candles},
            }),
            200,
          ),
        ),
      ),
      prefs,
      runner: (input) async => {'verification': {}},
    );
    await studies.loadFrame('600519.SH', const [5]);
    await prefs.blobs.flush();
    expect(
      raw.getKeys().where((k) => k.startsWith('chart.frame.v2:')),
      isEmpty,
    );
    expect(
      File('${dir.path}/chart.frame.v2_600519.SH.json').existsSync(),
      isTrue,
    );
    final again = ChartStudies(
      studies.api,
      AtlasPreferences(raw, BlobStore(dir)),
      runner: (input) async => {'verification': {}},
    );
    expect(await again.cachedFrame('600519.SH', const [5]), isNotNull);
  });

  test('without a directory everything stays in preferences', () async {
    SharedPreferences.setMockInitialValues({'scan-v2': '{}'});
    final raw = await SharedPreferences.getInstance();
    final prefs = AtlasPreferences(raw, BlobStore(null));
    await prefs.setString('scan-v2', '{"a":1}');
    expect(raw.getString('scan-v2'), '{"a":1}');
  });
}
