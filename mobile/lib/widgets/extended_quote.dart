import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/extended_quotes.dart';
import '../core/store.dart';
import 'common.dart';

class ExtendedQuoteLine extends StatefulWidget {
  const ExtendedQuoteLine(this.symbol, {super.key});
  final String symbol;
  @override
  State<ExtendedQuoteLine> createState() => _ExtendedQuoteLineState();
}

class _ExtendedQuoteLineState extends State<ExtendedQuoteLine> {
  Json? data;
  Timer? timer;
  bool failed = false, loading = false;
  @override
  void initState() {
    super.initState();
    data = context.read<AtlasStore>().extendedQuotes.values[widget.symbol];
    load();
    timer = Timer.periodic(const Duration(seconds: 60), (_) {
      if (context.read<AtlasStore>().foreground &&
          (ModalRoute.of(context)?.isCurrent ?? true)) {
        load();
      }
    });
  }

  @override
  void didUpdateWidget(covariant ExtendedQuoteLine oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.symbol != widget.symbol) {
      data = context.read<AtlasStore>().extendedQuotes.values[widget.symbol];
      failed = false;
      load();
    }
  }

  Future<void> load() async {
    final symbol = widget.symbol;
    loading = true;
    try {
      final result = await context.read<AtlasStore>().extendedQuotes.load(
        symbol,
      );
      if (mounted && widget.symbol == symbol) {
        setState(() {
          data = result;
          failed = false;
        });
      }
    } catch (_) {
      if (mounted && widget.symbol == symbol) setState(() => failed = true);
    } finally {
      if (mounted && widget.symbol == symbol) setState(() => loading = false);
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(), q = obj(data?['current']);
    final session = str(q['session'] ?? data?['activeSession'], '');
    if (data != null && q.isEmpty && session.isEmpty) {
      return const SizedBox.shrink();
    }
    final label = s.t(extendedLabels[session] ?? '盘前 / 盘后 / 24h');
    final at = DateTime.tryParse(str(q['asOf'], ''));
    final stale =
        failed ||
        q['stale'] == true ||
        at == null ||
        DateTime.now().difference(at).inMinutes > 20;
    final text = q.isEmpty
        ? '$label  ${s.t(failed
              ? '暂不可用'
              : loading
              ? '加载中…'
              : '暂无报价')}'
        : '$label  ${fixed(q['price'])}  ${percent(q['changePercent'])}${stale ? '  ${s.t('待更新')}' : ''}';
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Align(
        alignment: Alignment.centerRight,
        child: Tooltip(
          message: q.isEmpty
              ? s.t('扩展时段行情')
              : '${q['source']} · ${at?.toLocal()} · ${s.t('时段涨幅基准')} ${fixed(q['reference'])} USD',
          child: FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerRight,
            child: Text.rich(
              TextSpan(
                style: TextStyle(fontSize: 12, color: muted),
                children: q.isEmpty
                    ? [TextSpan(text: text)]
                    : [
                        TextSpan(text: '$label  '),
                        TextSpan(
                          text:
                              '${fixed(q['price'])}  ${percent(q['changePercent'])}',
                          style: TextStyle(color: tone(q['changePercent'])),
                        ),
                        if (stale) TextSpan(text: '  ${s.t('待更新')}'),
                      ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
