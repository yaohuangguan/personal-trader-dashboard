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
  String tab = 'overview',
      kind = 'fzb',
      period = '',
      holders = 'major',
      businessKind = '2';
  Widget heading(BuildContext c, String title) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Text(
      tr(c, title),
      style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600),
    ),
  );
  Widget fact(BuildContext c, String name, String value, {Color? color}) =>
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 9),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              flex: 5,
              child: Text(
                tr(c, name),
                style: TextStyle(fontSize: 14, color: muted),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              flex: 6,
              child: Text(
                value,
                textAlign: TextAlign.right,
                style: TextStyle(fontSize: 16, color: color),
              ),
            ),
          ],
        ),
      );
  Widget kpi(BuildContext c, String name, String value, {dynamic growth}) =>
      Expanded(
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: atlasColor(0xff1b1b20),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(tr(c, name), style: TextStyle(fontSize: 13, color: muted)),
              const SizedBox(height: 8),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (growth != null)
                Text(
                  '${tr(c, '同比')} ${percent(growth)}',
                  style: TextStyle(fontSize: 13, color: tone(growth)),
                ),
            ],
          ),
        ),
      );
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    return AsyncPanel(
      load: () =>
          s.api.get('/api/desk/f10', parameters: {'symbol': widget.symbol}),
      builder: (data) {
        final profile = obj(data['profile']),
            financials = rows(data['financials']),
            latest = financials.firstOrNull ?? {},
            statements = rows(data['statements'])
                .where((r) => r['kind'] == kind)
                .toList(),
            dates = statements.map((r) => str(r['date'])).toList(),
            selected =
                statements.where((r) => r['date'] == period).firstOrNull ??
                statements.firstOrNull ??
                {},
            reportItems = rows(selected['items']);
        final holderRows = rows(
          data[holders == 'major' ? 'majorHolders' : 'floatHolders'],
        );
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Chips(
              values: const {
                'overview': '公司概况',
                'finance': '财务报表',
                'holders': '股东研究',
                'business': '主营构成',
              },
              selected: tab,
              onSelected: (v) => setState(() => tab = v),
            ),
            if (tab == 'overview') ...[
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    heading(context, str(profile['name'], '公司概况')),
                    Text(
                      str(profile['industry']),
                      style: TextStyle(color: muted, fontSize: 15),
                    ),
                    const SizedBox(height: 14),
                    Wrap(
                      spacing: 24,
                      runSpacing: 16,
                      children: [
                        LabelValue('上市日期', str(profile['listing'])),
                        LabelValue('董事长', str(profile['chairman'])),
                        LabelValue('员工人数', str(profile['employees'])),
                        LabelValue('地区', str(profile['province'])),
                      ],
                    ),
                    ExpansionTile(
                      tilePadding: EdgeInsets.zero,
                      title: Text(s.t('公司简介')),
                      children: [
                        Text(
                          str(profile['description']),
                          style: const TextStyle(height: 1.8),
                        ),
                      ],
                    ),
                    ExpansionTile(
                      tilePadding: EdgeInsets.zero,
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
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    heading(context, '最新财务摘要'),
                    Text(
                      '${str(latest['date'])} · ${s.t('报告期累计值')}',
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        kpi(
                          context,
                          '营业收入',
                          amount(latest['revenue']),
                          growth: latest['revenueGrowth'],
                        ),
                        const SizedBox(width: 10),
                        kpi(
                          context,
                          '归母净利润',
                          amount(latest['profit']),
                          growth: latest['profitGrowth'],
                        ),
                      ],
                    ),
                    TextButton(
                      onPressed: () => setState(() => tab = 'finance'),
                      child: Text(s.t('查看完整三张报表')),
                    ),
                  ],
                ),
              ),
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    heading(context, '股东概览'),
                    for (final r in rows(data['controllers']))
                      fact(
                        context,
                        '实际控制人',
                        '${str(r['name'])} · ${fixed(r['ratio'])}%',
                      ),
                    if (rows(data['holders']).isNotEmpty) ...[
                      fact(
                        context,
                        '股东户数',
                        amount(rows(data['holders']).first['count']),
                      ),
                      fact(
                        context,
                        '户数环比',
                        percent(rows(data['holders']).first['change']),
                      ),
                      fact(
                        context,
                        '户均流通股',
                        amount(rows(data['holders']).first['average']),
                      ),
                      Text(
                        '${s.t('报告期')} ${str(rows(data['holders']).first['date'])}',
                        style: TextStyle(color: muted, fontSize: 12),
                      ),
                    ],
                    TextButton(
                      onPressed: () => setState(() => tab = 'holders'),
                      child: Text(s.t('查看十大股东与流通股东')),
                    ),
                  ],
                ),
              ),
            ],
            if (tab == 'finance') ...[
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    heading(context, '财务趋势'),
                    for (final r in financials.take(8))
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        child: Column(
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    str(r['date']),
                                    style: TextStyle(
                                      color: muted,
                                      fontSize: 13,
                                    ),
                                  ),
                                ),
                                Text(
                                  '${s.t('营收')} ${amount(r['revenue'])}',
                                  style: const TextStyle(fontSize: 14),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '${s.t('归母净利润')} ${amount(r['profit'])}',
                                    style: const TextStyle(fontSize: 15),
                                  ),
                                ),
                                Text(
                                  percent(r['profitGrowth']),
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: tone(r['profitGrowth']),
                                  ),
                                ),
                              ],
                            ),
                            const Divider(height: 16),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Chips(
                      values: const {
                        'fzb': '资产负债',
                        'lrb': '利润表',
                        'llb': '现金流量',
                      },
                      selected: kind,
                      onSelected: (v) => setState(() {
                        kind = v;
                        period = '';
                      }),
                    ),
                    if (dates.isNotEmpty)
                      DropdownButton<String>(
                        isExpanded: true,
                        value: str(selected['date']),
                        items: dates
                            .map(
                              (d) => DropdownMenuItem(value: d, child: Text(d)),
                            )
                            .toList(),
                        onChanged: (v) => setState(() => period = v!),
                      ),
                    Text(
                      '${str(selected['published'])} ${s.t('披露')} · ${str(selected['currency'])} · ${str(selected['scope'])} · ${str(selected['audited'])}',
                      style: TextStyle(fontSize: 12, color: muted, height: 1.8),
                    ),
                    const SizedBox(height: 12),
                    if (reportItems.isEmpty) Notice(s.t('该报表来源暂无已披露记录')),
                    for (final r in reportItems.take(8))
                      fact(context, str(r['name']), amount(r['value'])),
                    if (reportItems.length > 8)
                      ExpansionTile(
                        tilePadding: EdgeInsets.zero,
                        title: Text('${s.t('展开全部科目')} (${reportItems.length})'),
                        children: [
                          for (final r in reportItems.skip(8))
                            fact(context, str(r['name']), amount(r['value'])),
                        ],
                      ),
                    Notice(s.t('金额按来源币种折算万 / 亿；利润和现金流为报告期累计值，非单季度。')),
                  ],
                ),
              ),
            ],
            if (tab == 'holders') ...[
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    heading(context, '十大股东'),
                    Chips(
                      values: const {'major': '十大股东', 'float': '十大流通股东'},
                      selected: holders,
                      onSelected: (v) => setState(() => holders = v),
                    ),
                    Text(
                      '${s.t('报告期')} ${str(holderRows.firstOrNull?['date'])}',
                      style: TextStyle(fontSize: 13, color: muted),
                    ),
                    if (holderRows.isEmpty) Notice(s.t('来源未提供股东明细')),
                    for (final r in holderRows)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${str(r['rank'])}  ',
                                  style: TextStyle(color: muted, fontSize: 14),
                                ),
                                Expanded(
                                  child: Text(
                                    str(r['name']),
                                    style: const TextStyle(
                                      fontSize: 16,
                                      height: 1.4,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Text(
                                  '${fixed(r['ratio'])}%',
                                  style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            LinearProgressIndicator(
                              value: ((numOf(r['ratio']) ?? 0) / 100).clamp(
                                0,
                                1,
                              ),
                              minHeight: 3,
                              color: atlasColor(0xff8a9aa8),
                              backgroundColor: atlasColor(0xff292930),
                            ),
                            const SizedBox(height: 7),
                            Text(
                              '${amount(r['shares'])} ${s.t('股')} · ${str(r['change'])}',
                              style: TextStyle(fontSize: 13, color: muted),
                            ),
                          ],
                        ),
                      ),
                    Notice(
                      s.t(
                        holders == 'major'
                            ? '占总股本比例；仅展示来源前十大持有人。'
                            : '占流通股本比例；不能与总股本口径混加。',
                      ),
                    ),
                  ],
                ),
              ),
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    heading(context, '股东户数变化'),
                    for (final r in rows(data['holders']))
                      fact(
                        context,
                        str(r['date']),
                        '${amount(r['count'])} · ${percent(r['change'])}',
                      ),
                  ],
                ),
              ),
            ],
            if (tab == 'business')
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    heading(context, '主营构成'),
                    Chips(
                      values: const {'1': '行业', '2': '产品', '3': '地区'},
                      selected: businessKind,
                      onSelected: (v) => setState(() => businessKind = v),
                    ),
                    for (final r in rows(
                      data['business'],
                    ).where((r) => r['kind'] == businessKind)) ...[
                      fact(context, str(r['name']), amount(r['revenue'])),
                      Text(
                        '${str(r['date'])} · ${s.t('营收占比')} ${fixed(numOf(r['ratio']) == null ? null : numOf(r['ratio'])! * 100)}% · ${s.t('毛利率')} ${fixed(numOf(r['margin']) == null ? null : numOf(r['margin'])! * 100)}%',
                        style: TextStyle(fontSize: 13, color: muted),
                      ),
                      const Divider(height: 22),
                    ],
                    if (rows(data['business'])
                        .where((r) => r['kind'] == businessKind)
                        .isEmpty)
                      Notice(s.t('来源暂无该分类记录')),
                  ],
                ),
              ),
            ...((data['warnings'] as List?) ?? []).map(
              (w) => Notice(s.t('$w')),
            ),
            SourceLine(data),
            Notice(s.t('报告期与披露日期分别展示；尚未披露或来源缺失的项目不补值。')),
          ],
        );
      },
    );
  }
}
