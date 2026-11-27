import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

typedef Json = Map<String, dynamic>;
Json obj(dynamic value) => value is Map ? Map<String, dynamic>.from(value) : {};
List<Json> rows(dynamic value) => value is List
    ? value.whereType<Map>().map((r) => Map<String, dynamic>.from(r)).toList()
    : [];
double? numOf(dynamic value) =>
    value == null || value == '' ? null : double.tryParse('$value');
String str(dynamic value, [String fallback = '—']) =>
    value == null || '$value'.isEmpty ? fallback : '$value';
String fixed(dynamic value, [int digits = 2]) =>
    numOf(value)?.toStringAsFixed(digits) ?? '—';
String percent(dynamic value) {
  final n = numOf(value);
  return n == null ? '—' : '${n >= 0 ? '+' : ''}${n.toStringAsFixed(2)}%';
}

String amount(dynamic value) {
  final n = numOf(value);
  if (n == null) return '—';
  if (n.abs() >= 1e8) return '${(n / 1e8).toStringAsFixed(2)}亿';
  if (n.abs() >= 1e4) return '${(n / 1e4).toStringAsFixed(2)}万';
  return n.toStringAsFixed(0);
}

bool cnStock(String s) => RegExp(r'^\d{6}\.(SH|SZ|BJ)$').hasMatch(s);
String normalize(String input) {
  final value = input.trim().toUpperCase();
  if (RegExp(r'^\d{6}$').hasMatch(value)) {
    return '$value.${value.startsWith('6')
        ? 'SH'
        : RegExp(r'^(4|8|92)').hasMatch(value)
        ? 'BJ'
        : 'SZ'}';
  }
  return value;
}

/// Endpoints polled every few seconds; a slow response is abandoned quickly
/// so the next poll is not queued behind it.
const pollingPaths = {
  '/api/desk/quotes',
  '/api/desk/insight',
  '/api/desk/intraday',
  '/api/desk/extended-quote',
  '/api/desk/ticks',
  '/api/desk/trend',
  '/api/desk/screen-job',
  '/api/desk/candidate-check',
  '/api/monitor/status',
  '/api/monitor/global',
  '/api/account/watch',
  '/api/watch-sync',
  '/api/search',
};

class AtlasApi {
  AtlasApi({String? base, http.Client? client, DateTime Function()? clock})
    : base =
          base ??
          const String.fromEnvironment(
            'ATLAS_API_BASE',
            defaultValue: 'https://guanlan.nzs.workers.dev',
          ),
      client = client ?? http.Client(),
      clock = clock ?? DateTime.now;
  final String base;
  final http.Client client;
  final DateTime Function() clock;
  final _pending = <String, Future<Json>>{};
  final _recent = <String, ({DateTime until, Json data})>{};

  /// Paths the server asked us to leave alone (Retry-After) until a time.
  final _backoff = <String, ({DateTime until, ApiException error})>{};

  static Duration timeoutFor(String path) => pollingPaths.contains(path)
      ? const Duration(seconds: 10)
      : const Duration(seconds: 30);

  Future<Json> get(
    String path, {
    Map<String, String>? parameters,
    String? token,
    Duration? timeout,
  }) async {
    final uri = Uri.parse('$base$path').replace(queryParameters: parameters);
    timeout ??= timeoutFor(path);
    const publicPaths = {
      '/api/chart-frame',
      '/api/chart-bundle',
      '/api/market',
      '/api/analysis',
      '/api/review-context',
      '/api/desk/quotes',
      '/api/desk/history',
      '/api/desk/intraday',
      '/api/desk/auction',
      '/api/desk/sector-intraday',
      '/api/desk/sectors',
      '/api/desk/trend',
    };
    if (token == null && publicPaths.contains(path)) {
      final key = uri.toString(), cached = _recent[key];
      if (cached != null && cached.until.isAfter(clock())) {
        return Map.of(cached.data);
      }
      final pending = _pending[key];
      if (pending != null) return pending;
      final task = _get(uri, token, timeout);
      _pending[key] = task;
      try {
        final data = await task;
        if (_recent.length >= 64) _recent.remove(_recent.keys.first);
        _recent[key] = (
          until: clock().add(
            Duration(
              seconds: path == '/api/market' || path == '/api/desk/history'
                  ? 60
                  : path == '/api/analysis' ||
                        path == '/api/review-context' ||
                        path == '/api/desk/trend'
                  ? 10
                  : 2,
            ),
          ),
          data: Map.of(data),
        );
        return data;
      } finally {
        _pending.remove(key);
      }
    }
    return _get(uri, token, timeout);
  }

  Future<Json> _get(Uri uri, String? token, Duration timeout) =>
      _send(uri, timeout, read: true, () {
        return client.get(
          uri,
          headers: {
            'accept': 'application/json',
            if (token != null) 'Authorization': 'Bearer $token',
          },
        );
      });

  Future<Json> post(
    String path,
    Json body, {
    String? token,
    Duration timeout = const Duration(seconds: 40),
  }) {
    final uri = Uri.parse('$base$path');
    return _send(uri, timeout, read: false, () {
      return client.post(
        uri,
        headers: {
          'accept': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
          'content-type': 'application/json',
        },
        body: jsonEncode(body),
      );
    });
  }

