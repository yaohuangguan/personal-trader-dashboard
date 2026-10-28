import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/multi_filters.dart';
import 'common.dart';

class MultiLineFilters extends StatelessWidget {
  const MultiLineFilters({
    required this.values,
    required this.onChanged,
    this.disabled = false,
    super.key,
  });
  final Json values;
  final ValueChanged<Json> onChanged;
  final bool disabled;
  @override
  Widget build(BuildContext context) {
    final f = {...multiDefaults, ...values};
    return OpenSection(
      title: Text(tr(context, '一阳多线判定条件')),
      children: [
        for (final spec in [
          (
            'multiSystem',
            '均线体系',
            {
              'either': '任一套有效',
              'classic': '经典',
              'fibonacci': '斐波那契',
              'both': '两套同时有效',
            },
          ),
          ('multiLines', '实体至少穿过', {'4': '4条核心均线', '5': '5条核心均线'}),
          ('multiDense', '线束离散上限', {'10': '10%', '5': '5%', '2': '2%'}),
          (
            'multiVolume',
            '相对20日均量至少',
            {'1.2': '1.2×', '1.5': '1.5×', '2': '2×', '3': '3×'},
          ),
          (
            'multiVolume5',
            '相对5日均量至少',
            {'0': '不限', '1': '1×', '1.5': '1.5×', '2': '2×'},
          ),
          ('multiGain', '阳线涨幅至少', {'3': '3%', '5': '5%', '9': '9%'}),
          ('multiClose', '收盘位于振幅上方', {'0.7': '30%区域', '0.9': '10%区域'}),
        ])
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: DropdownButtonFormField<String>(
              initialValue: str(f[spec.$1]),
              decoration: InputDecoration(labelText: tr(context, spec.$2)),
              items: spec.$3.entries
                  .map(
                    (e) => DropdownMenuItem(
                      value: e.key,
                      child: Text(tr(context, e.value)),
                    ),
                  )
                  .toList(),
              onChanged: disabled ? null : (v) => onChanged({...f, spec.$1: v}),
            ),
          ),
        for (final spec in [
          ('multi60', '穿线必须包含MA60或55'),
          ('multiMiddle', '密集线束位于实体中轴'),
        ])
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(
              tr(context, spec.$2),
              style: const TextStyle(fontSize: 15),
            ),
            value: f[spec.$1] == '1',
            onChanged: disabled
                ? null
                : (v) => onChanged({...f, spec.$1: v ? '1' : '0'}),
          ),
        Text(
          tr(context, '经典与斐波那契两套分别计数。普通至少实体穿四线；强力另需55或60线、密集居中、大阳倍量及收近高点。'),
          style: const TextStyle(fontSize: 12, height: 1.7),
        ),
      ],
    );
  }
}
