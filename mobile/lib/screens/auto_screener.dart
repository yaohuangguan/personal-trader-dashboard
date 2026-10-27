import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/screener.dart';
import '../widgets/common.dart';
import 'stock.dart';

class AutomaticScreenPanel extends StatefulWidget {
  const AutomaticScreenPanel({super.key});
  @override
  State<AutomaticScreenPanel> createState() => _AutomaticScreenPanelState();
}

class _AutomaticScreenPanelState extends State<AutomaticScreenPanel> {
  Json? report;
  String? error;
  bool loading = false, activity = true, recent = false, useShared = true;
  String concentration = '20', cap = '1000';
  int visible = 40;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      useShared = true;
    });
    try {
      final r = await context.read<AtlasStore>().api.get(
        '/api/desk/close-report',
      );
      if (mounted) {
        setState(() {
          report = r['report'] == null ? null : obj(r['report']);
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> beginScan(ScreenerController scan) async {
    setState(() => useShared = false);
    await scan.start('all', true, true, options: options);
  }

  Json get options => {
    'strategy': 'auto',
    'modes': 'bloom,bullish,multi,beauty,spider,cannon,limitup',
    'concentration': concentration,
    'maxCap': cap,
    'activity': activity ? '1' : '0',
    'recentLimitUp': recent ? '1' : '0',
  };
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(),
        scan = context.watch<ScreenerController>();
    final manual =
        !useShared && obj(scan.state['options'])['strategy'] == 'auto';
    final candidates =
        (manual ? scan.candidates : rows(report?['candidates']))
            .where(
              (c) =>
                  (numOf(c['amount']) ?? 0) >= 2e8 &&
                  (numOf(obj(c['chip'])['concentration90']) ?? 99) <
                      double.parse(concentration) &&
                  (cap.isEmpty ||
                      (numOf(c['marketCap']) ?? double.infinity) <=
                          double.parse(cap) * 1e8) &&
                  (!activity ||
                      obj(c['character'])['quiet'] == false &&
                          obj(c['character'])['weakFollow'] == false) &&
                  (!recent || ((c['limitUpDates'] as List?) ?? []).isNotEmpty),
            )
            .toList()
          ..sort(
            (a, b) => (numOf(obj(b['ranking'])['score']) ?? 0).compareTo(
              numOf(obj(a['ranking'])['score']) ?? 0,
            ),
          );
    final accent = AtlasPalette.light
        ? const Color(0xff6553b7)
        : const Color(0xffb0a8fb);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.auto_awesome_outlined, color: accent, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      s.t('自动综合评估'),
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  Text(
                    '${candidates.length}',
                    style: TextStyle(color: accent, fontSize: 24),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                '${s.t('最近收盘')} ${report?['date'] ?? '—'} · ${s.t('深度核验')} ${report?['checked'] ?? '—'}',
                style: TextStyle(fontSize: 13, color: muted),
              ),
              const SizedBox(height: 8),
              Text(
                s.t('量价30 · 形态30 · 股性20 · 筹码20；各形态独立识别，相关形态不重复加分。'),
                style: TextStyle(fontSize: 14, height: 1.7, color: muted),
              ),
              Wrap(
                spacing: 10,
                runSpacing: 8,
                children: [
                  TextButton.icon(
                    onPressed: loading ? null : load,
                    icon: const Icon(Icons.refresh, size: 16),
                    label: Text(s.t('刷新收盘结果')),
                  ),
                  FilledButton.icon(
                    onPressed: () =>
                        scan.running ? scan.pause() : beginScan(scan),
                    icon: Icon(
                      scan.running ? Icons.pause : Icons.play_arrow,
                      size: 16,
                    ),
                    label: Text(s.t(scan.running ? '暂停扫描' : '手动并行复核')),
                  ),
                ],
              ),
              if (scan.running)
                Text(
                  '${scan.state['cursor']} / ${rows(scan.state['targets']).length}',
                  style: TextStyle(color: muted, fontSize: 13),
                ),
            ],
          ),
        ),
        ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 4),
          title: Text(s.t('筛选条件'), style: const TextStyle(fontSize: 15)),
          subtitle: Text(
            s.t('成交额≥2亿、筹码集中'),
            style: TextStyle(color: muted, fontSize: 12),
          ),
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: concentration,
                    decoration: InputDecoration(labelText: s.t('90%集中度上限')),
                    items: [
                      for (final n in ['10', '15', '20'])
                        DropdownMenuItem(value: n, child: Text('$n%')),
                    ],
                    onChanged: (v) => setState(() => concentration = v!),
                  ),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<String>(
                    initialValue: cap,
                    decoration: InputDecoration(labelText: s.t('市值上限（亿）')),
                    items: [
                      for (final n in ['200', '500', '1000', '3000', ''])
                        DropdownMenuItem(
                          value: n,
                          child: Text(n.isEmpty ? s.t('不限') : n),
                        ),
                    ],
                    onChanged: (v) => setState(() => cap = v!),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      s.t('排除低弹性与弱延续'),
                      style: const TextStyle(fontSize: 14),
                    ),
                    value: activity,
                    onChanged: (v) => setState(() => activity = v),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      s.t('所有形态加筛近10日涨停'),
                      style: const TextStyle(fontSize: 14),
                    ),
                    value: recent,
                    onChanged: (v) => setState(() => recent = v),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (error != null) Notice(error!),
        if (loading) const LinearProgressIndicator(),
        if (candidates.isEmpty && !loading)
          Notice(
            s.t(report == null ? '共享报告尚未生成，可先手动并行复核。' : '当前条件没有命中，结果保持为空。'),
          ),
        for (
          var index = 0;
          index < candidates.length && index < visible;
          index++
        )
          _card(context, candidates[index], index + 1, accent),
        if (candidates.length > visible)
          TextButton(
            onPressed: () => setState(() => visible += 40),
            child: Text(s.t('加载更多')),
          ),
        Notice(s.t('综合分表示复核优先级，不是上涨概率。筹码为量价换手模型，盘中形态须等收盘确认。')),
      ],
    );
  }

  Widget _card(BuildContext context, Json c, int rank, Color accent) {
    final s = context.watch<AtlasStore>(),
        ranking = obj(c['ranking']),
        advice = obj(c['advice']);
    return Panel(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Text(
              '$rank',
              style: TextStyle(color: muted, fontSize: 13),
            ),
            title: Text(
              str(c['name']),
              style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              '${c['symbol']} · ${c['asOf']}',
              style: TextStyle(color: muted, fontSize: 12),
            ),
            onTap: () => openStock(context, str(c['symbol'])),
            trailing: IconButton(
              onPressed: () => s.toggleWatch(str(c['symbol'])),
              icon: Icon(
                s.watchlist.contains(c['symbol'])
                    ? Icons.star
                    : Icons.star_border,
                size: 20,
              ),
            ),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                fixed(c['price']),
                style: TextStyle(
                  color: tone(c['changePercent']),
                  fontSize: 27,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 10),
              Text(
                percent(c['changePercent']),
                style: TextStyle(color: tone(c['changePercent']), fontSize: 14),
              ),
              const Spacer(),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    fixed(ranking['score'], 0),
                    style: TextStyle(color: accent, fontSize: 30),
                  ),
                  Text(
                    s.t(str(ranking['label'], '待评估')),
                    style: TextStyle(color: muted, fontSize: 12),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 13),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: rows(c['patterns'])
                .map(
                  (p) => Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: accent.withValues(alpha: .08),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      s.t(str(p['label'])),
                      style: TextStyle(color: accent, fontSize: 12),
                    ),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 13),
          Text(
            '${s.t(str(advice['action'], '观望'))} · ${s.t(str(c['bucket']))}',
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 8),
          Text(
            '${s.t('成交额')} ${amount(c['amount'])} · ${s.t('90%集中度')} ${fixed(obj(c['chip'])['concentration90'])}%',
            style: TextStyle(color: muted, fontSize: 13),
          ),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(s.t('评分依据与风险'), style: const TextStyle(fontSize: 14)),
            children: [
              for (final p in rows(ranking['parts']))
                Padding(
                  padding: const EdgeInsets.only(bottom: 13),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        '${s.t(str(p['label']))} ${p['score']}/${p['max']}',
                        style: const TextStyle(fontSize: 14),
                      ),
                      const SizedBox(height: 5),
                      LinearProgressIndicator(
                        value:
                            (numOf(p['score']) ?? 0) / (numOf(p['max']) ?? 1),
                        color: accent,
                        backgroundColor: accent.withValues(alpha: .1),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        s.t(str(p['reason'])),
                        style: TextStyle(
                          fontSize: 13,
                          color: muted,
                          height: 1.6,
                        ),
                      ),
                    ],
                  ),
                ),
              for (final r in ((advice['reasons'] as List?) ?? []).take(3))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    s.t('$r'),
                    style: TextStyle(fontSize: 13, color: muted, height: 1.7),
                  ),
                ),
              for (final r in ((c['risks'] as List?) ?? []))
                Text(
                  s.t('$r'),
                  style: const TextStyle(fontSize: 13, color: Colors.amber),
                ),
            ],
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: () => openStock(context, str(c['symbol'])),
              icon: const Icon(Icons.north_east, size: 15),
              label: Text(s.t('看图核验')),
            ),
          ),
        ],
      ),
    );
  }
}
