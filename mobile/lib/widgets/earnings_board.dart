import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import 'common.dart';
import '../screens/stock.dart';

const earningsSorts = {
  'profitGrowth': '归母净利同比',
  'revenueGrowth': '营收同比',
  'profit': '归母净利润',
  'revenue': '营业收入',
  'disclosed': '披露日期',
};
String reportLabel(String p) => p.length < 10
    ? p
    : '${p.substring(0, 4)}${const {'03-31': ' 一季报', '06-30': ' 中报', '09-30': ' 三季报', '12-31': ' 年报'}[p.substring(5)] ?? ''}';

class EarningsBoard extends StatefulWidget {
  const EarningsBoard({super.key});
  @override
  State<EarningsBoard> createState() => _EarningsBoardState();
}

class _EarningsBoardState extends State<EarningsBoard> {
  String period = 'latest', sort = 'profitGrowth', order = 'desc', query = '';
  int page = 1, revision = 0;
  Json? data;
  String? error;
  bool loading = true;
  final search = TextEditingController();
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> load() async {
    final request = ++revision;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final next = await context.read<AtlasStore>().api.get(
        '/api/desk/earnings',
        parameters: {
          'period': period,
          'sort': sort,
          'order': order,
          'page': '$page',
          'q': query,
        },
      );
      if (mounted && request == revision) setState(() => data = next);
    } catch (e) {
      if (mounted && request == revision) setState(() => error = e.toString());
    } finally {
      if (mounted && request == revision) setState(() => loading = false);
    }
  }

  void change(VoidCallback fn) {
    setState(() {
      fn();
      data = null;
    });
    load();
  }

  Widget metric(BuildContext c, String label, String value, {Color? color}) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(tr(c, label), style: TextStyle(fontSize: 12, color: muted)),
          const SizedBox(height: 5),
          Text(
            value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: color ?? ink,
            ),
          ),
        ],
      );
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(),
        items = rows(data?['items']),
        periods = (data?['periods'] as List?)?.cast<String>() ?? <String>[];
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      s.t('全市场财报披露'),
                      style: const TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 7),
                    Text(
                      '${s.t('沪深北 A 股 · 正式报表')}\n${data == null ? s.t('最新报告期') : reportLabel(str(data?['period']))}',
                      style: TextStyle(fontSize: 12, height: 1.7, color: muted),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: s.t('刷新财报'),
                onPressed: loading ? null : load,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 18),
          DropdownButtonFormField<String>(
            initialValue: period,
            key: ValueKey('period-$period'),
            isExpanded: true,
            decoration: InputDecoration(labelText: s.t('报告期')),
            items: [
              DropdownMenuItem(
                value: 'latest',
                child: Text(s.t('最新已披露报告期'), overflow: TextOverflow.ellipsis),
              ),
              ...{...periods, if (period != 'latest') period}.map(
                (p) => DropdownMenuItem(value: p, child: Text(reportLabel(p))),
              ),
            ],
            onChanged: (v) {
              if (v != null) {
                change(() {
                  period = v;
                  page = 1;
                });
              }
            },
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: sort,
                  key: ValueKey(sort),
                  isExpanded: true,
                  decoration: InputDecoration(labelText: s.t('排序')),
                  items: earningsSorts.entries
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
                  onChanged: (v) {
                    if (v != null) {
                      change(() {
                        sort = v;
                        order = 'desc';
                        page = 1;
                      });
                    }
                  },
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                tooltip: s.t(order == 'desc' ? '从高到低 ↓' : '从低到高 ↑'),
                onPressed: () => change(() {
                  order = order == 'desc' ? 'asc' : 'desc';
                  page = 1;
                }),
                icon: Icon(order == 'desc' ? Icons.south : Icons.north),
              ),
            ],
          ),
          const SizedBox(height: 14),
          TextField(
            controller: search,
            maxLength: 30,
            decoration: InputDecoration(
              labelText: s.t('股票全名或六位代码'),
              counterText: '',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(
                tooltip: s.t('搜索'),
                onPressed: () => change(() {
                  query = search.text.trim();
                  page = 1;
                }),
                icon: const Icon(Icons.arrow_forward),
              ),
            ),
            textInputAction: TextInputAction.search,
            onSubmitted: (v) => change(() {
              query = v.trim();
              page = 1;
            }),
          ),
          if (query.isNotEmpty)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () {
                  search.clear();
                  change(() {
                    query = '';
                    page = 1;
                  });
                },
                child: Text(s.t('清除')),
              ),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text(
              s.t('默认按归母净利润同比增速排列；营收与利润均为本报告期累计值。高增长需结合利润规模及低基数核验。'),
              style: TextStyle(fontSize: 12, color: muted, height: 1.7),
            ),
          ),
          if (loading)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: CircularProgressIndicator(),
              ),
            ),
          if (error != null) ...[
            Notice(error!),
            TextButton(onPressed: load, child: Text(s.t('重试数据源'))),
          ],
          if (data != null) ...[
            Text(
              '${s.t('本期已披露')} ${data?['total']} · ${data?['page']} / ${numOf(data?['pages']) == 0 ? 1 : data?['pages']}',
              style: TextStyle(color: muted, fontSize: 13),
            ),
            if (items.isEmpty) Notice(s.t('当前条件下暂无已披露报表')),
            ...items.asMap().entries.map((entry) {
              final r = entry.value;
              return Container(
                margin: const EdgeInsets.only(top: 16),
                padding: const EdgeInsets.symmetric(vertical: 16),
                decoration: BoxDecoration(
                  border: Border(
                    top: BorderSide(color: ink.withValues(alpha: .12)),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    InkWell(
                      onTap: () => openStock(context, str(r['symbol'])),
                      child: Row(
                        children: [
                          Text(
                            '${(page - 1) * 40 + entry.key + 1}',
                            style: TextStyle(color: muted, fontSize: 13),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  str(r['name']),
                                  style: const TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                Text(
                                  '${r['symbol']} · ${str(r['industry'])}',
                                  style: TextStyle(fontSize: 12, color: muted),
                                ),
                              ],
                            ),
                          ),
                          const Icon(Icons.north_east, size: 17),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    LayoutBuilder(
                      builder: (c, b) => Wrap(
                        spacing: 12,
                        runSpacing: 16,
                        children: [
                          SizedBox(
                            width: (b.maxWidth - 12) / 2,
                            child: metric(
                              c,
                              '归母净利同比',
                              percent(r['profitGrowth']),
                              color: tone(r['profitGrowth']),
                            ),
                          ),
                          SizedBox(
                            width: (b.maxWidth - 12) / 2,
                            child: metric(
                              c,
                              '营收同比',
                              percent(r['revenueGrowth']),
                              color: tone(r['revenueGrowth']),
                            ),
                          ),
                          SizedBox(
                            width: (b.maxWidth - 12) / 2,
                            child: metric(
                              c,
                              '归母净利润',
                              amount(r['profit']),
                              color:
                                  numOf(r['profit']) != null &&
                                      numOf(r['profit'])! < 0
                                  ? down
                                  : null,
                            ),
                          ),
                          SizedBox(
                            width: (b.maxWidth - 12) / 2,
                            child: metric(c, '营业收入', amount(r['revenue'])),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text(
                      'EPS ${fixed(r['eps'])} · ROE ${percent(r['roe'])}\n${s.t('披露')} ${r['disclosed']}',
                      style: TextStyle(fontSize: 12, color: muted, height: 1.7),
                    ),
                  ],
                ),
              );
            }),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: page <= 1 || loading
                        ? null
                        : () => change(() => page--),
                    icon: const Icon(Icons.chevron_left),
                    label: Text(s.t('上一页')),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: loading || page >= (numOf(data?['pages']) ?? 0)
                        ? null
                        : () => change(() => page++),
                    label: Text(s.t('下一页')),
                    icon: const Icon(Icons.chevron_right),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              '${str(data?['source'])}\n${str(data?['notice'])}',
              style: TextStyle(color: muted, fontSize: 12, height: 1.7),
            ),
          ],
        ],
      ),
    );
  }
}
