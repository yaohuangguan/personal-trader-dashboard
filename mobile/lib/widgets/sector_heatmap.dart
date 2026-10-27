import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/api.dart';
import 'common.dart';

/// Balanced binary treemap. Weights are clamped to keep every cell tappable.
List<Rect> heatRects(List<double> weights, Rect bounds) {
  final out = List<Rect>.filled(weights.length, Rect.zero);
  void split(int start, int end, Rect box) {
    if (end - start == 1) {
      out[start] = box;
      return;
    }
    final total = weights.sublist(start, end).fold<double>(0, (a, b) => a + b);
    var cumulative = 0.0, sum = 0.0, best = double.infinity;
    var middle = start + 1;
    for (var i = start; i < end - 1; i++) {
      cumulative += weights[i];
      final distance = (cumulative - total / 2).abs();
      if (distance < best) {
        best = distance;
        sum = cumulative;
        middle = i + 1;
      }
    }
    final minimum = math.min(.5, 48 / math.max(box.width, box.height));
    final ratio = (sum / total).clamp(minimum, 1 - minimum);
    if (box.width > box.height) {
      final width = box.width * ratio;
      split(start, middle, Rect.fromLTWH(box.left, box.top, width, box.height));
      split(
        middle,
        end,
        Rect.fromLTWH(box.left + width, box.top, box.width - width, box.height),
      );
    } else {
      final height = box.height * ratio;
      split(start, middle, Rect.fromLTWH(box.left, box.top, box.width, height));
      split(
        middle,
        end,
        Rect.fromLTWH(
          box.left,
          box.top + height,
          box.width,
          box.height - height,
        ),
      );
    }
  }

  if (weights.isNotEmpty) split(0, weights.length, bounds);
  return out;
}

class SectorHeatmap extends StatelessWidget {
  const SectorHeatmap(
    this.items, {
    super.key,
    required this.onSelect,
    this.height = 460,
  });
  final List<Json> items;
  final ValueChanged<Json> onSelect;
  final double height;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final amounts = items
          .map((s) => math.sqrt(math.max(1, numOf(s['amount']) ?? 1)))
          .toList();
      final base = amounts.isEmpty
          ? 1.0
          : amounts.reduce((a, b) => a + b) / amounts.length;
      final weights = amounts
          .map((n) => (n / base).clamp(.6, 1.6).toDouble())
          .toList();
      final rects = heatRects(
        weights,
        Rect.fromLTWH(0, 0, box.maxWidth, height),
      );
      return SizedBox(
        height: height,
        child: Stack(
          children: [
            for (var i = 0; i < items.length; i++)
              Positioned.fromRect(
                rect: rects[i].deflate(2),
                child: _Cell(items[i], onTap: () => onSelect(items[i])),
              ),
          ],
        ),
      );
    },
  );
}

class _Cell extends StatelessWidget {
  const _Cell(this.item, {required this.onTap});
  final Json item;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final change = numOf(item['changePercent']) ?? 0,
        color = change > 0
            ? up
            : change < 0
            ? down
            : muted;
    return Semantics(
      button: true,
      label: '${item['name']} ${percent(item['changePercent'])}',
      child: Material(
        color: Color.alphaBlend(
          color.withValues(alpha: (.09 + change.abs() * .065).clamp(.09, .38)),
          surface,
        ),
        borderRadius: BorderRadius.circular(7),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: LayoutBuilder(
            builder: (ctx, c) => Padding(
              padding: const EdgeInsets.all(8),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    str(item['name']),
                    textAlign: TextAlign.center,
                    maxLines: c.maxHeight > 92 ? 2 : 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: c.maxWidth > 120 ? 15 : 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    percent(change),
                    style: TextStyle(
                      fontSize: c.maxWidth > 120 ? 19 : 15,
                      fontWeight: FontWeight.w600,
                      color: color,
                    ),
                  ),
                  if (c.maxHeight > 115 && c.maxWidth > 100) ...[
                    const SizedBox(height: 5),
                    Text(
                      amount(item['amount']),
                      style: TextStyle(fontSize: 11, color: muted),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
