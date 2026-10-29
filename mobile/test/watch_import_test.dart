import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:market_atlas/core/api.dart';
import 'package:market_atlas/core/store.dart';
import 'package:market_atlas/core/watch_import.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('broker screenshots and CSV codes parse in source order without quotes, phone numbers or dates', () {
    expect(
      parseWatchText(
        '宁德时代 300750 210.25 +3.00%\nSZ002594,比亚迪\n600036.SH 招商银行\n300750\n13812345678\n2026-10-29\n123456.78\nVOL',
      ),
      ['300750.SZ', '002594.SZ', '600036.SH'],
    );
    expect(parseWatchText('["300750.SZ","NVDA","600036.SH"]'), [
      '300750.SZ',
      'NVDA',
      '600036.SH',
    ]);
    expect(parseWatchText('899050.BJ\n920002'), ['899050.BJ', '920002.BJ']);
  });
  test('merge preserves all existing watch groups and duplicate imports while adding selected stocks to a target group', () async {
    SharedPreferences.setMockInitialValues({
      'watchlist': ['300031.SZ'],
      'watchGroups': jsonEncode([
        {
          'id': 'g',
          'name': '机器人',
          'symbols': ['300031.SZ'],
        },
      ]),
    });
    final api = AtlasApi(
          client: MockClient((_) async => http.Response('{"items":[]}', 200)),
        ),
        s = AtlasStore(api, await SharedPreferences.getInstance(), {});
    final added = await s.mergeWatch([
      '300750.SZ',
      '300750.SZ',
      '300031.SZ',
    ], groupId: 'g');
    expect(added, 1);
    expect(s.watchlist, ['300031.SZ', '300750.SZ']);
    expect(s.groups.single['symbols'], ['300031.SZ', '300750.SZ']);
    s.dispose();
    api.dispose();
  });
}
