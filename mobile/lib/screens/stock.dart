import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/indicators.dart';
import '../widgets/common.dart';
import '../widgets/market_chart.dart';
import '../widgets/daily_trend.dart';
import '../widgets/live_chart_feed.dart';
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
  Json? quote, analysis, trend;
  String? trendError;
  bool trendLoading = false;
  String? quoteError, analysisError;
  String tab = 'chart', timeframe = 'day', newsTab = 'news';
  bool auto = true, loading = false;
  Timer? timer;
  int tick = 0;
  @override
  void initState() {
    super.initState();
    refreshQuote();
    refreshAnalysis();
    refreshTrend();
    timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (auto &&
          mounted &&
          context.read<AtlasStore>().foreground &&
          (ModalRoute.of(context)?.isCurrent ?? false)) {
        refreshQuote();
        if (++tick % 12 == 0) {
          refreshAnalysis();
          refreshTrend();
        }
      }
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> refreshQuote() async {
    if (!cnStock(widget.symbol)) return;
    try {
      final r = await context.read<AtlasStore>().api.get(
        '/api/desk/quotes',
        parameters: {'symbols': widget.symbol},
      );
      if (mounted) {
        setState(() {
          quote = rows(r['items']).firstOrNull;
          quoteError = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => quoteError = e.toString());
    }
  }

  Future<void> refreshAnalysis() async {
    if (loading) return;
    loading = true;
    try {
      final api = context.read<AtlasStore>().api;
      final r = cnStock(widget.symbol)
          ? await api.get(
              '/api/analysis',
              parameters: {'symbol': widget.symbol},
            )
          : {
              'market': await api.get(
                '/api/market',
                parameters: {'symbol': widget.symbol},
              ),
            };
      if (mounted) {
        setState(() {
          analysis = r;
          analysisError = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => analysisError = e.toString());
    } finally {
      loading = false;
    }
  }

  Future<void> refreshTrend() async {
    if (trendLoading || !cnStock(widget.symbol)) return;
    trendLoading = true;
    try {
      final value = await context.read<AtlasStore>().api.get(
        '/api/desk/trend',
        parameters: {'symbol': widget.symbol},
      );
      if (mounted) {
        setState(() {
          trend = value;
          trendError = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => trendError = e.toString());
    } finally {
      trendLoading = false;
    }
  }

  void openTrend() => sheet(
    '当日走势分析',
    AsyncPanel(
      refreshSeconds: 60,
      load: () => context.read<AtlasStore>().api.get(
        '/api/desk/trend',
        parameters: {'symbol': widget.symbol},
      ),
      builder: (r) => DailyTrendPanel(r),
    ),
  );
  Json get q =>
      quote ??
      {
        'name': obj(analysis?['market'])['name'],
        'price': obj(analysis?['market'])['last'],
        'changePercent': obj(analysis?['market'])['changePercent'],
        'asOf': obj(analysis?['market'])['asOf'],
      };
  String get volumeUnit =>
      str(obj(analysis?['market'])['provider'], '').startsWith('新浪') ||
          RegExp(r'^68[89]').hasMatch(widget.symbol)
      ? '股'
      : '手';
  List<Bar> get bars =>
      rows(obj(analysis?['market'])['candles']).map(Bar.fromJson).toList();
  Future<void> sheet(String title, Widget child) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: surface,
    builder: (ctx) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: .75,
      minChildSize: .4,
      maxChildSize: .96,
      builder: (ctx, controller) => Column(
        children: [
          Container(
            width: 36,
            height: 4,
            margin: const EdgeInsets.only(top: 10, bottom: 8),
            decoration: BoxDecoration(
              color: muted,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    tr(ctx, title),
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: tr(ctx, '关闭'),
                  onPressed: () => Navigator.pop(ctx),
                  icon: const Icon(Icons.close, size: 20),
                ),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              controller: controller,
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
              child: child,
            ),
          ),
        ],
      ),
    ),
  );
  Future<void> alert() async {
    final price = TextEditingController(text: fixed(q['price']));
    var direction = 'above';
    ModalRoute<dynamic>? route;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) {
        route = ModalRoute.of(ctx);
        return StatefulBuilder(
          builder: (ctx, update) => Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              20,
              20,
              MediaQuery.viewInsetsOf(ctx).bottom + 20,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(tr(ctx, '价格提醒'), style: const TextStyle(fontSize: 20)),
                  const SizedBox(height: 12),
                  Notice(tr(ctx, '价格阈值提醒在 App 前台、自选行情有效时检查。全市场信号扫描在服务端独立运行。')),
                  DropdownButtonFormField<String>(
                    initialValue: direction,
                    items: [
                      DropdownMenuItem(
                        value: 'above',
                        child: Text(tr(ctx, '价格达到或高于')),
                      ),
                      DropdownMenuItem(
                        value: 'below',
                        child: Text(tr(ctx, '价格达到或低于')),
                      ),
                    ],
                    onChanged: (v) => direction = v!,
                  ),
                  TextField(
                    controller: price,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(labelText: tr(ctx, '提醒目标价格')),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () {
                      final n = double.tryParse(price.text);
                      if (n == null || n <= 0) return;
                      context.read<AtlasStore>().addAlert(
                        widget.symbol,
                        n,
                        direction,
                      );
                      Navigator.pop(ctx);
                    },
                    child: Text(tr(ctx, '添加提醒')),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
    await route?.completed;
    price.dispose();
  }

  Widget mini(String text, VoidCallback action, {Color? color}) => InkWell(
    onTap: action,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      child: Text(
        tr(context, text),
        style: TextStyle(fontSize: 12, height: 1, color: color ?? muted),
      ),
    ),
  );
  void more() {
    sheet(
      '行情详情',
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 26,
            runSpacing: 18,
            children: [
              LabelValue('今开', fixed(q['open'])),
              LabelValue('昨收', fixed(q['previous'])),
              LabelValue('最高', fixed(q['high'])),
              LabelValue('最低', fixed(q['low'])),
              LabelValue('成交额', amount(q['amount'])),
              LabelValue('换手率', '${fixed(q['turnover'])}%'),
              LabelValue('量比', fixed(q['volumeRatio'])),
              LabelValue('市盈率 TTM', fixed(q['pe'])),
              LabelValue('总市值', amount(q['marketCap'])),
            ],
          ),
          const Divider(height: 30),
          SourceLine(q),
          if (quoteError != null) Notice(quoteError!),
          ListTile(
            leading: const Icon(Icons.insights),
            title: Text(tr(context, '当日走势分析')),
            onTap: () {
              Navigator.pop(context);
              openTrend();
            },
          ),
          ListTile(
            leading: const Icon(Icons.notifications_none),
            title: Text(tr(context, '价格提醒')),
            onTap: () {
              Navigator.pop(context);
              alert();
            },
          ),
          SwitchListTile(
            title: Text(tr(context, '自动')),
            value: auto,
            onChanged: (v) {
              setState(() => auto = v);
              Navigator.pop(context);
            },
          ),
          ListTile(
            leading: const Icon(Icons.refresh),
            title: Text(tr(context, '刷新数据')),
            onTap: () {
              Navigator.pop(context);
              refreshQuote();
              refreshAnalysis();
            },
          ),
          Notice(tr(context, '公开五档和约3秒聚合分笔；没有授权十档、逐笔委托队列或完整交易所 Level-2。')),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(), name = str(q['name'], widget.symbol);
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 44,
        centerTitle: true,
        title: Column(
          children: [
            Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 17,
                height: 1.1,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              widget.symbol,
              style: const TextStyle(fontSize: 10, height: 1, color: muted),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: s.t('我的自选'),
            onPressed: () => s.toggleWatch(widget.symbol),
            icon: Icon(
              s.watchlist.contains(widget.symbol)
                  ? Icons.star
                  : Icons.star_border,
              size: 20,
              color: s.watchlist.contains(widget.symbol) ? Colors.amber : muted,
            ),
          ),
          IconButton(
            tooltip: s.t('行情详情'),
            onPressed: more,
            icon: const Icon(Icons.more_horiz, size: 22),
          ),
        ],
      ),
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _quoteStrip(),
            if (tab == 'chart') ...[
              _periodBar(),
              Expanded(
                child: LayoutBuilder(
                  builder: (ctx, c) => _chart(c.maxHeight, name),
                ),
              ),
              _sourceBar(),
            ] else
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
                  children: [
                    if (tab == 'guide')
                      if (analysis != null)
                        GuidePanel(widget.symbol, analysis!)
                      else
                        _waiting(),
                    if (tab == 'sector') StockSectors(widget.symbol),
                    if (tab == 'f10') F10Page(widget.symbol),
                    if (tab == 'news') ...[
                      Row(
                        children: [
                          mini(
                            '个股资讯',
                            () => setState(() => newsTab = 'news'),
                            color: newsTab == 'news' ? Colors.white : null,
                          ),
                          mini(
                            '公告财报',
                            () => setState(() => newsTab = 'evidence'),
                            color: newsTab == 'evidence' ? Colors.white : null,
                          ),
                        ],
                      ),
                      if (newsTab == 'news')
                        StockNews(widget.symbol)
                      else
                        EvidencePanel(widget.symbol),
                    ],
                  ],
                ),
              ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          height: 50,
          decoration: const BoxDecoration(
            color: Color(0xff131316),
            border: Border(
              top: BorderSide(color: Color(0xff303038), width: .5),
            ),
          ),
          child: Row(
            children: [
              for (final item in [
                ('chart', '看盘', Icons.candlestick_chart_outlined),
                ('guide', '五线开花', Icons.auto_graph),
                ('sector', '板块', Icons.hub_outlined),
                ('news', '资讯', Icons.article_outlined),
                ('f10', 'F10', Icons.business_outlined),
              ])
                Expanded(
                  child: InkWell(
                    onTap: () => setState(() => tab = item.$1),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          item.$3,
                          size: 18,
                          color: tab == item.$1 ? Colors.white : muted,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          s.t(item.$2),
                          style: TextStyle(
                            fontSize: 11,
                            height: 1,
                            color: tab == item.$1 ? Colors.white : muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _quoteStrip() => InkWell(
    onTap: more,
    child: Container(
      height: 78,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0xff24242a), width: .5)),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 5,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    fixed(q['price']),
                    style: TextStyle(
                      fontSize: 31,
                      height: 1,
                      fontWeight: FontWeight.w600,
                      color: tone(q['changePercent']),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  '${fixed(q['change'])}  ${percent(q['changePercent'])}',
                  style: TextStyle(
                    fontSize: 13,
                    height: 1,
                    color: tone(q['changePercent']),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            flex: 6,
            child: Row(
              children: [
                Expanded(
                  child: _statColumn(
                    '今开',
                    fixed(q['open']),
                    '最低',
                    fixed(q['low']),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _statColumn(
                    '最高',
                    fixed(q['high']),
                    '换手率',
                    '${fixed(q['turnover'])}%',
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
  Widget _statColumn(String a, String av, String b, String bv) => Column(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      for (final pair in [(a, av), (b, bv)])
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Row(
            children: [
              Text(
                tr(context, pair.$1),
                style: const TextStyle(fontSize: 11, height: 1, color: muted),
              ),
              const SizedBox(width: 5),
              Expanded(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerRight,
                  child: Text(
                    pair.$2,
                    style: const TextStyle(fontSize: 13, height: 1),
                  ),
                ),
              ),
            ],
          ),
        ),
    ],
  );
  Widget _periodBar() => Container(
    height: 36,
    decoration: const BoxDecoration(
      border: Border(bottom: BorderSide(color: Color(0xff303038), width: .5)),
    ),
    child: Row(
      children: [
        for (final p in [
          ('intraday', '分时'),
          ('day', '日 K'),
          ('week', '周 K'),
          ('month', '月 K'),
        ])
          Expanded(
            child: InkWell(
              onTap: () => setState(() => timeframe = p.$1),
              child: Container(
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color: timeframe == p.$1 ? up : Colors.transparent,
                      width: 2,
                    ),
                  ),
                ),
                child: Text(
                  tr(context, p.$2),
                  style: TextStyle(
                    fontSize: 14,
                    height: 1,
                    color: timeframe == p.$1 ? Colors.white : muted,
                    fontWeight: timeframe == p.$1
                        ? FontWeight.w600
                        : FontWeight.normal,
                  ),
                ),
              ),
            ),
          ),
      ],
    ),
  );
  Widget _waiting() => Center(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: analysisError == null
          ? const CircularProgressIndicator(strokeWidth: 1.5)
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  analysisError!,
                  style: const TextStyle(fontSize: 13, color: muted),
                ),
                TextButton(
                  onPressed: refreshAnalysis,
                  child: Text(tr(context, '重试数据源')),
                ),
              ],
            ),
    ),
  );
  Widget _chart(double height, String name) {
    if (analysis == null) return _waiting();
    if (timeframe == 'day') {
      return MarketChart(
        key: ValueKey('${widget.symbol}-day'),
        bars: bars,
        name: name,
        symbol: widget.symbol,
        volumeUnit: volumeUnit,
        events: rows(obj(analysis?['guide'])['events']),
        terminal: true,
        viewportHeight: height,
      );
    }
    return LiveChartFeed(
      key: ValueKey('${widget.symbol}-$timeframe'),
      refreshSeconds: timeframe == 'intraday' ? 15 : 60,
      load: () => context.read<AtlasStore>().api.get(
        timeframe == 'intraday' ? '/api/desk/intraday' : '/api/desk/history',
        parameters: {
          'symbol': widget.symbol,
          if (timeframe != 'intraday') 'period': timeframe,
        },
      ),
      builder: (r) {
        return timeframe == 'intraday'
            ? IntradayChart(
                r,
                height: math.max(150, height - 30),
                showSource: false,
              )
            : MarketChart(
                key: ValueKey('${widget.symbol}-$timeframe'),
                bars: rows(r['candles']).map(Bar.fromJson).toList(),
                name: name,
                symbol: widget.symbol,
                unit: timeframe,
                volumeUnit: str(r['volumeUnit']),
                terminal: true,
                viewportHeight: height,
              );
      },
    );
  }

  Widget _sourceBar() => Container(
    height: 32,
    decoration: const BoxDecoration(
      border: Border(top: BorderSide(color: Color(0xff25252b), width: .5)),
    ),
    child: Row(
      children: [
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            '${str(q['asOf'], '').replaceFirst('T', ' ').replaceFirst('+08:00', '')} · ${tr(context, q['stale'] == true
                ? '快照已过期'
                : q['session'] == 'trading'
                ? '盘中快照'
                : '已收盘')}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 10, height: 1, color: muted),
          ),
        ),
        if (cnStock(widget.symbol))
          mini(
            '${tr(context, '走势')} ${fixed(trend?['score'], 0)}',
            openTrend,
            color: Colors.white,
          ),
        mini('盘口', () => sheet('五档盘口', BookPanel(widget.symbol, q))),
        mini(
          '筹码',
          () => sheet(
            '筹码峰',
            ChipProfile(
              bars: bars,
              symbol: widget.symbol,
              quote: q,
              volumeUnit: volumeUnit,
            ),
          ),
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
              width: double.infinity,
              child: CustomPaint(
                painter: _ChipHistogramPainter(
                  histogram,
                  maxWeight,
                  numOf(quote['price']) ?? bars.last.close,
                ),
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

class _ChipHistogramPainter extends CustomPainter {
  const _ChipHistogramPainter(this.histogram, this.maxWeight, this.lastPrice);
  final List<Json> histogram;
  final double maxWeight, lastPrice;
  @override
  void paint(Canvas canvas, Size size) {
    if (histogram.isEmpty || maxWeight <= 0) return;
    const left = 58.0, top = 8.0;
    final height = size.height - 16,
        width = math.max(0.0, size.width - left),
        step = height / histogram.length;
    for (var i = 0; i < histogram.length; i++) {
      final r = histogram[i];
      canvas.drawRect(
        Rect.fromLTWH(
          left,
          top + i * step,
          width * (numOf(r['weight']) ?? 0) / maxWeight,
          math.max(.5, step - .5),
        ),
        Paint()..color = (numOf(r['price']) ?? 0) < lastPrice ? up : down,
      );
    }
    for (var i = 0; i <= 4; i++) {
      final index = ((histogram.length - 1) * i / 4).round();
      final text = TextPainter(
        text: TextSpan(
          text: fixed(histogram[index]['price']),
          style: const TextStyle(fontSize: 13, color: muted),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: left - 6);
      text.paint(
        canvas,
        Offset(
          0,
          (top + height * i / 4 - text.height / 2).clamp(
            0.0,
            size.height - text.height,
          ),
        ),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _ChipHistogramPainter old) =>
      old.histogram != histogram ||
      old.lastPrice != lastPrice ||
      old.maxWeight != maxWeight;
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
