import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../widgets/common.dart';
import 'stock.dart';

class StockSectors extends StatefulWidget {
  const StockSectors(this.symbol, {super.key});
  final String symbol;
  @override
  State<StockSectors> createState() => _StockSectorsState();
}

class _StockSectorsState extends State<StockSectors> {
  String? selected;
  String name = '';
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AsyncPanel(
          load: () => s.api.get(
            '/api/desk/sectors',
            parameters: {'symbol': widget.symbol},
          ),
          builder: (r) => Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.t('所属板块'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: rows(r['boards'])
                      .map(
                        (b) => ChoiceChip(
                          label: Text(
                            '${b['name']} ${percent(b['changePercent'])}',
                          ),
                          selected: selected == b['code'],
                          onSelected: (_) => setState(() {
                            selected = str(b['code']);
                            name = str(b['name']);
                          }),
                        ),
                      )
                      .toList(),
                ),
                SourceLine(r),
              ],
            ),
          ),
        ),
        AsyncPanel(
          load: () => s.api.get(
            '/api/desk/sector-map',
            parameters: {'type': 'concept'},
          ),
          builder: (r) => Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  s.t('独立概念成分'),
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: s.t('选择概念（新浪独立分类）'),
                    border: const OutlineInputBorder(),
                  ),
                  items: rows(r['items'])
                      .map(
                        (b) => DropdownMenuItem(
                          value: str(b['code']),
                          child: Text(
                            '${str(b['name'])} ${percent(b['changePercent'])}',
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    final b = rows(r['items'])
                        .where((b) => b['code'] == value)
                        .firstOrNull;
                    if (b != null)
                      setState(() {
                        selected = value;
                        name = str(b['name']);
                      });
                  },
                ),
                Notice(s.t('可直接查看机器人、创新药等概念成分；不同来源分类分别标识。')),
              ],
            ),
          ),
        ),
        if (selected != null) SectorMembers(selected!, name),
        const SizedBox(height: 10),
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                s.t('市场行业轮动'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              AsyncPanel(
                load: () => s.api.get('/api/desk/industries'),
                builder: (r) => Column(
                  children: [
                    ...rows(r['items']).map(
                      (b) => ListTile(
                        title: Text(str(b['name'])),
                        subtitle: Text('${s.t('领涨')} ${str(b['leader'])}'),
                        trailing: Text(
                          percent(b['changePercent']),
                          style: TextStyle(color: tone(b['changePercent'])),
                        ),
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                SectorPage(str(b['code']), str(b['name'])),
                          ),
                        ),
                      ),
                    ),
                    SourceLine(r),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class SectorMembers extends StatelessWidget {
  const SectorMembers(this.code, this.name, {super.key});
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
              '${str(r['resolvedName'], name)} · ${s.t(r['related'] == true ? '相关分类参考' : '板块成分')}',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            ...rows(r['items']).map(
              (b) => ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(str(b['name'])),
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
              return DropdownButtonFormField<String>(
                initialValue: code,
                decoration: InputDecoration(labelText: s.t('分析行业')),
                items: items
                    .map(
                      (r) => DropdownMenuItem(
                        value: str(r['code']),
                        child: Text(str(r['name'])),
                      ),
                    )
                    .toList(),
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
