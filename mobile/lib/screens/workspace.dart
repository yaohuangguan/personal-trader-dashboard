import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../widgets/common.dart';
import '../widgets/earnings_board.dart';
import 'news.dart';
import 'stock.dart';

class WorkspacePage extends StatefulWidget {
  const WorkspacePage({super.key, this.initial = 'overview'});
  final String initial;
  @override
  State<WorkspacePage> createState() => _WorkspacePageState();
}

class _WorkspacePageState extends State<WorkspacePage> {
  late String view = widget.initial;
  String category = 'all';
  bool onlyNew = false;
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(), sectors = rows(s.catalog['sectors']);
    return Scaffold(
      appBar: AppBar(title: Text(s.t('研究工作区'))),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Chips(
            values: const {
              'overview': '情报总览',
              'radar': '产业联动',
              'history': '事件档案',
            },
            selected: view,
            onSelected: (v) => setState(() => view = v),
          ),
          if (view == 'history') ...[
            Chips(
              values: {
                'all': '全部情报',
                for (final r in sectors) str(r['id']): str(r['name']),
              },
              selected: category,
              onSelected: (v) => setState(() => category = v),
            ),
            SwitchListTile(
              title: Text(s.t('仅看新事件')),
              value: onlyNew,
              onChanged: (v) => setState(() => onlyNew = v),
            ),
            AsyncPanel(
              key: ValueKey('$category-$onlyNew'),
              load: () => s.api.get(
                '/api/intelligence',
                parameters: {
                  'category': category,
                  'limit': '100',
                  if (onlyNew) 'new': '1',
                },
              ),
              builder: (r) => Column(
                children: [
                  if (r['stored'] == false)
                    Notice(s.t('情报数据库未配置，无法读取长期历史。'))
                  else if (rows(r['items']).isEmpty)
                    Notice(s.t('此范围暂无已归档事件')),
                  ...rows(r['items']).map(NewsTile.new),
                ],
              ),
            ),
          ] else ...[
            if (view == 'radar') const EarningsBoard(),
            if (view == 'overview')
              Panel(
                child: AsyncPanel(
                  load: () => s.api.get('/api/intelligence/summary'),
                  builder: (r) => Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        s.t('事件采集'),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 20),
                      Wrap(
                        spacing: 25,
                        runSpacing: 15,
                        children: [
                          LabelValue('已归档', str(r['total'])),
                          LabelValue('24小时新增', str(r['new24h'])),
                        ],
                      ),
                      const SizedBox(height: 14),
                      if (r['stored'] == false)
                        Notice(s.t('情报数据库未配置，无法读取长期历史。'))
                      else
                        SourceLine(r, extra: str(r['lastRun'])),
                    ],
                  ),
                ),
              ),
            AsyncPanel(
              key: ValueKey('news-$view'),
              load: () =>
                  s.api.get('/api/news', parameters: {'category': 'all'}),
              refreshSeconds: 60,
              builder: (data) {
                final news = rows(data['items']);
                if (view == 'overview') {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      PageTitle('全球情报', '媒体线索 · 公告与财报交叉验证'),
                      ...news.take(15).map(NewsTile.new),
                      ...sectors.map(
                        (r) => Panel(
                          child: ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(s.t(str(r['name']))),
                            subtitle: Text(str(r['en'])),
                            trailing: const Icon(Icons.arrow_forward),
                            onTap: () => setState(() => view = 'radar'),
                          ),
                        ),
                      ),
                      SourceLine(data),
                    ],
                  );
                }
                return Column(
                  children: [
                    ...sectors.map((sector) {
                      final words = (sector['words'] as List?) ?? [],
                          items = news
                              .where(
                                (r) => words.any(
                                  (w) => '${r['title']} ${r['summary']}'
                                      .toLowerCase()
                                      .contains('$w'.toLowerCase()),
                                ),
                              )
                              .take(5)
                              .toList();
                      return Panel(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              s.t(str(sector['name'])),
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              str(sector['en']),
                              style: TextStyle(color: muted, fontSize: 13),
                            ),
                            const SizedBox(height: 16),
                            Wrap(
                              spacing: 8,
                              children: ((sector['tickers'] as List?) ?? [])
                                  .map(
                                    (symbol) => ActionChip(
                                      label: Text('$symbol'),
                                      onPressed: () =>
                                          openStock(context, '$symbol'),
                                    ),
                                  )
                                  .toList(),
                            ),
                            const Divider(height: 30),
                            if (items.isEmpty)
                              Notice(s.t('该主题目前没有从订阅源取得新线索；不能据此认定产业没有变化。')),
                            ...items.map((r) => NewsTile(r, compact: true)),
                            Notice(s.t('媒体线索 · 尚未完成订单 / 财报验证')),
                          ],
                        ),
                      );
                    }),
                    SourceLine(data),
                  ],
                );
              },
            ),
          ],
        ],
      ),
    );
  }
}
