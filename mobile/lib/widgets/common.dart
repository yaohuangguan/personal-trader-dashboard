import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';

export '../core/palette.dart';
import '../core/palette.dart';

Color tone(dynamic value) => numOf(value) == null
    ? muted
    : numOf(value)! >= 0
    ? up
    : down;
String tr(BuildContext c, String key) => c.read<AtlasStore>().t(key);

class Panel extends StatelessWidget {
  const Panel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(12),
  });
  final Widget child;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Material(
      color: surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: atlasColor(0xff34343c)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(padding: padding, child: child),
    ),
  );
}

class LabelValue extends StatelessWidget {
  const LabelValue(this.label, this.value, {super.key, this.color});
  final String label, value;
  final Color? color;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        tr(context, label),
        style: Theme.of(context).textTheme.labelMedium?.copyWith(color: muted),
      ),
      const SizedBox(height: 6),
      Text(
        value,
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: color,
          fontSize: 17,
        ),
      ),
    ],
  );
}

class AsyncPanel extends StatefulWidget {
  const AsyncPanel({
    super.key,
    required this.load,
    required this.builder,
    this.empty,
    this.refreshSeconds = 0,
  });
  final Future<Json> Function() load;
  final Widget Function(Json data) builder;
  final String? empty;
  final int refreshSeconds;
  @override
  State<AsyncPanel> createState() => AsyncPanelState();
}

class AsyncPanelState extends State<AsyncPanel> {
  Timer? timer;
  DateTime lastRead = DateTime.now();
  Json? data;
  Object? error;
  bool loading = true;
  int revision = 0;
  @override
  void initState() {
    super.initState();
    refresh();
    timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (widget.refreshSeconds > 0 &&
          DateTime.now().difference(lastRead).inSeconds >=
              widget.refreshSeconds &&
          !loading &&
          mounted &&
          context.read<AtlasStore>().foreground &&
          (ModalRoute.of(context)?.isCurrent ?? true)) {
        refresh();
      }
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant AsyncPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.key != widget.key) refresh();
  }

  Future<void> refresh() async {
    lastRead = DateTime.now();
    final id = ++revision;
    setState(() => loading = true);
    try {
      final value = await widget.load();
      if (!mounted || id != revision) return;
      setState(() {
        data = value;
        error = null;
        loading = false;
      });
    } catch (e) {
      if (!mounted || id != revision) return;
      setState(() {
        error = e;
        loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (data == null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            if (loading)
              const CircularProgressIndicator(strokeWidth: 2)
            else
              Icon(Icons.cloud_off, color: muted),
            const SizedBox(height: 14),
            Text(
              loading ? tr(context, '正在连接数据源…') : tr(context, error.toString()),
              textAlign: TextAlign.center,
            ),
            if (!loading)
              TextButton.icon(
                onPressed: refresh,
                icon: const Icon(Icons.refresh),
                label: Text(tr(context, '重试数据源')),
              ),
          ],
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (error != null) Notice('${tr(context, '刷新失败，保留上一快照')} · $error'),
        widget.builder(data!),
        TextButton.icon(
          onPressed: loading ? null : refresh,
          icon: const Icon(Icons.refresh, size: 18),
          label: Text(tr(context, loading ? '正在读取' : '刷新数据')),
        ),
      ],
    );
  }
}

class Notice extends StatelessWidget {
  const Notice(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(12),
    margin: const EdgeInsets.only(bottom: 12),
    decoration: BoxDecoration(
      color: atlasColor(0xff23232b),
      border: Border.all(color: atlasColor(0xff4b4b59)),
      borderRadius: BorderRadius.circular(7),
    ),
    child: Text(
      text,
      style: TextStyle(color: muted, fontSize: 14, height: 1.6),
    ),
  );
}

