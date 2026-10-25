import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/indicators.dart';
import '../widgets/common.dart';
import '../widgets/market_chart.dart';
import 'guide.dart';
import 'f10.dart';
import 'news.dart';
import 'sector.dart';

void openStock(BuildContext context, String symbol) => Navigator.push(
  context,
  MaterialPageRoute(builder: (_) => StockPage(normalize(symbol))),
);

class StockPage extends StatefulWidget {
  const StockPage(this.symbol, {super.key});
  final String symbol;
  @override
  State<StockPage> createState() => _StockPageState();
}

class _StockPageState extends State<StockPage> {
  Json? quote;
  String? quoteError;
  String tab = 'chart', timeframe = 'day';
  bool auto = true, chips = false;
  Timer? timer;
  final analysisKey = GlobalKey<AsyncPanelState>();
  @override
  void initState() {
    super.initState();
    refreshQuote();
    timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (auto &&
          mounted &&
          context.read<AtlasStore>().foreground &&
          (ModalRoute.of(context)?.isCurrent ?? false)) {
        refreshQuote();
      }
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> refreshQuote() async {
    final s = context.read<AtlasStore>();
    if (!cnStock(widget.symbol)) return;
    try {
      final data = await s.api.get(
        '/api/desk/quotes',
        parameters: {'symbols': widget.symbol},
      );
      if (!mounted) return;
      setState(() {
        quote = rows(data['items']).firstOrNull;
        quoteError = null;
      });
    } catch (e) {
      if (mounted) setState(() => quoteError = e.toString());
    }
  }

  Future<void> alert() async {
    final price = TextEditingController(text: fixed(quote?['price'])),
        s = context.read<AtlasStore>();
    var direction = 'above';
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) => Padding(
          padding: EdgeInsets.fromLTRB(
            22,
            20,
            22,
            MediaQuery.viewInsetsOf(ctx).bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(s.t('价格提醒'), style: Theme.of(ctx).textTheme.titleLarge),
              const SizedBox(height: 15),
              Notice(s.t('本页打开且盘中行情有效时触发')),
              DropdownButtonFormField<String>(
                initialValue: direction,
                items: [
                  DropdownMenuItem(value: 'above', child: Text(s.t('价格达到或高于'))),
                  DropdownMenuItem(value: 'below', child: Text(s.t('价格达到或低于'))),
                ],
                onChanged: (v) => direction = v!,
              ),
              TextField(
                controller: price,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: InputDecoration(labelText: s.t('提醒目标价格')),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () {
                  final value = double.tryParse(price.text);
                  if (value == null || value <= 0) return;
                  s.addAlert(widget.symbol, value, direction);
                  Navigator.pop(ctx);
                },
                child: Text(s.t('添加提醒')),
              ),
            ],
          ),
        ),
      ),
    );
    price.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(),
        name = str(quote?['name'], widget.symbol);
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 80,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 19,
                height: 1.1,
              ),
            ),
            const SizedBox(height: 5),
            Wrap(
              spacing: 10,
              children: [
                Text(
                  fixed(quote?['price']),
                  style: TextStyle(
                    color: tone(quote?['changePercent']),
                    fontWeight: FontWeight.bold,
                    fontSize: 23,
                    height: 1.1,
                  ),
                ),
                Text(
                  percent(quote?['changePercent']),
                  style: TextStyle(
                    color: tone(quote?['changePercent']),
                    fontSize: 15,
                    height: 1.1,
                  ),
                ),
              ],
            ),
          ],
        ),
        actions: [
          IconButton(
            onPressed: () => s.toggleWatch(widget.symbol),
            tooltip: s.t('我的自选'),
            icon: Icon(
              s.watchlist.contains(widget.symbol)
                  ? Icons.star
                  : Icons.star_border,
              color: s.watchlist.contains(widget.symbol) ? Colors.amber : muted,
            ),
          ),
          IconButton(
            onPressed: cnStock(widget.symbol) ? alert : null,
            tooltip: s.t('价格提醒'),
            icon: const Icon(Icons.notifications_none),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(58),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Chips(
              values: const {
                'chart': '看盘',
                'guide': '五线开花',
                'sector': '板块联动',
                'news': '个股资讯',
                'f10': 'F10 资料',
                'evidence': '公告财报',
              },
              selected: tab,
              onSelected: (v) => setState(() => tab = v),
            ),
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await refreshQuote();
          await analysisKey.currentState?.refresh();
        },
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (quoteError != null)
                Notice('${s.t('刷新失败，保留上一快照')} · $quoteError'),
              if (tab == 'chart') ...[
                _quotePanel(s),
                Wrap(
                  children: [
                    IconButton(
                      onPressed: () => setState(() => auto = !auto),
                      icon: Icon(auto ? Icons.pause : Icons.play_arrow),
                    ),
                    Text(s.t(auto ? '自动' : '已暂停轮询')),

                    Text(
                      str(quote?['asOf']),
                      style: const TextStyle(fontSize: 12, color: muted),
                    ),
                  ],
                ),
              ],
              if (tab == 'chart' || tab == 'guide')
                AsyncPanel(
                  key: analysisKey,
                  refreshSeconds: auto ? 60 : 0,
                  load: () => cnStock(widget.symbol)
                      ? s.api.get(
                          '/api/analysis',
                          parameters: {'symbol': widget.symbol},
                        )
                      : s.api
                            .get(
                              '/api/market',
                              parameters: {'symbol': widget.symbol},
                            )
                            .then((m) => {'market': m}),
                  builder: (data) {
                    final market = obj(data['market']),
                        bars = rows(market['candles'])
                            .map(Bar.fromJson)
                            .toList();
                    if (tab == 'guide') {
                      return cnStock(widget.symbol)
                          ? GuidePanel(widget.symbol, data)
                          : Notice(s.t('当前公开接口覆盖 A 股'));
                    }
                    return Panel(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
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
                          if (timeframe == 'intraday')
                            AsyncPanel(
                              key: ValueKey('${widget.symbol}-minute'),
                              refreshSeconds: auto ? 15 : 0,
                              load: () => s.api.get(
                                '/api/desk/intraday',
                                parameters: {'symbol': widget.symbol},
                              ),
                              builder: (r) => IntradayChart(r),
                            )
                          else if (timeframe == 'day')
                            MarketChart(
                              bars: bars,
                              symbol: widget.symbol,
                              events: rows(obj(data['guide'])['events']),
                              volumeUnit:
                                  str(
                                        market['provider'],
                                        '',
                                      ).startsWith('新浪') ||
                                      RegExp(r'^68[89]').hasMatch(widget.symbol)
                                  ? '股'
                                  : '手',
                            )
                          else
                            AsyncPanel(
                              key: ValueKey('${widget.symbol}-$timeframe'),
                              load: () => s.api.get(
                                '/api/desk/history',
                                parameters: {
                                  'symbol': widget.symbol,
                                  'period': timeframe,
                                },
                              ),
                              builder: (r) => Column(
                                children: [
                                  MarketChart(
                                    bars: rows(r['candles'])
                                        .map(Bar.fromJson)
                                        .toList(),
                                    symbol: widget.symbol,
                                    unit: timeframe,
                                    volumeUnit: str(r['volumeUnit']),
                                  ),
                                  SourceLine(r),
                                ],
                              ),
                            ),
                          if (timeframe == 'day' && cnStock(widget.symbol)) ...[
                            const SizedBox(height: 14),
                            OutlinedButton.icon(
                              onPressed: () => setState(() => chips = !chips),
                              icon: const Icon(Icons.bar_chart),
                              label: Text(s.t('筹码峰')),
                            ),
                            if (chips)
                              ChipProfile(
                                bars: bars,
                                symbol: widget.symbol,
                                quote: quote ?? {},
                                volumeUnit:
                                    str(
                                          market['provider'],
                                          '',
                                        ).startsWith('新浪') ||
                                        RegExp(r'^68[89]')
                                            .hasMatch(widget.symbol)
                                    ? '股'
                                    : '手',
                              ),
                          ],
                          SourceLine(market, extra: str(market['notice'], '')),
                        ],
                      ),
                    );
                  },
                ),
              if (tab == 'chart' && cnStock(widget.symbol))
                BookPanel(widget.symbol, quote ?? {}),
              if (tab == 'sector') StockSectors(widget.symbol),
              if (tab == 'news') StockNews(widget.symbol),
              if (tab == 'f10') F10Page(widget.symbol),
              if (tab == 'evidence') EvidencePanel(widget.symbol),
            ],
          ),
        ),
      ),
    );
  }

  Widget _quotePanel(AtlasStore s) => Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 25,
          runSpacing: 20,
          children: [
            LabelValue('今开', fixed(quote?['open'])),
            LabelValue('最高', fixed(quote?['high'])),
            LabelValue('最低', fixed(quote?['low'])),
            LabelValue('成交额', amount(quote?['amount'])),
            LabelValue('换手率', '${fixed(quote?['turnover'])}%'),
            LabelValue('量比', fixed(quote?['volumeRatio'])),
            LabelValue('市盈率 TTM', fixed(quote?['pe'])),
            LabelValue('总市值', amount(quote?['marketCap'])),
          ],
        ),
        const SizedBox(height: 16),
        Text(
          '${s.t(quote?['stale'] == true
              ? '快照已过期'
              : quote?['session'] == 'trading'
              ? '盘中快照'
              : '已收盘')} · ${s.t('公开五档快照')}',
          style: const TextStyle(color: muted, fontSize: 13),
        ),
      ],
    ),
  );
}

