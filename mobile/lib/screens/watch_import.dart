import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/watch_import.dart';
import '../widgets/common.dart';

Future<void> showWatchImport(BuildContext context) =>
    Navigator.of(context)
        .push<void>(MaterialPageRoute(builder: (_) => const WatchImportPage()));

class WatchImportPage extends StatefulWidget {
  const WatchImportPage({super.key});
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
      text.text = [
        text.text,
        str(r['text'], ''),
      ].where((v) => v.isNotEmpty).join('\n');
      notice = (numOf(r['failedImages']) ?? 0) == 0 ? null : '部分图片未识别，请核对结果。';
    } catch (e) {
      if (mounted) setState(() => error = '读取失败：$e');
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
        notice =
            '识别 ${parsed.length} 个，核验 ${symbols.length} 个；重复项自动合并。${parsed.length > symbols.length ? '未核验代码不会加入，请核对原图。' : ''}';
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> save() async {
    final store = context.read<AtlasStore>();
    if (selected.isEmpty) return;
    setState(() => busy = true);
    try {
      final id = group == 'new'
          ? await store.saveGroup(groupName.text)
          : group == 'all'
          ? null
          : group;
      final count = await store.mergeWatch(selected.toList(), groupId: id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('已新增 $count 只，已有自选保留；已连接云同步时自动同步。')),
      );
      Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AtlasStore>(),
        ios = defaultTargetPlatform == TargetPlatform.iOS && !kIsWeb;
    return Scaffold(
      appBar: AppBar(title: const Text('导入自选')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              '从同花顺、招商证券、东方财富等App迁入',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            const Text(
              '在原App自选页显示股票代码并截图，可分多张；或复制代码名单。识别后先核对，再合并到自选。',
              style: TextStyle(height: 1.6),
            ),
            if (ios) ...[
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: busy ? null : () => pick(true),
                icon: const Icon(Icons.photo_library_outlined),
                label: const Text('选择自选截图（可多张）'),
              ),
              TextButton.icon(
                onPressed: busy ? null : () => pick(false),
                icon: const Icon(Icons.file_open_outlined),
                label: const Text('选择 TXT / CSV / JSON 文件'),
              ),
              Text(
                '截图只在本机识别；仅代码用于查询名称，不上传图片。',
                style: TextStyle(color: muted, fontSize: 12, height: 1.5),
              ),
            ],
            const SizedBox(height: 12),
            TextField(
              controller: text,
              minLines: 4,
              maxLines: 8,
              enabled: !busy,
              onChanged: (_) => setState(() => verified = false),
              decoration: const InputDecoration(
                labelText: '粘贴名单或查看识别原文',
                hintText: '300750 宁德时代\n002594 比亚迪\n600036 招商银行',
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
              label: const Text('从剪贴板粘贴并识别'),
            ),
            OutlinedButton(
              onPressed: busy ? null : preview,
              child: const Text('识别并预览'),
            ),
            if (busy) const LinearProgressIndicator(),
            if (error != null) Notice(error!),
            if (notice != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Text(
                  notice!,
                  style: TextStyle(color: muted, height: 1.5),
                ),
              ),
            if (verified) ...[
              DropdownButtonFormField<String>(
                initialValue: group,
                decoration: const InputDecoration(labelText: '导入到分组'),
                items: [
                  const DropdownMenuItem(value: 'all', child: Text('全部自选')),
                  for (final g in store.groups)
                    DropdownMenuItem(
                      value: str(g['id']),
                      child: Text(str(g['name'])),
                    ),
                  const DropdownMenuItem(value: 'new', child: Text('新建分组')),
                ],
                onChanged: busy
                    ? null
                    : (v) => setState(() => group = v ?? 'all'),
              ),
              if (group == 'new')
                TextField(
                  controller: groupName,
                  maxLength: 24,
                  decoration: const InputDecoration(labelText: '分组名称'),
                ),
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
                        (store.watchlist.contains(symbol) ? ' · 已在自选' : ''),
                  ),
                ),
              Text(
                '当前自选 ${store.watchlist.length}/60；已有股票不会重复加入，超出容量的新增项请分组整理后再导入。',
                style: TextStyle(color: muted, fontSize: 12, height: 1.5),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: busy || selected.isEmpty ? null : save,
                child: Text('确认合并 ${selected.length} 只'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
