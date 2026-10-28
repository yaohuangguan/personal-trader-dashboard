import 'sector_explorer.dart';

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/indicators.dart';
import '../widgets/common.dart';
import '../widgets/market_chart.dart';
import '../widgets/live_chart_feed.dart';
import 'stock.dart';

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
  String index = indexSymbols.first, timeframe = 'day', ranking = 'gainers';
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

  String view = 'index';
  int feedRevision = 0;
  Widget _tabs(BuildContext context) => Chips(
    values: const {
      'index': '指数',
      'sector': '热点板块',
      'stocks': '个股机会榜',
      'mood': '情绪指数',
    },
    selected: view,
    onSelected: (v) => setState(() => view = v),
  );
  @override
  Widget build(BuildContext context) {
    final store = context.watch<AtlasStore>(), quotes = rows(indices?['items']);
    final sourceDate = quotes.isEmpty
        ? null
        : str(quotes.first['asOf']).split('T').first;
    return Column(
      children: [
        _tabs(context),
        if (view == 'index') ...[
          SizedBox(
            height: 88,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: 5,
              itemBuilder: (ctx, i) {
                final q =
                    quotes
                        .where((r) => r['symbol'] == indexSymbols[i])
                        .firstOrNull ??
                    {};
                return InkWell(
                  onTap: () => setState(() => index = indexSymbols[i]),
                  child: Container(
                    width: 130,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      border: Border(
                        right: BorderSide(
                          color: atlasColor(0xff292930),
                          width: .5,
                        ),
                        bottom: BorderSide(
                          color: index == indexSymbols[i]
                              ? ink.withValues(alpha: .54)
                              : Colors.transparent,
                          width: 1,
                        ),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          store.t(indexNames[i]),
                          style: TextStyle(
                            fontSize: 12,
                            height: 1,
                            color: muted,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          fixed(q['price']),
                          style: const TextStyle(
                            fontSize: 21,
                            height: 1,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          percent(q['changePercent']),
                          style: TextStyle(
                            fontSize: 12,
                            height: 1,
                            color: tone(q['changePercent']),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          PeriodSelector(
            value: timeframe,
            onChanged: (v) => setState(() => timeframe = v),
          ),
          Expanded(
            child: LayoutBuilder(
              builder: (ctx, c) {
                final key = '$index-$timeframe';
                return LiveChartFeed(
                  key: ValueKey((key, feedRevision)),
                  refreshSeconds: timeframe == 'intraday' ? 15 : 60,
                  load: () => store.api.get(
                    timeframe == 'intraday'
                        ? '/api/desk/intraday'
                        : '/api/desk/history',
                    parameters: {
                      'symbol': index,
                      if (timeframe != 'intraday') 'period': timeframe,
                    },
                  ),
                  builder: (data) {
                    return timeframe == 'intraday'
                        ? IntradayChart(
                            data,
                            height: math.max(140, c.maxHeight - 28),
                            showSource: false,
                          )
                        : MarketChart(
                            key: ValueKey(key),
                            bars: rows(data['candles'])
                                .map(Bar.fromJson)
                                .toList(),
                            symbol: index,
                            name: indexNames[indexSymbols.indexOf(index)],
                            unit: timeframe,
                            volumeUnit: str(data['volumeUnit']),
                            patterns: rows(data['patternMarks']),
                            terminal: true,
                            viewportHeight: c.maxHeight,
                          );
                  },
                );
              },
            ),
          ),
          SizedBox(
            height: 24,
            child: Row(
              children: [
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    '${sourceDate ?? '—'} · ${store.t('公开行情快照')}',
                    style: TextStyle(fontSize: 10, color: muted),
                  ),
                ),
                IconButton(
                  padding: EdgeInsets.zero,
                  onPressed: () {
                    setState(() => feedRevision++);
                    refresh();
                  },
                  icon: const Icon(Icons.refresh, size: 15),
                ),
              ],
            ),
          ),
        ] else
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              children: [
                if (error != null) Notice(error!),
                if (view == 'sector') const SectorExplorer(),
                if (view == 'mood' && sourceDate != null)
                  AsyncPanel(
                    load: () => store.api.get(
                      '/api/desk/market-pools',
                      parameters: {'date': sourceDate},
                    ),
                    builder: (r) => _sentiment(context, r),
                  ),
                if (view == 'stocks') ...[
                  Chips(
                    values: {
                      'gainers': '涨幅榜',
                      'dragon': '近期龙虎榜',
                      'yesterday': '昨日涨停',
                      'up': '本日涨停',
                    },
                    selected: ranking,
                    onSelected: (v) => setState(() => ranking = v),
                  ),
                  if (ranking == 'gainers' || sourceDate != null)
                    AsyncPanel(
                      key: ValueKey('$ranking-$sourceDate'),
                      load: () => store.api.get(
                        ranking == 'gainers'
                            ? '/api/desk/gainers'
                            : ranking == 'dragon'
                            ? '/api/desk/dragon'
                            : '/api/desk/market-pools',
                        parameters: ranking == 'gainers'
                            ? null
                            : {'date': sourceDate!},
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
                        return Column(
                          children: [
                            if (items.isEmpty)
                              Notice(str(pool['reason'], store.t('此范围暂无记录'))),
                            ...items.map(
                              (q) => ListTile(
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 2,
                                ),
                                title: Text(
                                  str(q['name']),
                                  style: const TextStyle(fontSize: 17),
                                ),
                                subtitle: Text(
                                  '${q['symbol']}${q['date'] != null ? ' · ${q['date']}' : ''}',
                                  style: TextStyle(fontSize: 11, color: muted),
                                ),
                                trailing: Text(
                                  '${fixed(q['price'])}  ${percent(q['changePercent'])}',
                                  style: TextStyle(
                                    fontSize: 15,
                                    color: tone(q['changePercent']),
                                  ),
                                ),
                                onTap: () =>
                                    openStock(context, str(q['symbol'])),
                              ),
                            ),
                            SourceLine(r),
                          ],
                        );
                      },
                    ),
                ],
              ],
            ),
          ),
      ],
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
              Padding(
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
            color: atlasColor(0xffd4d4df),
            backgroundColor: atlasColor(0xff34343e),
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
                style: TextStyle(color: muted, height: 1.8),
              ),
            ],
          ),
          SourceLine(data),
        ],
      ),
    );
  }
}
