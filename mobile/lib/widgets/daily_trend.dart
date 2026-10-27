import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/store.dart';

import '../core/api.dart';
import 'common.dart';

class DailyTrendPanel extends StatelessWidget {
  const DailyTrendPanel(this.data, {super.key, this.error});
  final Json? data;
  final String? error;
  @override
  Widget build(BuildContext context) {
    final english = context.watch<AtlasStore>().locale == 'en';
    final r = data;
    if (r == null) return Notice(error ?? tr(context, '正在读取走势分析…'));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              fixed(r['score'], 0),
              style: const TextStyle(fontSize: 42, fontWeight: FontWeight.w600),
            ),
            Text(' / 100', style: TextStyle(fontSize: 14, color: muted)),
            const Spacer(),
            Text(
              tr(context, str(r['label'])),
              style: const TextStyle(fontSize: 20),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          '${r['date'] ?? '—'} · ${tr(context, r['current'] == true
              ? r['provisional'] == true
                    ? '盘中暂评'
                    : '收盘复盘'
              : '历史快照')} · ${tr(context, '依据覆盖')} ${r['coveredWeight'] ?? 0}/100',
          style: TextStyle(fontSize: 13, color: muted),
        ),
        const SizedBox(height: 16),
        if (error != null) Notice(error!),
        ...((r[english ? 'observationsEn' : 'observations'] as List?) ?? [])
            .map(
              (v) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Text(
                  tr(context, '$v'),
                  style: const TextStyle(fontSize: 16, height: 1.6),
                ),
              ),
            ),
        if (r['operation'] != null) ...[
          const Divider(height: 24),
          Text(
            '${tr(context, '五线操作建议')} · ${tr(context, str(obj(r['operation'])['action']))}',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
          ),
          Text(
            '${str(obj(r['operation'])['asOf'])} · ${tr(context, '当日强弱分结合形态与股性核验')}',
            style: TextStyle(fontSize: 12, color: muted),
          ),
          ...((obj(r['operation'])['reasons'] as List?) ?? []).map(
            (v) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Text(
                tr(context, '$v'),
                style: const TextStyle(fontSize: 15, height: 1.6),
              ),
            ),
          ),
        ],
        const Divider(height: 24),
        for (final d in rows(r['dimensions']))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${tr(context, str(d['key']))} · ${d['weight']}%',
                    style: const TextStyle(fontSize: 14),
                  ),
                ),
                Text(
                  d['score'] == null
                      ? tr(context, '未计分')
                      : '${fixed(d['value'])}${d['unit']} · ${fixed(d['score'], 0)}',
                  style: TextStyle(fontSize: 13, color: muted),
                ),
              ],
            ),
          ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 24,
          runSpacing: 16,
          children: [
            LabelValue('日内支撑参考', fixed(obj(r['levels'])['support'])),
            LabelValue('日内压力参考', fixed(obj(r['levels'])['resistance'])),
            LabelValue('分时均价', fixed(obj(r['levels'])['vwap'])),
          ],
        ),
        const SizedBox(height: 18),
        ...((r[english ? 'risksEn' : 'risks'] as List?) ?? []).map(
          (v) => Notice(tr(context, '$v')),
        ),
        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          title: Text(tr(context, '评分计算口径')),
          children: [
            Text(
              tr(context, str(r['method'])),
              style: const TextStyle(fontSize: 14, height: 1.6),
            ),
          ],
        ),
        SourceLine(r),
      ],
    );
  }
}
