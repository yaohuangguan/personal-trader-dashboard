import 'package:flutter/material.dart';

import '../core/api.dart';
import 'common.dart';

class LiveAlertsPanel extends StatelessWidget {
  const LiveAlertsPanel(this.alerts, {super.key});
  final List<Json> alerts;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        tr(context, '盘中动态观察'),
        style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
      ),
      Text(
        tr(context, '随量价变化更新，待收盘核验；历史确认形态保留在K线上。'),
        style: TextStyle(color: muted, fontSize: 12),
      ),
      if (alerts.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Text(tr(context, '当前无新增盘中预警')),
        ),
      for (final a in alerts)
        Container(
          margin: const EdgeInsets.only(top: 12),
          padding: const EdgeInsets.only(left: 10),
          decoration: BoxDecoration(
            border: Border(
              left: BorderSide(
                width: 2,
                color: a['direction'] == 'bullish'
                    ? up
                    : a['direction'] == 'bearish'
                    ? down
                    : muted,
              ),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                str(a['title']),
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: a['direction'] == 'bullish'
                      ? up
                      : a['direction'] == 'bearish'
                      ? down
                      : ink,
                ),
              ),
              const SizedBox(height: 5),
              Text(
                str(a['detail']),
                style: const TextStyle(fontSize: 14, height: 1.6),
              ),
            ],
          ),
        ),
    ],
  );
}
