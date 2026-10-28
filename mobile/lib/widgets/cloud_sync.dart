import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/store.dart';
import 'common.dart';

class CloudSyncPanel extends StatefulWidget {
  const CloudSyncPanel({super.key});
  @override
  State<CloudSyncPanel> createState() => _CloudSyncPanelState();
}

class _CloudSyncPanelState extends State<CloudSyncPanel> {
  final keyInput = TextEditingController();
  bool working = false;
  String? error;
  Future<void> run(Future<void> Function() task) async {
    setState(() {
      working = true;
      error = null;
    });
    try {
      await task();
      keyInput.clear();
    } catch (e) {
      error = '$e';
    }
    if (mounted) setState(() => working = false);
  }

  @override
  void dispose() {
    keyInput.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(s.t('自选云同步'), style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          Text(s.t(s.syncStatus)),
          const SizedBox(height: 8),
          Text(s.t('另一设备输入同一同步密钥，自选和分组自动同步。离线修改联网后补传。密钥仅交给自己的设备。')),
          const SizedBox(height: 12),
          if (s.syncKey.isEmpty)
            FilledButton.tonal(
              onPressed: working ? null : () => run(() => s.connectCloud()),
              child: Text(s.t('创建我的云同步')),
            ),
          if (s.syncKey.isNotEmpty)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: working || s.syncBusy
                      ? null
                      : () => run(s.syncCloud),
                  icon: const Icon(Icons.sync),
                  label: Text(s.t('立即同步')),
                ),
                OutlinedButton(
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: s.syncKey));
                    if (context.mounted) {
                      ScaffoldMessenger.of(
                        context,
                      ).showSnackBar(SnackBar(content: Text(s.t('同步密钥已复制'))));
                    }
                  },
                  child: Text(s.t('复制同步密钥')),
                ),
                TextButton(
                  onPressed: working ? null : s.disconnectCloud,
                  child: Text(s.t('断开本机')),
                ),
              ],
            ),
          const SizedBox(height: 12),
          TextField(
            controller: keyInput,
            obscureText: true,
            autocorrect: false,
            enableSuggestions: false,
            decoration: InputDecoration(labelText: s.t('粘贴另一设备的同步密钥')),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: working
                ? null
                : () => run(() async {
                    final k = keyInput.text.trim();
                    if (!RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(k)) {
                      throw const FormatException('同步密钥格式无效');
                    }
                    await s.connectCloud(k);
                  }),
            child: Text(s.t('连接并合并自选')),
          ),
          if (error != null)
            Text(error!, style: const TextStyle(color: Colors.redAccent)),
        ],
      ),
    );
  }
}
