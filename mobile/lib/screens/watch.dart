import '../core/watch_transfer_share.dart';
import '../core/extended_quotes.dart';
import '../widgets/extended_quote.dart';
import 'watch_import.dart';
import '../widgets/cloud_sync.dart';

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/watch_insights.dart';
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

class _SearchState {
  const _SearchState(this.query, {this.data, this.error, this.loading = false});
  final String query;
  final Json? data;
  final Object? error;
  final bool loading;
}

/// Sends one request after typing pauses; earlier keystrokes are cancelled and
/// late responses for an older query are ignored.
class StockSearch extends SearchDelegate<String> {
  StockSearch(this.store, {this.debounce = const Duration(milliseconds: 300)})
    : super(searchFieldLabel: store.t('名称、代码或拼音首字母'));
  final AtlasStore store;
  final Duration debounce;
  Timer? _timer;
  String? _scheduled;
  final _state = ValueNotifier(const _SearchState(''));

  @override
  ThemeData appBarTheme(BuildContext context) => Theme.of(context);
  @override
  List<Widget> buildActions(BuildContext context) => [
    IconButton(
      tooltip: store.t('清除'),
      onPressed: () => query = '',
      icon: const Icon(Icons.clear),
    ),
  ];
  @override
  Widget buildLeading(BuildContext context) => IconButton(
    tooltip: store.t('返回'),
    onPressed: () => close(context, ''),
    icon: const Icon(Icons.arrow_back),
  );
  @override
  void close(BuildContext context, String result) {
    _timer?.cancel();
    super.close(context, result);
  }

  @override
  Widget buildResults(BuildContext context) => results(context);
  @override
  Widget buildSuggestions(BuildContext context) => results(context);

  Future<void> _fetch(String value) async {
    _state.value = _SearchState(value, loading: true);
    try {
      final data = await store.api.get('/api/search', parameters: {'q': value});
      if (_scheduled == value) _state.value = _SearchState(value, data: data);
    } catch (e) {
      if (_scheduled == value) _state.value = _SearchState(value, error: e);
    }
  }

