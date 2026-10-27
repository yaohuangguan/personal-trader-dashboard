import 'auto_screener.dart';

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/screener.dart';
import '../widgets/common.dart';
import 'stock.dart';
import 'sector.dart';
import 'signals.dart';

class ScreenerPage extends StatefulWidget {
  const ScreenerPage({super.key});
  @override
  State<ScreenerPage> createState() => _ScreenerPageState();
}

class _ScreenerPageState extends State<ScreenerPage> {
  String scope = 'all',
      tab = 'auto',
      stage = 'all',
      character = 'potential',
      query = '';
  final Set<String> modes = {'bloom'};
  String concentration = '20', maxCap = '1000';
  bool recentLimitUp = false, activity = true;
  Json get options => {
    'modes': modes.join(','),
    'concentration': concentration,
    'maxCap': maxCap,
    'recentLimitUp': recentLimitUp ? '1' : '0',
    'activity': activity ? '1' : '0',
  };
  bool excludeSt = true, minAmount = true, riskOnly = false;
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(),
        scan = context.watch<ScreenerController>(),
        state = scan.state;
    var candidates = scan.candidates.where((r) {
      final c = obj(r['character']);
      return (stage == 'all' || r['bucket'] == stage) &&
          (query.isEmpty ||
              str(r['name']).contains(query) ||
              str(r['symbol']).toLowerCase().contains(query.toLowerCase())) &&
          (!riskOnly || ((r['risks'] as List?) ?? []).isEmpty) &&
          (character == 'all' ||
              c.isNotEmpty &&
                  c['quiet'] != true &&
                  c['weakFollow'] != true &&
                  (character != 'active' || c['active'] == true));
    }).toList();
    const rank = {'开花确认': 4, '启动待确认': 3, '回踩观察': 2, '粘合蓄势': 1};
    candidates.sort((a, b) {
      final byScore = (numOf(obj(b['ranking'])['score']) ?? 0).compareTo(
        numOf(obj(a['ranking'])['score']) ?? 0,
      );
      if (byScore != 0) return byScore;
      final byStage = (rank[b['bucket']] ?? 0).compareTo(
        rank[a['bucket']] ?? 0,
      );
      return byStage != 0
          ? byStage
          : (numOf(obj(b['character'])['score']) ?? -1).compareTo(
              numOf(obj(a['character'])['score']) ?? -1,
            );
    });
    final cursor = (numOf(state['cursor']) ?? 0).toInt(),
        targets = rows(state['targets']),
        universe = rows(state['universe']);
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      children: [
        PageTitle('五线开花选股器', '寻找值得看图的候选。按你的指南逐项核验，显示形成阶段、缺项和失效条件。'),
        Chips(
          values: const {
            'auto': '自动优选',
            'scan': '独立形态',
            'sector': '板块研判 · 天时地利人和',
          },
          selected: tab,
          onSelected: (v) => setState(() => tab = v),
        ),
        if (tab == 'sector')
          const SectorOutlook()
        else if (tab == 'auto')
          const AutomaticScreenPanel()
        else ...[
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  s.t('形态模式'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                Text(s.t('各形态独立筛选；可单选，多选时命中任意一种即可。')),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    for (final e in const {
                      'bloom': '五线开花',
                      'bullish': '多头排列',
                      'multi': '一阳多线',
                      'beauty': '美人肩',
                      'spider': '金蜘蛛',
                      'cannon': '多方炮',
                      'limitup': '近10日涨停',
                    }.entries)
                      FilterChip(
                        label: Text(
                          s.t(e.value),
                          style: const TextStyle(fontSize: 14),
                        ),
                        selected: modes.contains(e.key),
                        onSelected: scan.running
                            ? null
                            : (v) => setState(() {
                                if (v) {
                                  modes.add(e.key);
                                } else if (modes.length > 1) {
                                  modes.remove(e.key);
                                }
                              }),
                      ),
                  ],
                ),
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: Text(
                    s.t('成交额与筹码条件'),
                    style: const TextStyle(fontSize: 15),
                  ),
                  children: [
                    DropdownButtonFormField<String>(
                      initialValue: concentration,
                      decoration: InputDecoration(labelText: s.t('90%筹码集中度上限')),
                      items: [
                        for (final n in ['10', '15', '20'])
                          DropdownMenuItem(value: n, child: Text('$n%')),
                      ],
                      onChanged: scan.running
                          ? null
                          : (v) => setState(() => concentration = v!),
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      initialValue: maxCap,
                      decoration: InputDecoration(labelText: s.t('市值上限（亿）')),
                      items: [
                        for (final n in ['200', '500', '1000', '3000', ''])
                          DropdownMenuItem(
                            value: n,
                            child: Text(n.isEmpty ? s.t('不限') : n),
                          ),
                      ],
                      onChanged: scan.running
                          ? null
                          : (v) => setState(() => maxCap = v!),
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        s.t('所有形态加筛近10日涨停'),
                        style: const TextStyle(fontSize: 15),
                      ),
                      value: recentLimitUp,
                      onChanged: scan.running
                          ? null
                          : (v) => setState(() => recentLimitUp = v),
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        s.t('排除低弹性与弱延续'),
                        style: const TextStyle(fontSize: 15),
                      ),
                      value: activity,
                      onChanged: scan.running
                          ? null
                          : (v) => setState(() {
                              activity = v;
                              character = v ? 'potential' : 'all';
                            }),
                    ),
                  ],
                ),
                Notice(
                  s.t(
                    '一阳多线需实体上穿至少三线且含MA60、90%集中度<15%；其余模式集中度<20%。筹码按量价与换手模型估算；涨停按近10根已收盘未复权日线规则估算，不含未收盘当天。',
                  ),
                ),
              ],
            ),
          ),
          Row(
            children: [
              Expanded(
                child: Text(
                  s.t(
                    scope == 'all'
                        ? '全市场'
                        : scope == 'watchlist'
                        ? '我的自选'
                        : '快速抽样 · 最多200只',
                  ),
                  style: TextStyle(fontSize: 13, color: muted),
                ),
              ),
              FilledButton.icon(
                onPressed: () => scan.running
                    ? scan.pause()
                    : scan.start(scope, excludeSt, true, options: options),
                icon: Icon(
                  scan.running ? Icons.pause : Icons.play_arrow,
                  size: 16,
                ),
                label: Text(s.t(scan.running ? '暂停扫描' : '开始扫描')),
              ),
            ],
          ),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(s.t('扫描设置'), style: const TextStyle(fontSize: 14)),
            children: [
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    DropdownButtonFormField<String>(
                      isExpanded: true,
                      initialValue: scope,
                      decoration: InputDecoration(labelText: s.t('扫描范围')),
                      items:
                          const {
                                'quick': '快速抽样 · 最多200只',
                                'all': '深度扫描 · 全市场',
                                'watchlist': '我的自选 · 沪深北',
                              }.entries
                              .map(
                                (e) => DropdownMenuItem(
                                  value: e.key,
                                  child: Text(s.t(e.value)),
                                ),
                              )
                              .toList(),
                      onChanged: scan.running
                          ? null
                          : (v) => setState(() => scope = v!),
                    ),
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: excludeSt,
                      onChanged: scan.running
                          ? null
                          : (v) => setState(() => excludeSt = v!),
                      title: Text(s.t('排除ST与退市名称')),
                    ),
                    Notice(s.t('全部模式：成交额≥2亿、筹码集中')),
                    Wrap(
                      spacing: 12,
                      runSpacing: 10,
                      children: [
                        FilledButton.icon(
                          onPressed: () => scan.running
                              ? scan.pause()
                              : scan.start(
                                  scope,
                                  excludeSt,
                                  true,
                                  options: options,
                                ),
                          icon: Icon(
                            scan.running ? Icons.pause : Icons.play_arrow,
                          ),
                          label: Text(s.t(scan.running ? '暂停扫描' : '开始扫描')),
                        ),
                        if (state['phase'] == 'paused')
                          OutlinedButton(
                            onPressed: scan.resume,
                            child: Text(s.t('继续上次扫描')),
                          ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      s.t('扫描在本页打开时运行，站内查看个股时继续扫描；隐藏浏览器窗口或离线会暂停。'),
                      style: TextStyle(color: muted, fontSize: 13, height: 1.7),
                    ),
                  ],
                ),
              ),
            ],
          ),
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.t(
                    state['phase'] == 'universe'
                        ? '读取证券池'
                        : state['phase'] == 'scanning'
                        ? '核验历史日线'
                        : state['phase'] == 'complete'
                        ? '当前范围处理完毕'
                        : state['phase'] == 'paused'
                        ? '已暂停'
                        : '等待开始',
                  ),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                LinearProgressIndicator(
                  value: state['phase'] == 'universe'
                      ? ((numOf(state['total']) ?? 0) > 0
                            ? universe.length / numOf(state['total'])!
                            : 0)
                      : targets.isEmpty
                      ? 0
                      : cursor / targets.length,
                ),
                const SizedBox(height: 12),
                Text(
                  '${state['phase'] == 'universe' ? universe.length : cursor} / ${state['phase'] == 'universe' ? state['total'] : targets.length} · ${s.t('候选')} ${scan.candidates.length}',
                ),
                Text(
                  '${s.t('来源失败')} ${rows(state['failed']).length} · ${s.t('历史不足')} ${state['insufficient']}',
                  style: TextStyle(color: muted, fontSize: 13),
                ),
                if (state['message'] != null) Notice(str(state['message'])),
                if (state['universeComplete'] == true &&
                    universe.length != (numOf(state['total']) ?? 0))
                  Notice(s.t('来源登记与实际数量不同，覆盖仍待核对。')),
              ],
            ),
          ),
          Chips(
            values: const {
              'all': '全部',
              '粘合蓄势': '粘合蓄势',
              '启动待确认': '启动待确认',
              '开花确认': '开花确认',
              '回踩观察': '回踩观察',
              '形态候选': '形态候选',
            },
            selected: stage,
            onSelected: (v) => setState(() => stage = v),
          ),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(s.t('筛选与导出'), style: const TextStyle(fontSize: 14)),
            children: [
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: character,
                decoration: InputDecoration(labelText: s.t('股性筛选')),
                items:
                    const {
                          'potential': '活性优先 · 排除低弹性与弱延续',
                          'active': '只看历史活跃',
                          'all': '全部形态 · 包括横盘粘合',
                        }.entries
                        .map(
                          (e) => DropdownMenuItem(
                            value: e.key,
                            child: Text(
                              s.t(e.value),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                onChanged: (v) => setState(() => character = v!),
              ),
              const SizedBox(height: 12),
              TextField(
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search),
                  hintText: s.t('筛选名称或代码'),
                ),
                onChanged: (v) => setState(() => query = v),
              ),
              CheckboxListTile(
                value: riskOnly,
                onChanged: (v) => setState(() => riskOnly = v!),
                title: Text(s.t('只看未命中现有风险条件')),
                contentPadding: EdgeInsets.zero,
              ),
              Wrap(
                spacing: 12,
                runSpacing: 10,
                children: [
                  OutlinedButton.icon(
                    onPressed: candidates.isEmpty
                        ? null
                        : () => _export(candidates),
                    icon: const Icon(Icons.download),
                    label: Text(s.t('导出候选')),
                  ),
                  OutlinedButton(
                    onPressed: candidates.isEmpty
                        ? null
                        : () {
                            s.prefs.setStringList(
                              'monitorPool',
                              candidates
                                  .take(60)
                                  .map((r) => str(r['symbol']))
                                  .toList(),
                            );
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => const Scaffold(
                                  appBar: _SignalsAppBar(),
                                  body: SignalsPage(imported: true),
                                ),
                              ),
                            );
                          },
                    child: Text(s.t('加入收盘推送')),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          Notice(s.t('均线粘合不是启动信号，股性、量能、突破延续与板块需要共同核验。收盘后共享精选请使用收盘信号中心。')),
          if (candidates.isEmpty)
            Notice(
              s.t(
                scan.running ? '正在扫描，命中候选后会逐步出现。' : '当前已处理范围没有命中此筛选条件，结果保持为空。',
              ),
            ),
          ...candidates.map((c) => _candidate(context, c)),
          if (obj(state['rejected']).isNotEmpty)
            ExpansionTile(
              title: Text(s.t('过滤原因统计')),
              children: obj(state['rejected']).entries
                  .map(
                    (r) => ListTile(
                      title: Text(
                        s.t(r.key),
                        style: const TextStyle(fontSize: 14),
                      ),
                      trailing: Text(fixed(r.value, 0)),
                    ),
                  )
                  .toList(),
            ),
          if (rows(state['failed']).isNotEmpty)
            ExpansionTile(
              title: Text('${s.t('未完成标的')} ${rows(state['failed']).length}'),
              children: rows(state['failed'])
                  .map(
                    (r) => ListTile(
                      title: Text(str(r['symbol'])),
                      subtitle: Text(str(r['reason'])),
                    ),
                  )
                  .toList(),
            ),
        ],
      ],
    );
  }

  Widget _candidate(BuildContext context, Json c) {
    final s = context.watch<AtlasStore>(), character = obj(c['character']);
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(
              str(c['name']),
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            subtitle: Text('${c['symbol']} · ${c['asOf']}'),
            trailing: IconButton(
              onPressed: () => s.toggleWatch(str(c['symbol'])),
              icon: Icon(
                s.watchlist.contains(c['symbol'])
                    ? Icons.star
                    : Icons.star_border,
              ),
            ),
            onTap: () => openStock(context, str(c['symbol'])),
          ),
          Wrap(
            spacing: 8,
            children: rows(c['patterns'])
                .map(
                  (p) => Chip(
                    label: Text(
                      s.t(str(p['label'])),
                      style: const TextStyle(fontSize: 13),
                    ),
                  ),
                )
                .toList(),
          ),
          Text(
            '${s.t('成交额')} ${amount(c['amount'])} · ${s.t('90%集中度')} ${fixed(obj(c['chip'])['concentration90'])}% · ${s.t('市值')} ${amount(c['marketCap'])}',
            style: const TextStyle(fontSize: 14),
          ),
          Text(
            s.t(str(obj(c['chip'])['notice'])),
            style: TextStyle(color: muted, fontSize: 12, height: 1.7),
          ),
          if ((c['limitUpDates'] as List?)?.isNotEmpty == true)
            Text(
              '${s.t('近10日收盘涨停估算')}：${(c['limitUpDates'] as List).join('、')}',
              style: const TextStyle(fontSize: 13),
            ),
          Text(
            s.t(str(c['bucket'])),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 15),
          Wrap(
            spacing: 22,
            runSpacing: 15,
            children: [
              LabelValue('粘合系数', '${fixed(c['adhesion'])}%'),
              LabelValue('BIAS60', '${fixed(c['bias60'])}%'),
              LabelValue('启动清单', '${c['passed']}/${c['required']}'),
            ],
          ),
          const Divider(height: 30),
          Text(s.t(str(character['label'], '股性待计算'))),
          Text(
            '${s.t('60日波动')} ${fixed(character['volatility'])}% · ATR20 ${fixed(character['atr'])}%\n${s.t('历史突破次数')} ${str(character['breakouts'])} · ${s.t('相对量能')} ${fixed(character['volumeExpansion'])}×',
            style: TextStyle(color: muted, fontSize: 14, height: 1.9),
          ),
          ...((c['reasons'] as List?) ?? [])
              .take(3)
              .map(
                (r) => Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    s.t('$r'),
                    style: const TextStyle(fontSize: 14, height: 1.7),
                  ),
                ),
              ),
          ...((c['risks'] as List?) ?? []).map(
            (r) => Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                s.t('$r'),
                style: TextStyle(fontSize: 14, color: up, height: 1.7),
              ),
            ),
          ),
          TextButton.icon(
            onPressed: () => openStock(context, str(c['symbol'])),
            icon: const Icon(Icons.arrow_forward),
            label: Text(s.t('看图核验')),
          ),
        ],
      ),
    );
  }

  Future<void> _export(List<Json> data) async {
    String safe(dynamic value) {
      var s = str(value, '');
      if (RegExp(r'^[=+\-@]').hasMatch(s)) s = "'$s";
      return '"${s.replaceAll('"', '""')}"';
    }

    final content = [
      [
        '名称',
        '代码',
        '阶段',
        '行情日期',
        '命中形态',
        '成交额(元)',
        '90%筹码集中度%',
        '近10日涨停日期',
        '粘合系数%',
        'BIAS60%',
        '股性',
        '风险',
        '来源',
      ],
      ...data.map(
        (c) => [
          c['name'],
          c['symbol'],
          c['bucket'],
          c['asOf'],
          rows(c['patterns']).map((p) => str(p['label'])).join(';'),
          c['amount'],
          obj(c['chip'])['concentration90'],
          ((c['limitUpDates'] as List?) ?? []).join(';'),
          c['adhesion'],
          c['bias60'],
          obj(c['character'])['label'],
          ((c['risks'] as List?) ?? []).join(';'),
          c['provider'],
        ],
      ),
    ].map((r) => r.map(safe).join(',')).join('\r\n');
    await SharePlus.instance.share(
      ShareParams(
        files: [
          XFile.fromData(
            utf8.encode('\ufeff$content'),
            mimeType: 'text/csv',
            name: 'market-atlas-candidates.csv',
          ),
        ],
      ),
    );
  }
}

class _SignalsAppBar extends StatelessWidget implements PreferredSizeWidget {
  const _SignalsAppBar();
  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);
  @override
  Widget build(BuildContext context) =>
      AppBar(title: Text(tr(context, '收盘信号中心')));
}