  Future<Json> _send(
    Uri uri,
    Duration timeout,
    Future<http.Response> Function() request, {
    required bool read,
  }) async {
    final blocked = _backoff[uri.path];
    if (blocked != null) {
      if (blocked.until.isAfter(clock())) throw blocked.error;
      _backoff.remove(uri.path);
    }
    final http.Response response;
    try {
      response = await request().timeout(timeout);
    } on TimeoutException {
      throw ApiException('请求超时，请检查网络后重试', 0, kind: ApiFailure.timeout);
    } on http.ClientException {
      throw ApiException('网络不可用，请检查网络连接', 0, kind: ApiFailure.offline);
    }
    final Json data;
    try {
      data = decodeResponse(response);
    } on ApiException catch (e) {
      _rememberBackoff(uri, e);
      rethrow;
    }
    final failed = read
        ? response.statusCode >= 400 ||
              data['available'] == false ||
              data['error'] != null
        : response.statusCode >= 400 || data['error'] != null;
    if (failed) {
      final error = ApiException(
        str(
          read ? data['reason'] ?? data['error'] : data['error'],
          response.statusCode >= 500 ? '服务繁忙，请稍后重试' : '数据暂不可用',
        ),
        response.statusCode,
        code: data['code'] == null ? null : str(data['code']),
        retryAfter: retryAfterOf(response, data, clock()),
      );
      _rememberBackoff(uri, error);
      throw error;
    }
    return data;
  }

  void _rememberBackoff(Uri uri, ApiException error) {
    final wait = error.retryAfter;
    if (wait == null || wait <= Duration.zero) return;
    if (error.status != 429 && error.status != 503) return;
    // Never park an endpoint for long on a misconfigured header.
    final capped = wait > const Duration(minutes: 5)
        ? const Duration(minutes: 5)
        : wait;
    _backoff[uri.path] = (until: clock().add(capped), error: error);
  }

  Json decodeResponse(http.Response response) {
    final text = utf8.decode(response.bodyBytes, allowMalformed: true);
    try {
      return obj(jsonDecode(text));
    } catch (_) {
      // Cloudflare edge errors ("error code: 1102", HTML 5xx pages) are not
      // JSON. They are reported as a busy service, never as a FormatException.
      throw ApiException(
        response.statusCode >= 500 || response.statusCode == 429
            ? '服务繁忙，请稍后重试'
            : '数据服务暂未返回有效响应，请稍后重试',
        response.statusCode,
        code: 'NON_JSON',
        retryAfter: retryAfterOf(response, const {}, clock()),
      );
    }
  }

  void dispose() => client.close();
}

/// Reads `Retry-After` (seconds or HTTP date) or the JSON `retryAfter`
/// (seconds) / `retryAt` (ISO timestamp) fields.
Duration? retryAfterOf(http.Response response, Json data, DateTime now) {
  final header = response.headers['retry-after']?.trim();
  if (header != null && header.isNotEmpty) {
    final seconds = int.tryParse(header);
    if (seconds != null) return Duration(seconds: seconds);
    final date = parseHttpDate(header);
    if (date != null) return date.difference(now.toUtc());
  }
  final seconds = numOf(data['retryAfter']);
  if (seconds != null) return Duration(milliseconds: (seconds * 1000).round());
  final at = DateTime.tryParse(str(data['retryAt'], ''));
  return at?.difference(now);
}

/// IMF-fixdate, e.g. "Wed, 21 Oct 2015 07:28:00 GMT".
DateTime? parseHttpDate(String value) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  final m = RegExp(
    r'^\w{3}, (\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$',
  ).firstMatch(value);
  final month = m == null ? -1 : months.indexOf(m[2]!);
  if (m == null || month < 0) return null;
  return DateTime.utc(
    int.parse(m[3]!),
    month + 1,
    int.parse(m[1]!),
    int.parse(m[4]!),
    int.parse(m[5]!),
    int.parse(m[6]!),
  );
}

enum ApiFailure { http, offline, timeout }

class ApiException implements Exception {
  ApiException(
    this.message,
    this.status, {
    this.code,
    this.retryAfter,
    this.kind = ApiFailure.http,
  });
  final String message;
  final int status;
  final String? code;
  final Duration? retryAfter;
  final ApiFailure kind;
  bool get busy =>
      kind == ApiFailure.http &&
      (status == 429 || status == 502 || status == 503 || status == 504);
  @override
  String toString() => message;
}

/// A short, translatable message for any failure. Raw exception text such as
/// "TimeoutException after 0:00:35" or "ClientException with SocketException"
/// never reaches the screen.
String describeError(Object? error) {
  if (error is ApiException) {
    if (error.code == 'AUTH_REQUIRED') return '登录后可发起全市场扫描';
    if (error.kind != ApiFailure.http) return error.message;
    if (error.status == 401 && error.message == '数据暂不可用') {
      return '登录已过期，请重新登录';
    }
    return error.message;
  }
  if (error is TimeoutException) return '请求超时，请检查网络后重试';
  if (error is http.ClientException) return '网络不可用，请检查网络连接';
  if (error is FormatException) return error.message;
  if (error is StateError) return error.message;
  final text = '$error';
  if (text.contains('SocketException') || text.contains('ClientException')) {
    return '网络不可用，请检查网络连接';
  }
  if (text.contains('TimeoutException')) return '请求超时，请检查网络后重试';
  if (text.startsWith('Exception: ')) return text.substring(11);
  return text.isEmpty ? '数据暂不可用，请稍后重试' : text;
}

bool supportedStock(String symbol) =>
    cnStock(symbol) ||
    RegExp(r'^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$').hasMatch(symbol);
