import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../widgets/common.dart';
import '../widgets/sector_heatmap.dart';
import 'stock.dart';
import 'news.dart';

class SectorExplorer extends StatefulWidget {
  const SectorExplorer({super.key});
  @override
  State<SectorExplorer> createState() => _SectorExplorerState();
}

class _SectorExplorerState extends State<SectorExplorer> {
  String kind = 'concept', theme = '全部', sort = 'amount', query = '';
  int visible = 24;
  static const themes = {
    '全部': '',
    '机器人': '机器|人形|自动化|减速器',
    '创新药': '创新药|仿制药|疫苗|生物|医疗',
    'AI科技': '人工智能|算力|芯片|半导体|软件|数据|云计算',
    '新能源': '电池|光伏|储能|风电|能源',
    '低空航天': '低空|航空|航天|无人机|卫星',
  };
  @override
  Widget build(BuildContext context) => AsyncPanel(
    key: ValueKey(kind),
    load: () => context.read<AtlasStore>().api.get(
      '/api/desk/sector-map',
      parameters: {'type': kind},
    ),
    builder: (data) {
      final all = rows(data['items']),
          items =
              all
                  .where(
                    (s) =>
                        (query.isEmpty || str(s['name']).contains(query)) &&
                        (kind != 'concept' ||
                            query.isNotEmpty ||
                            !RegExp(
                              '重仓|融资融券|含H股|业绩|超大盘|解禁|股权激励|参股|转债|昨日|次新|退市|ST板|央企50|黄河三角',
                            ).hasMatch(str(s['name']))) &&
                        (theme == '全部' ||
                            RegExp(themes[theme]!).hasMatch(str(s['name']))),
                  )
                  .toList()
                ..sort(
                  (a, b) => sort == 'amount'
                      ? (numOf(b['amount']) ?? 0).compareTo(
                          numOf(a['amount']) ?? 0,
                        )
                      : (numOf(b['changePercent']) ?? 0).compareTo(
                          numOf(a['changePercent']) ?? 0,
                        ),
                );
      final selected = items.take(visible).toList();
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 10, 4, 12),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        tr(context, '主题雷达'),
                        style: const TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '${tr(context, kind == 'concept' ? '概念' : '行业')} ${all.length} · ${tr(context, '点击色块看扩散与龙头')}',
                        style: TextStyle(color: muted, fontSize: 13),
                      ),
                    ],
                  ),
                ),
                SegmentedButton<String>(
                  showSelectedIcon: false,
                  style: ButtonStyle(visualDensity: VisualDensity.compact),
                  segments: [
                    ButtonSegment(
                      value: 'concept',
                      label: Text(tr(context, '概念')),
                    ),
                    ButtonSegment(
                      value: 'industry',
                      label: Text(tr(context, '行业')),
                    ),
                  ],
                  selected: {kind},
                  onSelectionChanged: (v) => setState(() {
                    kind = v.first;
                    theme = '全部';
                  }),
                ),
              ],
            ),
          ),
          TextField(
            onChanged: (v) => setState(() => query = v),
            decoration: InputDecoration(
              hintText: tr(context, '搜索概念，例如机器人、创新药'),
              prefixIcon: const Icon(Icons.search, size: 19),
            ),
          ),
          const SizedBox(height: 12),
          if (kind == 'concept')
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final name in themes.keys)
                    Padding(
                      padding: const EdgeInsets.only(right: 7),
                      child: ChoiceChip(
                        label: Text(tr(context, name)),
                        selected: theme == name,
                        onSelected: (_) => setState(() => theme = name),
                      ),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 10),
          Row(
            children: [
              Text(
                tr(context, '面积：成交额'),
                style: TextStyle(fontSize: 12, color: muted),
              ),
              const Spacer(),
              TextButton(
                onPressed: () => setState(
                  () => sort = sort == 'amount' ? 'change' : 'amount',
                ),
                child: Text(tr(context, sort == 'amount' ? '按成交活跃' : '按涨幅强弱')),
              ),
            ],
          ),
          if (selected.isNotEmpty)
            SectorHeatmap(
              selected,
              height: selected.length <= 8
                  ? 280
                  : math.max(520, selected.length * 24.0),
              onSelect: (item) => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => SectorHeatDetail(item)),
              ),
            )
          else
            Notice(tr(context, '当前分类暂无匹配主题')),
          if (items.length > visible)
            TextButton(
              onPressed: () => setState(() => visible += 24),
              child: Text(
                '${tr(context, '显示更多主题')} (${selected.length}/${items.length})',
              ),
            ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _stat(
                  context,
                  '上涨主题',
                  all.where((s) => (numOf(s['changePercent']) ?? 0) > 0).length,
                  up,
                ),
              ),
              Expanded(
                child: _stat(
                  context,
                  '下跌主题',
                  all.where((s) => (numOf(s['changePercent']) ?? 0) < 0).length,
                  down,
                ),
              ),
              Expanded(child: _stat(context, '当前覆盖', all.length, muted)),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            tr(context, '红色上涨 · 绿色下跌 · 深浅表示幅度；面积按成交额并限制极端权重，以保留点按空间。'),
            style: TextStyle(color: muted, fontSize: 12, height: 1.6),
          ),
          SourceLine(data),
        ],
      );
    },
  );
  Widget _stat(BuildContext c, String label, int n, Color color) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(tr(c, label), style: TextStyle(color: muted, fontSize: 12)),
      const SizedBox(height: 6),
      Text(
        '$n',
        style: TextStyle(
          color: color,
          fontSize: 23,
          fontWeight: FontWeight.w600,
        ),
      ),
    ],
  );
}