  Widget results(BuildContext context) {
    final value = query.trim();
    if (value.isEmpty) {
      _timer?.cancel();
      _scheduled = null;
      return ListView.builder(
        itemCount: store.watchlist.length,
        itemBuilder: (_, i) {
          final s = store.watchlist[i];
          return ListTile(
            title: Text(str(store.quotes[s]?['name'], s)),
            subtitle: Text(s),
            onTap: () => close(context, s),
          );
        },
      );
    }
    if (value != _scheduled) {
      _scheduled = value;
      _timer?.cancel();
      _timer = Timer(debounce, () => _fetch(value));
    }
    return ValueListenableBuilder<_SearchState>(
      valueListenable: _state,
      builder: (context, state, _) {
        final current = state.query == value;
        final items = current ? rows(state.data?['items']) : const <Json>[];
        return ListView(
          children: [
            if (!current || state.loading) const LinearProgressIndicator(),
            if (current && state.error != null)
              Notice(describeError(state.error)),
            ...items.map(
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
  String filter = 'all', sort = 'manual', group = 'all', phase = 'all';
  bool get preset => group == '@trend' || group == '@five';

  /// Preset views need every stock's insight, not only the visible rows.
  final _tracked = <String>{};
  late final AtlasStore _store;
  @override
  void initState() {
    super.initState();
    _store = context.read<AtlasStore>();
  }

  void _trackPreset(AtlasStore s) {
    final want = preset ? s.watchlist.toSet() : const <String>{};
    for (final symbol in _tracked.difference(want).toList()) {
      s.watchInsights.untrack(symbol);
      _tracked.remove(symbol);
    }
    for (final symbol in want.difference(_tracked)) {
      s.watchInsights.track(symbol);
      _tracked.add(symbol);
    }
  }

  @override
  void dispose() {
    for (final symbol in _tracked) {
      _store.watchInsights.untrack(symbol);
    }
    super.dispose();
  }

  void selectGroup(String value) {
    setState(() => group = value);
    if (preset) {
      final s = context.read<AtlasStore>();
      s.watchInsights.loadMany(s.watchlist);
    }
  }

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
                  set(() => error = describeError(e));
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

  /// Swipe-to-remove: in a group view only the group membership goes; in the
  /// full list the stock leaves the watchlist. Either way it can be undone.
  Future<void> remove(AtlasStore s, String symbol, Json? inGroup) async {
    HapticFeedback.mediumImpact();
    final messenger = ScaffoldMessenger.maybeOf(context);
    final name = str(s.quotes[symbol]?['name'], symbol);
    if (inGroup != null) {
      final id = str(inGroup['id']);
      await s.groupStock(id, symbol, false);
      messenger?.showSnackBar(
        SnackBar(
          content: Text('${s.t('已移出分组')} ${str(inGroup['name'])} · $name'),
          action: SnackBarAction(
            label: s.t('撤销'),
            onPressed: () => s.groupStock(id, symbol, true),
          ),
        ),
      );
      return;
    }
    final removed = s.removalOf(symbol);
    await s.removeWatch(symbol);
    messenger?.showSnackBar(
      SnackBar(
        content: Text('${s.t('已移除自选')} · $name'),
        action: SnackBarAction(
          label: s.t('撤销'),
          onPressed: () => s.restoreWatch(removed),
        ),
      ),
    );
  }

  void stockActions(AtlasStore s, String symbol, Json? inGroup) =>
      showModalBottomSheet<void>(
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
              if (inGroup != null)
                ListTile(
                  title: Text(s.t('移出当前分组')),
                  onTap: () {
                    Navigator.pop(ctx);
                    remove(s, symbol, inGroup);
                  },
                ),
              ListTile(
                title: Text(s.t('移除自选')),
                onTap: () {
                  Navigator.pop(ctx);
                  remove(s, symbol, null);
                },
              ),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    _trackPreset(s);
    // Only the views whose order depends on live data listen to it.
    return ListenableBuilder(
      listenable: Listenable.merge([
        if (sort == 'change') s.quoteBook,
        if (preset) s.watchInsights,
      ]),
      builder: (context, _) => _list(context, s),
    );
  }

  Widget _list(BuildContext context, AtlasStore s) {
    final selected = s.groups.where((g) => g['id'] == group).firstOrNull;
    final list = s.watchlist
        .where(
          (v) =>
              (selected == null || (selected['symbols'] as List).contains(v)) &&
              (filter == 'all' || (filter == 'cn' ? cnStock(v) : !cnStock(v))),
        )
        .toList();
    if (group == '@trend') {
      final ranked = rankWatch(list, s.watchInsights.values);
      list
        ..clear()
        ..addAll(ranked);
    } else if (sort == 'change') {
      list.sort(
        (a, b) => (numOf(s.quotes[b]?['changePercent']) ?? -999).compareTo(
          numOf(s.quotes[a]?['changePercent']) ?? -999,
        ),
      );
    }
    final phaseCounts = group != '@five'
        ? const <String, int>{}
        : {
            for (final key in watchPhases.keys)
              key: key == 'all'
                  ? list.length
                  : list
                        .where(
                          (v) => watchPhase(s.watchInsights.values[v]) == key,
                        )
                        .length,
          };
    if (group == '@five' && phase != 'all') {
      list.removeWhere((v) => watchPhase(s.watchInsights.values[v]) != phase);
    }
    final scaler = MediaQuery.textScalerOf(context);
    final headers = <Widget>[
      Row(
        children: [
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  ChoiceChip(
                    label: Text(s.t('全部自选')),
                    selected: group == 'all',
                    onSelected: (_) => selectGroup('all'),
                  ),
                  for (final entry in const {
                    '@trend': '今日走势排序',
                    '@five': '五线量价',
                  }.entries)
                    Padding(
                      padding: const EdgeInsets.only(left: 8),
                      child: ChoiceChip(
                        label: Text(s.t(entry.value)),
                        selected: group == entry.key,
                        onSelected: (_) => selectGroup(entry.key),
                      ),
                    ),
                  for (final g in s.groups)
                    Padding(
                      padding: const EdgeInsets.only(left: 8),
                      child: GestureDetector(
                        onLongPress: () => editGroup(s, existing: g),
                        child: ChoiceChip(
                          label: Text(str(g['name'])),
                          selected: group == g['id'],
                          onSelected: (_) => selectGroup(str(g['id'])),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          IconButton(
            tooltip: s.t('添加自选'),
            onPressed: () => showStockSearch(context),
            icon: const Icon(Icons.add),
          ),
          PopupMenuButton<String>(
            tooltip: s.t('自选管理'),
            icon: const Icon(Icons.more_horiz),
            constraints: BoxConstraints(
              maxWidth: 280,
              maxHeight: MediaQuery.sizeOf(context).height * .62,
            ),
            onSelected: (action) {
              switch (action) {
                case 'export':
                  shareWatchTransfer(context);
                case 'code':
                  shareWatchCode(context);
                case 'code-import':
                  showWatchImport(context, enterCode: true);
                case 'file':
                  showWatchImport(context, pickFile: true);
                case 'import':
                  showWatchImport(context);
                case 'group':
                  editGroup(s);
                case 'edit':
                  editGroup(s, existing: selected);
                case 'sort':
                  setState(() => sort = sort == 'manual' ? 'change' : 'manual');
                case 'all':
                case 'cn':
                case 'us':
                  setState(() => filter = action);
              }
            },
            itemBuilder: (_) => [
              PopupMenuItem(value: 'group', child: Text(s.t('创建分组'))),
              if (selected != null)
                PopupMenuItem(value: 'edit', child: Text(s.t('编辑分组'))),
              const PopupMenuDivider(),
              for (final entry in const {
                'all': '全部市场',
                'cn': 'A股',
                'us': '美股',
              }.entries)
                CheckedPopupMenuItem(
                  value: entry.key,
                  checked: filter == entry.key,
                  child: Text(s.t(entry.value)),
                ),
              PopupMenuItem(
                value: 'sort',
                child: Text(s.t(sort == 'manual' ? '按涨幅排序' : '按自定义顺序')),
              ),
              const PopupMenuDivider(),
              PopupMenuItem(
                value: 'export',
                enabled: s.watchlist.isNotEmpty,
                child: Text(s.t('导出自选')),
              ),
              PopupMenuItem(
                value: 'code',
                enabled: s.watchlist.isNotEmpty,
                child: Text(s.t('生成分享码')),
              ),
              PopupMenuItem(value: 'code-import', child: Text(s.t('输入分享码导入'))),
              PopupMenuItem(value: 'file', child: Text(s.t('导入自选文件'))),
              PopupMenuItem(value: 'import', child: Text(s.t('从其他App导入自选'))),
            ],
          ),
        ],
      ),
      if (preset)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(
            s.t(group == '@trend' ? '走势评分从高到低，待更新项置后' : '经典均线 · 按量价研判阶段筛选'),
            style: TextStyle(color: muted, fontSize: 12),
          ),
        ),
      if (group == '@five')
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final entry in watchPhases.entries)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    label: Text(
                      '${s.t(entry.value)} ${phaseCounts[entry.key]}',
                    ),
                    selected: phase == entry.key,
                    onSelected: (_) => setState(() => phase = entry.key),
                  ),
                ),
            ],
          ),
        ),
      ValueListenableBuilder<String?>(
        valueListenable: s.quoteBook.errors,
        builder: (context, error, _) => error == null
            ? const SizedBox.shrink()
            : Notice('${s.t('行情源暂时不可用')} · ${s.t(error)}'),
      ),
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
              width: watchPriceWidth(scaler),
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
    final inGroup = preset ? null : selected;
    return RefreshIndicator(
      onRefresh: () async {
        await s.refreshQuotes();
        await s.watchInsights.loadMany(list, force: true);
      },
      child: ListView.builder(
        key: const PageStorageKey('watch-list'),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        itemCount: headers.length + list.length + 1,
        itemBuilder: (ctx, i) {
          if (i < headers.length) return headers[i];
          if (i == headers.length + list.length) {
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Notice(
                s.t(
                  list.isEmpty
                      ? preset
                            ? '当前筛选暂无自选'
                            : '分组暂无股票，长按自选股票加入分组'
                      : '分时仅显示来源当日数据；长按股票管理分组。',
                ),
              ),
            );
          }
          final symbol = list[i - headers.length];
          return Dismissible(
            key: ValueKey('${inGroup?['id'] ?? 'all'}:$symbol'),
            direction: DismissDirection.endToStart,
            background: Container(
              color: up.withValues(alpha: .2),
              alignment: Alignment.centerRight,
              padding: const EdgeInsets.only(right: 16),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    inGroup == null
                        ? Icons.star_border
                        : Icons.folder_off_outlined,
                  ),
                  const SizedBox(width: 6),
                  Text(s.t(inGroup == null ? '移除自选' : '移出分组')),
                ],
              ),
            ),
            onDismissed: (_) => remove(s, symbol, inGroup),
            child: WatchRow(
              symbol,
              onTap: () => openStock(context, symbol),
              onLongPress: () => stockActions(s, symbol, inGroup),
            ),
          );
        },
      ),
    );
  }
}

