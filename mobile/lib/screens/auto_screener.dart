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
  bool loading = false, activity = true, recent = false, live = false;
  String concentration = '20', cap = '1000', group = 'all';
  int visible = 30;
  @override
  void initState() {
    super.initState();
    load();
    context.read<ScreenerController>().connectShared();
  }

  Future<void> load() async {
    setState(() => loading = true);
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
    } catch (_) {
      if (mounted) setState(() => error = '收盘报告暂不可用，可启动服务端全市场扫描。');
    } finally {
      if (mounted) setState(() => loading = false);
    }
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
    final scan = context.watch<ScreenerController>();
    final job = obj(scan.state['serverJob']);
    final manual = live || job.isNotEmpty;
    final previous = obj(scan.state['previousReport']);
    final usePrevious =
        manual &&
        rows(scan.state['sharedCandidates']).isEmpty &&
        rows(previous['candidates']).isNotEmpty;
    final source = usePrevious
        ? rows(previous['candidates'])
        : manual
        ? rows(scan.state['sharedCandidates'] ?? scan.state['candidates'])
        : rows(report?['candidates']);
    final all =
        source
            .where(
              (c) =>
                  !rows(
                    c['patterns'],
                  ).any((p) => ['multi', 'strongmulti'].contains(p['mode'])) ||
                  obj(c['multiLine'])['version'] == 2,
            )
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
    final candidates = all
        .where(
          (c) =>
              group == 'all' ||
              group == 'limitup' &&
                  ((c['limitUpDates'] as List?) ?? []).isNotEmpty ||
              group == 'prepare' && c['bucket'] == '粘合蓄势' ||
              group == 'launch' &&
                  ['启动待确认', '开花确认', '形态候选'].contains(c['bucket']) ||
              group == 'retest' && c['bucket'] == '回踩观察',
        )
        .toList();
    final accent = AtlasPalette.light
        ? const Color(0xff6d59ad)
        : const Color(0xffb5a5de);
    final count = (numOf(job['targets']) ?? 0).toInt(),
        processed = (numOf(job['cursor']) ?? 0).toInt();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 10, 4, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      tr(context, '综合优选'),
                      style: const TextStyle(
                        fontSize: 25,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  Text(
                    '${all.length}',
                    style: TextStyle(
                      fontSize: 27,
                      color: accent,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 5),
                  Text(
                    tr(context, '候选'),
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                tr(context, '量价 · 独立形态 · 股性 · 筹码，综合排列'),
                style: TextStyle(color: muted, fontSize: 13, height: 1.5),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(0, 44),
                      ),
                      onPressed: scan.running
                          ? scan.pause
                          : () {
                              setState(() => live = true);
                              scan.start('all', true, true, options: options);
                            },
                      icon: Icon(
                        scan.running ? Icons.pause : Icons.radar,
                        size: 17,
                      ),
                      label: Text(tr(context, scan.running ? '暂停查看' : '扫描全市场')),
                    ),
                  ),
                  const SizedBox(width: 10),
                  IconButton(
                    tooltip: tr(context, '刷新收盘结果'),
                    onPressed: loading
                        ? null
                        : () {
                            setState(() => live = false);
                            load();
                          },
                    icon: const Icon(Icons.history, size: 21),
                  ),
                ],
              ),
            ],
          ),
        ),
        if (usePrevious) Notice(tr(context, '新任务尚无有效候选，下面保留上一轮快照，非当前实时结果。')),
        if (manual && job.isNotEmpty)
          Panel(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(
                      job['phase'] == 'complete'
                          ? Icons.check_circle_outline
                          : Icons.cloud_sync_outlined,
                      size: 17,
                      color: accent,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        tr(
                          context,
                          job['retryOf'] != null
                              ? '重试未完成标的'
                              : job['phase'] == 'universe'
                              ? '读取证券池'
                              : job['phase'] == 'complete'
                              ? '本轮结果'
                              : '服务端核验中',
                        ),
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    Text(
                      job['phase'] == 'universe'
                          ? '${job['registered'] ?? 0}/${job['total'] ?? '—'}'
                          : '$processed/$count',
                      style: TextStyle(color: muted, fontSize: 12),
                    ),
                  ],
                ),
                const SizedBox(height: 9),
                LinearProgressIndicator(
                  minHeight: 3,
                  value: job['phase'] == 'universe'
                      ? null
                      : count > 0
                      ? processed / count
                      : 0,
                  color: accent,
                  backgroundColor: accent.withValues(alpha: .1),
                ),
                const SizedBox(height: 9),
                Text(
                  '${tr(context, '全市场')} ${job['total'] ?? 0} → ${tr(context, '深度核验')} $count · ${tr(context, '未完成')} ${job['failed'] ?? 0} · ${tr(context, '缓存复用')} ${job['cached'] ?? 0}',
                  style: TextStyle(color: muted, fontSize: 12, height: 1.5),
                ),
                if (scan.state['phase'] == 'paused')
                  Text(
                    tr(context, str(scan.state['message'])),
                    style: const TextStyle(fontSize: 13, height: 1.5),
                  ),
                if ((numOf(job['failed']) ?? 0) > 0 && !scan.running)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: scan.retryShared,
                      child: Text(tr(context, '仅重试未完成标的')),
                    ),
                  ),
                if (scan.state['phase'] == 'paused' && !scan.running)
                  TextButton(
                    onPressed: scan.resume,
                    child: Text(tr(context, '连接并继续任务')),
                  ),
              ],
            ),
          ),
        if (manual && job.isEmpty && scan.state['message'] != null)
          Notice(tr(context, str(scan.state['message']))),
        Panel(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: concentration,
                      decoration: InputDecoration(
                        isDense: true,
                        labelText: tr(context, '90%集中度上限'),
                      ),
                      items: [
                        for (final n in ['10', '15', '20'])
                          DropdownMenuItem(value: n, child: Text('$n%')),
                      ],
                      onChanged: (v) => setState(() => concentration = v!),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: cap,
                      decoration: InputDecoration(
                        isDense: true,
                        labelText: tr(context, '市值上限（亿）'),
                      ),
                      items: [
                        for (final n in ['200', '500', '1000', '3000', ''])
                          DropdownMenuItem(
                            value: n,
                            child: Text(n.isEmpty ? tr(context, '不限') : n),
                          ),
                      ],
                      onChanged: (v) => setState(() => cap = v!),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  FilterChip(
                    label: Text(
                      tr(context, '排除低弹性'),
                      style: const TextStyle(fontSize: 13),
                    ),
                    selected: activity,
                    onSelected: (v) => setState(() => activity = v),
                  ),
                  FilterChip(
                    label: Text(
                      tr(context, '近10日涨停'),
                      style: const TextStyle(fontSize: 13),
                    ),
                    selected: recent,
                    onSelected: (v) => setState(() => recent = v),
                  ),
                ],
              ),
              Text(
                tr(context, '成交额≥2亿；一阳多线集中度<15%，其余<20%。'),
                style: TextStyle(color: muted, fontSize: 11, height: 1.5),
              ),
            ],
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final g in [
                ('all', '全部'),
                ('prepare', '蓄势观察'),
                ('launch', '启动候选'),
                ('retest', '回踩承接'),
                ('limitup', '近期涨停'),
              ])
                Padding(
                  padding: const EdgeInsets.only(right: 7, bottom: 10),
                  child: ChoiceChip(
                    label: Text(tr(context, g.$2)),
                    selected: group == g.$1,
                    onSelected: (_) => setState(() => group = g.$1),
                  ),
                ),
            ],
          ),
        ),
        if (error != null) Notice(tr(context, error!)),
        if (loading) const LinearProgressIndicator(),
        if (candidates.isEmpty && !loading)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 8),
            child: Column(
              children: [
                Icon(
                  scan.running
                      ? Icons.travel_explore
                      : Icons.filter_alt_outlined,
                  color: muted,
                  size: 30,
                ),
                const SizedBox(height: 12),
                Text(
                  tr(
                    context,
                    scan.running
                        ? '符合条件的候选将随进度出现'
                        : report == null && !manual
                        ? '还没有收盘报告，点击“扫描全市场”获取当前候选。'
                        : '本轮没有符合当前条件的候选。',
                  ),
                  style: TextStyle(color: muted, fontSize: 14, height: 1.6),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        for (var i = 0; i < candidates.length && i < visible; i++)
          _card(context, candidates[i], i + 1, accent),
        if (candidates.length > visible)
          TextButton(
            onPressed: () => setState(() => visible += 30),
            child: Text(tr(context, '加载更多')),
          ),
        if (manual && rows(job['failureSample']).isNotEmpty)
          OpenSection(
            title: Text(tr(context, '未完成标的与原因')),
            children: [
              for (final f in rows(job['failureSample']))
                Text(
                  '${f['symbol']} · ${tr(context, str(f['reason']))}',
                  style: TextStyle(color: muted, fontSize: 13, height: 1.7),
                ),
            ],
          ),
        OpenSection(
          title: Text(tr(context, '本轮过滤统计')),
          children: [
            for (final e in obj(
              manual ? job['rejected'] : report?['rejected'],
            ).entries)
              Padding(
                padding: const EdgeInsets.only(bottom: 7),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        tr(context, e.key),
                        style: TextStyle(color: muted, fontSize: 13),
                      ),
                    ),
                    Text('${e.value}', style: const TextStyle(fontSize: 13)),
                  ],
                ),
              ),
          ],
        ),
        Notice(tr(context, '综合分表示复核优先级，不是上涨概率。筹码为量价换手模型，盘中形态须等收盘确认。')),
      ],
    );
  }

  Widget _card(BuildContext context, Json c, int rank, Color accent) {
    final s = context.watch<AtlasStore>(),
        r = obj(c['ranking']),
        a = obj(c['advice']);
    final parts = rows(r['parts']);
    return Panel(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text(
                '$rank'.padLeft(2, '0'),
                style: TextStyle(fontSize: 12, color: muted),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: InkWell(
                  onTap: () => openStock(context, str(c['symbol'])),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        str(c['name']),
                        style: const TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        str(c['symbol']),
                        style: TextStyle(fontSize: 12, color: muted),
                      ),
                    ],
                  ),
                ),
              ),
              IconButton(
                onPressed: () => s.toggleWatch(str(c['symbol'])),
                icon: Icon(
                  s.watchlist.contains(c['symbol'])
                      ? Icons.star
                      : Icons.star_border,
                  size: 20,
                  color: muted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Wrap(
                  spacing: 10,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.end,
                  children: [
                    Text(
                      fixed(c['price']),
                      style: TextStyle(
                        fontSize: 28,
                        color: tone(c['changePercent']),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      percent(c['changePercent']),
                      style: TextStyle(
                        color: tone(c['changePercent']),
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                fixed(r['score'], 0),
                style: TextStyle(
                  color: accent,
                  fontSize: 28,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(' /100', style: TextStyle(color: muted, fontSize: 11)),
            ],
          ),
          const SizedBox(height: 13),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final p in rows(c['patterns']))
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: .09),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    tr(context, str(p['label'])),
                    style: TextStyle(color: accent, fontSize: 12),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            '${tr(context, str(a['action'], '观望'))} · ${tr(context, str(c['bucket']))}',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Text(
            tr(
              context,
              str(
                ((a['reasons'] as List?) ?? []).firstOrNull ??
                    ((c['reasons'] as List?) ?? []).firstOrNull,
              ),
            ),
            style: TextStyle(fontSize: 14, height: 1.6, color: muted),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 18,
            runSpacing: 7,
            children: [
              Text(
                '${tr(context, '成交额')} ${amount(c['amount'])}',
                style: const TextStyle(fontSize: 13),
              ),
              Text(
                '${tr(context, '90%集中度')} ${fixed(obj(c['chip'])['concentration90'])}%',
                style: const TextStyle(fontSize: 13),
              ),
              Text(
                tr(context, str(obj(c['character'])['label'])),
                style: TextStyle(fontSize: 13, color: muted),
              ),
            ],
          ),
          const SizedBox(height: 14),
          for (final p in parts)
            Padding(
              padding: const EdgeInsets.only(bottom: 11),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          tr(context, str(p['label'])),
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                      Text(
                        '${p['score']} / ${p['max']}',
                        style: TextStyle(fontSize: 12, color: accent),
                      ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  LinearProgressIndicator(
                    value: (numOf(p['score']) ?? 0) / (numOf(p['max']) ?? 1),
                    minHeight: 3,
                    color: accent.withValues(alpha: .7),
                    backgroundColor: accent.withValues(alpha: .08),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    tr(context, str(p['reason'])),
                    style: TextStyle(fontSize: 12, height: 1.5, color: muted),
                  ),
                ],
              ),
            ),
          for (final risk in ((c['risks'] as List?) ?? []).take(3))
            Padding(
              padding: const EdgeInsets.only(top: 5),
              child: Text(
                '• ${tr(context, '$risk')}',
                style: const TextStyle(
                  color: Color(0xffb58f53),
                  fontSize: 13,
                  height: 1.5,
                ),
              ),
            ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  '${str(c['asOf'])} · ${tr(context, c['provisional'] == true ? '盘中待确认' : '收盘核验')}',
                  style: TextStyle(color: muted, fontSize: 12),
                ),
              ),
              TextButton.icon(
                onPressed: () => openStock(context, str(c['symbol'])),
                icon: const Icon(Icons.north_east, size: 15),
                label: Text(tr(context, '看图核验')),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
