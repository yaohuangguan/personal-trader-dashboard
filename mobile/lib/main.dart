import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'core/app_links.dart';
import 'core/store.dart';
import 'core/screener.dart';
import 'core/push_service.dart';
import 'screens/watch.dart';
import 'screens/market.dart';
import 'screens/news.dart';
import 'screens/screener.dart';
import 'screens/signals.dart';
import 'screens/workspace.dart';
import 'screens/stock.dart';
import 'widgets/common.dart';
import 'widgets/splash.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Registered before runApp so links reach the app, not the Navigator.
  final links = AppLinkObserver(
    initial: WidgetsBinding.instance.platformDispatcher.defaultRouteName,
  );
  WidgetsBinding.instance.addObserver(links);
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  final store = await AtlasStore.load();
  final native = NativePushService(store.api, store.deviceToken);
  await native.initialize();
  runApp(AtlasApp(store: store, push: native, links: links, showSplash: true));
  store.start();
}

/// Tells iOS which appearance the app uses so system sheets (share sheet,
/// file picker, alerts) match the in-app theme; `system` follows iOS.
const _appearance = MethodChannel('space.ps6.marketAtlas/appearance');
String? _appliedAppearance;
void syncSystemAppearance(String mode) {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.iOS) return;
  if (_appliedAppearance == mode) return;
  _appliedAppearance = mode;
  _appearance.invokeMethod<void>('setStyle', mode).catchError((Object _) {
    _appliedAppearance = null;
  });
}

class AtlasApp extends StatelessWidget {
  const AtlasApp({
    super.key,
    required this.store,
    required this.push,
    this.links,
    this.showSplash = false,
  });
  final AtlasStore store;
  final NativePushService push;
  final AppLinkObserver? links;

  /// Only the real launch shows the splash; tests pump the shell directly.
  final bool showSplash;
  @override
  Widget build(BuildContext context) => MultiProvider(
    providers: [
      ChangeNotifierProvider.value(value: store),
      ChangeNotifierProvider(create: (_) => ScreenerController(store)),
      Provider.value(value: push),
      if (links != null) Provider<AppLinkObserver>.value(value: links!),
    ],
    child: Builder(
      builder: (context) {
        // Only theme, language and font size rebuild the app root.
        context.select<AtlasStore, (String, String, double)>(
          (s) => (s.themeMode, s.locale, s.fontSize),
        );
        final s = context.read<AtlasStore>();
        final light = s.themeMode == 'system'
            ? MediaQuery.platformBrightnessOf(context) == Brightness.light
            : s.themeMode == 'light';
        AtlasPalette.light = light;
        syncSystemAppearance(s.themeMode);
        final brightness = light ? Brightness.light : Brightness.dark;
        final overlay = light
            ? SystemUiOverlayStyle.dark
            : SystemUiOverlayStyle.light;
        final base = ThemeData(
          brightness: brightness,
          useMaterial3: true,
          colorScheme:
              ColorScheme.fromSeed(
                seedColor: atlasColor(0xff888899),
                brightness: brightness,
              ).copyWith(
                primary: atlasColor(0xffeeeef4),
                onPrimary: atlasColor(0xff17171b),
                secondary: atlasColor(0xffb9b9c6),
                surface: surface,
              ),
          scaffoldBackgroundColor: atlasColor(0xff0b0b0e),
          appBarTheme: AppBarTheme(
            backgroundColor: atlasColor(0xff111114),
            surfaceTintColor: Colors.transparent,
            systemOverlayStyle: overlay,
          ),
          dividerColor: atlasColor(0xff34343c),
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: atlasColor(0xff1e1e24),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
          ),
          filledButtonTheme: FilledButtonThemeData(
            style: FilledButton.styleFrom(
              minimumSize: const Size(0, 34),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
              textStyle: const TextStyle(fontSize: 14),
            ),
          ),
          outlinedButtonTheme: OutlinedButtonThemeData(
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(0, 34),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
              textStyle: const TextStyle(fontSize: 14),
            ),
          ),
          navigationBarTheme: NavigationBarThemeData(
            backgroundColor: atlasColor(0xff151519),
            indicatorColor: atlasColor(0xff383840),
          ),
        );
        final home = showSplash
            ? SplashGate(translate: s.t, child: const AtlasShell())
            : const AtlasShell();
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: overlay,
          child: MaterialApp(
            title: '观澜 · Market Atlas',
            debugShowCheckedModeBanner: false,
            theme: base.copyWith(
              textTheme:
                  const TextTheme(
                    headlineSmall: TextStyle(fontSize: 24, height: 1.4),
                    headlineMedium: TextStyle(fontSize: 28),
                    headlineLarge: TextStyle(fontSize: 32),
                    displaySmall: TextStyle(fontSize: 32),
                    displayMedium: TextStyle(fontSize: 38),
                    displayLarge: TextStyle(fontSize: 44),
                    bodyLarge: TextStyle(fontSize: 18, height: 1.55),
                    bodyMedium: TextStyle(fontSize: 18, height: 1.55),
                    bodySmall: TextStyle(fontSize: 14, height: 1.5),
                    titleLarge: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w600,
                    ),
                    titleMedium: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                    titleSmall: TextStyle(fontSize: 16),
                    labelLarge: TextStyle(fontSize: 16),
                    labelMedium: TextStyle(fontSize: 14),
                    labelSmall: TextStyle(fontSize: 13),
                  ).apply(
                    bodyColor: atlasColor(0xffeeeef4),
                    displayColor: atlasColor(0xffeeeef4),
                  ),
            ),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(
                  appTextScale(
                    s.fontSize,
                    MediaQuery.textScalerOf(context).scale(1),
                  ),
                ),
              ),
              child: child!,
            ),
            // Links are handled by the shell; the platform's initial route
            // (a cold-start deep link) must not become a named route.
            onGenerateInitialRoutes: (_) => [
              MaterialPageRoute<void>(
                settings: const RouteSettings(name: '/'),
                builder: (_) => home,
              ),
            ],
            onGenerateRoute: (settings) => settings.name == '/'
                ? MaterialPageRoute<void>(
                    settings: settings,
                    builder: (_) => home,
                  )
                : null,
          ),
        );
      },
    ),
  );
}

