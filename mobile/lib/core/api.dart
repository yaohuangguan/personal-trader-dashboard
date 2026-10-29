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

class AtlasApi {
  AtlasApi({String? base, http.Client? client})
    : base =
          base ??
          const String.fromEnvironment(
            'ATLAS_API_BASE',
            defaultValue: 'https://guanlan.nzs.workers.dev',
          ),
      client = client ?? http.Client();
  final String base;
  final http.Client client;
  final _pending = <String, Future<Json>>{};
  final _recent = <String, ({DateTime until, Json data})>{};
  Future<Json> get(
    String path, {
    Map<String, String>? parameters,
    String? token,
    Duration timeout = const Duration(seconds: 35),
  }) async {
    final uri = Uri.parse('$base$path').replace(queryParameters: parameters);
    const publicPaths = {
      '/api/chart-frame',
      '/api/chart-bundle',
      '/api/market',
      '/api/analysis',
      '/api/review-context',
      '/api/desk/quotes',
      '/api/desk/history',
      '/api/desk/intraday',
      '/api/desk/trend',
    };
    if (token == null && publicPaths.contains(path)) {
      final key = uri.toString(), cached = _recent[key];
      if (cached != null && cached.until.isAfter(DateTime.now())) {
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
          until: DateTime.now().add(
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

  Future<Json> _get(Uri uri, String? token, Duration timeout) async {
    final response = await client
        .get(
          uri,
          headers: {
            'accept': 'application/json',
            if (token != null) 'Authorization': 'Bearer $token',
          },
        )
        .timeout(timeout);
    final data = decodeResponse(response);
    if (response.statusCode >= 400 ||
        data['available'] == false ||
        data['error'] != null) {
      throw ApiException(
        str(data['reason'] ?? data['error'], '数据暂不可用'),
        response.statusCode,
      );
    }
    return data;
  }

  Future<Json> post(String path, Json body, {String? token}) async {
    final response = await client
        .post(
          Uri.parse('$base$path'),
          headers: {
            if (token != null) 'Authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 40));
    final data = decodeResponse(response);
    if (response.statusCode >= 400 || data['error'] != null) {
      throw ApiException(str(data['error']), response.statusCode);
    }
    return data;
  }

  Json decodeResponse(http.Response response) {
    final text = utf8.decode(response.bodyBytes, allowMalformed: true);
    try {
      return obj(jsonDecode(text));
    } catch (_) {
      final limit =
          text.contains('Worker exceeded resource limits') ||
          text.contains('Error 1102');
      throw ApiException(
        limit
            ? '云端计算达到上限，请重试；已保存的行情快照仍可查看。'
            : '数据服务暂未返回有效响应（HTTP ${response.statusCode}），请稍后重试。',
        response.statusCode,
      );
    }
  }

  void dispose() => client.close();
}

class ApiException implements Exception {
  ApiException(this.message, this.status);
  final String message;
  final int status;
  @override
  String toString() => message;
}
