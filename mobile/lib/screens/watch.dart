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
  StockSearch(this.store) : super(searchFieldLabel: store.t('股票名称或代码'));
  final AtlasStore store;
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
    return FutureBuilder<Json>(
      future: store.api.get('/api/search', parameters: {'q': value}),
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
  String filter = 'all', sort = 'manual';
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    final list = s.watchlist
        .where(
          (v) => filter == 'all' || (filter == 'cn' ? cnStock(v) : !cnStock(v)),
        )
        .toList();
    if (sort == 'change') {
      list.sort(
        (a, b) => (numOf(s.quotes[b]?['changePercent']) ?? -999).compareTo(
          numOf(s.quotes[a]?['changePercent']) ?? -999,
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: s.refreshQuotes,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        children: [
          PageTitle(
            '我的自选',
            '点选股票进入工作台，长按排序，左滑移除',
            trailing: IconButton(
              onPressed: () => showStockSearch(context),
              icon: const Icon(Icons.add),
            ),
          ),
          Chips(
            values: const {'all': '全部', 'cn': 'A股', 'us': '美股'},
            selected: filter,
            onSelected: (v) => setState(() => filter = v),
          ),
          Row(
            children: [
              Expanded(
                child: Text(
                  '${list.length} ${s.t('只自选')}',
                  style: const TextStyle(color: muted),
                ),
              ),
              TextButton.icon(
                onPressed: () => setState(
                  () => sort = sort == 'manual' ? 'change' : 'manual',
                ),
                icon: const Icon(Icons.sort, size: 18),
                label: Text(s.t(sort == 'manual' ? '自定义排序' : '涨幅排序')),
              ),
            ],
          ),
          if (s.quoteError != null)
            Notice('${s.t('行情源暂时不可用')} · ${s.quoteError}'),
          if (list.isEmpty) Notice(s.t('添加股票开始看盘')),
          ...list.map((symbol) {
            final q = s.quotes[symbol] ?? {};
            return Dismissible(
              key: ValueKey(symbol),
              direction: DismissDirection.endToStart,
              background: Container(
                color: up.withValues(alpha: .2),
                alignment: Alignment.centerRight,
                padding: const EdgeInsets.all(20),
                child: const Icon(Icons.star_border),
              ),
              onDismissed: (_) => s.toggleWatch(symbol),
              child: Container(
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: Color(0xff303038))),
                ),
                child: ListTile(
                  minVerticalPadding: 14,
                  title: Text(
                    str(q['name'], symbol),
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 19,
                    ),
                  ),
                  subtitle: Text(
                    '$symbol${q['asOf'] != null
                        ? ' · ${str(q['asOf']).replaceFirst('T', ' ')}'
                        : cnStock(symbol)
                        ? ''
                        : ' · ${s.t('打开查看行情')}'}',
                    style: const TextStyle(color: muted, fontSize: 12),
                  ),
                  trailing: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        fixed(q['price']),
                        style: const TextStyle(
                          fontSize: 22,
                          height: 1.05,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        percent(q['changePercent']),
                        style: TextStyle(
                          fontSize: 16,
                          height: 1.05,
                          color: tone(q['changePercent']),
                        ),
                      ),
                    ],
                  ),
                  onTap: () => openStock(context, symbol),
                  onLongPress: () => showModalBottomSheet(
                    context: context,
                    useSafeArea: true,
                    builder: (ctx) => ListView(
                      shrinkWrap: true,
                      children: [
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
                ),
              ),
            );
          }),
          const SizedBox(height: 20),
          Notice(s.t('公开行情快照约5秒刷新。盘外保留来源时间；美股行情进入工作台读取。')),
        ],
      ),
    );
  }
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
                  style: const TextStyle(
                    color: muted,
                    fontSize: 14,
                    height: 1.8,
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  s.t('公开快照与聚合分笔，非授权 Level-2。筹码为模型推演；盘中候选需等待收盘确认。'),
                  style: const TextStyle(color: muted, height: 1.8),
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
              if (error != null)
                Text(error!, style: const TextStyle(color: up)),
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
