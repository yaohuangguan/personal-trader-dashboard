import 'dart:async';

import 'package:flutter/material.dart';

import '../core/api.dart';
import 'common.dart';

/// Refreshes the visible chart without replacing it with a loading screen.
class LiveChartFeed extends StatefulWidget {
  const LiveChartFeed({
    super.key,
    required this.load,
    required this.builder,
    required this.refreshSeconds,
  });
  final Future<Json> Function() load;
  final Widget Function(Json) builder;
  final int refreshSeconds;
  @override
  State<LiveChartFeed> createState() => _LiveChartFeedState();
}

class _LiveChartFeedState extends State<LiveChartFeed> {
  Json? data;
  Object? error;
  bool loading = false, _inFlight = false;
  Timer? timer;
  @override
  void initState() {
    super.initState();
    loading = true;
    refresh();
    timer = Timer.periodic(Duration(seconds: widget.refreshSeconds), (_) {
      // Tabs stay mounted in an IndexedStack: skip offstage tabs too.
      if (mounted && visibleHere(context)) refresh();
    });
  }

  /// One rebuild per refresh: the loading flag only drives the first-load
  /// spinner, so a refresh over an existing chart does not rebuild it before
  /// and after the request.
  Future<void> refresh() async {
    if (_inFlight) return;
    _inFlight = true;
    if (data == null && !loading) setState(() => loading = true);
    try {
      final next = await widget.load();
      if (mounted) {
        setState(() {
          data = next;
          error = null;
          loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          error = e;
          loading = false;
        });
      }
    } finally {
      _inFlight = false;
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (data == null) {
      return Center(
        child: loading
            ? const CircularProgressIndicator(strokeWidth: 1.5)
            : Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '$error',
                      style: TextStyle(fontSize: 13, color: muted),
                    ),
                    TextButton(
                      onPressed: refresh,
                      child: Text(tr(context, '重试数据源')),
                    ),
                  ],
                ),
              ),
      );
    }
    return LayoutBuilder(
      builder: (context, c) => Stack(
        children: [
          SizedBox(
            width: c.maxWidth,
            height: c.maxHeight,
            child: widget.builder(data!),
          ),
          if (error != null)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Tooltip(
                message: '$error',
                child: Container(
                  color: surface,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  child: Text(
                    '${tr(context, '刷新失败，保留上一快照')} · ${str(data!['asOf'])}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 10, color: muted),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