class SourceLine extends StatelessWidget {
  const SourceLine(this.data, {super.key, this.extra});
  final Json data;
  final String? extra;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Text(
      [
        str(data['source'] ?? data['provider'], ''),
        str(data['date'] ?? data['asOf'] ?? data['fetchedAt'], ''),
        ?extra,
      ].where((s) => s.isNotEmpty).join(' · '),
      style: TextStyle(color: muted, fontSize: 13, height: 1.6),
    ),
  );
}

class Chips extends StatelessWidget {
  const Chips({
    super.key,
    required this.values,
    required this.selected,
    required this.onSelected,
  });
  final Map<String, String> values;
  final String selected;
  final ValueChanged<String> onSelected;
  @override
  Widget build(BuildContext context) => SizedBox(
    height: 38,
    child: SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: values.entries
            .map(
              (e) => InkWell(
                onTap: () => onSelected(e.key),
                child: Container(
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: 13),
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        color: selected == e.key ? ink : Colors.transparent,
                        width: 1.5,
                      ),
                    ),
                  ),
                  child: Text(
                    tr(context, e.value),
                    style: TextStyle(
                      fontSize: 14,
                      height: 1,
                      color: selected == e.key ? ink : muted,
                      fontWeight: selected == e.key
                          ? FontWeight.w600
                          : FontWeight.normal,
                    ),
                  ),
                ),
              ),
            )
            .toList(),
      ),
    ),
  );
}

class DataTableView extends StatelessWidget {
  const DataTableView({super.key, required this.columns, required this.data});
  final List<String> columns;
  final List<List<String>> data;
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: DataTable(
      columns: columns
          .map((c) => DataColumn(label: Text(tr(context, c))))
          .toList(),
      rows: data
          .map((r) => DataRow(cells: r.map((v) => DataCell(Text(v))).toList()))
          .toList(),
    ),
  );
}

class PageTitle extends StatelessWidget {
  const PageTitle(this.title, this.subtitle, {super.key, this.trailing});
  final String title, subtitle;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => SizedBox(
    height: 42,
    child: Row(
      children: [
        Expanded(
          child: Text(
            tr(context, title),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
          ),
        ),
        if (subtitle.isNotEmpty)
          IconButton(
            tooltip: tr(context, subtitle),
            onPressed: () => showModalBottomSheet(
              context: context,
              useSafeArea: true,
              builder: (ctx) => Padding(
                padding: const EdgeInsets.all(22),
                child: Text(
                  tr(context, subtitle),
                  style: const TextStyle(fontSize: 16, height: 1.7),
                ),
              ),
            ),
            icon: Icon(Icons.info_outline, size: 17, color: muted),
          ),
        ?trailing,
      ],
    ),
  );
}

class PeriodSelector extends StatelessWidget {
  const PeriodSelector({
    super.key,
    required this.value,
    required this.onChanged,
  });
  final String value;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => SizedBox(
    height: 36,
    child: Row(
      children: [
        for (final pair in [
          ('intraday', '分时'),
          ('day', '日 K'),
          ('week', '周 K'),
          ('month', '月 K'),
        ])
          Expanded(
            child: InkWell(
              onTap: () => onChanged(pair.$1),
              child: Container(
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      width: 2,
                      color: value == pair.$1 ? up : Colors.transparent,
                    ),
                  ),
                ),
                child: Text(
                  tr(context, pair.$2),
                  style: TextStyle(
                    fontSize: 14,
                    color: value == pair.$1 ? ink : muted,
                  ),
                ),
              ),
            ),
          ),
        Expanded(
          child: PopupMenuButton<String>(
            tooltip: tr(context, '分钟周期'),
            onSelected: onChanged,
            itemBuilder: (ctx) => [
              for (final n in [5, 15, 30, 60, 120])
                PopupMenuItem(value: 'm$n', child: Text('$n ${tr(ctx, '分钟')}')),
            ],
            child: Container(
              alignment: Alignment.center,
              child: Text(
                value.startsWith('m') && value != 'month'
                    ? '${value.substring(1)}m ▾'
                    : '${tr(context, '周期')} ▾',
                style: const TextStyle(fontSize: 14),
              ),
            ),
          ),
        ),
      ],
    ),
  );
}
