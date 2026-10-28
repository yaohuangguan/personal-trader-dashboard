import 'package:flutter/material.dart';

import '../core/api.dart';
import '../widgets/common.dart';
import 'guide.dart' show GuideEvidencePanel;
import 'trade_review.dart';

Color _direction(Json p) => p['direction'] == 'bullish'
    ? up
    : p['direction'] == 'bearish'
    ? down
    : muted;
List<String> _texts(dynamic v) => v is List ? v.map((e) => '$e').toList() : [];
String _zone(dynamic v) =>
    v is List && v.length == 2 ? '${fixed(v[0])} – ${fixed(v[1])}' : '等待有效触发';

/// Compact execution summary shown immediately below the full-screen chart.
class GuideActionPanel extends StatelessWidget {
  const GuideActionPanel(this.analysis, {super.key});
  final Json analysis;
  @override
  Widget build(BuildContext context) {
    if (obj(obj(analysis['strategy'])['plan'])['flat'] is Map) {
      return DecisionSummary(analysis);
    }
    final strategy = obj(analysis['strategy']), p = obj(strategy['plan']);
    final color = _direction(p),
        score = numOf(obj(analysis['strength'])['score']);
    return Panel(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  tr(context, '五线开花 · 操作计划'),
                  style: TextStyle(color: muted, fontSize: 13),
                ),
              ),
              Text(
                tr(context, p['provisional'] == true ? '盘中待确认' : '日线收盘'),
                style: TextStyle(color: color, fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      tr(context, str(p['action'], '等待策略数据')),
                      style: TextStyle(
                        fontSize: 27,
                        height: 1.2,
                        fontWeight: FontWeight.w600,
                        color: color,
                      ),
                    ),
                    const SizedBox(height: 7),
                    Text(
                      tr(context, str(p['label'], '刷新后查看结构量价策略')),
                      style: const TextStyle(fontSize: 15),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    score == null ? '—' : score.round().toString(),
                    style: const TextStyle(
                      fontSize: 30,
                      height: 1.1,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    tr(context, '五线总分 / 100'),
                    style: TextStyle(color: muted, fontSize: 11),
                  ),
                ],
              ),
            ],
          ),
          if (_texts(p['reasons']).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 14),
              child: Text(
                tr(context, _texts(p['reasons']).first),
                style: TextStyle(fontSize: 14, height: 1.6, color: ink),
              ),
            ),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 3,
                child: _Value('计划入场区间', _zone(p['entry']), color),
              ),
              const SizedBox(width: 8),
              Expanded(flex: 2, child: _Value('结构失效价', fixed(p['stop']), down)),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: _Value(
                  '计划 2R',
                  p['targets'] is List && (p['targets'] as List).isNotEmpty
                      ? fixed(p['targets'][0])
                      : '—',
                  muted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            '${str(p['asOf'])} · ${tr(context, str(strategy['version'], '结构量价 v2.0'))}',
            style: TextStyle(color: muted, fontSize: 12),
          ),
          const SizedBox(height: 5),
          Text(
            tr(context, '评分衡量形态条件，不是胜率；价位是条件计划，不代表实际持仓或成交。'),
            style: TextStyle(color: muted, fontSize: 12, height: 1.5),
          ),
        ],
      ),
    );
  }
}

class _Value extends StatelessWidget {
  const _Value(this.label, this.value, this.color);
  final String label, value;
  final Color color;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(tr(context, label), style: TextStyle(fontSize: 12, color: muted)),
      const SizedBox(height: 6),
      Text(
        tr(context, value),
        style: TextStyle(
          fontSize: 15,
          height: 1.4,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    ],
  );
}

