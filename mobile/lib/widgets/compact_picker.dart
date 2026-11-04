import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'common.dart';

/// Searchable selector that always leaves the underlying page visible.
class CompactPicker extends StatelessWidget {
  const CompactPicker({
    super.key,
    required this.label,
    required this.items,
    required this.onChanged,
    this.value,
  });
  final String label;
  final Map<String, String> items;
  final String? value;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: () async {
      var query = '';
      final selected = await showModalBottomSheet<String>(
        context: context,
        useSafeArea: true,
        isScrollControlled: true,
        constraints: BoxConstraints(
          maxWidth: 560,
          maxHeight: MediaQuery.sizeOf(context).height * .62,
        ),
        builder: (ctx) => StatefulBuilder(
          builder: (ctx, update) {
            final filtered = items.entries
                .where(
                  (e) => e.value.toLowerCase().contains(query.toLowerCase()),
                )
                .toList();
            return Padding(
              padding: EdgeInsets.fromLTRB(
                16,
                8,
                16,
                math.min(
                      MediaQuery.viewInsetsOf(ctx).bottom,
                      MediaQuery.sizeOf(ctx).height * .22,
                    ) +
                    8,
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          tr(ctx, label),
                          style: Theme.of(ctx).textTheme.titleMedium,
                        ),
                      ),
                      IconButton(
                        tooltip: tr(ctx, '关闭'),
                        onPressed: () => Navigator.pop(ctx),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                  TextField(
                    onChanged: (text) => update(() => query = text),
                    decoration: InputDecoration(
                      prefixIcon: const Icon(Icons.search),
                      hintText: tr(ctx, '搜索名称'),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Expanded(
                    child: filtered.isEmpty
                        ? Center(child: Text(tr(ctx, '暂无匹配项')))
                        : ListView.builder(
                            itemCount: filtered.length,
                            itemBuilder: (_, i) => ListTile(
                              title: Text(filtered[i].value),
                              trailing: filtered[i].key == value
                                  ? const Icon(Icons.check, size: 20)
                                  : null,
                              onTap: () => Navigator.pop(ctx, filtered[i].key),
                            ),
                          ),
                  ),
                ],
              ),
            );
          },
        ),
      );
      if (selected != null) onChanged(selected);
    },
    child: InputDecorator(
      decoration: InputDecoration(
        labelText: tr(context, label),
        border: const OutlineInputBorder(),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              items[value] ?? tr(context, '请选择'),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const Icon(Icons.expand_more),
        ],
      ),
    ),
  );
}