class BookPanel extends StatefulWidget {
  const BookPanel(this.symbol, this.quote, {super.key});
  final String symbol;
  final Json quote;
  @override
  State<BookPanel> createState() => _BookPanelState();
}

class _BookPanelState extends State<BookPanel> {
  String tab = 'book';
  @override
  Widget build(BuildContext context) {
    final s = context.read<AtlasStore>();
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Chips(
            values: const {'book': '五档盘口', 'ticks': '成交分笔', 'flow': '资金流'},
            selected: tab,
            onSelected: (v) => setState(() => tab = v),
          ),
          if (tab == 'book') ...[
            for (final r in rows(
              widget.quote['asks'],
            ).indexed.toList().reversed)
              _level('卖${r.$1 + 1}', r.$2),
            const Divider(),
            for (final r in rows(widget.quote['bids']).indexed)
              _level('买${r.$1 + 1}', r.$2),
            Notice(s.t('公开五档和约3秒聚合分笔；没有授权十档、逐笔委托队列或完整交易所 Level-2。')),
          ] else if (tab == 'ticks')
            AsyncPanel(
              key: ValueKey('${widget.symbol}-ticks'),
              refreshSeconds: 15,
              load: () => s.api.get(
                '/api/desk/ticks',
                parameters: {'symbol': widget.symbol},
              ),
              builder: (r) => Column(
                children: [
                  DataTableView(
                    columns: const ['时间', '成交价', '量（手）'],
                    data: rows(r['items'])
                        .take(45)
                        .map(
                          (r) => [
                            str(r['time']),
                            fixed(r['price']),
                            fixed(r['volume'], 0),
                          ],
                        )
                        .toList(),
                  ),
                  SourceLine(r, extra: s.t('· 最近一页 · 聚合分笔，非全日完整明细')),
                ],
              ),
            )
          else
            AsyncPanel(
              key: ValueKey('${widget.symbol}-flow'),
              load: () => s.api.get(
                '/api/desk/flow',
                parameters: {'symbol': widget.symbol},
              ),
              builder: (r) {
                final last = rows(r['points']).lastOrNull ?? {};
                return Column(
                  children: [
                    for (final e in {
                      'main': '主力净流入',
                      'superLarge': '超大单',
                      'large': '大单',
                      'medium': '中单',
                      'small': '小单',
                    }.entries)
                      ListTile(
                        title: Text(s.t(e.value)),
                        trailing: Text(
                          amount(last[e.key]),
                          style: TextStyle(color: tone(last[e.key])),
                        ),
                      ),
                    SourceLine(r, extra: str(last['time'])),
                    if (r['notice'] != null) Notice(str(r['notice'])),
                  ],
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _level(String name, Json r) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(
      children: [
        SizedBox(
          width: 64,
          child: Text(name, style: const TextStyle(color: muted)),
        ),
        Expanded(
          child: Text(
            fixed(r['price']),
            style: TextStyle(
              color: tone(
                (numOf(r['price']) ?? numOf(widget.quote['previous']) ?? 0) -
                    (numOf(widget.quote['previous']) ?? 0),
              ),
            ),
          ),
        ),
        Text(fixed(r['volume'], 0)),
      ],
    ),
  );
}

class ChipProfile extends StatefulWidget {
  const ChipProfile({
    super.key,
    required this.bars,
    required this.symbol,
    required this.quote,
    required this.volumeUnit,
  });
  final List<Bar> bars;
  final String symbol, volumeUnit;
  final Json quote;
  @override
  State<ChipProfile> createState() => _ChipProfileState();
}

class _ChipProfileState extends State<ChipProfile> {
  late Future<Json> sourceData;
  List<Bar> get bars => widget.bars;
  String get symbol => widget.symbol;
  String get volumeUnit => widget.volumeUnit;
  Json get quote => widget.quote;
  @override
  void initState() {
    super.initState();
    sourceData = context.read<AtlasStore>().api.get(
      '/api/desk/chips',
      parameters: {'symbol': widget.symbol},
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = context.read<AtlasStore>();
    return FutureBuilder<Json>(
      future: sourceData,
      builder: (context, snapshot) {
        final source = snapshot.data,
            raw = rows(source?['bars']),
            floatShares =
                (numOf(quote['floatCap']) ?? 0) / (numOf(quote['price']) ?? 1),
            historical = raw.isNotEmpty;
        final input = historical ? raw.map(Bar.fromJson).toList() : bars;
        final turns = historical
            ? raw.map((r) => numOf(r['turnover']) ?? double.nan).toList()
            : input
                  .map(
                    (b) => floatShares > 0
                        ? b.volume *
                              (volumeUnit == '手' ? 100 : 1) /
                              floatShares *
                              100
                        : double.nan,
                  )
                  .toList();
        final model = chipModel(input, turns);
        if (model == null) {
          return Notice(
            s.t(
              snapshot.connectionState == ConnectionState.waiting
                  ? '正在获取历史换手率…'
                  : '历史换手率与流通股本均不可用，无法推演筹码分布。',
            ),
          );
        }
        final histogram = rows(model['histogram']).reversed.toList(),
            maxWeight = histogram
                .map((r) => numOf(r['weight']) ?? 0)
                .reduce(math.max);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              s.t('筹码峰 · 模型估算'),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            Notice(s.t(historical ? '使用逐日历史换手率' : '备用估算 · 固定最新流通股本')),
            SizedBox(
              height: 250,
              child: Column(
                children: histogram
                    .map(
                      (r) => Expanded(
                        child: Row(
                          children: [
                            SizedBox(
                              width: 55,
                              child: Text(
                                (histogram.indexOf(r) % 12 == 0)
                                    ? fixed(r['price'])
                                    : '',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: muted,
                                ),
                              ),
                            ),
                            Expanded(
                              child: Align(
                                alignment: Alignment.centerLeft,
                                child: FractionallySizedBox(
                                  widthFactor:
                                      (numOf(r['weight']) ?? 0) / maxWeight,
                                  child: Container(
                                    margin: const EdgeInsets.symmetric(
                                      vertical: .4,
                                    ),
                                    color:
                                        (numOf(r['price']) ?? 0) <
                                            (numOf(quote['price']) ??
                                                bars.last.close)
                                        ? up
                                        : down,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),
            const SizedBox(height: 20),
            Wrap(
              spacing: 24,
              runSpacing: 18,
              children: [
                LabelValue('筹码峰', fixed(model['peak'])),
                LabelValue('平均成本', fixed(model['average'])),
                LabelValue(
                  '获利比例',
                  '${fixed((numOf(model['profit']) ?? 0) * 100)}%',
                ),
                LabelValue('90%集中度', '${fixed(model['concentration90'])}%'),
                LabelValue('70%集中度', '${fixed(model['concentration70'])}%'),
                LabelValue(
                  '初始筹码残留',
                  '${fixed((numOf(model['seed']) ?? 0) * 100)}%',
                ),
                LabelValue(
                  '90%成本区间',
                  (model['range90'] as List).map((v) => fixed(v)).join(' ~ '),
                ),
                LabelValue(
                  '70%成本区间',
                  (model['range70'] as List).map((v) => fixed(v)).join(' ~ '),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Notice(
              s.t(
                '这是公开量价数据推演，不是交易所真实持仓、主力成本或Level-2筹码。固定股本备用模式不能准确还原送转、增发、解禁等历史变化；不与券商筹码绝对值对齐。',
              ),
            ),
            Text(
              '${model['start']} ~ ${model['date']}',
              style: const TextStyle(fontSize: 13, color: muted),
            ),
          ],
        );
      },
    );
  }
}

class StockNews extends StatelessWidget {
  const StockNews(this.symbol, {super.key});
  final String symbol;
  @override
  Widget build(BuildContext context) {
    final s = context.read<AtlasStore>();
    return Column(
      children: [
        AsyncPanel(
          load: () =>
              s.api.get('/api/desk/stock-news', parameters: {'symbol': symbol}),
          builder: (r) => Column(
            children: [...rows(r['items']).map(NewsTile.new), SourceLine(r)],
          ),
        ),
        Panel(
          child: AsyncPanel(
            load: () =>
                s.api.get('/api/desk/reports', parameters: {'symbol': symbol}),
            builder: (r) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.t('机构研报'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                ...rows(r['items']).map(
                  (item) => ListTile(
                    title: Text(str(item['title'])),
                    subtitle: Text(
                      '${item['organization']} · ${item['rating']} · ${item['date']}',
                    ),
                    onTap: () => openNews(context, {
                      ...item,
                      'source': item['organization'],
                      'summary': s.t('研报索引保留原始机构与评级，当前没有获授权的全文。'),
                    }),
                  ),
                ),
                if (rows(r['items']).isEmpty) Notice(s.t('来源在当前窗口未列出研报')),
                SourceLine(r),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class EvidencePanel extends StatelessWidget {
  const EvidencePanel(this.symbol, {super.key});
  final String symbol;
  @override
  Widget build(BuildContext context) {
    final s = context.read<AtlasStore>();
    return Column(
      children: [
        Panel(
          child: AsyncPanel(
            load: () =>
                s.api.get('/api/filings', parameters: {'symbol': symbol}),
            builder: (r) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.t('正式公告时间线'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                ...rows(r['items']).map(
                  (item) => ListTile(
                    title: Text(str(item['title'] ?? item['form'])),
                    subtitle: Text(str(item['date'])),
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => ReaderPage(
                          item: item,
                          document: () => item['artCode'] != null
                              ? s.api
                                    .get(
                                      '/api/announcement',
                                      parameters: {
                                        'code': str(item['artCode']),
                                      },
                                    )
                                    .then(
                                      (r) => {...r, 'code': item['artCode']},
                                    )
                              : s.api.get(
                                  '/api/filing-document',
                                  parameters: {
                                    'symbol': symbol,
                                    'form': str(item['form']),
                                    'date': str(item['date']),
                                  },
                                ),
                        ),
                      ),
                    ),
                  ),
                ),
                if (rows(r['items']).isEmpty)
                  Notice(str(r['notice'], s.t('暂无法查询公告。'))),
                SourceLine(r),
              ],
            ),
          ),
        ),
        Panel(
          child: AsyncPanel(
            load: () => s.api.get(
              '/api/earnings-calendar',
              parameters: {'symbol': symbol},
            ),
            builder: (r) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.t('财报日历'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                ...rows(r['items']).map(
                  (item) => ListTile(
                    title: Text(str(item['date'])),
                    subtitle: Text(
                      'EPS ${fixed(item['epsEstimated'])} / ${fixed(item['epsActual'])}',
                    ),
                  ),
                ),
                if (rows(r['items']).isEmpty) Notice(s.t('当前没有可用财报日历数据。')),
                SourceLine(r),
              ],
            ),
          ),
        ),
        AsyncPanel(
          load: () => s.api.get(
            '/api/intelligence',
            parameters: {'symbol': symbol, 'limit': '20', 'category': 'all'},
          ),
          builder: (r) => Column(
            children: [
              ...rows(r['items']).map(NewsTile.new),
              if (r['stored'] == false) Notice(s.t('情报数据库未配置，无法读取长期历史。')),
            ],
          ),
        ),
      ],
    );
  }
}
