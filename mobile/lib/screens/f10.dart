import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../widgets/common.dart';

class F10Page extends StatefulWidget {
  const F10Page(this.symbol, {super.key});
  final String symbol;
  @override
  State<F10Page> createState() => _F10PageState();
}

class _F10PageState extends State<F10Page> {
  String kind = '2';
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    return AsyncPanel(
      load: () =>
          s.api.get('/api/desk/f10', parameters: {'symbol': widget.symbol}),
      builder: (data) {
        final profile = obj(data['profile']),
            business = rows(data['business']),
            dates = business.map((r) => str(r['date'])).toList()..sort();
        final date = dates.isEmpty ? '—' : dates.last;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (profile.isNotEmpty)
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      str(profile['name']),
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      str(profile['industry']),
                      style: const TextStyle(color: muted),
                    ),
                    const SizedBox(height: 20),
                    Wrap(
                      spacing: 25,
                      runSpacing: 18,
                      children: [
                        LabelValue('上市日期', str(profile['listing'])),
                        LabelValue('成立日期', str(profile['founded'])),
                        LabelValue('董事长', str(profile['chairman'])),
                        LabelValue('员工人数', str(profile['employees'])),
                        LabelValue('地区', str(profile['province'])),
                      ],
                    ),
                    const Divider(height: 36),
                    Text(
                      s.t('公司概况'),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 10),
                    Text(
                      str(profile['description']),
                      style: const TextStyle(height: 1.8),
                    ),
                    ExpansionTile(
                      title: Text(s.t('经营范围')),
                      children: [
                        Text(
                          str(profile['business']),
                          style: const TextStyle(height: 1.8),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    s.t('财务摘要'),
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  Text(
                    s.t('报告期累计值 · 金额为元折算'),
                    style: const TextStyle(color: muted, fontSize: 13),
                  ),
                  DataTableView(
                    columns: const ['报告期', '披露日期', '营业收入', '同比', '归母净利润', '同比'],
                    data: rows(data['financials'])
                        .map(
                          (r) => [
                            str(r['date']),
                            str(r['published']),
                            amount(r['revenue']),
                            percent(r['revenueGrowth']),
                            amount(r['profit']),
                            percent(r['profitGrowth']),
                          ],
                        )
                        .toList(),
                  ),
                ],
              ),
            ),
            Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${s.t('主营构成')} · $date',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  Chips(
                    values: const {'1': '按行业', '2': '按产品', '3': '按地区'},
                    selected: kind,
                    onSelected: (v) => setState(() => kind = v),
                  ),
                  DataTableView(
                    columns: const ['业务', '营业收入', '收入占比', '毛利率'],
                    data: business
                        .where((r) => r['date'] == date && r['kind'] == kind)
                        .map(
                          (r) => [
                            str(r['name']),
                            amount(r['revenue']),
                            numOf(r['ratio']) == null
                                ? '—'
                                : '${(numOf(r['ratio'])! * 100).toStringAsFixed(2)}%',
                            numOf(r['margin']) == null
                                ? '—'
                                : '${(numOf(r['margin'])! * 100).toStringAsFixed(2)}%',
                          ],
                        )
                        .toList(),
                  ),
                ],
              ),
            ),
            Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    s.t('股东户数变化'),
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  DataTableView(
                    columns: const ['截止日期', '股东户数', '较上期变化', '户均流通股'],
                    data: rows(data['holders'])
                        .map(
                          (r) => [
                            str(r['date']),
                            str(r['count']),
                            percent(r['change']),
                            str(r['average']),
                          ],
                        )
                        .toList(),
                  ),
                  Notice(
                    s.t('股东户数为披露期数据，与日K筹码峰模型是不同口径。财务值可能为累计数，不直接比较不同报告期的绝对值。'),
                  ),
                ],
              ),
            ),
            ...((data['warnings'] as List?) ?? []).map((r) => Notice('$r')),
            SourceLine(data),
          ],
        );
      },
    );
  }
}