/// App font size (18/20/22) times the iOS text size, which may also be
/// smaller than the default.
double appTextScale(double fontSize, double system) =>
    fontSize / 18 * system.clamp(.8, 1.5);

class AtlasShell extends StatefulWidget {
  const AtlasShell({super.key});
  @override
  State<AtlasShell> createState() => _AtlasShellState();
}

class _AtlasShellState extends State<AtlasShell> {
  int index = 1;

  /// Tabs are built on first visit and then kept (IndexedStack), so scroll
  /// positions, groups, filters and screener options survive tab switches.
  final visited = <int>{1};
  final scrollers = List.generate(5, (_) => ScrollController());
  StreamSubscription<String>? messages, pushClicks, deepLinks;
  static const names = ['我的自选', '市场全景', '五线选股器', '收盘信号中心', '7×24 快讯'];
  static const icons = [
    Icons.star_outline,
    Icons.show_chart,
    Icons.filter_alt_outlined,
    Icons.sensors,
    Icons.article_outlined,
  ];
  @override
  void initState() {
    super.initState();
    final store = context.read<AtlasStore>(),
        push = context.read<NativePushService>(),
        links = context.read<AppLinkObserver?>();
    messages = store.messages.stream.listen((message) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(message)));
      }
    });
    pushClicks = push.opened.stream.listen(open);
    deepLinks = links?.links.listen(open);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final url =
          push.initialUrl ??
          links?.initial ??
          (kIsWeb ? Uri.base.toString() : null);
      if (url != null) open(url);
    });
  }

  void selectTab(int i) {
    if (i == index) {
      // iOS convention: tapping the active tab returns to the top.
      final controller = scrollers[i];
      if (controller.hasClients) {
        controller.animateTo(
          0,
          duration: const Duration(milliseconds: 320),
          curve: Curves.easeOutCubic,
        );
      }
      return;
    }
    setState(() {
      index = i;
      visited.add(i);
    });
  }

  /// Routes a push payload, `guanlan://` link or shared https link.
  void open(String url) {
    if (!mounted) return;
    final link = AppLink.parse(url);
    if (link == null) return;
    final navigator = Navigator.of(context);
    switch (link.kind) {
      case AppLinkKind.share:
        navigator.push(
          MaterialPageRoute(builder: (_) => SharedReaderPage(link.value)),
        );
      case AppLinkKind.article:
        final article = parseArticleLink(link.raw);
        if (article != null) openNews(context, article);
      case AppLinkKind.stock:
        openStock(context, link.value);
      case AppLinkKind.view:
        // A stock page, sheet or dialog may cover the tabs.
        navigator.popUntil((route) => route.isFirst);
        final tab = AppLink.views[link.value]!;
        if (tab != index) selectTab(tab);
    }
  }

  @override
  void dispose() {
    messages?.cancel();
    pushClicks?.cancel();
    deepLinks?.cancel();
    for (final c in scrollers) {
      c.dispose();
    }
    super.dispose();
  }

  void page(Widget page) {
    Navigator.pop(context);
    Navigator.push(context, MaterialPageRoute(builder: (_) => page));
  }

  Widget _tab(int i) {
    if (!visited.contains(i)) return const SizedBox.shrink();
    const pages = [
      WatchPage(),
      MarketPage(),
      ScreenerPage(),
      SignalsPage(),
      NewsPage(),
    ];
    // Offstage tabs keep their state but their timers and tickers pause.
    return PrimaryScrollController(
      controller: scrollers[i],
      child: TickerMode(
        enabled: i == index,
        child: HeroMode(enabled: i == index, child: pages[i]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = context.read<AtlasStore>();
    context.select<AtlasStore, String>((s) => s.locale);
    final wide = MediaQuery.sizeOf(context).shortestSide >= 600;
    final scaler = MediaQuery.textScalerOf(context);
    final body = IndexedStack(
      index: index,
      children: [for (var i = 0; i < names.length; i++) _tab(i)],
    );
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: math.max(46, scaler.scale(19) + 22),
        title: Text(
          index == 0 ? '观澜 · ATLAS' : s.t(names[index]),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 19,
            fontWeight: FontWeight.w700,
            letterSpacing: .7,
          ),
        ),
        actions: [
          IconButton(
            tooltip: s.t('搜索股票'),
            onPressed: () => showStockSearch(context),
            icon: const Icon(Icons.search),
          ),
          IconButton(
            tooltip: s.t('设置'),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SettingsPage()),
            ),
            icon: const Icon(Icons.tune),
          ),
        ],
      ),
      drawer: Drawer(
        child: SafeArea(
          child: ListView(
            children: [
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  '观澜 · ATLAS',
                  style: TextStyle(fontSize: 23, fontWeight: FontWeight.bold),
                ),
              ),
              for (var i = 0; i < names.length; i++)
                ListTile(
                  leading: Icon(icons[i]),
                  title: Text(s.t(names[i])),
                  selected: index == i,
                  onTap: () {
                    Navigator.pop(context);
                    selectTab(i);
                  },
                ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.dashboard_outlined),
                title: Text(s.t('情报总览')),
                onTap: () => page(const WorkspacePage()),
              ),
              ListTile(
                leading: const Icon(Icons.hub_outlined),
                title: Text(s.t('产业联动')),
                onTap: () => page(const WorkspacePage(initial: 'radar')),
              ),
              ListTile(
                leading: const Icon(Icons.history),
                title: Text(s.t('事件档案')),
                onTap: () => page(const WorkspacePage(initial: 'history')),
              ),
              ListTile(
                leading: const Icon(Icons.bookmarks_outlined),
                title: Text(s.t('收藏情报')),
                onTap: () => page(
                  Scaffold(
                    appBar: AppBar(title: Text(s.t('收藏情报'))),
                    body: const NewsPage(savedOnly: true),
                  ),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.settings_outlined),
                title: Text(s.t('设置')),
                onTap: () => page(const SettingsPage()),
              ),
            ],
          ),
        ),
      ),
      body: SafeArea(
        child: wide
            ? Row(
                children: [
                  NavigationRail(
                    selectedIndex: index,
                    onDestinationSelected: selectTab,
                    labelType: NavigationRailLabelType.all,
                    destinations: List.generate(
                      names.length,
                      (i) => NavigationRailDestination(
                        icon: Icon(icons[i]),
                        label: Text(s.t(names[i])),
                      ),
                    ),
                  ),
                  const VerticalDivider(width: 1),
                  Expanded(child: body),
                ],
              )
            : body,
      ),
      bottomNavigationBar: wide
          ? null
          : CupertinoTabBar(
              // Grows with the label size instead of clipping it.
              height: math.max(48, 21 + 8 + scaler.scale(10) * 1.3),
              backgroundColor: atlasColor(0xff111114),
              activeColor: ink,
              inactiveColor: muted,
              currentIndex: index,
              onTap: selectTab,
              items: List.generate(
                names.length,
                (i) => BottomNavigationBarItem(
                  icon: Icon(icons[i], size: 21),
                  label: s.t(['自选', '市场', '选股', '信号', '快讯'][i]),
                  tooltip: s.t(names[i]),
                ),
              ),
            ),
    );
  }
}
