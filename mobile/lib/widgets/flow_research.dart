import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';
import 'common.dart';

/// Each source loads independently; an unavailable four-bucket feed cannot hide history.
class FlowResearch extends StatelessWidget {
  const FlowResearch(this.symbol, {super.key});
  final String symbol;
  @override
  Widget build(BuildContext context) {
    final s = context.read<AtlasStore>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          s.t('资金面'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 14),
        AsyncPanel(
          key: ValueKey('$symbol-flow-history'),
          refreshSeconds: 300,
          load: () => s.api.get(
            '/api/desk/flow-history',
            parameters: {'symbol': symbol},
          ),
          builder: (r) {
            final points = rows(r['points']);
            final last = points.lastOrNull ?? {};
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  '${s.t('日度资金趋势')} · ${str(last['time'])}',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 12),
                LayoutBuilder(
                  builder: (context, box) => Wrap(
                    spacing: 10,
                    runSpacing: 12,
                    children: [
                      for (final days in [1, 5, 10, 20])
                        SizedBox(
                          width: (box.maxWidth - 10) / 2,
                          child: Builder(
                            builder: (context) {
                              final window = points
                                  .skip(
                                    (points.length - days).clamp(
                                      0,
                                      points.length,
                                    ),
                                  )
                                  .toList();
                              final complete =
                                  window.length == days &&
                                  window.every((p) => numOf(p['main']) != null);
                              final value = complete
                                  ? window.fold<double>(
                                      0,
                                      (n, p) => n + numOf(p['main'])!,
                                    )
                                  : null;
                              return LabelValue(
                                '${days == 1 ? s.t('最近交易日') : '$days${s.t('日累计')}'} · ${s.t('主力净额')}',
                                amount(value),
                                color: tone(value),
                              );
                            },
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  height: 120,
                  child: CustomPaint(painter: _FlowBars(points, up, down)),
                ),
                Text(
                  '${str(points.firstOrNull?['time'])} — ${str(last['time'])} · ${points.length}${s.t('个交易日')}',
                  style: TextStyle(color: muted, fontSize: 13),
                ),
                const SizedBox(height: 14),
                SizedBox(
                  height: 280,
                  child: SingleChildScrollView(
                    child: DataTableView(
                      columns: ['交易日', '主力净额', '全部净额', '主力净额占比'],
                      data: points.reversed
                          .map(
                            (p) => [
                              str(p['time']),
                              amount(p['main']),
                              amount(p['totalNet']),
                              p['mainRatio'] == null
                                  ? '—'
                                  : '${fixed(p['mainRatio'])}%',
                            ],
                          )
                          .toList(),
                    ),
                  ),
                ),
                SourceLine(r),
                if (r['notice'] != null) Notice(str(r['notice'])),
              ],
            );
          },
        ),
        const Divider(height: 32),
        Text(
          s.t('分单资金统计'),
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
        AsyncPanel(
          key: ValueKey('$symbol-flow-current'),
          refreshSeconds: 60,
          load: () =>
              s.api.get('/api/desk/flow', parameters: {'symbol': symbol}),
          builder: (r) {
            final last = rows(r['points']).lastOrNull ?? {};
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final e in {
                  'main': str(r['mainLabel'], '主力净额'),
                  'superLarge': '超大单',
                  'large': '大单',
                  'medium': '中单',
                  'small': '小单',
                }.entries)
                  if (numOf(last[e.key]) != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 9),
                      child: Row(
                        children: [
                          Expanded(child: Text(s.t(e.value))),
                          Text(
                            amount(last[e.key]),
                            style: TextStyle(
                              color: tone(last[e.key]),
                              fontSize: 19,
                            ),
                          ),
                        ],
                      ),
                    ),
                if (last['superLarge'] == null)
                  Notice(s.t('当前来源未提供完整四档；下方成交样本单独统计，不用零值填补。')),
                SourceLine(r, extra: str(last['time'])),
                if (r['notice'] != null) Notice(str(r['notice'])),
              ],
            );
          },
        ),
        const Divider(height: 32),
        Text(
          s.t('暗盘／拆单特征观察 · 模型估算'),
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
        AsyncPanel(
          key: ValueKey('$symbol-flow-observation'),
          refreshSeconds: 60,
          load: () => s.api.get(
            '/api/desk/flow-observation',
            parameters: {'symbol': symbol},
          ),
          builder: (r) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                str(r['label']),
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: r['stance'] == 'positive'
                      ? up
                      : r['stance'] == 'negative'
                      ? down
                      : null,
                ),
              ),
              Notice(str(r['explanation'])),
              Text(
                '${str(r['date'])} ${str(r['start'])}–${str(r['end'])}',
                style: const TextStyle(fontSize: 14),
              ),
              const SizedBox(height: 8),
              Text(
                '${str(r['count'])}${s.t('条聚合分笔')} · ${s.t('样本成交额')} ${amount(r['amount'])} · ${s.t('占当日')} ${r['coverage'] == null ? '—' : '${(numOf(r['coverage'])! * 100).toStringAsFixed(1)}%'}',
                style: TextStyle(color: muted, fontSize: 14),
              ),
              DataTableView(
                columns: ['聚合单额', '主动买额', '主动卖额', '样本净额'],
                data: rows(r['buckets'])
                    .map(
                      (p) => [
                        str(p['name']),
                        amount(p['buy']),
                        amount(p['sell']),
                        amount(
                          (numOf(p['buy']) ?? 0) - (numOf(p['sell']) ?? 0),
                        ),
                      ],
                    )
                    .toList(),
              ),
              const SizedBox(height: 14),
              Text(
                s.t('疑似连续小额同向成交'),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (rows(r['clusters']).isEmpty)
                Notice(s.t('当前样本未发现满足阈值的连续同向小额成交；不代表没有拆单。'))
              else
                SizedBox(
                  height: 200,
                  child: SingleChildScrollView(
                    child: DataTableView(
                      columns: ['时段', '主动方向', '聚合条数', '累计成交额'],
                      data: rows(r['clusters'])
                          .map(
                            (p) => [
                              '${p['start']}–${p['end']}',
                              s.t(p['side'] == 'B' ? '买入方向' : '卖出方向'),
                              str(p['count']),
                              amount(p['amount']),
                            ],
                          )
                          .toList(),
                    ),
                  ),
                ),
              Notice(str(r['methodology'])),
              SourceLine(r),
              Notice(str(r['notice'])),
            ],
          ),
        ),
      ],
    );
  }
}

class _FlowBars extends CustomPainter {
  _FlowBars(this.points, this.positive, this.negative);
  final List<Json> points;
  final Color positive, negative;
  @override
  void paint(Canvas canvas, Size size) {
    if (points.isEmpty) return;
    final scale = points.fold<double>(
      1,
      (n, p) =>
          (numOf(p['main']) ?? 0).abs() > n ? (numOf(p['main']) ?? 0).abs() : n,
    );
    final step = size.width / points.length;
    for (var i = 0; i < points.length; i++) {
      final v = numOf(points[i]['main']) ?? 0,
          h = v.abs() / scale * size.height * .46;
      canvas.drawRect(
        Rect.fromLTWH(
          i * step + 1,
          v >= 0 ? size.height / 2 - h : size.height / 2,
          (step - 2).clamp(1, step),
          h,
        ),
        Paint()..color = v >= 0 ? positive : negative,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _FlowBars oldDelegate) =>
      oldDelegate.points != points ||
      oldDelegate.positive != positive ||
      oldDelegate.negative != negative;
}
