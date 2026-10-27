import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../widgets/common.dart';
import 'stock.dart';

Future<void> showStockSearch(BuildContext context) async {
  final result = await showSearch<String>(
    context: context,
    delegate: StockSearch(context.read<AtlasStore>()),
  );
  if (result != null && result.isNotEmpty && context.mounted) {
    openStock(context, result);
  }
}

class StockSearch extends SearchDelegate<String> {
  StockSearch(this.store) : super(searchFieldLabel: store.t('名称、代码或拼音首字母'));
  final AtlasStore store;
  String? lastQuery;
  Future<Json>? pending;
  @override
  ThemeData appBarTheme(BuildContext context) => Theme.of(context);
  @override
  List<Widget> buildActions(BuildContext context) => [
    IconButton(onPressed: () => query = '', icon: const Icon(Icons.clear)),
  ];
  @override
  Widget buildLeading(BuildContext context) => IconButton(
    onPressed: () => close(context, ''),
    icon: const Icon(Icons.arrow_back),
  );
  @override
  Widget buildResults(BuildContext context) => results(context);
  @override
  Widget buildSuggestions(BuildContext context) => results(context);
  Widget results(BuildContext context) {
    final value = query.trim();
    if (value.isEmpty) {
      return ListView(
        children: store.watchlist
            .map(
              (s) => ListTile(
                title: Text(str(store.quotes[s]?['name'], s)),
                subtitle: Text(s),
                onTap: () => close(context, s),
              ),
            )
            .toList(),
      );
    }
    if (lastQuery != value) {
      lastQuery = value;
      pending = Future.delayed(
        const Duration(milliseconds: 250),
        () => store.api.get('/api/search', parameters: {'q': value}),
      );
    }
    return FutureBuilder<Json>(
      future: pending,
      builder: (context, snapshot) {
        return ListView(
          children: [
            if (snapshot.connectionState == ConnectionState.waiting)
              const LinearProgressIndicator(),
            if (snapshot.hasError) Notice(snapshot.error.toString()),
            ...rows(snapshot.data?['items']).map(
              (r) => ListTile(
                title: Text(str(r['name'])),
                subtitle: Text(str(r['symbol'])),
                onTap: () => close(context, str(r['symbol'])),
              ),
            ),
            if (RegExp(r'^[A-Za-z0-9.^-]+(\.(SH|SZ|BJ))?$').hasMatch(value))
              ListTile(
                leading: const Icon(Icons.arrow_forward),
                title: Text('${store.t('直接打开代码')} ${normalize(value)}'),
                onTap: () => close(context, normalize(value)),
              ),
          ],
        );
      },
    );
  }
}

class WatchPage extends StatefulWidget {
  const WatchPage({super.key});
  @override
  State<WatchPage> createState() => _WatchPageState();
}

