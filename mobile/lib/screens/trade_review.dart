import 'package:flutter/material.dart';

import '../core/api.dart';
import '../widgets/common.dart';

Color _stanceTone(Json stance) {
  final action = str(stance['action']);
  if (RegExp('卖出|减仓|风控|回避').hasMatch(action)) return down;
  if (RegExp('买入观察|强买入').hasMatch(action)) return up;
  return muted;
}

class DecisionSummary extends StatelessWidget {
  const DecisionSummary(this.analysis, {super.key});
  final Json analysis;
  @override
  Widget build(BuildContext context) {
    final p = obj(obj(analysis['strategy'])['plan']),
        r = obj(analysis['review']);
    final flat = obj(r['flat'] ?? p['flat']),
        holding = obj(r['holding'] ?? p['holding']);
    return Panel(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            tr(context, '五线量价研判'),
            style: TextStyle(fontSize: 13, color: muted),
          ),
          const SizedBox(height: 10),
          Text(
            tr(context, str(p['label'])),
            style: const TextStyle(
              fontSize: 25,
              height: 1.4,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: _Metric('结构准备度', p['structureScore'])),
              Expanded(
                child: _Metric(
                  '当前买点分',
                  r.isNotEmpty ? r['entryScore'] : p['score'],
                ),
              ),
              Expanded(
                child: _Metric('持仓退出风险', r['exitRisk'] ?? p['exitRisk']),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _StanceCard('空仓 / 准备买入', flat),
          const SizedBox(height: 12),
          _StanceCard('已有持仓', holding),
          const SizedBox(height: 16),
          Wrap(
            spacing: 24,
            runSpacing: 14,
            children: [
              LabelValue(
                '条件观察区',
                p['entry'] is List
                    ? (p['entry'] as List).map((n) => fixed(n)).join('–')
                    : '—',
              ),
              LabelValue('新入场失效价', fixed(p['stop'])),
              LabelValue('持仓防守参考', fixed(p['holdingStop'])),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            '${str(r['asOf'] ?? p['asOf'])} · ${tr(context, p['provisional'] == true ? '盘中待确认' : '日线收盘')}',
            style: TextStyle(color: muted, fontSize: 12, height: 1.6),
          ),
          Text(
            r.isNotEmpty
                ? '${tr(context, '综合证据覆盖')} ${r['coverage']}%'
                : tr(context, '量价初判 · 联动待核验'),
            style: TextStyle(color: muted, fontSize: 12, height: 1.6),
          ),
          Text(
            tr(context, '结构好看与当前位置适合买入分别评价；分数不是上涨概率。'),
            style: TextStyle(color: muted, fontSize: 12, height: 1.6),
          ),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric(this.label, this.value);
  final String label;
  final dynamic value;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(tr(context, label), style: TextStyle(fontSize: 11, color: muted)),
      const SizedBox(height: 6),
      Text(
        fixed(value, 0),
        style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w600),
      ),
      Text('/100', style: TextStyle(fontSize: 11, color: muted)),
    ],
  );
}

class _StanceCard extends StatelessWidget {
  const _StanceCard(this.label, this.data);
  final String label;
  final Json data;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(13),
    decoration: BoxDecoration(
      border: Border(left: BorderSide(color: _stanceTone(data), width: 2)),
      color: _stanceTone(data).withValues(alpha: .04),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(tr(context, label), style: TextStyle(fontSize: 12, color: muted)),
        const SizedBox(height: 7),
        Text(
          tr(context, str(data['action'])),
          style: TextStyle(
            fontSize: 18,
            color: _stanceTone(data),
            fontWeight: FontWeight.w600,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 7),
        Text(
          tr(context, str(data['reason'])),
          style: const TextStyle(fontSize: 14, height: 1.7),
        ),
      ],
    ),
  );
}

class DecisionDetails extends StatefulWidget {
  const DecisionDetails(this.analysis, {super.key});
  final Json analysis;
  @override
  State<DecisionDetails> createState() => _DecisionDetailsState();
}

