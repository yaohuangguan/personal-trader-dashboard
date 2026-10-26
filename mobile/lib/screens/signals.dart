import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../core/push_service.dart';
import '../widgets/common.dart';
import 'stock.dart';

class SignalsPage extends StatefulWidget {
  const SignalsPage({super.key, this.imported = false});
  final bool imported;
  @override
  State<SignalsPage> createState() => _SignalsPageState();
}

class _SignalsPageState extends State<SignalsPage> {
  Json? status, market;
  String scope = 'all';
  bool activity = true, busy = false;
  String? error, message;
  Timer? timer;
  @override
  void initState() {
    super.initState();
    scope = widget.imported ? 'candidates' : 'all';
    refresh();
    timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted && context.read<AtlasStore>().foreground) refresh();
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> refresh() async {
    final s = context.read<AtlasStore>();
    try {
      final results = await Future.wait([
        s.api.get('/api/monitor/status', token: s.deviceToken),
        s.api.get('/api/monitor/global', token: s.deviceToken),
      ]);
      if (!mounted) return;
      setState(() {
        status = results[0];
        market = results[1];
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  Future<void> action(Future<dynamic> Function() fn, [String? success]) async {
    setState(() {
      busy = true;
      error = null;
      message = null;
    });
    try {
      await fn();
      await refresh();
      if (mounted) setState(() => message = success);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(),
        push = context.read<NativePushService>(),
        config = obj(status?['config']),
        items = scope == 'watch'
            ? s.watchlist.where(cnStock).toList()
            : s.prefs.getStringList('monitorPool') ?? <String>[],
        events = rows(status?['events']);
    String clock(dynamic v) {
      final n = numOf(v);
      if (n == null || n == 0) return '—';
      return DateTime.fromMillisecondsSinceEpoch(n.toInt(), isUtc: true)
          .add(const Duration(hours: 8))
          .toIso8601String()
          .replaceFirst('T', ' ')
          .substring(0, 19);
    }

    return RefreshIndicator(
      onRefresh: refresh,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        children: [
          PageTitle(
            '盘中信号中心',
            '全市场分片扫描 · 浏览器 / PWA 推送',
            trailing: IconButton(
              onPressed: refresh,
              icon: const Icon(Icons.refresh),
            ),
          ),
          if (error != null) Notice(s.t(error!)),
          if (message != null) Notice(s.t(message!)),
          Row(
            children: [
              Expanded(
                child: Text(
                  s.t(scope == 'all' ? '全市场 · 沪深北全部证券' : '自定义名单最多60只'),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, color: muted),
                ),
              ),
              FilledButton.icon(
                onPressed:
                    busy ||
                        scope != 'all' && (items.isEmpty || items.length > 60)
                    ? null
                    : () => action(
                        () => s.api.post('/api/monitor/config', {
                          'enabled': config['enabled'] != true,
                          'scope': scope == 'all' ? 'all' : 'selected',
                          'symbols': scope == 'all' ? [] : items,
                          'activityFilter': activity,
                          'locale': s.locale,
                        }, token: s.deviceToken),
                      ),
                icon: Icon(
                  config['enabled'] == true ? Icons.pause : Icons.play_arrow,
                  size: 16,
                ),
                label: Text(s.t(config['enabled'] == true ? '暂停盯盘' : '开启盯盘')),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              '${s.t(str(status?['status'], '尚未开启'))} · ${s.t('底稿')} ${market?['ready'] ?? 0}/${market?['total'] ?? 0}',
              style: const TextStyle(fontSize: 13, color: muted),
            ),
          ),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(s.t('监控设置'), style: const TextStyle(fontSize: 14)),
            children: [
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    DropdownButtonFormField<String>(
                      initialValue: scope,
                      decoration: InputDecoration(labelText: s.t('监控范围')),
                      isExpanded: true,
                      items:
                          const {
                                'all': '全市场 · 沪深北全部证券',
                                'watch': '我的自选 · 沪深北',
                                'candidates': '选股器导入的候选',
                              }.entries
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
                      onChanged: busy
                          ? null
                          : (v) => setState(() => scope = v!),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      s.t(
                        scope == 'all'
                            ? '自动读取完整证券名单，分片持续核验；无需先加入自选。'
                            : '自定义名单最多60只',
                      ),
                      style: const TextStyle(color: muted, height: 1.7),
                    ),
                    if (scope != 'all')
                      Wrap(
                        spacing: 8,
                        children: items
                            .map(
                              (v) => ActionChip(
                                label: Text(v),
                                onPressed: () => openStock(context, v),
                              ),
                            )
                            .toList(),
                      ),
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(s.t('股性过滤：跳过低弹性和历史弱延续')),
                      value: activity,
                      onChanged: (v) => setState(() => activity = v!),
                    ),
                    Wrap(
                      spacing: 12,
                      runSpacing: 10,
                      children: [
                        FilledButton.icon(
                          onPressed:
                              busy ||
                                  scope != 'all' &&
                                      (items.isEmpty || items.length > 60)
                              ? null
                              : () => action(
                                  () => s.api.post('/api/monitor/config', {
                                    'enabled': true,
                                    'scope': scope == 'all'
                                        ? 'all'
                                        : 'selected',
                                    'symbols': scope == 'all' ? [] : items,
                                    'activityFilter': activity,
                                    'locale': s.locale,
                                  }, token: s.deviceToken),
                                  '后台盯盘已开启；关闭页面后任务继续运行。',
                                ),
                          icon: const Icon(Icons.play_arrow),
                          label: Text(
                            s.t(
                              config['enabled'] == true ? '更新监控名单' : '开启后台盯盘',
                            ),
                          ),
                        ),
                        OutlinedButton.icon(
                          onPressed: busy || config['enabled'] != true
                              ? null
                              : () => action(
                                  () => s.api.post('/api/monitor/config', {
                                    'enabled': false,
                                  }, token: s.deviceToken),
                                  '后台盯盘已暂停。',
                                ),
                          icon: const Icon(Icons.pause),
                          label: Text(s.t('暂停后台盯盘')),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(s.t('设备通知'), style: const TextStyle(fontSize: 14)),
            children: [
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      s.t('设备通知'),
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 14),
                    Notice(
                      s.t(
                        nativePushConfigured ? '原生推送已配置，允许通知后可接收后台信号。' : '原生推送配置待接入 Firebase / APNs；后台扫描和触发记录已可用。网页版 / PWA 推送继续可用。',
                      ),
                    ),
                    FilledButton.icon(
                      onPressed:
                          busy ||
                              !push.ready ||
                              (status?['nativeAvailable']) != true
                          ? null
                          : () => action(push.enable, '当前设备已订阅'),
                      icon: const Icon(Icons.notifications_outlined),
                      label: Text(s.t('允许原生通知')),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton(
                      onPressed: busy || (status?['nativeSubscribed']) != true
                          ? null
                          : () => action(
                              () => s.api.post(
                                '/api/monitor/test',
                                {},
                                token: s.deviceToken,
                              ),
                              '测试已提交通知服务，请检查设备通知。',
                            ),
                      child: Text(s.t('发送测试通知')),
                    ),
                    TextButton(
                      onPressed: () => launchUrl(
                        Uri.parse('${s.api.base}/?view=signals'),
                        mode: LaunchMode.externalApplication,
                      ),
                      child: Text(s.t('在浏览器 / PWA 设置推送')),
                    ),
                  ],
                ),
              ),
            ],
          ),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(s.t('核验详情'), style: const TextStyle(fontSize: 14)),
            children: [
              Panel(
                child: Wrap(
                  spacing: 24,
                  runSpacing: 20,
                  children: [
                    LabelValue('后台状态', s.t(str(status?['status']))),
                    LabelValue(
                      '历史底稿就绪',
                      '${status?['ready'] ?? 0} / ${config['scope'] == 'all' ? (market?['total'] ?? '—') : ((config['symbols'] as List?)?.length ?? 0)}',
                    ),
                    LabelValue('本轮核验', str(status?['checked'])),
                    LabelValue('最近检查 · 北京时间', clock(status?['lastRun'])),
                    LabelValue('下次检查 · 北京时间', clock(status?['nextRun'])),
                    LabelValue('有效期至 · 北京时间', clock(config['expiresAt'])),
                  ],
                ),
              ),
              if (scope == 'all')
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        s.t('全市场覆盖'),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 18),
                      Wrap(
                        spacing: 24,
                        runSpacing: 20,
                        children: [
                          LabelValue(
                            '来源登记 / 实际读取',
                            '${market?['registered'] ?? 0} / ${market?['total'] ?? 0}',
                          ),
                          LabelValue(
                            '名单页数 / 全量读取',
                            '${market?['pages'] ?? 0} · ${s.t(market?['universeComplete'] == true ? '已读到末页' : '读取中')}',
                          ),
                          LabelValue(
                            '分片数量 / 活跃分片',
                            '${market?['shards'] ?? 0} / ${market?['freshShards'] ?? 0}',
                          ),
                          LabelValue(
                            '全市场底稿就绪',
                            '${market?['ready'] ?? 0} / ${market?['total'] ?? 0}',
                          ),
                          LabelValue('最近150秒有效核验', str(market?['checked'])),
                          LabelValue('最近行情源时间', str(market?['lastQuoteAt'])),
                        ],
                      ),
                      const SizedBox(height: 18),
                      Notice(s.t(str(market?['notice'], '开启后由后台读取全市场证券名单。'))),
                    ],
                  ),
                ),
            ],
          ),
          Text(s.t('触发记录'), style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 16),
          if (events.isEmpty) Notice(s.t('尚无触发记录。仅记录开启监控后观察到的信号，不回填历史命中。')),
          ...events.map(
            (e) => Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    s.t(
                      const {
                            'intraday': '盘中候选',
                            'launch-close': '收盘启动',
                            'confirmed': '开花确认',
                            'invalidated': '确认失效',
                          }[e['kind']] ??
                          '待核验',
                    ),
                    style: TextStyle(
                      color: e['kind'] == 'intraday' ? Colors.amber : muted,
                      fontSize: 14,
                    ),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(str(e['name'])),
                    subtitle: Text('${e['symbol']} · ${e['asOf']}'),
                    trailing: Text(fixed(e['price'])),
                    onTap: () => openStock(context, str(e['symbol'])),
                  ),
                  Text(
                    s.t(
                      e['kind'] == 'intraday'
                          ? '未收盘候选，后续可能撤回；不是开花确认。'
                          : '已观察后续日线并满足指南确认条件。',
                    ),
                    style: const TextStyle(
                      color: muted,
                      fontSize: 13,
                      height: 1.8,
                    ),
                  ),
                  if (e['deliveryError'] != null)
                    Text(
                      str(e['deliveryError']),
                      style: const TextStyle(color: up, fontSize: 13),
                    ),
                ],
              ),
            ),
          ),
          if (rows(status?['failures']).isNotEmpty)
            ExpansionTile(
              title: Text(s.t('本轮未完成核验')),
              children: rows(status?['failures'])
                  .map(
                    (r) => ListTile(
                      title: Text(str(r['symbol'])),
                      subtitle: Text(s.t(str(r['reason']))),
                    ),
                  )
                  .toList(),
            ),
          Notice(
            s.t(
              '核心使用指南固定MA5/10/20/30/60：前序粘合、放量大阳、穿线与MA60等条件。盘中成交量采用已发生的累计量，不外推全天量；盘中候选不等于确认开花。确认与失效只在收盘后核验，按证券、交易日、事件类型去重。',
            ),
          ),
        ],
      ),
    );
  }
}
