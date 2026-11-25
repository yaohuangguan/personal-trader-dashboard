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
  final keyInput = TextEditingController(),
      email = TextEditingController(),
      username = TextEditingController(),
      login = TextEditingController(),
      password = TextEditingController();
  bool working = false, registering = false;
  String? error;
  Future<void> run(Future<void> Function() task) async {
    setState(() {
      working = true;
      error = null;
    });
    try {
      await task();
      keyInput.clear();
      password.clear();
    } catch (e) {
      error = '$e';
    }
    if (mounted) setState(() => working = false);
  }

  @override
  void dispose() {
    for (final c in [keyInput, email, username, login, password]) {
      c.dispose();
    }
    super.dispose();
  }

  Widget field(
    AtlasStore s,
    TextEditingController c,
    String label, {
    bool secret = false,
    TextInputType? type,
    Iterable<String>? hints,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: TextField(
      controller: c,
      obscureText: secret,
      autocorrect: false,
      enableSuggestions: false,
      keyboardType: type,
      autofillHints: hints,
      decoration: InputDecoration(labelText: s.t(label)),
    ),
  );

  Widget accountSection(AtlasStore s) {
    final account = s.account;
    if (s.accountToken.isNotEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${s.t('已登录')} · ${account['username'] ?? ''}',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          if ('${account['email'] ?? ''}'.isNotEmpty)
            Text('${account['email']}'),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: working || s.syncBusy ? null : () => run(s.syncCloud),
                icon: const Icon(Icons.sync),
                label: Text(s.t('立即同步')),
              ),
              TextButton(
                onPressed: working ? null : () => run(s.logoutAccount),
                child: Text(s.t('退出登录')),
              ),
            ],
          ),
        ],
      );
    }
    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SegmentedButton<bool>(
            segments: [
              ButtonSegment(value: false, label: Text(s.t('登录'))),
              ButtonSegment(value: true, label: Text(s.t('注册'))),
            ],
            selected: {registering},
            onSelectionChanged: (v) => setState(() {
              registering = v.first;
              error = null;
            }),
          ),
          const SizedBox(height: 10),
          if (registering) ...[
            field(
              s,
              email,
              '邮箱',
              type: TextInputType.emailAddress,
              hints: const [AutofillHints.email],
            ),
            field(
              s,
              username,
              '用户名',
              hints: const [AutofillHints.newUsername],
            ),
            field(
              s,
              password,
              '密码（至少8位）',
              secret: true,
              hints: const [AutofillHints.newPassword],
            ),
          ] else ...[
            field(
              s,
              login,
              '邮箱或用户名',
              type: TextInputType.emailAddress,
              hints: const [AutofillHints.username, AutofillHints.email],
            ),
            field(
              s,
              password,
              '密码',
              secret: true,
              hints: const [AutofillHints.password],
            ),
          ],
          FilledButton(
            onPressed: working
                ? null
                : () => run(() async {
                    if (registering) {
                      if (password.text.length < 8) {
                        throw const FormatException('密码需为8-128位');
                      }
                      await s.registerAccount(
                        email.text,
                        username.text,
                        password.text,
                      );
                    } else {
                      await s.loginAccount(login.text, password.text);
                    }
                    TextInput.finishAutofillContext();
                  }),
            child: Text(s.t(registering ? '注册并同步自选' : '登录并同步自选')),
          ),
        ],
      ),
    );
  }

  Widget keySection(AtlasStore s) => ExpansionTile(
    tilePadding: EdgeInsets.zero,
    childrenPadding: EdgeInsets.zero,
    initiallyExpanded: s.syncKey.isNotEmpty,
    title: Text(s.t('使用同步密钥（无需账号）')),
    children: [
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
              onPressed: working || s.syncBusy ? null : () => run(s.syncCloud),
              icon: const Icon(Icons.sync),
              label: Text(s.t('立即同步')),
            ),
            OutlinedButton(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: s.syncKey));
                if (mounted) {
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
      Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton(
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
      ),
      const SizedBox(height: 8),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(s.t('账号与自选同步'), style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text(s.t(s.syncStatus)),
          const SizedBox(height: 6),
          Text(s.t('登录后自选和分组保存在账号里，手机和网页登录同一账号即可同步。首次登录会把本机所有自选合并上传，不会覆盖。')),
          const SizedBox(height: 12),
          accountSection(s),
          if (s.accountToken.isEmpty) keySection(s),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                s.t(error!.replaceFirst('FormatException: ', '')),
                style: const TextStyle(color: Colors.redAccent),
              ),
            ),
        ],
      ),
    );
  }
}
