import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import 'api.dart';

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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${store.t('导出失败')}：${store.t(describeError(e))}'),
        ),
      );
    }
  }
}

/// Share codes look like ABCD-2345 (no 0/O/1/I/L), dash optional.
final shareCodePattern = RegExp(
  r'^[A-HJKMNP-Z2-9]{4}-?[A-HJKMNP-Z2-9]{4}$',
  caseSensitive: false,
);

/// Uploads a snapshot of the current stocks and groups and returns its code.
Future<Json> createWatchShareCode(AtlasStore store) async {
  if (store.watchlist.isEmpty) throw const FormatException('还没有自选股票');
  return store.api.post(
    '/api/watch-share',
    obj(jsonDecode(serializeWatchTransfer(store.watchlist, store.groups))),
  );
}

/// Fetches a share code as a portable transfer, ready for the import preview.
Future<WatchTransfer> readWatchShareCode(AtlasApi api, String input) async {
  final code = input.replaceAll(RegExp(r'\s'), '');
  if (!shareCodePattern.hasMatch(code)) {
    throw const FormatException('分享码格式无效');
  }
  final packet = WatchTransfer.parse(
    jsonEncode(await api.get('/api/watch-share/${Uri.encodeComponent(code)}')),
  );
  if (packet.watchlist.isEmpty) throw const FormatException('分享码中没有自选股票');
  return packet;
}

Future<void> shareWatchCode(BuildContext context) async {
  final store = context.read<AtlasStore>();
  final box = context.findRenderObject() as RenderBox?;
  try {
    final made = await createWatchShareCode(store);
    final code = str(made['code']),
        message = '${store.t('在观澜输入分享码导入我的自选：')}$code';
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(store.t('分享码')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SelectableText(
              code,
              style: Theme.of(dialog).textTheme.headlineMedium?.copyWith(
                letterSpacing: 3,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(height: 10),
            Text(store.t('分享码已生成，30天内有效；对方在“输入分享码”中一键导入。')),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: message));
              if (dialog.mounted) Navigator.of(dialog).pop();
              if (context.mounted) {
                ScaffoldMessenger.of(context)
                    .showSnackBar(SnackBar(content: Text(store.t('分享码已复制'))));
              }
            },
            child: Text(store.t('复制')),
          ),
          FilledButton(
            onPressed: () => SharePlus.instance.share(
              ShareParams(
                text: message,
                sharePositionOrigin: box == null
                    ? null
                    : box.localToGlobal(Offset.zero) & box.size,
              ),
            ),
            child: Text(store.t('分享')),
          ),
        ],
      ),
    );
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${store.t('生成分享码失败')}：${store.t(describeError(e))}'),
        ),
      );
    }
  }
}