class _WatchPageState extends State<WatchPage> {
  String filter = 'all', sort = 'manual', group = 'all';
  Future<void> editGroup(AtlasStore s, {Json? existing}) async {
    final c = TextEditingController(text: str(existing?['name'], ''));
    String? error;
    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text(s.t(existing == null ? '创建分组' : '编辑分组')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: c,
                autofocus: true,
                maxLength: 24,
                decoration: InputDecoration(labelText: s.t('分组名称')),
              ),
              if (error != null) Text(s.t(error!), style: TextStyle(color: up)),
            ],
          ),
          actions: [
            if (existing != null)
              TextButton(
                onPressed: () {
                  s.deleteGroup(str(existing['id']));
                  setState(() => group = 'all');
                  Navigator.pop(ctx);
                },
                child: Text(s.t('删除分组（保留自选）')),
              ),
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(s.t('取消')),
            ),
            TextButton(
              onPressed: () async {
                try {
                  final id = await s.saveGroup(c.text, id: existing?['id']);
                  if (ctx.mounted) {
                    setState(() => group = id!);
                    Navigator.pop(ctx);
                  }
                } catch (e) {
                  set(
                    () => error = e.toString().replaceFirst(
                      'FormatException: ',
                      '',
                    ),
                  );
                }
              },
              child: Text(s.t('保存')),
            ),
          ],
        ),
      ),
    );
    // Dialog disposal can overlap its reverse animation; let it finish first.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    c.dispose();
  }

  void stockActions(AtlasStore s, String symbol) => showModalBottomSheet<void>(
    context: context,
    useSafeArea: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, update) => ListView(
        shrinkWrap: true,
        children: [
          ListTile(
            title: Text(str(s.quotes[symbol]?['name'], symbol)),
            subtitle: Text(s.t('可加入多个分组')),
          ),
          for (final g in s.groups)
            CheckboxListTile(
              title: Text(str(g['name'])),
              value: (g['symbols'] as List).contains(symbol),
              onChanged: (v) async {
                await s.groupStock(str(g['id']), symbol, v == true);
                update(() {});
              },
            ),
          ListTile(
            leading: const Icon(Icons.add),
            title: Text(s.t('创建分组')),
            onTap: () {
              Navigator.pop(ctx);
              editGroup(s);
            },
          ),
          ListTile(
            title: Text(s.t('移到第一位')),
            onTap: () {
              Navigator.pop(ctx);
              s.reorderWatch(s.watchlist.indexOf(symbol), 0);
            },
          ),
          ListTile(
            title: Text(s.t('移除自选')),
            onTap: () {
              Navigator.pop(ctx);
              s.toggleWatch(symbol);
            },
          ),
        ],
      ),
    ),
  );
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(),
        selected = s.groups.where((g) => g['id'] == group).firstOrNull;
    final list = s.watchlist
        .where(
          (v) =>
              (selected == null || (selected['symbols'] as List).contains(v)) &&
              (filter == 'all' || (filter == 'cn' ? cnStock(v) : !cnStock(v))),
        )
        .toList();
    if (sort == 'change') {
      list.sort(
        (a, b) => (numOf(s.quotes[b]?['changePercent']) ?? -999).compareTo(
          numOf(s.quotes[a]?['changePercent']) ?? -999,
        ),
      );
    }
    final headers = <Widget>[
      PageTitle(
        '我的自选',
        '长按股票设置分组，左滑移除',
        trailing: IconButton(
          onPressed: () => showStockSearch(context),
          icon: const Icon(Icons.add),
        ),
      ),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            ChoiceChip(
              label: Text(s.t('全部自选')),
              selected: group == 'all',
              onSelected: (_) => setState(() => group = 'all'),
            ),
            for (final g in s.groups)
              Padding(
                padding: const EdgeInsets.only(left: 8),
                child: GestureDetector(
                  onLongPress: () => editGroup(s, existing: g),
                  child: ChoiceChip(
                    label: Text(str(g['name'])),
                    selected: group == g['id'],
                    onSelected: (_) => setState(() => group = str(g['id'])),
                  ),
                ),
              ),
            IconButton(
              tooltip: s.t('创建分组'),
              onPressed: () => editGroup(s),
              icon: const Icon(Icons.create_new_folder_outlined, size: 20),
            ),
          ],
        ),
      ),
      Row(
        children: [
          Expanded(
            child: Chips(
              values: const {'all': '全部', 'cn': 'A股', 'us': '美股'},
              selected: filter,
              onSelected: (v) => setState(() => filter = v),
            ),
          ),
          TextButton.icon(
            onPressed: () =>
                setState(() => sort = sort == 'manual' ? 'change' : 'manual'),
            icon: const Icon(Icons.sort, size: 16),
            label: Text(
              s.t(sort == 'manual' ? '自定义排序' : '涨幅排序'),
              style: const TextStyle(fontSize: 12),
            ),
          ),
        ],
      ),
      if (s.quoteError != null) Notice('${s.t('行情源暂时不可用')} · ${s.quoteError}'),
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                '${list.length} ${s.t('只自选')}',
                style: TextStyle(fontSize: 12, color: muted),
              ),
            ),
            SizedBox(
              width: 90,
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  s.t('当日分时'),
                  style: TextStyle(fontSize: 12, color: muted),
                ),
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 84,
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  s.t('价格 / 涨幅'),
                  style: TextStyle(fontSize: 12, color: muted),
                ),
              ),
            ),
          ],
        ),
      ),
    ];
    return RefreshIndicator(
      onRefresh: s.refreshQuotes,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        itemCount: headers.length + list.length + 1,
        itemBuilder: (ctx, i) {
          if (i < headers.length) return headers[i];
          if (i == headers.length + list.length) {
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Notice(
                s.t(
                  list.isEmpty ? '分组暂无股票，长按自选股票加入分组' : '分时仅显示来源当日数据；长按股票管理分组。',
                ),
              ),
            );
          }
          final symbol = list[i - headers.length], q = s.quotes[symbol] ?? {};
          return Dismissible(
            key: ValueKey(symbol),
            direction: DismissDirection.endToStart,
            background: Container(
              color: up.withValues(alpha: .2),
              alignment: Alignment.centerRight,
              child: const Icon(Icons.star_border),
            ),
            onDismissed: (_) => s.toggleWatch(symbol),
            child: InkWell(
              onTap: () => openStock(context, symbol),
              onLongPress: () => stockActions(s, symbol),
              child: Container(
                height: cnStock(symbol) ? 112 : 76,
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color: atlasColor(0xff26262c),
                      width: .5,
                    ),
                  ),
                ),
                child: Column(
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          Expanded(
                            flex: 4,
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  str(q['name'], symbol),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                    fontSize: 18,
                                  ),
                                ),
                                const SizedBox(height: 5),
                                Text(
                                  symbol,
                                  style: TextStyle(fontSize: 12, color: muted),
                                ),
                              ],
                            ),
                          ),
                          Expanded(
                            flex: 3,
                            child: SizedBox(
                              height: 42,
                              child: cnStock(symbol)
                                  ? MiniIntraday(symbol)
                                  : Center(
                                      child: Text(
                                        '—',
                                        style: TextStyle(color: muted),
                                      ),
                                    ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          SizedBox(
                            width: 84,
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(
                                  fixed(q['price']),
                                  style: TextStyle(
                                    color: tone(q['changePercent']),
                                    fontSize: 21,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                Text(
                                  percent(q['changePercent']),
                                  style: TextStyle(
                                    fontSize: 15,
                                    color: tone(q['changePercent']),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (cnStock(symbol)) WatchRowInsight(symbol),
                    const SizedBox(height: 6),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class MiniIntraday extends StatefulWidget {
  const MiniIntraday(this.symbol, {super.key});
  final String symbol;
  @override
  State<MiniIntraday> createState() => _MiniIntradayState();
}

class _MiniIntradayState extends State<MiniIntraday> {
  static final cache = <String, ({DateTime at, Json data})>{};
  Json? data;
  bool loading = false;
  @override
  void didUpdateWidget(covariant MiniIntraday old) {
    super.didUpdateWidget(old);
    load();
  }

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    if (loading) return;
    final saved = cache[widget.symbol];
    if (saved != null && DateTime.now().difference(saved.at).inSeconds < 60) {
      data = saved.data;
      return;
    }
    loading = true;
    try {
      final r = await context.read<AtlasStore>().api.get(
        '/api/desk/intraday',
        parameters: {'symbol': widget.symbol},
      );
      cache[widget.symbol] = (at: DateTime.now(), data: r);
      if (mounted) setState(() => data = r);
    } catch (_) {
    } finally {
      loading = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final points = rows(data?['points']), previous = numOf(data?['previous']);
    return Tooltip(
      message: '${str(data?['date'], '—')} · ${tr(context, '当日分时')}',
      child: points.length < 2
          ? Center(
              child: Text('—', style: TextStyle(color: muted)),
            )
          : CustomPaint(painter: SparkPainter(points, previous)),
    );
  }
}

class SparkPainter extends CustomPainter {
  SparkPainter(this.points, this.previous);
  final List<Json> points;
  final double? previous;
  @override
  void paint(Canvas c, Size size) {
    final prices = points
        .map((p) => numOf(p['price']))
        .whereType<double>()
        .toList();
    if (prices.length < 2) return;
    var lo = prices.reduce((a, b) => a < b ? a : b),
        hi = prices.reduce((a, b) => a > b ? a : b);
    if (previous != null) {
      if (previous! < lo) lo = previous!;
      if (previous! > hi) hi = previous!;
    }
    if (hi == lo) hi = lo + 1;
    double y(double p) => 3 + (hi - p) / (hi - lo) * (size.height - 6);
    if (previous != null) {
      c.drawLine(
        Offset(0, y(previous!)),
        Offset(size.width, y(previous!)),
        Paint()
          ..color = muted.withValues(alpha: .35)
          ..strokeWidth = .5,
      );
    }
    final path = Path();
    for (var i = 0; i < prices.length; i++) {
      final x = size.width * i / (prices.length - 1);
      if (i == 0) {
        path.moveTo(x, y(prices[i]));
      } else {
        path.lineTo(x, y(prices[i]));
      }
    }
    c.drawPath(
      path,
      Paint()
        ..color = (prices.last >= (previous ?? prices.first) ? up : down)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );
  }

  @override
  bool shouldRepaint(covariant SparkPainter old) =>
      old.points != points || old.previous != previous;
}

class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    return Scaffold(
      appBar: AppBar(title: Text(s.t('设置'))),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        children: [
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(s.t('外观'), style: Theme.of(context).textTheme.titleLarge),
                Chips(
                  values: const {'dark': '中性黑', 'light': '明亮白'},
                  selected: s.themeMode,
                  onSelected: s.setTheme,
                ),
                const SizedBox(height: 20),
                Text(s.t('语言'), style: Theme.of(context).textTheme.titleLarge),
                Chips(
                  values: const {'zh-CN': '中文', 'en': 'English'},
                  selected: s.locale,
                  onSelected: s.setLocale,
                ),
                const SizedBox(height: 22),
                Text(
                  s.t('字体大小'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Chips(
                  values: const {
                    '18': '大 · 18px',
                    '20': '更大 · 20px',
                    '22': '特大 · 22px',
                  },
                  selected: '${s.fontSize.toInt()}',
                  onSelected: (v) => s.setFont(double.parse(v)),
                ),
                Text(
                  s.t('阅读预览：均线粘合，放量突破，等待确认。'),
                  style: const TextStyle(height: 1.9),
                ),
              ],
            ),
          ),
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  s.t('自选备份'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 15),
                FilledButton.icon(
                  onPressed: () => SharePlus.instance.share(
                    ShareParams(
                      text: const JsonEncoder.withIndent('  ')
                          .convert({'watchlist': s.watchlist}),
                      subject: 'Market Atlas watchlist',
                    ),
                  ),
                  icon: const Icon(Icons.ios_share),
                  label: Text(s.t('导出自选')),
                ),
                OutlinedButton.icon(
                  onPressed: () => _import(context, s),
                  icon: const Icon(Icons.download),
                  label: Text(s.t('导入自选 JSON')),
                ),
                Notice(s.t('自选、字号、语言、收藏、扫描进度和提醒保存在当前设备。网页与 App 不会自动同步。')),
              ],
            ),
          ),
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.t('价格提醒'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 12),
                if (s.alerts.isEmpty) Text(s.t('尚未设置价格提醒')),
                ...s.alerts.map(
                  (r) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      '${r['symbol']} ${r['direction'] == 'above' ? '≥' : '≤'} ${r['value']}',
                    ),
                    subtitle: Text(s.t(r['firedAt'] != null ? '已触发' : '等待触发')),
                    trailing: IconButton(
                      onPressed: () => s.removeAlert(r),
                      icon: const Icon(Icons.delete_outline),
                    ),
                  ),
                ),
                Notice(s.t('价格阈值提醒在 App 前台、自选行情有效时检查。全市场信号扫描在服务端独立运行。')),
              ],
            ),
          ),
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'MARKET ATLAS · 1.0.0',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 12),
                Text(
                  '${s.t('生产数据服务')}\n${s.api.base}',
                  style: TextStyle(color: muted, fontSize: 14, height: 1.8),
                ),
                const SizedBox(height: 14),
                Text(
                  s.t('公开快照与聚合分笔，非授权 Level-2。筹码为模型推演；盘中候选需等待收盘确认。'),
                  style: TextStyle(color: muted, height: 1.8),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _import(BuildContext context, AtlasStore s) async {
    final controller = TextEditingController();
    String? error;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            22,
            20,
            MediaQuery.viewInsetsOf(ctx).bottom + 22,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(s.t('导入自选 JSON'), style: Theme.of(ctx).textTheme.titleLarge),
              const SizedBox(height: 16),
              TextField(
                controller: controller,
                maxLines: 5,
                decoration: const InputDecoration(
                  hintText: '["300545.SZ", "NVDA"]',
                ),
              ),
              if (error != null) Text(error!, style: TextStyle(color: up)),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () async {
                  try {
                    await s.importWatch(controller.text);
                    if (ctx.mounted) Navigator.pop(ctx);
                  } catch (e) {
                    set(() => error = e.toString());
                  }
                },
                child: Text(s.t('导入')),
              ),
            ],
          ),
        ),
      ),
    );
    controller.dispose();
  }
}

