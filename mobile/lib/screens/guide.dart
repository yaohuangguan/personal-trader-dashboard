import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../widgets/common.dart';

class GuidePanel extends StatelessWidget {
  const GuidePanel(this.symbol, this.analysis, {super.key});
  final String symbol;
  final Json analysis;
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(),
        guide = obj(analysis['guide']),
        character = obj(analysis['character']),
        strength = obj(analysis['strength']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        GuideActionPanel(analysis),
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                s.t('姚记五线开花 v10.4'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    fixed(strength['score'], 0),
                    style: const TextStyle(
                      fontSize: 48,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    ' / 100 · ${s.t('五线总分')}',
                    style: TextStyle(color: muted, fontSize: 14),
                  ),
                ],
              ),
              ...rows(strength['parts']).map(
                (p) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          s.t(str(p['label'])),
                          style: const TextStyle(fontSize: 14),
                        ),
                      ),
                      Text(
                        '${p['score']} / ${p['max']}',
                        style: const TextStyle(fontSize: 14),
                      ),
                    ],
                  ),
                ),
              ),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: Text(s.t('评分口径'), style: const TextStyle(fontSize: 14)),
                children: [
                  Text(
                    s.t(str(strength['notice'])),
                    style: TextStyle(color: muted, fontSize: 13, height: 1.6),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Text(
                s.t(str(guide['stage'])),
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 18),
              Wrap(
                spacing: 28,
                runSpacing: 18,
                children: [
                  LabelValue('粘合系数', '${fixed(guide['adhesionPct'])}%'),
                  LabelValue('当前 BIAS60', '${fixed(guide['bias60'])}%'),
                  LabelValue('相对量能', '${fixed(guide['volumeRatio'])}×'),
                  LabelValue('历史日线', str(guide['asOf'])),
                ],
              ),
              if (guide['provisional'] == true)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Notice(s.t('当前日线尚未收盘，盘中满足条件仍只是候选。')),
                ),
            ],
          ),
        ),
        if (character.isNotEmpty)
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${s.t('股性')} · ${s.t(str(character['label']))}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 22,
                  runSpacing: 16,
                  children: [
                    LabelValue('60日波动', '${fixed(character['volatility'])}%'),
                    LabelValue('ATR20', '${fixed(character['atr'])}%'),
                    LabelValue('≥5%脉冲', str(character['impulseDays'])),
                    LabelValue('历史突破次数', str(character['breakouts'])),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  '${s.t('5日延续次数')}: ${numOf(character['continuation']) == null ? '—' : (numOf(character['continuation'])! * numOf(character['breakouts'])!).round()}',
                  style: TextStyle(color: muted),
                ),
                Text(
                  s.t('历史波动不保证未来行情，板块与催化仍需另行核验。'),
                  style: TextStyle(fontSize: 13, color: muted),
                ),
              ],
            ),
          ),
        ...rows(guide['dimensions']).map(
          (r) => Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.t(str(r['title'])),
                  style: TextStyle(color: muted, fontSize: 14),
                ),
                const SizedBox(height: 8),
                Text(
                  s.t(str(r['value'])),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                Text(
                  s.t(str(r['detail'])),
                  style: TextStyle(height: 1.8, color: muted),
                ),
              ],
            ),
          ),
        ),
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                s.t('一阳穿线 · 强度清单'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              ...rows(guide['rules']).map(
                (r) => ExpansionTile(
                  leading: Icon(
                    r['state'] == 'pass'
                        ? Icons.check_circle_outline
                        : r['state'] == 'unknown'
                        ? Icons.help_outline
                        : Icons.circle_outlined,
                    color: r['state'] == 'pass' ? down : muted,
                  ),
                  title: Text(s.t(str(r['title']))),
                  subtitle: Text(
                    s.t(str(r['value'])),
                    style: TextStyle(color: muted, fontSize: 14),
                  ),
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                        '${s.t(str(r['rule']))}\n${s.t('指南 §')}${r['chapter']}',
                        style: TextStyle(height: 1.8, color: muted),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (obj(guide['event']).isNotEmpty)
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.t('后续确认'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 12),
                Text(s.t(str(obj(guide['event'])['reason']))),
                const SizedBox(height: 14),
                LabelValue(
                  '首次确认',
                  str(obj(guide['event'])['confirmationDate']),
                ),
                const SizedBox(height: 12),
                LabelValue(
                  '失守日期',
                  str(obj(guide['event'])['invalidationDate']),
                ),
              ],
            ),
          ),
        Panel(
          child: AsyncPanel(
            load: () => s.api.get(
              '/api/analysis',
              parameters: {'symbol': symbol, 'resonance': '1', 'compact': '1'},
            ),
            builder: (r) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.t('全周期共振'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                for (final key in ['weekly', 'monthly'])
                  ListTile(
                    title: Text(
                      s.t(key == 'weekly' ? '周线 · 屠龙刀' : '月线 · 30月线回踩'),
                    ),
                    subtitle: Text(
                      '${obj(obj(r['resonance'])[key])['detail']}\n${s.t('仅用已收盘周期')}',
                    ),
                    trailing: Icon(
                      obj(obj(r['resonance'])[key])['matched'] == true
                          ? Icons.check_circle
                          : Icons.circle_outlined,
                      color: muted,
                    ),
                  ),
              ],
            ),
          ),
        ),
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                s.t('指标协同与人工证据'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              ...rows(guide['supporting']).map(
                (r) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(s.t(str(r['title']))),
                  subtitle: Text(s.t(str(r['detail']))),
                  trailing: Text(
                    s.t(
                      r['state'] == 'pass'
                          ? '满足'
                          : r['state'] == 'unknown'
                          ? '待核验'
                          : '未满足',
                    ),
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
              ),
            ],
          ),
        ),
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                s.t('风险与失效观察'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              ...((guide['risks'] as List?) ?? []).map(
                (r) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    s.t('$r'),
                    style: TextStyle(color: up, height: 1.7),
                  ),
                ),
              ),
              if (((guide['risks'] as List?) ?? []).isEmpty)
                Text(s.t('当前未命中已实现的风险条件；仍需核验行情时效、消息与筹码。')),
              const Divider(height: 30),
              Text(
                s.t(
                  '核心五线固定为 MA5/10/20/30/60。长期120/250用于背景观察，图表的八条可调均线独立保留。粘合系数严格采用指南计算器：(最高均线−最低均线)/最低均线；小于2%/5%/10%分别对应极致/紧密/松散粘合。',
                ),
                style: TextStyle(fontSize: 13, height: 1.8, color: muted),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class GuideActionPanel extends StatelessWidget {
  const GuideActionPanel(this.analysis, {super.key});
  final Json analysis;
  @override
  Widget build(BuildContext context) {
    final a = obj(analysis['action']),
        strength = obj(analysis['strength']),
        s = context.watch<AtlasStore>();
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  s.t('五线操作建议'),
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                '${fixed(strength['score'], 0)} / 100',
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            s.t(str(a['action'], '观望')),
            style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w600),
          ),
          Text(
            '${str(a['asOf'])} · ${s.t(a['provisional'] == true ? '盘中待确认' : '收盘规则')}',
            style: TextStyle(color: muted, fontSize: 12),
          ),
          const SizedBox(height: 12),
          ...((a['reasons'] as List?) ?? []).map(
            (r) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                '• ${s.t('$r')}',
                style: const TextStyle(fontSize: 15, height: 1.6),
              ),
            ),
          ),
          if (a['invalidation'] != null)
            Text(
              '${s.t('失效观察')} · ${s.t('阳线半位')} ${fixed(obj(a['invalidation'])['midpoint'])} / MA20 ${fixed(obj(a['invalidation'])['ma20'])}',
              style: TextStyle(fontSize: 14, color: muted),
            ),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(s.t('历史买卖点与规则'), style: const TextStyle(fontSize: 14)),
            children: [
              ...rows(analysis['tradeMarkers']).reversed
                  .take(10)
                  .map(
                    (p) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        '${str(p['time'])} · ${s.t(str(p['label']))}  ${fixed(p['price'])}',
                        style: const TextStyle(fontSize: 14),
                      ),
                      subtitle: Text(
                        s.t(str(p['reason'])),
                        style: const TextStyle(fontSize: 13),
                      ),
                    ),
                  ),
              Text(
                s.t(str(a['notice'])),
                style: TextStyle(color: muted, fontSize: 13, height: 1.7),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
