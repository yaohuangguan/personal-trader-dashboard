import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/watch_import.dart';
import '../core/watch_transfer.dart';
import '../core/watch_transfer_share.dart';
import '../widgets/common.dart';

Future<void> showWatchImport(
  BuildContext context, {
  bool pickFile = false,
  bool enterCode = false,
}) => Navigator.of(context).push<void>(
  MaterialPageRoute(
    builder: (_) => WatchImportPage(pickFile: pickFile, enterCode: enterCode),
  ),
);

class WatchImportPage extends StatefulWidget {
  const WatchImportPage({
    super.key,
    this.pickFile = false,
    this.enterCode = false,
  });
  final bool pickFile, enterCode;
  @override
  State<WatchImportPage> createState() => _WatchImportPageState();
}

class _WatchImportPageState extends State<WatchImportPage> {
  final text = TextEditingController(), groupName = TextEditingController();
  List<String> symbols = [];
  final selected = <String>{}, names = <String, String>{};
  bool busy = false, verified = false;
  String? error, notice;
  String group = 'all';
  WatchTransfer? portable;
  bool importGroups = true;
  @override
  void initState() {
    super.initState();
    if (widget.pickFile &&
        !kIsWeb &&
        defaultTargetPlatform == TargetPlatform.iOS) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) pick(false);
      });
    }
  }

  @override
  void dispose() {
    text.dispose();
    groupName.dispose();
    super.dispose();
  }

  Future<void> pick(bool image) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final r = await (image
          ? WatchImport.pickImages()
          : WatchImport.pickTextFile());
      if (r['cancelled'] == true) return;
      text.text = image
          ? [
              portable == null ? text.text : '',
              str(r['text'], ''),
            ].where((v) => v.isNotEmpty).join('\n')
          : str(r['text'], '');
      notice = (numOf(r['failedImages']) ?? 0) == 0 ? null : '部分图片未识别，请核对结果。';
    } catch (e) {
      if (mounted) setState(() => error = '读取失败：${describeError(e)}');
    } finally {
      if (mounted) setState(() => busy = false);
    }
    if (mounted) await preview();
  }

  Future<void> preview() async {
    setState(() {
      busy = true;
      error = null;
      verified = false;
    });
    try {
      portable = null;
      final raw = text.text.trimLeft(),
          code = raw.trim().replaceAll(RegExp(r'\s'), '');
      final isCode = shareCodePattern.hasMatch(code);
      if (isCode || raw.startsWith('{') || raw.startsWith('[')) {
        final packet = isCode
            ? await readWatchShareCode(context.read<AtlasStore>().api, code)
            : WatchTransfer.parse(text.text);
        if (packet.watchlist.isEmpty) throw const FormatException('文件中没有自选股票');
        if (!mounted) return;
        setState(() {
          portable = packet;
          symbols = packet.watchlist;
          selected
            ..clear()
            ..addAll(symbols);
          names.clear();
          verified = true;
          importGroups = true;
          notice = isCode
              ? '已读取分享码 ${code.toUpperCase()}；股票与分组可一起导入。'
              : '已读取自选文件；股票与分组可一起导入，无需等待行情源。';
        });
        return;
      }
      final parsed = parseWatchText(text.text);
      if (parsed.isEmpty) {
        throw const FormatException('未找到股票代码，请在原App显示代码后截图，或粘贴含代码的名单。');
      }
      final api = context.read<AtlasStore>().api,
          cn = parsed.where(cnStock).take(300).toList();
      names.clear();
      final valid = <String>[];
      for (var i = 0; i < cn.length; i += 60) {
        final r = await api.get(
          '/api/desk/quotes',
          parameters: {'symbols': cn.skip(i).take(60).join(',')},
        );
        for (final q in rows(r['items'])) {
          final s = str(q['symbol']);
          valid.add(s);
          names[s] = str(q['name'], s);
        }
      }
      valid.addAll(parsed.where((s) => !cnStock(s)).take(60));
      if (!mounted) return;
      setState(() {
        symbols = parsed.where(valid.contains).toList();
        selected
          ..clear()
          ..addAll(symbols);
        verified = true;
        final t = context.read<AtlasStore>().t;
        notice = [
          t('识别 ${parsed.length} 个，核验 ${symbols.length} 个；重复项自动合并。'),
          if (parsed.length > symbols.length) t('未核验代码不会加入，请核对原图。'),
        ].join(' ');
      });
    } catch (e) {
      if (mounted) setState(() => error = describeError(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> save() async {
    final store = context.read<AtlasStore>();
    if (selected.isEmpty) return;
    setState(() => busy = true);
    try {
      if (portable != null) {
        final result = await store.mergeWatchTransfer(
          portable!.select(selected, includeGroups: importGroups),
        );
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              store.t(
                '导入完成 · 新增股票 ${result.added} · 新建分组 ${result.groupsAdded}；已有自选保留。',
              ),
            ),
          ),
        );
        Navigator.pop(context);
        return;
      }
      final id = group == 'new'
          ? await store.saveGroup(groupName.text)
          : group == 'all'
          ? null
          : group;
      final count = await store.mergeWatch(selected.toList(), groupId: id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(store.t('已新增 $count 只，已有自选保留；已连接云同步时自动同步。'))),
      );
      Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => error = describeError(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AtlasStore>(),
        ios = defaultTargetPlatform == TargetPlatform.iOS && !kIsWeb,
        packet = portable?.select(selected, includeGroups: importGroups),
        plan = packet == null
            ? null
            : planWatchImport(store.watchlist, store.groups, packet);
    return Scaffold(
      appBar: AppBar(title: Text(store.t('导入自选'))),
      bottomNavigationBar: portable != null && verified
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                child: FilledButton(
                  onPressed: busy || selected.isEmpty ? null : save,
                  child: Text(store.t('一键合并导入')),
                ),
              ),
            )
          : null,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              store.t('导入观澜自选文件，或从其他App迁入'),
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(
              store.t('在原App自选页显示股票代码并截图，可分多张；或复制代码名单。识别后先核对，再合并到自选。'),
              style: const TextStyle(height: 1.6),
            ),
            if (ios) ...[
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: busy ? null : () => pick(true),
                icon: const Icon(Icons.photo_library_outlined),
                label: Text(store.t('选择自选截图（可多张）')),
              ),
              TextButton.icon(
                onPressed: busy ? null : () => pick(false),
                icon: const Icon(Icons.file_open_outlined),
                label: Text(store.t('选择 TXT / CSV / JSON 文件')),
              ),
              Text(
                store.t('截图只在本机识别；仅代码用于查询名称，不上传图片。'),
                style: TextStyle(color: muted, fontSize: 12, height: 1.5),
              ),
            ],
            const SizedBox(height: 12),
            if (portable == null) ...[
              TextField(
                controller: text,
                minLines: 4,
                maxLines: 8,
                enabled: !busy,
                onChanged: (_) => setState(() => verified = false),
                autofocus: widget.enterCode,
                textCapitalization: widget.enterCode
                    ? TextCapitalization.characters
                    : TextCapitalization.none,
                decoration: InputDecoration(
                  labelText: store.t(
                    widget.enterCode ? '输入分享码，如 ABCD-2345' : '粘贴名单、分享码或查看识别原文',
                  ),
                  hintText: widget.enterCode
                      ? 'ABCD-2345'
                      : '300750 宁德时代\n002594 比亚迪\n600036 招商银行',
                  border: OutlineInputBorder(),
                ),
              ),
              TextButton.icon(
                onPressed: busy
                    ? null
                    : () async {
                        final data = await Clipboard.getData('text/plain');
                        if (!mounted) return;
                        text.text = data?.text ?? '';
                        await preview();
                      },
                icon: const Icon(Icons.content_paste),
                label: Text(store.t('从剪贴板粘贴并识别')),
              ),
              OutlinedButton(
                onPressed: busy ? null : preview,
                child: Text(store.t('识别并预览')),
              ),
            ],
            if (busy) const LinearProgressIndicator(),
            if (error != null) Notice(error!),
            if (notice != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Text(
                  store.t(notice!),
                  style: TextStyle(color: muted, height: 1.5),
                ),
              ),
            if (verified) ...[
              if (portable == null)
                DropdownButtonFormField<String>(
                  menuMaxHeight: compactMenuHeight(context),
                  initialValue: group,
                  decoration: InputDecoration(labelText: store.t('导入到分组')),
                  items: [
                    DropdownMenuItem(
                      value: 'all',
                      child: Text(store.t('全部自选')),
                    ),
                    for (final g in store.groups)
                      DropdownMenuItem(
                        value: str(g['id']),
                        child: Text(str(g['name'])),
                      ),
                    DropdownMenuItem(
                      value: 'new',
                      child: Text(store.t('新建分组')),
                    ),
                  ],
                  onChanged: busy
                      ? null
                      : (v) => setState(() => group = v ?? 'all'),
                ),
              if (group == 'new' && portable == null)
                TextField(
                  controller: groupName,
                  maxLength: 24,
                  decoration: InputDecoration(labelText: store.t('分组名称')),
                ),
              if (portable != null) ...[
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(store.t('同时导入分组')),
                  value: importGroups,
                  onChanged: busy
                      ? null
                      : (v) => setState(() => importGroups = v == true),
                ),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: portable!.groups
                      .map((g) => Chip(label: Text(str(g['name']))))
                      .toList(),
                ),
                if (plan != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      store.t(
                        '新增股票 ${plan.added} · 已有股票 ${plan.existing} · 新建分组 ${plan.groupsAdded}',
                      ),
                      style: TextStyle(color: muted, height: 1.7),
                    ),
                  ),
                if (plan != null &&
                    (plan.skipped > 0 || plan.groupsSkipped > 0))
                  Notice(
                    '容量不足跳过：股票 ${plan.skipped} · 分组 ${plan.groupsSkipped}。自选最多60只、分组最多20个；已有数据不会删除。',
                  ),
                Text(
                  store.t('仅交换股票和分组，不包含云同步密钥、提醒或账号资料。'),
                  style: TextStyle(color: muted, fontSize: 12, height: 1.7),
                ),
              ],
              for (final symbol in symbols)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: selected.contains(symbol),
                  onChanged: busy
                      ? null
                      : (v) => setState(
                          () => v == true
                              ? selected.add(symbol)
                              : selected.remove(symbol),
                        ),
                  title: Text(names[symbol] ?? symbol),
                  subtitle: Text(
                    symbol +
                        (store.watchlist.contains(symbol)
                            ? store.t(' · 已在自选')
                            : ''),
                  ),
                ),
              Text(
                store.t(
                  '当前自选 ${store.watchlist.length}/60；已有股票不会重复加入，超出容量的新增项请分组整理后再导入。',
                ),
                style: TextStyle(color: muted, fontSize: 12, height: 1.5),
              ),
              const SizedBox(height: 12),
              if (portable == null)
                FilledButton(
                  onPressed: busy || selected.isEmpty ? null : save,
                  child: Text(
                    portable != null
                        ? store.t('一键合并导入')
                        : store.t('确认合并 ${selected.length} 只'),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
