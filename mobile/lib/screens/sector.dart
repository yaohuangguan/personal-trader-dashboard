import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../widgets/common.dart';
import '../widgets/compact_picker.dart';
import '../widgets/sector_heatmap.dart';
import 'stock.dart';

class StockSectors extends StatefulWidget {
  const StockSectors(this.symbol, {super.key});
  final String symbol;
  @override
  State<StockSectors> createState() => _StockSectorsState();
}

class _StockSectorsState extends State<StockSectors> {
  String? selected;
  String query = '';
  bool expanded = false;
  @override
  Widget build(BuildContext context) {
    final store = context.watch<AtlasStore>();
    return AsyncPanel(
      key: ValueKey('stock-sectors-${widget.symbol}'),
      load: () => store.api.get(
        '/api/desk/sectors',
        parameters: {'symbol': widget.symbol},
      ),
      builder: (data) {
        final boards = rows(data['boards']);
        final current =
            boards.where((b) => b['code'] == selected).firstOrNull ??
            boards.firstOrNull;
        final matching = boards
            .where(
              (b) => str(b['name']).toLowerCase().contains(query.toLowerCase()),
            )
            .toList();
        final visible = expanded ? matching : matching.take(12).toList();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.symbol,
                              style: TextStyle(fontSize: 12, color: muted),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              store.t('板块联动'),
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        '${boards.length} ${store.t('个所属板块')}',
                        style: TextStyle(fontSize: 11, color: muted),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 18,
                    runSpacing: 8,
                    children: [
                      Text(
                        '↗ ${boards.where((b) => (numOf(b['changePercent']) ?? 0) > 0).length} ${store.t('上涨')}',
                        style: TextStyle(color: up, fontSize: 13),
                      ),
                      Text(
                        '↘ ${boards.where((b) => (numOf(b['changePercent']) ?? 0) < 0).length} ${store.t('下跌')}',
                        style: TextStyle(color: down, fontSize: 13),
                      ),
                      Text(
                        store.t('仅展示该股归属'),
                        style: TextStyle(color: muted, fontSize: 11),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    onChanged: (value) => setState(() => query = value),
                    decoration: InputDecoration(
                      isDense: true,
                      prefixIcon: const Icon(Icons.search, size: 18),
                      hintText: store.t('筛选该股所属板块'),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          store.t('所属板块热力图'),
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                      Text(
                        store.t('色深表示涨跌幅'),
                        style: TextStyle(fontSize: 10, color: muted),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  if (visible.isNotEmpty)
                    SectorHeatmap(
                      visible,
                      showAmount: false,
                      selectedCode: str(current?['code'], ''),
                      height: (visible.length / 3).ceil() * 92.0,
                      onSelect: (board) =>
                          setState(() => selected = str(board['code'])),
                    )
                  else
                    Notice(
                      store.t(boards.isEmpty ? '来源暂无该股板块归属' : '暂无匹配的所属板块'),
                    ),
                  if (matching.length > 12)
                    TextButton(
                      onPressed: () => setState(() => expanded = !expanded),
                      child: Text(store.t(expanded ? '收起板块' : '展开其余板块')),
                    ),
                  ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    title: Text(
                      store.t('来源与口径'),
                      style: TextStyle(fontSize: 11, color: muted),
                    ),
                    children: [SourceLine(data)],
                  ),
                ],
              ),
            ),
            if (current != null)
              SectorMembers(
                str(current['code']),
                str(current['name']),
                currentSymbol: widget.symbol,
              ),
          ],
        );
      },
    );
  }
}

class SectorMembers extends StatelessWidget {
  const SectorMembers(this.code, this.name, {super.key, this.currentSymbol});
  final String? currentSymbol;
  final String code, name;
  @override
  Widget build(BuildContext context) {
    final s = context.read<AtlasStore>();
    return AsyncPanel(
      key: ValueKey(code),
      load: () => s.api.get(
        '/api/desk/peers',
        parameters: {'code': code, 'name': name},
      ),
      builder: (r) => Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '$name · ${s.t(r['related'] == true ? '相关分类参考' : '板块成分')}${r['related'] == true ? ' · ${str(r['resolvedName'])}' : ''}',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            ...rows(r['items']).map(
              (b) => ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  str(b['name']) +
                      (b['symbol'] == currentSymbol ? ' · ${s.t('本股')}' : ''),
                ),
                subtitle: Text(str(b['symbol'])),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(fixed(b['price'])),
                    Text(
                      percent(b['changePercent']),
                      style: TextStyle(
                        color: tone(b['changePercent']),
                        fontSize: 14,
                        height: 1.1,
                      ),
                    ),
                  ],
                ),
                onTap: () => openStock(context, str(b['symbol'])),
              ),
            ),
            SourceLine(r, extra: s.t('来源成分涨幅前16；未读取全成分')),
            if (r['notice'] != null) Notice(str(r['notice'])),
          ],
        ),
      ),
    );
  }
}