/// Width of the price column; grows with the text scale up to a bound.
double watchPriceWidth(TextScaler scaler) =>
    math.min(120, math.max(84, scaler.scale(84 * 18 / 22)));

/// One watchlist row. It listens to its own quote only, so a poll that
/// changes one stock rebuilds one row.
class WatchRow extends StatelessWidget {
  const WatchRow(
    this.symbol, {
    super.key,
    required this.onTap,
    required this.onLongPress,
  });
  final String symbol;
  final VoidCallback onTap, onLongPress;
  @override
  Widget build(BuildContext context) {
    final s = context.read<AtlasStore>(),
        scaler = MediaQuery.textScalerOf(context),
        us = usStock(symbol);
    return InkWell(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        // A minimum, not a fixed height: large app font × system text size
        // makes the row taller instead of overlapping the insight line.
        constraints: BoxConstraints(minHeight: us ? 128 : 104),
        padding: const EdgeInsets.only(top: 10, bottom: 8),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(color: atlasColor(0xff26262c), width: .5),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            ValueListenableBuilder<Json?>(
              valueListenable: s.quoteBook.listen(symbol),
              builder: (context, quote, _) {
                final q = quote ?? const <String, dynamic>{};
                return Row(
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
                            maxLines: 1,
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
                            ? MiniIntraday(symbol, revision: q['asOf'])
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
                      width: watchPriceWidth(scaler),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerRight,
                            child: Text(
                              fixed(q['price']),
                              maxLines: 1,
                              style: TextStyle(
                                color: tone(q['changePercent']),
                                fontSize: 21,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerRight,
                            child: Text(
                              percent(q['changePercent']),
                              maxLines: 1,
                              style: TextStyle(
                                fontSize: 15,
                                color: tone(q['changePercent']),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              },
            ),
            const SizedBox(height: 6),
            if (us) ExtendedQuoteLine(symbol),
            WatchRowInsight(symbol),
          ],
        ),
      ),
    );
  }
}

class MiniIntraday extends StatefulWidget {
  const MiniIntraday(this.symbol, {super.key, this.revision});
  final String symbol;

  /// Changes when the row's quote changes; the sparkline re-reads (at most
  /// once a minute) only then, so a closed market makes no requests.
  final Object? revision;
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
    if (old.symbol != widget.symbol || old.revision != widget.revision) {
      load();
    }
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
          : CustomPaint(
              painter: SparkPainter(
                points,
                previous,
                upColor: up,
                downColor: down,
                baseColor: muted,
              ),
            ),
    );
  }
}

