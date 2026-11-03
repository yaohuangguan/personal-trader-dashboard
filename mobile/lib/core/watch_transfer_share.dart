import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import 'store.dart';
import 'watch_transfer.dart';

Future<void> shareWatchTransfer(BuildContext context) async {
  final store = context.read<AtlasStore>();
  try {
    if (store.watchlist.isEmpty) throw const FormatException('还没有自选股票');
    final content = serializeWatchTransfer(store.watchlist, store.groups);
    final name =
        'guanlan-watchlist-${DateTime.now().toIso8601String().substring(0, 10)}.json';
    final box = context.findRenderObject() as RenderBox?;
    await SharePlus.instance.share(
      ShareParams(
        files: [
          XFile.fromData(
            utf8.encode(content),
            mimeType: 'application/json',
            name: name,
          ),
        ],
        fileNameOverrides: [name],
        subject: store.t('观澜自选'),
        sharePositionOrigin: box == null
            ? null
            : box.localToGlobal(Offset.zero) & box.size,
      ),
    );
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('${store.t('导出失败')}：$e')));
    }
  }
}
