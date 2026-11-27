import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:market_atlas/core/api.dart';

void main() {
  final english = Map<String, dynamic>.from(
    jsonDecode(File('assets/strings_en.json').readAsStringSync()),
  );
  test('Cloudflare plain-text 503 becomes a localized busy error', () async {
    var now = DateTime.utc(2026, 11, 26, 2);
    var calls = 0;
    final api = AtlasApi(
      clock: () => now,
      client: MockClient((r) async {
        calls++;
        return calls == 1
            ? http.Response(
                'error code: 1102',
                503,
                headers: {'retry-after': '20'},
              )
            : http.Response('{"items":[]}', 200);
      }),
    );
    final error = await api
        .get('/api/desk/quotes', parameters: {'symbols': 'AAPL'})
        .then<Object?>((_) => null, onError: (Object e) => e);
    expect(error, isA<ApiException>());
    error as ApiException;
    expect(error.message, '服务繁忙，请稍后重试');
    expect(error.busy, isTrue);
    expect(error.retryAfter, const Duration(seconds: 20));
    // Retry-After is honoured: no request until the window has passed.
    await expectLater(
      api.get('/api/desk/quotes', parameters: {'symbols': 'MSFT'}),
      throwsA(isA<ApiException>()),
    );
    expect(calls, 1);
    now = now.add(const Duration(seconds: 21));
    await api.get('/api/desk/quotes', parameters: {'symbols': 'MSFT'});
    expect(calls, 2);
    api.dispose();
  });

  test('JSON errors keep code and retryAfter; POST failures too', () async {
    final api = AtlasApi(
      client: MockClient(
        (r) async => http.Response.bytes(
          utf8.encode(
            jsonEncode({
              'error': '登录后可发起全市场扫描',
              'code': 'AUTH_REQUIRED',
              'retryAfter': 3,
            }),
          ),
          401,
        ),
      ),
    );
    final error = await api
        .post('/api/desk/screen-job', {'retry': false})
        .then<Object?>((_) => null, onError: (Object e) => e);
    expect(error, isA<ApiException>());
    error as ApiException;
    expect(error.status, 401);
    expect(error.code, 'AUTH_REQUIRED');
    expect(error.retryAfter, const Duration(seconds: 3));
    expect(describeError(error), '登录后可发起全市场扫描');
    api.dispose();
  });

  test('timeouts and offline errors never show raw exception text', () async {
    final hang = AtlasApi(
      client: MockClient((r) => Completer<http.Response>().future),
    );
    final timeout = await hang
        .get('/api/desk/quotes', timeout: const Duration(milliseconds: 20))
        .then<Object?>((_) => null, onError: (Object e) => e);
    expect(timeout, isA<ApiException>());
    expect((timeout as ApiException).kind, ApiFailure.timeout);
    expect(describeError(timeout), '请求超时，请检查网络后重试');
    final offline = AtlasApi(
      client: MockClient(
        (r) async =>
            throw http.ClientException('SocketException: Failed host lookup'),
      ),
    );
    final down = await offline
        .get('/api/news')
        .then<Object?>((_) => null, onError: (Object e) => e);
    expect(describeError(down), '网络不可用，请检查网络连接');
    expect(describeError(TimeoutException('after 0:00:35')), '请求超时，请检查网络后重试');
    expect(
      describeError(Exception('ClientException with SocketException: x')),
      '网络不可用，请检查网络连接',
    );
    for (final message in [
      '服务繁忙，请稍后重试',
      '请求超时，请检查网络后重试',
      '网络不可用，请检查网络连接',
      '登录后可发起全市场扫描',
      '数据服务暂未返回有效响应，请稍后重试',
    ]) {
      expect(english[message], isNotNull, reason: message);
    }
    hang.dispose();
    offline.dispose();
  });

  test('polling endpoints use short timeouts', () {
    expect(AtlasApi.timeoutFor('/api/desk/quotes').inSeconds, lessThan(11));
    expect(AtlasApi.timeoutFor('/api/desk/insight').inSeconds, lessThan(11));
    expect(AtlasApi.timeoutFor('/api/chart-bundle').inSeconds, 30);
    expect(
      parseHttpDate('Wed, 21 Oct 2015 07:28:00 GMT'),
      DateTime.utc(2015, 10, 21, 7, 28),
    );
  });
}
