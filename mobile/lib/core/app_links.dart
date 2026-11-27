import 'dart:async';

import 'package:flutter/widgets.dart';

import 'api.dart';

/// Destinations reachable from a push payload, a `guanlan://` link or a
/// shared https link.
enum AppLinkKind { stock, share, article, view }

class AppLink {
  const AppLink(this.kind, this.value, this.raw);
  final AppLinkKind kind;

  /// Symbol, share id, view name, or (for articles) the full link.
  final String value;
  final String raw;

  static const views = {
    'watch': 0,
    'market': 1,
    'screener': 2,
    'signals': 3,
    'news': 4,
  };
  static const hosts = {'guanlan.nzs.workers.dev'};

  /// Accepts `guanlan://stock/600519.SH`, `guanlan://stock?symbol=…`,
  /// `guanlan://n/<id>`, `guanlan://signals`, `guanlan://open?article=…`,
  /// the same paths on the https site (`/n/<id>`, `/?symbol=…`,
  /// `/?view=signals`, `/?article=…`) and path-only push payloads.
  static AppLink? parse(String raw) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null) return null;
    final List<String> segments;
    if (uri.scheme == 'guanlan') {
      segments = [
        if (uri.host.isNotEmpty) uri.host,
        ...uri.pathSegments.where((s) => s.isNotEmpty),
      ];
    } else if (uri.scheme.isEmpty ||
        (const {'http', 'https'}.contains(uri.scheme) &&
            (hosts.contains(uri.host) ||
                uri.host == Uri.tryParse(_base)?.host))) {
      segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
    } else {
      return null;
    }
    final query = uri.queryParameters, first = segments.firstOrNull ?? '';
    if (first == 'n' &&
        segments.length > 1 &&
        RegExp(r'^[A-Za-z0-9_-]{16}$').hasMatch(segments[1])) {
      return AppLink(AppLinkKind.share, segments[1], raw);
    }
    if (query['article'] != null) {
      return AppLink(AppLinkKind.article, raw, raw);
    }
    final symbol =
        query['symbol'] ??
        (first == 'stock' && segments.length > 1 ? segments[1] : null);
    if (symbol != null && symbol.trim().isNotEmpty) {
      return AppLink(AppLinkKind.stock, normalize(symbol), raw);
    }
    final view = query['view'] ?? first;
    if (views.containsKey(view)) return AppLink(AppLinkKind.view, view, raw);
    return null;
  }

  static const _base = String.fromEnvironment(
    'ATLAS_API_BASE',
    defaultValue: 'https://guanlan.nzs.workers.dev',
  );
}

/// Receives links the iOS embedder pushes (FlutterDeepLinkingEnabled). It is
/// registered before runApp so it answers before WidgetsApp, which would try
/// to push the link as a named route.
class AppLinkObserver with WidgetsBindingObserver {
  AppLinkObserver({String? initial})
    : initial = initial == null || initial == '/' || initial.isEmpty
          ? null
          : initial;

  /// The cold-start link (PlatformDispatcher.defaultRouteName).
  final String? initial;
  final _links = StreamController<String>.broadcast();
  Stream<String> get links => _links.stream;

  @override
  Future<bool> didPushRouteInformation(RouteInformation routeInformation) {
    final link = routeInformation.uri.toString();
    // Unknown links are swallowed too: there are no named routes to push.
    if (AppLink.parse(link) != null && !_links.isClosed) _links.add(link);
    return Future.value(true);
  }

  void dispose() => _links.close();
}