class SectorPage extends StatelessWidget {
  const SectorPage(this.code, this.name, {super.key});
  final String code, name;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(name)),
    body: SingleChildScrollView(
      padding: const EdgeInsets.all(18),
      child: Column(
        children: [
          if (code.startsWith('SN:')) SectorOutlook(code: code, name: name),
          SectorMembers(code, name),
        ],
      ),
    ),
  );
}

class SectorOutlook extends StatefulWidget {
  const SectorOutlook({super.key, this.code, this.name});
  final String? code, name;
  @override
  State<SectorOutlook> createState() => _SectorOutlookState();
}

class _SectorOutlookState extends State<SectorOutlook> {
  String? code;
  String? name;
  @override
  void initState() {
    super.initState();
    code = widget.code;
    name = widget.name;
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PageTitle('天时 · 地利 · 人和', '根据可核验的市场与成分快照建立观察剧本，条件变化就调整判断。'),
        if (widget.code == null)
          AsyncPanel(
            load: () => s.api.get('/api/desk/industries'),
            builder: (r) {
              final items = rows(r['items']);
              return CompactPicker(
                label: '分析行业',
                value: code,
                items: {
                  for (final item in items)
                    str(item['code']): str(item['name']),
                },
                onChanged: (v) => setState(() {
                  code = v;
                  name = str(items.firstWhere((r) => r['code'] == v)['name']);
                }),
              );
            },
          ),
        const SizedBox(height: 16),
        if (code != null)
          AsyncPanel(
            key: ValueKey('$code-scenario'),
            load: () => s.api.get(
              '/api/desk/sector-scenario',
              parameters: {'code': code!},
            ),
            builder: (data) {
              final breadth = obj(data['breadth']),
                  conditions = obj(data['conditions']);
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          s.t('天时 · 大盘环境'),
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        AsyncPanel(
                          load: () => s.api.get(
                            '/api/desk/quotes',
                            parameters: {
                              'symbols': '000001.SH,399001.SZ,399006.SZ,000300.SH,000688.SH',
                            },
                          ),
                          builder: (r) => Column(
                            children: rows(r['items'])
                                .map(
                                  (q) => ListTile(
                                    title: Text(str(q['name'])),
                                    subtitle: Text(str(q['asOf'])),
                                    trailing: Text(
                                      percent(q['changePercent']),
                                      style: TextStyle(
                                        color: tone(q['changePercent']),
                                      ),
                                    ),
                                  ),
                                )
                                .toList(),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${s.t('地利 · 行业内扩散')} · $name',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          s.t(str(breadth['label'])),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 18),
                        Wrap(
                          spacing: 24,
                          runSpacing: 18,
                          children: [
                            LabelValue('上涨', str(breadth['up'])),
                            LabelValue('下跌', str(breadth['down'])),
                            LabelValue('平盘', str(breadth['flat'])),
                            LabelValue(
                              '上涨占比',
                              '${fixed((numOf(breadth['positiveShare']) ?? 0) * 100)}%',
                            ),
                            LabelValue('中位涨幅', '${fixed(breadth['median'])}%'),
                            LabelValue(
                              '覆盖',
                              '${breadth['sampled']} / ${breadth['total']}',
                            ),
                          ],
                        ),
                        const SizedBox(height: 18),
                        Notice(
                          s.t(
                            breadth['complete'] == true
                                ? '家数与登记一致'
                                : '部分样本，停止整体结论',
                          ),
                        ),
                      ],
                    ),
                  ),
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          s.t('人和 · 参与与证据'),
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 16),
                        LabelValue('行业成交额', amount(breadth['amount'])),
                        const SizedBox(height: 14),
                        Notice(s.t('行业主力净流入与筹码集中度尚待独立数据核验。')),
                      ],
                    ),
                  ),
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          s.t('延续条件'),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        Text(
                          str(conditions['continuation']),
                          style: const TextStyle(height: 1.8),
                        ),
                        const SizedBox(height: 18),
                        Text(
                          s.t('降级条件'),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        Text(
                          str(conditions['invalidation']),
                          style: const TextStyle(height: 1.8),
                        ),
                        const SizedBox(height: 18),
                        Notice(s.t('情景条件为观察阈值，不输出未经校准的上涨概率。')),
                      ],
                    ),
                  ),
                  SourceLine(data),
                ],
              );
            },
          ),
      ],
    );
  }
}
