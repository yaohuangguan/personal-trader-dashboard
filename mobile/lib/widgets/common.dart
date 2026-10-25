import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/store.dart';

const up = Color(0xffee5b67),
    down = Color(0xff38b59c),
    surface = Color(0xff141417),
    muted = Color(0xffa4a4b2);
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
    this.padding = const EdgeInsets.all(18),
  });
  final Widget child;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Material(
      color: surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Color(0xff34343c)),
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
              const Icon(Icons.cloud_off, color: muted),
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
      color: const Color(0xff23232b),
      border: Border.all(color: const Color(0xff4b4b59)),
      borderRadius: BorderRadius.circular(7),
    ),
    child: Text(
      text,
      style: const TextStyle(color: muted, fontSize: 14, height: 1.6),
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
      style: const TextStyle(color: muted, fontSize: 13, height: 1.6),
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
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(
      children: values.entries
          .map(
            (e) => Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                selected: selected == e.key,
                label: Text(tr(context, e.value)),
                onSelected: (_) => onSelected(e.key),
              ),
            ),
          )
          .toList(),
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
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 12, bottom: 22),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                tr(context, title),
                style: Theme.of(context).textTheme.headlineSmall
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                tr(context, subtitle),
                style: const TextStyle(color: muted, height: 1.6),
              ),
            ],
          ),
        ),
        ?trailing,
      ],
    ),
  );
}
