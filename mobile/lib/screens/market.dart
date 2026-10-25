import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/indicators.dart';
import '../widgets/common.dart';
import '../widgets/market_chart.dart';
import 'stock.dart';
import 'sector.dart';

const indexSymbols = [
  '000001.SH',
  '399001.SZ',
  '399006.SZ',
  '000300.SH',
  '000688.SH',
];
const indexNames = ['上证指数', '深证成指', '创业板指', '沪深300', '科创50'];

class MarketPage extends StatefulWidget {
  const MarketPage({super.key});
  @override
  State<MarketPage> createState() => _MarketPageState();
}

class _MarketPageState extends State<MarketPage> {
  String index = indexSymbols.first,
      timeframe = 'intraday',
      ranking = 'gainers',
      kind = 'stocks';
  Json? indices;
  String? error;
  Timer? timer;
  @override
  void initState() {
    super.initState();
    refresh();
    timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted && context.read<AtlasStore>().foreground) refresh();
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> refresh() async {
    try {
      final r = await context.read<AtlasStore>().api.get(
        '/api/desk/quotes',
        parameters: {'symbols': indexSymbols.join(',')},
      );
      if (mounted) {
        setState(() {
          indices = r;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(),
        q = rows(indices?['items']),
        date = q.isNotEmpty ? str(q.first['asOf']).substring(0, 10) : null;
    return RefreshIndicator(
      onRefresh: refresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          PageTitle(
            '市场全景',
            '大盘分时 · 热点板块 · 强势个股 · 市场情绪',
            trailing: IconButton(
              onPressed: refresh,
              icon: const Icon(Icons.refresh),
            ),
          ),
          if (error != null) Notice(error!),
          SizedBox(
            height: 180,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: 5,
              separatorBuilder: (_, _) => const SizedBox(width: 12),
              itemBuilder: (context, i) {
                final quote =
                    q
                        .where((q) => q['symbol'] == indexSymbols[i])
                        .firstOrNull ??
                    {};
                return SizedBox(
                  width: 175,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () => setState(() => index = indexSymbols[i]),
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: index == indexSymbols[i]
                            ? const Color(0xff27272e)
                            : surface,
                        border: Border.all(
                          color: index == indexSymbols[i]
                              ? Colors.white70
                              : const Color(0xff393942),
                        ),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            s.t(indexNames[i]),
                            style: const TextStyle(fontSize: 15),
                          ),
                          const SizedBox(height: 10),
                          Text(
                            fixed(quote['price']),
                            style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            percent(quote['changePercent']),
                            style: TextStyle(
                              color: tone(quote['changePercent']),
                              fontSize: 17,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          Panel(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.t(indexNames[indexSymbols.indexOf(index)]),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Chips(
                  values: const {
                    'intraday': '分时',
                    'day': '日 K',
                    'week': '周 K',
                    'month': '月 K',
                  },
                  selected: timeframe,
                  onSelected: (v) => setState(() => timeframe = v),
                ),
                AsyncPanel(
                  key: ValueKey('$index-$timeframe'),
                  refreshSeconds: timeframe == 'intraday' ? 15 : 60,
                  load: () => s.api.get(
                    timeframe == 'intraday'
                        ? '/api/desk/intraday'
                        : '/api/desk/history',
                    parameters: {
                      'symbol': index,
                      if (timeframe != 'intraday') 'period': timeframe,
                    },
                  ),
                  builder: (r) => timeframe == 'intraday'
                      ? IntradayChart(r)
                      : Column(
                          children: [
                            MarketChart(
                              bars: rows(r['candles'])
                                  .map(Bar.fromJson)
                                  .toList(),
                              symbol: index,
                              unit: timeframe,
                              volumeUnit: str(r['volumeUnit']),
                            ),
                            SourceLine(r),
                          ],
                        ),
                ),
              ],
            ),
          ),
          if (date != null)
            AsyncPanel(
              key: ValueKey('$date-pools'),
              load: () => s.api.get(
                '/api/desk/market-pools',
                parameters: {'date': date},
              ),
              builder: (r) => _sentiment(context, r),
            ),
          Chips(
            values: const {'stocks': '个股机会榜', 'sectors': '热点板块 · 涨幅排序'},
            selected: kind,
            onSelected: (v) => setState(() => kind = v),
          ),
          if (kind == 'sectors')
            AsyncPanel(
              load: () => s.api.get('/api/desk/ranks'),
              builder: (r) => Panel(
                child: Column(
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
                    SourceLine(r, extra: s.t('公开快照，来源未提供交易日期；热度按涨幅衡量。')),
                  ],
                ),
              ),
            )
          else ...[
            Chips(
              values: const {
                'gainers': '涨幅榜',
                'dragon': '近期龙虎榜',
                'yesterday': '昨日涨停',
                'up': '本日涨停',
              },
              selected: ranking,
              onSelected: (v) => setState(() => ranking = v),
            ),
            if (ranking == 'gainers' || date != null)
              AsyncPanel(
                key: ValueKey('$ranking-$date'),
                load: () => s.api.get(
                  ranking == 'gainers'
                      ? '/api/desk/gainers'
                      : ranking == 'dragon'
                      ? '/api/desk/dragon'
                      : '/api/desk/market-pools',
                  parameters: ranking == 'gainers' ? null : {'date': date!},
                ),
                builder: (r) {
                  final pool = obj(obj(r['pools'])[ranking]),
                      items = ranking == 'yesterday' || ranking == 'up'
                          ? rows(pool['items'])
                          : rows(r['items']);
                  items.sort(
                    (a, b) => (numOf(b['changePercent']) ?? 0).compareTo(
                      numOf(a['changePercent']) ?? 0,
                    ),
                  );
                  return Panel(
                    child: Column(
                      children: [
                        if (ranking == 'dragon')
                          Notice(
                            '${r['start']} ~ ${r['end']} · ${s.t('披露日涨幅')}',
                          ),
                        if (items.isEmpty)
                          Notice(str(pool['reason'], s.t('此范围暂无记录'))),
                        ...items.map(
                          (stock) => ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(str(stock['name'])),
                            subtitle: Text(
                              '${stock['symbol']}${stock['date'] != null ? ' · ${stock['date']}' : ''}',
                            ),
                            trailing: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(fixed(stock['price'])),
                                Text(
                                  percent(stock['changePercent']),
                                  style: TextStyle(
                                    color: tone(stock['changePercent']),
                                    fontSize: 14,
                                    height: 1.1,
                                  ),
                                ),
                              ],
                            ),
                            onTap: () =>
                                openStock(context, str(stock['symbol'])),
                          ),
                        ),
                        SourceLine(
                          r,
                          extra: ranking == 'gainers'
                              ? str(r['scope'], '')
                              : null,
                        ),
                      ],
                    ),
                  );
                },
              ),
          ],
        ],
      ),
    );
  }

