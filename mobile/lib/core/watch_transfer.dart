import 'dart:convert';
import 'dart:math';

import 'api.dart';

const watchTransferFormat = 'guanlan-watchlist';
const watchTransferMaxBytes = 262144;

class WatchTransfer {
  WatchTransfer(this.watchlist, this.groups);
  final List<String> watchlist;
  final List<Json> groups;
  factory WatchTransfer.parse(String input) {
    if (utf8.encode(input).length > watchTransferMaxBytes) {
      throw const FormatException('自选文件过大，最大256KB');
    }
    dynamic raw;
    try {
      raw = jsonDecode(input.replaceFirst(RegExp(r'^\uFEFF'), ''));
    } catch (_) {
      throw const FormatException('不是有效的自选JSON文件');
    }
    if (raw is List) {
      raw = <String, dynamic>{'watchlist': raw};
    }
    if (raw is! Map ||
        raw.containsKey('format') &&
            (raw['format'] != watchTransferFormat || raw['version'] != 1)) {
      throw const FormatException('不支持的自选文件格式或版本');
    }
    final watchlist = _tickers(raw['watchlist']),
        allowed = watchlist.toSet(),
        groups = <Json>[];
    if (raw.containsKey('groups') &&
        (raw['groups'] is! List || (raw['groups'] as List).length > 30)) {
      throw const FormatException('自选分组格式无效或超过30组');
    }
    for (final g in (raw['groups'] as List?) ?? []) {
      if (g is! Map ||
          g['name'] is! String ||
          (g['name'] as String).trim().isEmpty ||
          (g['name'] as String).trim().length > 24 ||
          RegExp(r'[\u0000-\u001f\u007f]').hasMatch(g['name'] as String)) {
        throw const FormatException('分组名称需要1–24个字');
      }
      final members = _tickers(g['symbols']),
          name = (g['name'] as String).trim();
      if (members.any((s) => !allowed.contains(s))) {
        throw const FormatException('分组包含自选名单之外的代码');
      }
      final old = groups.where((g) => g['name'] == name).firstOrNull;
      if (old == null) {
        groups.add({'name': name, 'symbols': members});
      } else {
        old['symbols'] = <String>{
          ...List<String>.from(old['symbols']),
          ...members,
        }.toList();
      }
    }
    return WatchTransfer(watchlist, groups);
  }
  Json toJson() => {
    'format': watchTransferFormat,
    'version': 1,
    'watchlist': watchlist,
    'groups': groups
        .map((g) => {'name': g['name'], 'symbols': g['symbols']})
        .toList(),
  };
  WatchTransfer select(Set<String> selected, {bool includeGroups = true}) {
    final result = <Json>[];
    if (includeGroups) {
      for (final g in groups) {
        final members = List<String>.from(g['symbols'])
            .where(selected.contains)
            .toList();
        if (members.isNotEmpty || (g['symbols'] as List).isEmpty) {
          result.add({'name': g['name'], 'symbols': members});
        }
      }
    }
    return WatchTransfer(watchlist.where(selected.contains).toList(), result);
  }
}

List<String> _tickers(dynamic value) {
  if (value is! List || value.length > 200) {
    throw const FormatException('自选代码格式无效或超过200只');
  }
  final result = <String>{};
  for (final v in value) {
    if (v is! String || v.length > 64) {
      throw const FormatException('自选代码格式无效或超过200只');
    }
    var symbol = v.trim().toUpperCase();
    if (!RegExp(r'^[A-Z0-9.^:=_-]{1,32}$').hasMatch(symbol)) {
      throw const FormatException('自选代码格式无效或超过200只');
    }
    if (RegExp(r'^\d{6}$').hasMatch(symbol)) {
      symbol +=
          '.${RegExp(r'^[65]').hasMatch(symbol)
              ? 'SH'
              : RegExp(r'^(?:4|8|92)').hasMatch(symbol)
              ? 'BJ'
              : 'SZ'}';
    }
    result.add(symbol);
  }
  return result.toList();
}

String serializeWatchTransfer(List<String> watchlist, List<Json> groups) {
  final allowed = watchlist.toSet();
  final value = WatchTransfer.parse(
    jsonEncode({
      'format': watchTransferFormat,
      'version': 1,
      'watchlist': watchlist,
      'groups': groups
          .map(
            (g) => {
              'name': g['name'],
              'symbols': (g['symbols'] as List)
                  .where(allowed.contains)
                  .toList(),
            },
          )
          .toList(),
    }),
  );
  return const JsonEncoder.withIndent('  ').convert(value.toJson());
}

class WatchImportPlan {
  WatchImportPlan(
    this.watchlist,
    this.groups,
    this.added,
    this.existing,
    this.skipped,
    this.groupsAdded,
    this.groupsMerged,
    this.groupsSkipped,
  );
  final List<String> watchlist;
  final List<Json> groups;
  final int added, existing, skipped, groupsAdded, groupsMerged, groupsSkipped;
}

WatchImportPlan planWatchImport(
  List<String> current,
  List<Json> oldGroups,
  WatchTransfer input, {
  String Function()? newId,
}) {
  final source = WatchTransfer.parse(jsonEncode(input.toJson())),
      watchlist = [...current],
      old = current.toSet(),
      groups = oldGroups
          .map((g) => {...g, 'symbols': List<String>.from(g['symbols'])})
          .toList();
  int added = 0,
      existing = 0,
      skipped = 0,
      groupsAdded = 0,
      groupsMerged = 0,
      groupsSkipped = 0;
  for (final s in source.watchlist) {
    if (old.contains(s)) {
      existing++;
    } else if (watchlist.length >= 60) {
      skipped++;
    } else {
      watchlist.add(s);
      added++;
    }
  }
  final allowed = watchlist.toSet();
  for (final g in source.groups) {
    final members = List<String>.from(g['symbols'])
            .where(allowed.contains)
            .toList(),
        found = groups.where((v) => v['name'] == g['name']).firstOrNull;
    if (found != null) {
      found['symbols'] = <String>{
        ...List<String>.from(found['symbols']),
        ...members,
      }.toList();
      groupsMerged++;
      continue;
    }
    if (groups.length >= 20 ||
        (g['symbols'] as List).isNotEmpty && members.isEmpty) {
      groupsSkipped++;
      continue;
    }
    final id =
        newId?.call() ??
        '${DateTime.now().microsecondsSinceEpoch}_${Random.secure().nextInt(0x7fffffff)}';
    if (!RegExp(r'^[\w-]{1,100}$').hasMatch(id) ||
        groups.any((g) => g['id'] == id)) {
      throw const FormatException('无法创建新的分组标识');
    }
    groups.add({'id': id, 'name': g['name'], 'symbols': members});
    groupsAdded++;
  }
  return WatchImportPlan(
    watchlist,
    groups,
    added,
    existing,
    skipped,
    groupsAdded,
    groupsMerged,
    groupsSkipped,
  );
}