class _DecisionDetailsState extends State<DecisionDetails> {
  String selected = '';
  @override
  Widget build(BuildContext context) {
    final a = widget.analysis,
        s = obj(a['strategy']),
        p = obj(s['plan']),
        r = obj(a['review']),
        metrics = obj(p['metrics']),
        episodes = rows(s['episodes']);
    final matching = episodes.where((e) => obj(e['setup'])['date'] == selected);
    final episode = matching.isNotEmpty ? matching.first : episodes.lastOrNull,
        setup = obj(episode?['setup']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (rows(p['patternEvidence'])
            .where((m) => m['chartVisible'] != false)
            .isNotEmpty)
          Panel(
            child: OpenSection(
              title: Text(tr(context, '当前形态与操作依据')),
              children: [
                Text(tr(context, str(obj(p['flat'])['reason']))),
                for (final mark in rows(
                  p['patternEvidence'],
                ).where((m) => m['chartVisible'] != false).take(4))
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          str(mark['label']),
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 6),
                        Text(str(mark['detail'])),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        if (rows(a['patternCoverage']).isNotEmpty)
          Panel(
            child: OpenSection(
              title: Text(tr(context, '指南形态覆盖与数据条件')),
              children: [
                for (final group in rows(a['patternCoverage']))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          '${tr(context, str(group['group']))} · §${group['chapter']}',
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 7),
                        Text(
                          (group['items'] as List? ?? [])
                              .map((s) => tr(context, str(s)))
                              .join(' · '),
                          style: const TextStyle(fontSize: 13, height: 1.8),
                        ),
                        Text(
                          tr(context, str(group['requirement'])),
                          style: TextStyle(
                            fontSize: 12,
                            height: 1.7,
                            color: muted,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        if (metrics.isNotEmpty)
          Panel(
            child: OpenSection(
              title: Text(tr(context, str(metrics['volumeLabel']))),
              children: [
                Text(
                  tr(context, str(metrics['volumeDetail'])),
                  style: const TextStyle(fontSize: 14, height: 1.7),
                ),
                const SizedBox(height: 10),
                Text(
                  '${tr(context, '相对20日均量')} ${fixed(metrics['volume20'])}× · ${tr(context, '相对启动日量')} ${fixed(metrics['volumeLaunch'])}×',
                  style: TextStyle(fontSize: 12, color: muted, height: 1.6),
                ),
              ],
            ),
          ),
        if (r.isNotEmpty) ...[
          for (final e in rows(r['evidence']))
            Panel(
              padding: const EdgeInsets.all(15),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          tr(context, str(e['label'])),
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      Text(
                        e['score'] == null
                            ? tr(
                                context,
                                e['status'] == 'missing' ? '缺失' : '待核验',
                              )
                            : '${e['score']}/${e['weight']}',
                        style: TextStyle(
                          fontSize: 12,
                          color: e['direction'] == 'bullish'
                              ? up
                              : e['direction'] == 'bearish'
                              ? down
                              : muted,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    tr(context, str(e['detail'])),
                    style: const TextStyle(fontSize: 14, height: 1.7),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${tr(context, str(e['source']))} · ${str(e['asOf'])}',
                    style: TextStyle(fontSize: 11, color: muted, height: 1.6),
                  ),
                ],
              ),
            ),
          for (final pair in [
            ('买入前需要什么', 'buyConditions'),
            ('什么时候优先卖出 / 风控', 'sellConditions'),
          ])
            Panel(
              child: OpenSection(
                title: Text(tr(context, pair.$1)),
                children: [
                  for (final text in (r[pair.$2] as List? ?? []))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: Text(
                        tr(context, '$text'),
                        style: const TextStyle(fontSize: 14, height: 1.7),
                      ),
                    ),
                ],
              ),
            ),
        ],
        Panel(
          child: OpenSection(
            title: Text(tr(context, '启动后 · 10日连续观察')),
            children: [
              if (episodes.isNotEmpty)
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (final e in episodes)
                        Padding(
                          padding: const EdgeInsets.only(right: 7),
                          child: ChoiceChip(
                            label: Text(str(obj(e['setup'])['date'])),
                            selected: setup['date'] == obj(e['setup'])['date'],
                            onSelected: (_) => setState(
                              () => selected = str(obj(e['setup'])['date']),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              const SizedBox(height: 12),
              if (episode == null)
                Text(tr(context, '当前没有可跟踪的近期启动，继续观察新证据。'))
              else ...[
                Text(
                  '${str(setup['date'])} · ${rows(episode['follow']).length}/10 ${tr(context, '根已收盘后续日线')}',
                  style: const TextStyle(fontSize: 14),
                ),
                if (episode['failedAt'] != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 7),
                    child: Text(
                      '${tr(context, '本段计划失效于')} ${episode['failedAt']}',
                      style: TextStyle(color: down, fontSize: 13),
                    ),
                  ),
                for (final f in rows(episode['follow']))
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Text(
                              'D${f['day']} · ${f['date']}',
                              style: const TextStyle(fontSize: 13),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                tr(context, str(f['state'])),
                                textAlign: TextAlign.right,
                                style: TextStyle(
                                  fontSize: 13,
                                  color: f['supportHeld'] == true ? ink : down,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          '${tr(context, '相对20日量')} ${fixed(f['volume20'])}× · ${tr(context, '启动量')} ${fixed(f['volumeLaunch'])}× · ${tr(context, '离散')} ${fixed(f['adhesion'])}%',
                          style: TextStyle(
                            fontSize: 11,
                            color: muted,
                            height: 1.6,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
              const SizedBox(height: 10),
              Text(
                tr(context, '十日观察不是到期买入或永久淘汰；失效后新的放量修复建立新计划，今天未收盘时不计入已完成天数。'),
                style: TextStyle(fontSize: 12, color: muted, height: 1.7),
              ),
            ],
          ),
        ),
        if (rows(a['patternMarks']).isNotEmpty)
          Panel(
            child: OpenSection(
              title: Text(tr(context, '近期形态标注')),
              children: [
                for (final mark in rows(a['patternMarks']).reversed.take(10))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 13),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          '${mark['time']} · ${tr(context, str(mark['label']))}${mark['provisional'] == true ? ' · ${tr(context, '待收盘')}' : ''}',
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          tr(context, str(mark['detail'])),
                          style: TextStyle(
                            fontSize: 12,
                            color: muted,
                            height: 1.6,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        Panel(
          child: OpenSection(
            title: Text(tr(context, '阶段演变 · 保留历史失效记录')),
            children: [
              for (final item in rows(s['timeline']).reversed.take(10))
                Padding(
                  padding: const EdgeInsets.only(bottom: 15),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        '${item['date']} · ${tr(context, str(item['label']))}',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        tr(context, str(item['reason'])),
                        style: TextStyle(
                          fontSize: 12,
                          color: muted,
                          height: 1.7,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