class SectorHeatDetail extends StatelessWidget {
  const SectorHeatDetail(this.board, {super.key});
  final Json board;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(str(board['name']))),
    body: ListView(
      padding: const EdgeInsets.all(14),
      children: [
        Panel(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                percent(board['changePercent']),
                style: TextStyle(
                  fontSize: 38,
                  fontWeight: FontWeight.w600,
                  color: tone(board['changePercent']),
                ),
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 28,
                runSpacing: 14,
                children: [
                  LabelValue('板块成交额', amount(board['amount'])),
                  LabelValue('分类快照成分数', str(board['count'])),
                  LabelValue('资金净额', amount(board['mainNet'])),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                tr(context, '资金净额未提供时保持空白；概念之间成分重叠。'),
                style: TextStyle(fontSize: 12, color: muted, height: 1.5),
              ),
            ],
          ),
        ),
        AsyncPanel(
          load: () => context.read<AtlasStore>().api.get(
            '/api/desk/sector-detail',
            parameters: {'code': str(board['code'])},
          ),
          builder: (data) {
            final breadth = obj(data['breadth']),
                share = numOf(breadth['positiveShare']),
                members = rows(data['members']);
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Panel(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        tr(context, '板块扩散'),
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              tr(context, str(data['state'])),
                              style: TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w600,
                                color: share == null
                                    ? muted
                                    : share >= .65
                                    ? up
                                    : share <= .35
                                    ? down
                                    : ink,
                              ),
                            ),
                          ),
                          Text(
                            share == null
                                ? '—'
                                : '${(share * 100).toStringAsFixed(1)}%',
                            style: const TextStyle(
                              fontSize: 25,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(5),
                        child: Row(
                          children: [
                            if ((numOf(breadth['up']) ?? 0) > 0)
                              Expanded(
                                flex: (numOf(breadth['up']) ?? 0).toInt(),
                                child: Container(height: 9, color: up),
                              ),
                            if ((numOf(breadth['flat']) ?? 0) > 0)
                              Expanded(
                                flex: (numOf(breadth['flat']) ?? 0).toInt(),
                                child: Container(height: 9, color: muted),
                              ),
                            if ((numOf(breadth['down']) ?? 0) > 0)
                              Expanded(
                                flex: (numOf(breadth['down']) ?? 0).toInt(),
                                child: Container(height: 9, color: down),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        '${tr(context, '上涨')} ${breadth['up']} · ${tr(context, '下跌')} ${breadth['down']} · ${tr(context, '成分覆盖')} ${breadth['covered']}/${breadth['total']}',
                        style: TextStyle(fontSize: 12, color: muted),
                      ),
                      const SizedBox(height: 14),
                      Text(
                        tr(context, str(data['outlook'])),
                        style: const TextStyle(fontSize: 14, height: 1.7),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    tr(context, '龙头与成分强弱'),
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                LayoutBuilder(
                  builder: (ctx, c) => Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      for (final stock in members)
                        SizedBox(
                          width: (c.maxWidth - 10) / 2,
                          child: Material(
                            color: surface,
                            borderRadius: BorderRadius.circular(10),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(10),
                              onTap: () =>
                                  openStock(context, str(stock['symbol'])),
                              child: Padding(
                                padding: const EdgeInsets.all(13),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      str(stock['name']),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      str(stock['symbol']),
                                      style: TextStyle(
                                        color: muted,
                                        fontSize: 11,
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    Text(
                                      percent(stock['changePercent']),
                                      style: TextStyle(
                                        color: tone(stock['changePercent']),
                                        fontSize: 23,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    const SizedBox(height: 5),
                                    Text(
                                      '${fixed(stock['price'])} · ${amount(stock['amount'])}',
                                      style: TextStyle(
                                        color: muted,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (rows(data['related']).isNotEmpty)
                  OpenSection(
                    title: Text(tr(context, '同龙头的关联概念')),
                    children: [
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final related in rows(data['related']))
                            ActionChip(
                              label: Text(
                                '${related['name']} ${percent(related['changePercent'])}',
                              ),
                              onPressed: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => SectorHeatDetail(related),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                SourceLine(data),
                Notice(tr(context, str(data['notice']))),
              ],
            );
          },
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Text(
            tr(context, '主题催化 · 7×24快讯'),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
        ),
        AsyncPanel(
          load: () => context.read<AtlasStore>().api.get(
            '/api/desk/sector-news',
            parameters: {'code': str(board['code'])},
          ),
          builder: (data) => Column(
            children: [
              if (rows(data['items']).isEmpty)
                Notice(tr(context, '当前快讯中没有匹配的主题催化，不补造消息。')),
              for (final news in rows(data['items']))
                Panel(
                  child: InkWell(
                    onTap: () => openNews(context, news),
                    child: Text(
                      str(news['title']),
                      style: const TextStyle(fontSize: 15, height: 1.6),
                    ),
                  ),
                ),
              SourceLine(data),
            ],
          ),
        ),
      ],
    ),
  );
}
