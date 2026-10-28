import 'package:flutter_test/flutter_test.dart';
import 'package:market_atlas/core/store.dart';

void main() {
  test('offline cloud edits do not resurrect a removed symbol and merge independent group memberships', () {
    final base = <String, dynamic>{
      'watchlist': ['AAPL', 'NVDA', 'MU'],
      'groups': [
        {
          'id': 'tech',
          'name': '科技',
          'symbols': ['AAPL'],
        },
      ],
    };
    final a = <String, dynamic>{
      'watchlist': ['AAPL', 'NVDA', 'MU'],
      'groups': [
        {
          'id': 'tech',
          'name': '科技',
          'symbols': ['AAPL', 'NVDA'],
        },
      ],
    };
    final b = <String, dynamic>{
      'watchlist': ['AAPL', 'NVDA', 'MU'],
      'groups': [
        {
          'id': 'tech',
          'name': '科技',
          'symbols': ['AAPL', 'MU'],
        },
      ],
    };
    final remote = watchCloudApply(
      watchCloudApply(base, watchCloudDiff(base, a)),
      watchCloudDiff(base, b),
    );
    expect(remote['groups'][0]['symbols'], ['AAPL', 'NVDA', 'MU']);
    final removed = watchCloudApply(remote, [
      {'kind': 'remove', 'symbol': 'AAPL'},
    ]);
    expect(watchCloudApply(removed, watchCloudDiff(base, base))['watchlist'], [
      'NVDA',
      'MU',
    ]);
  });
}