class SparkPainter extends CustomPainter {
  SparkPainter(
    this.points,
    this.previous, {
    Color? upColor,
    Color? downColor,
    Color? baseColor,
  }) : upColor = upColor ?? up,
       downColor = downColor ?? down,
       baseColor = baseColor ?? muted;
  final List<Json> points;
  final double? previous;

  /// Theme colours are part of the painter so a theme switch repaints.
  final Color upColor, downColor, baseColor;
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
          ..color = baseColor.withValues(alpha: .35)
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
        ..color = (prices.last >= (previous ?? prices.first)
            ? upColor
            : downColor)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );
  }

  @override
  bool shouldRepaint(covariant SparkPainter old) =>
      old.points != points ||
      old.previous != previous ||
      old.upColor != upColor ||
      old.downColor != downColor ||
      old.baseColor != baseColor;
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
          const CloudSyncPanel(),
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(s.t('外观'), style: Theme.of(context).textTheme.titleLarge),
                Chips(
                  values: const {
                    'system': '跟随系统',
                    'dark': '中性黑',
                    'light': '明亮白',
                  },
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
                Builder(
                  builder: (button) => FilledButton.icon(
                    onPressed: () => shareWatchTransfer(button),
                    icon: const Icon(Icons.ios_share),
                    label: Text(s.t('导出自选')),
                  ),
                ),
                Builder(
                  builder: (button) => FilledButton.tonalIcon(
                    onPressed: s.watchlist.isEmpty
                        ? null
                        : () => shareWatchCode(button),
                    icon: const Icon(Icons.key),
                    label: Text(s.t('生成分享码')),
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: () => showWatchImport(context, enterCode: true),
                  icon: const Icon(Icons.keyboard),
                  label: Text(s.t('输入分享码导入')),
                ),
                OutlinedButton.icon(
                  onPressed: () => showWatchImport(context, pickFile: true),
                  icon: const Icon(Icons.file_open_outlined),
                  label: Text(s.t('导入自选文件')),
                ),
                OutlinedButton.icon(
                  onPressed: () => showWatchImport(context),
                  icon: const Icon(Icons.download),
                  label: Text(s.t('从截图／名单导入')),
                ),
                Notice(s.t('连接云同步后，自选与分组跨设备同步；显示设置、收藏和提醒仍保存在当前设备。')),
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
                      tooltip: s.t('删除提醒'),
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
}

/// Trend score and five-MA stance under a watch row. It shows the shared
/// [WatchInsights] snapshot, listens to its own symbol only, and is refreshed
/// by the store's scheduler while it is on screen (no per-row timer).
class WatchRowInsight extends StatefulWidget {
  const WatchRowInsight(this.symbol, {super.key});
  final String symbol;
  @override
  State<WatchRowInsight> createState() => _WatchRowInsightState();
}

class _WatchRowInsightState extends State<WatchRowInsight> {
  late final AtlasStore store = context.read<AtlasStore>();
  String? tracked;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _track();
  }

  @override
  void didUpdateWidget(covariant WatchRowInsight oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.symbol != widget.symbol) _track();
  }

  /// Registered with the scheduler only while visible: its tab is on stage
  /// and no stock page covers the list.
  void _track() {
    final visible =
        TickerMode.valuesOf(context).enabled &&
        (ModalRoute.isCurrentOf(context) ?? true);
    final want = visible ? widget.symbol : null;
    if (want == tracked) return;
    if (tracked != null) store.watchInsights.untrack(tracked!);
    tracked = want;
    if (want != null) {
      store.watchInsights.track(want);
      load();
    }
  }

  @override
  void dispose() {
    if (tracked != null) store.watchInsights.untrack(tracked!);
    super.dispose();
  }

  Future<void> load() async {
    try {
      await store.watchInsights.load(widget.symbol);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store.watchInsights.listen(widget.symbol),
    builder: (context, _) {
      final s = store,
          data = s.watchInsights.values[widget.symbol],
          trend = obj(data?['trend']),
          action = obj(data?['operation']),
          structure = obj(data?['structure']),
          score = numOf(trend['score']),
          fresh = insightFresh(data);
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
              color: score == null || !fresh
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
              '${s.t(str(action['action'], '五线待核验'))} · ${s.t(data != null && !fresh ? '待更新' : str(structure['state'], '—'))}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, color: muted),
            ),
          ),
        ],
      );
    },
  );
}
