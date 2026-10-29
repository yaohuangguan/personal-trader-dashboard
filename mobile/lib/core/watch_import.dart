import 'dart:convert';

import 'package:flutter/services.dart';

import 'api.dart';

class WatchImport {
  static const channel = MethodChannel('space.ps6.marketAtlas/watch-import');
  static Future<Json> pickImages() async =>
      obj(await channel.invokeMethod('pickImages'));
  static Future<Json> pickTextFile() async =>
      obj(await channel.invokeMethod('pickTextFile'));
}

List<String> parseWatchText(String input) {
  if (input.length > 2000000) throw const FormatException('文件过大，请分批导入');
  final out = <String>{};
  void add(String raw) {
    raw = raw.toUpperCase().trim();
    if (RegExp(r'^[A-Z][A-Z0-9.^-]{0,16}$').hasMatch(raw) &&
        !RegExp(r'^(SH|SZ|BJ)[:.]?[0-9]{6}').hasMatch(raw)) {
      out.add(raw);
      return;
    }
    final explicit = RegExp(
      r'^(?:([A-Z]{2})[:.]?)?([0-9]{6})(?:[.:]([A-Z]{2}))?$',
    ).firstMatch(raw);
    if (explicit == null) return;
    final code = explicit.group(2)!,
        market = explicit.group(1) ?? explicit.group(3);
    if (!RegExp(r'^(?:00|30|60|68|51|56|58|15|16|4|8|9)').hasMatch(code)) {
      return;
    }
    if (market != null && !['SH', 'SZ', 'BJ'].contains(market)) return;
    out.add(
      '$code.${market ?? (code.startsWith('6') || code.startsWith('5')
              ? 'SH'
              : RegExp(r'^[489]').hasMatch(code)
              ? 'BJ'
              : 'SZ')}',
    );
  }

  try {
    final json = jsonDecode(input),
        list = json is List ? json : obj(json)['watchlist'];
    if (list is List) {
      for (final v in list) {
        add('$v');
      }
      return out.toList();
    }
  } catch (_) {}
  // Six digits only; do not interpret prices, phone numbers, dates or seven-digit broker flags as codes.
  for (final match in RegExp(
    r'(?<![0-9.])(?:SH|SZ|BJ)?[:.]?[0-9]{6}(?:[.:](?:SH|SZ|BJ))?(?![0-9.]|\.[0-9])',
    caseSensitive: false,
  ).allMatches(input)) {
    add(match.group(0)!);
  }
  // US symbols are accepted only as a complete line, avoiding OCR headings like VOL.
  for (final line in input.split(RegExp(r'[\r\n]+'))) {
    if (RegExp(r'^[A-Za-z][A-Za-z0-9.^-]{0,10}$').hasMatch(line.trim()) &&
        ![
          'VOL',
          'MACD',
          'KDJ',
          'RSI',
          'SH',
          'SZ',
          'BJ',
          'CSV',
          'JSON',
          'TXT',
        ].contains(line.trim().toUpperCase())) {
      add(line);
    }
  }
  return out.toList();
}
