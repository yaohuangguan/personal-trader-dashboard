import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

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

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await AtlasStore.load();
  final native = NativePushService(store.api, store.deviceToken);
  await native.initialize();
  runApp(AtlasApp(store: store, push: native));
  store.start();
}

class AtlasApp extends StatelessWidget {
  const AtlasApp({super.key, required this.store, required this.push});
  final AtlasStore store;
  final NativePushService push;
  @override
  Widget build(BuildContext context) => MultiProvider(
    providers: [
      ChangeNotifierProvider.value(value: store),
      ChangeNotifierProvider(create: (_) => ScreenerController(store)),
      Provider.value(value: push),
    ],
    child: Consumer<AtlasStore>(
      builder: (context, s, _) {
        final base = ThemeData(
          brightness: Brightness.dark,
          useMaterial3: true,
          colorScheme: const ColorScheme.dark(
            primary: Color(0xffeeeef4),
            onPrimary: Color(0xff17171b),
            secondary: Color(0xffb9b9c6),
            surface: surface,
          ),
          scaffoldBackgroundColor: const Color(0xff0b0b0e),
          appBarTheme: const AppBarTheme(
            backgroundColor: Color(0xff111114),
            surfaceTintColor: Colors.transparent,
          ),
          dividerColor: const Color(0xff34343c),
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: const Color(0xff1e1e24),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
          ),
          navigationBarTheme: const NavigationBarThemeData(
            backgroundColor: Color(0xff151519),
            indicatorColor: Color(0xff383840),
          ),
        );
        return MaterialApp(
          title: 'Market Atlas',
          debugShowCheckedModeBanner: false,
          theme: base.copyWith(
            textTheme: const TextTheme(
              bodyLarge: TextStyle(fontSize: 18, height: 1.55),
              bodyMedium: TextStyle(fontSize: 18, height: 1.55),
              bodySmall: TextStyle(fontSize: 14, height: 1.5),
              titleLarge: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
              titleMedium: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              titleSmall: TextStyle(fontSize: 16),
              labelLarge: TextStyle(fontSize: 16),
              labelMedium: TextStyle(fontSize: 14),
              labelSmall: TextStyle(fontSize: 13),
            ),
          ),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: TextScaler.linear(
                s.fontSize /
                    18 *
                    MediaQuery.textScalerOf(context).scale(1).clamp(1, 1.5),
              ),
            ),
            child: child!,
          ),
          home: const AtlasShell(),
        );
      },
    ),
  );
}

class AtlasShell extends StatefulWidget {
  const AtlasShell({super.key});
  @override
  State<AtlasShell> createState() => _AtlasShellState();
}

class _AtlasShellState extends State<AtlasShell> {
  int index = 0;
  StreamSubscription<String>? messages, pushClicks;
  static const names = ['我的自选', '市场全景', '五线选股器', '盘中信号中心', '7×24 快讯'];
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
        push = context.read<NativePushService>();
    messages = store.messages.stream.listen((message) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(message)));
      }
    });
    pushClicks = push.opened.stream.listen(_open);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final url = push.initialUrl ?? Uri.base.toString();
      if (url.contains('symbol=') || url.contains('view=signals')) _open(url);
    });
  }

  void _open(String url) {
    if (!mounted) return;
    final symbol = Uri.tryParse(url)?.queryParameters['symbol'];
    if (symbol != null) {
      openStock(context, symbol);
    } else {
      setState(() => index = 3);
    }
  }

  @override
  void dispose() {
    messages?.cancel();
    pushClicks?.cancel();
    super.dispose();
  }

  void page(Widget page) {
    Navigator.pop(context);
    Navigator.push(context, MaterialPageRoute(builder: (_) => page));
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>(),
        wide = MediaQuery.sizeOf(context).width >= 760;
    final body = [
      const WatchPage(),
      const MarketPage(),
      const ScreenerPage(),
      const SignalsPage(),
      const NewsPage(),
    ][index];
    return Scaffold(
      appBar: AppBar(
        title: Text(
          index == 0 ? 'MARKET ATLAS' : s.t(names[index]),
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
                  'MARKET ATLAS',
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
                    setState(() => index = i);
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
                    onDestinationSelected: (i) => setState(() => index = i),
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
          : NavigationBar(
              height: 78,
              selectedIndex: index,
              onDestinationSelected: (i) => setState(() => index = i),
              destinations: List.generate(
                names.length,
                (i) => NavigationDestination(
                  icon: Icon(icons[i]),
                  label: s.t(['自选', '市场', '选股', '信号', '快讯'][i]),
                ),
              ),
            ),
    );
  }
}