  Widget _sentiment(BuildContext context, Json data) {
    final s = context.read<AtlasStore>(),
        p = sentiment(obj(data['pools'])),
        score = numOf(p?['score']);
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(s.t('情绪指数'), style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                score?.toStringAsFixed(0) ?? '—',
                style: const TextStyle(
                  fontSize: 54,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const Padding(
                padding: EdgeInsets.only(bottom: 10, left: 10),
                child: Text('/ 100', style: TextStyle(color: muted)),
              ),
            ],
          ),
          Text(
            s.t(
              score == null
                  ? '数据不足，无法计算'
                  : score >= 75
                  ? '偏热 · 留意分歧'
                  : score >= 55
                  ? '偏积极'
                  : score >= 35
                  ? '分歧整理'
                  : '偏冷 · 留意风险',
            ),
          ),
          const SizedBox(height: 18),
          LinearProgressIndicator(
            value: (score ?? 0) / 100,
            color: const Color(0xffd4d4df),
            backgroundColor: const Color(0xff34343e),
          ),
          const SizedBox(height: 20),
          Wrap(
            spacing: 24,
            runSpacing: 16,
            children: [
              LabelValue('涨停家数', str(p?['up'])),
              LabelValue('跌停家数', str(p?['down'])),
              LabelValue('炸板家数', str(p?['broken'])),
              LabelValue('昨涨停平均溢价', percent(p?['premium'])),
            ],
          ),
          ExpansionTile(
            title: Text(s.t('查看计算口径')),
            children: [
              Text(
                s.t(
                  '40% × 涨停占涨跌停之比 + 30% × 封板率 + 30% × 昨涨停溢价强度。溢价强度 = clamp(50 + 平均涨幅 × 5, 0, 100)。低于35偏冷、55以上偏积极、75以上偏热；均为自定义观察阈值。',
                ),
                style: const TextStyle(color: muted, height: 1.8),
              ),
            ],
          ),
          SourceLine(data),
        ],
      ),
    );
  }
}