class GuidePanel extends StatelessWidget {
  const GuidePanel(this.symbol, this.analysis, {super.key});
  final String symbol;
  final Json analysis;
  @override
  Widget build(BuildContext context) {
    final strategy = obj(analysis['strategy']),
        p = obj(strategy['plan']),
        market = obj(analysis['context']);
    final structure = obj(market['structure']), pv = obj(market['priceVolume']);
    final history = obj(analysis['strategyHistory']),
        guide = obj(analysis['guide']);
    final color = _direction(p), steps = ['蓄势', '触发', '确认', '跟踪'];
    final active = switch (p['kind']) {
      'prepare' => 0,
      'breakout' || 'multi' || 'retest' => p['provisional'] == true ? 1 : 2,
      'manage' || 'exit' => 3,
      _ => -1,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        GuideActionPanel(analysis),
        if (p['flat'] is Map) DecisionDetails(analysis),
        Panel(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                tr(context, '结构与节奏'),
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  for (var i = 0; i < steps.length; i++)
                    Expanded(
                      child: Column(
                        children: [
                          Container(
                            width: 28,
                            height: 28,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: i == active
                                  ? color.withValues(alpha: .14)
                                  : muted.withValues(alpha: .07),
                            ),
                            child: Text(
                              '${i + 1}',
                              style: TextStyle(
                                color: i == active ? color : muted,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          const SizedBox(height: 7),
                          Text(
                            tr(context, steps[i]),
                            style: TextStyle(
                              fontSize: 13,
                              color: i == active ? color : muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 20),
              _ContextRow(
                Icons.account_tree_outlined,
                '当前结构',
                str(structure['state']),
                str(structure['period']),
                _direction(structure),
              ),
              Divider(height: 26, color: muted.withValues(alpha: .15)),
              _ContextRow(
                Icons.bar_chart,
                '量价方向',
                str(pv['label']),
                str(pv['explanation']),
                _direction(pv),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: _Value(
                      '五线粘合',
                      '${fixed(guide['adhesionPct'])}%',
                      muted,
                    ),
                  ),
                  Expanded(
                    child: _Value(
                      'BIAS60',
                      '${fixed(guide['bias60'])}%',
                      muted,
                    ),
                  ),
                  Expanded(
                    child: _Value(
                      '相对量能',
                      '${fixed(guide['volumeRatio'])}×',
                      muted,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        if (_texts(p['warnings']).isNotEmpty)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xffd6a75a).withValues(alpha: .09),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.info_outline,
                  size: 18,
                  color: Color(0xffcfa45f),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Text(
                    _texts(p['warnings']).map((s) => tr(context, s)).join('\n'),
                    style: const TextStyle(fontSize: 13, height: 1.6),
                  ),
                ),
              ],
            ),
          ),
        Panel(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
          child: OpenSection(
            tilePadding: EdgeInsets.zero,
            childrenPadding: const EdgeInsets.only(bottom: 12),
            shape: const Border(),
            collapsedShape: const Border(),
            title: Text(
              tr(context, '触发证据'),
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              '${rows(p['checks']).where((c) => c['pass'] == true).length} / ${rows(p['checks']).length} ${tr(context, '条件通过')}',
              style: TextStyle(color: muted, fontSize: 12),
            ),
            children: [
              for (final c in rows(p['checks']))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 9),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        c['pass'] == true
                            ? Icons.check_circle_outline
                            : Icons.radio_button_unchecked,
                        size: 18,
                        color: c['pass'] == true ? color : muted,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              tr(context, str(c['label'])),
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              tr(context, str(c['detail'])),
                              style: TextStyle(
                                fontSize: 13,
                                height: 1.5,
                                color: muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        Panel(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                tr(context, '历史检验 · 扣除模拟成本'),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: _Value('完成交易', '${history['completed'] ?? 0}', ink),
                  ),
                  Expanded(
                    child: _Value(
                      '胜率',
                      history['sufficient'] == true
                          ? '${fixed((numOf(history['winRate']) ?? 0) * 100, 1)}%'
                          : '样本不足',
                      muted,
                    ),
                  ),
                  Expanded(
                    child: _Value(
                      '最大回撤',
                      history.isEmpty
                          ? '—'
                          : '${fixed(history['maxDrawdown'])}%',
                      down,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                '${str(history['from'])} → ${str(history['to'])}',
                style: TextStyle(fontSize: 12, color: muted),
              ),
              OpenSection(
                tilePadding: EdgeInsets.zero,
                shape: const Border(),
                collapsedShape: const Border(),
                title: Text(
                  tr(context, '买卖记录与模拟口径'),
                  style: const TextStyle(fontSize: 14),
                ),
                children: [
                  for (final point in rows(
                    strategy['signals'],
                  ).reversed.take(8))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            point['side'] == 'buy'
                                ? tr(context, '买')
                                : tr(context, '卖'),
                            style: TextStyle(
                              color: point['side'] == 'buy' ? up : down,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${str(point['time'])}  ${fixed(point['price'])}',
                                  style: const TextStyle(fontSize: 14),
                                ),
                                Text(
                                  tr(context, str(point['reason'])),
                                  style: TextStyle(
                                    color: muted,
                                    fontSize: 12,
                                    height: 1.5,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  Text(
                    tr(context, str(history['notice'])),
                    style: TextStyle(color: muted, fontSize: 12, height: 1.6),
                  ),
                  Text(
                    tr(context, str(strategy['method'])),
                    style: TextStyle(color: muted, fontSize: 12, height: 1.6),
                  ),
                ],
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 14, 4, 12),
          child: Text(
            tr(context, '指南原始规则与全周期共振'),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
        ),
        GuideEvidencePanel(symbol, analysis),
      ],
    );
  }
}

class _ContextRow extends StatelessWidget {
  const _ContextRow(this.icon, this.title, this.value, this.detail, this.color);
  final IconData icon;
  final String title, value, detail;
  final Color color;
  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(icon, size: 20, color: color),
      const SizedBox(width: 11),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              tr(context, title),
              style: TextStyle(fontSize: 12, color: muted),
            ),
            const SizedBox(height: 5),
            Text(
              tr(context, value),
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
            if (detail != '—')
              Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Text(
                  tr(context, detail),
                  style: TextStyle(fontSize: 13, height: 1.5, color: muted),
                ),
              ),
          ],
        ),
      ),
    ],
  );
}