class WatchRowInsight extends StatefulWidget {
  const WatchRowInsight(this.symbol, {super.key});
  final String symbol;
  @override
  State<WatchRowInsight> createState() => _WatchRowInsightState();
}

class _WatchRowInsightState extends State<WatchRowInsight> {
  Json? data;
  Timer? timer;
  @override
  void initState() {
    super.initState();
    load();
    timer = Timer.periodic(const Duration(seconds: 60), (_) {
      if (mounted &&
          context.read<AtlasStore>().foreground &&
          (ModalRoute.of(context)?.isCurrent ?? true)) {
        load();
      }
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> load() async {
    try {
      final r = await context.read<AtlasStore>().api.get(
        '/api/desk/insight',
        parameters: {'symbol': widget.symbol},
      );
      if (mounted) setState(() => data = r);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(),
        trend = obj(data?['trend']),
        action = obj(data?['operation']),
        structure = obj(data?['structure']),
        score = numOf(trend['score']);
    return Row(
      children: [
        Text(
          '${s.t(trend['current'] == true
              ? '今日走势'
              : str(trend['date'], '').isEmpty
              ? '走势'
              : str(trend['date']).substring(5))} ${score?.toStringAsFixed(0) ?? '—'}',
          style: TextStyle(
            fontSize: 12,
            color: score == null
                ? muted
                : score >= 60
                ? up
                : score < 40
                ? down
                : muted,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            '${s.t(str(action['action'], '五线待核验'))} · ${s.t(str(structure['state'], '—'))}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12, color: muted),
          ),
        ),
      ],
    );
  }
}
