import 'dart:convert';
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:flutter_html/flutter_html.dart';
import 'package:pdfrx/pdfrx.dart';

import '../core/api.dart';
import '../core/store.dart';
import '../widgets/common.dart';

void openNews(BuildContext context, Json item) => Navigator.push(
  context,
  MaterialPageRoute(builder: (_) => ReaderPage(item: item)),
);

class NewsTile extends StatelessWidget {
  const NewsTile(this.item, {super.key, this.compact = false});
  final Json item;
  final bool compact;
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      title: Text(
        str(item['title']),
        maxLines: compact ? 3 : null,
        overflow: compact ? TextOverflow.ellipsis : null,
        style: const TextStyle(fontSize: 17, height: 1.65),
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 10),
        child: Text(
          '${str(item['source'])} · ${str(item['publishedAt'])}',
          style: TextStyle(fontSize: 12, color: muted),
        ),
      ),
      trailing: IconButton(
        onPressed: () => s.toggleSaved(item),
        tooltip: s.t('收藏'),
        icon: Icon(
          s.saved(item) ? Icons.bookmark : Icons.bookmark_border,
          color: s.saved(item) ? Colors.amber : muted,
        ),
      ),
      onTap: () => openNews(context, item),
    );
  }
}

class NewsPage extends StatefulWidget {
  const NewsPage({super.key, this.savedOnly = false});
  final bool savedOnly;
  @override
  State<NewsPage> createState() => _NewsPageState();
}

class _NewsPageState extends State<NewsPage> {
  String category = 'all', source = 'all';
  bool auto = true;

  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    if (widget.savedOnly) {
      return ListView(
        padding: const EdgeInsets.all(18),
        children: [
          PageTitle('收藏情报', '只保存在当前设备'),
          if (s.bookmarks.isEmpty) Notice(s.t('还没有收藏情报')),
          ...s.bookmarks.map((r) => NewsTile(r)),
        ],
      );
    }
    final categories = {
      'all': '7×24 快讯',
      for (final r in rows(s.catalog['sectors'])) str(r['id']): str(r['name']),
    };
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        PageTitle(
          '7×24 财经快讯',
          '财联社与华尔街见闻 · 来源摘要 · 北京时间',
          trailing: IconButton(
            onPressed: () => setState(() => auto = !auto),
            tooltip: s.t(auto ? '暂停' : '恢复'),
            icon: Icon(
              auto ? Icons.pause_circle_outline : Icons.play_circle_outline,
            ),
          ),
        ),
        Chips(
          values: categories,
          selected: category,
          onSelected: (v) => setState(() => category = v),
        ),
        if (category == 'all')
          Chips(
            values: const {
              'all': '全部快讯',
              'important': '重要',
              '财联社': '财联社',
              '华尔街见闻': '华尔街见闻',
            },
            selected: source,
            onSelected: (v) => setState(() => source = v),
          ),
        AsyncPanel(
          key: ValueKey(category),
          refreshSeconds: auto ? 60 : 0,
          load: () => s.api.get(
            category == 'all' ? '/api/desk/flash' : '/api/news',
            parameters: category == 'all' ? null : {'category': category},
          ),
          builder: (data) {
            final items = rows(data['items'])
                .where(
                  (r) =>
                      category != 'all' ||
                      source == 'all' ||
                      (source == 'important'
                          ? r['important'] == true
                          : r['source'] == source),
                )
                .toList();
            return Column(
              children: [
                if (items.isEmpty) Notice(s.t('当前范围内暂无来源资讯')),
                ...items.map((r) => NewsTile(r)),
                SourceLine(data),
                ...((data['warnings'] as List?) ?? []).map((w) => Notice('$w')),
              ],
            );
          },
        ),
      ],
    );
  }
}

class ReaderPage extends StatelessWidget {
  const ReaderPage({super.key, required this.item, this.document});
  final Json item;
  final Future<Json> Function()? document;
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AtlasStore>();
    return Scaffold(
      appBar: AppBar(
        title: Text(s.t('站内资料阅读器')),
        actions: [
          IconButton(
            onPressed: () => s.toggleSaved(item),
            tooltip: s.t('收藏'),
            icon: Icon(s.saved(item) ? Icons.bookmark : Icons.bookmark_border),
          ),
          IconButton(
            onPressed: () async {
              try {
                final result = await s.api.post('/api/shares', {
                  'item': item,
                }, token: s.deviceToken);
                if (!context.mounted) return;
                final box = context.findRenderObject() as RenderBox?;
                await SharePlus.instance.share(
                  ShareParams(
                    text: '${str(item['title'])}\n${str(result['url'])}',
                    sharePositionOrigin: box == null
                        ? null
                        : box.localToGlobal(Offset.zero) & box.size,
                  ),
                );
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(
                    context,
                  ).showSnackBar(SnackBar(content: Text('${s.t('分享失败')}：$e')));
                }
              }
            },
            tooltip: s.t('分享'),
            icon: const Icon(Icons.ios_share),
          ),
        ],
      ),
      body: document == null
          ? _body(context, item)
          : AsyncPanel(
              load: document!,
              builder: (data) => _body(context, {...item, ...data}),
            ),
    );
  }

  Widget _body(BuildContext context, Json data) {
    final s = context.read<AtlasStore>(),
        title = str(data['title']),
        content = str(data['content'] ?? data['summary'], ''),
        code = str(data['code'] ?? data['artCode'], '');
    return SingleChildScrollView(
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            str(data['source'], 'MARKET ATLAS'),
            style: TextStyle(color: muted, fontSize: 13),
          ),
          const SizedBox(height: 14),
          Text(
            title,
            style: Theme.of(context).textTheme.headlineSmall
                ?.copyWith(height: 1.5, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 14),
          Text(
            str(data['publishedAt'] ?? data['date']),
            style: TextStyle(color: muted, fontSize: 13),
          ),
          const Divider(height: 40),
          if (content.isNotEmpty)
            Html(
              data: content.replaceAll('\n', '<br>'),
              style: {
                'body': Style(
                  color: atlasColor(0xffdddde7),
                  fontSize: FontSize(s.fontSize),
                  lineHeight: const LineHeight(1.9),
                  margin: Margins.zero,
                ),
              },
              onLinkTap: (_, _, _) {},
            )
          else
            Notice(s.t('该资讯源仅提供了标题、日期与出处，未授权提供正文。本站不推测正文，也不把标题扩写成未经核实的新闻内容。')),
          if (data['pdfUrl'] != null && code.isNotEmpty)
            FilledButton.icon(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => Scaffold(
                    appBar: AppBar(title: Text(s.t('公告 PDF'))),
                    body: PdfViewer.uri(
                      Uri.parse(
                        '${s.api.base}/api/announcement-pdf?code=$code',
                      ),
                    ),
                  ),
                ),
              ),
              icon: const Icon(Icons.picture_as_pdf),
              label: Text(s.t('公告 PDF')),
            ),
          const SizedBox(height: 22),
          Notice(s.t('这是媒体信息线索，不代表公司订单、收入或利润已经兑现。需要结合正式公告、财报和不同来源交叉验证。')),
        ],
      ),
    );
  }
}

String articleLink(Json item) {
  String plain(dynamic v, int n) {
    final t = str(v, '').replaceAll(RegExp(r'<[^>]*>'), '');
    return t.substring(0, t.length < n ? t.length : n);
  }

  final data = {
    'title': plain(item['title'], 240),
    'source': plain(item['source'], 100),
    'url': plain(item['url'] ?? item['sourceUrl'], 2048),
    'publishedAt': item['publishedAt'] ?? item['date'],
    'summary': plain(item['summary'] ?? item['content'], 1800),
  };
  return 'https://personal-market-atlas.nzs.workers.dev/?article=${base64Url.encode(utf8.encode(jsonEncode(data))).replaceAll('=', '')}';
}

Json? parseArticleLink(String url) {
  try {
    final raw = Uri.parse(url).queryParameters['article'];
    if (raw == null || raw.length > 12000) return null;
    final r = obj(
      jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(raw)))),
    );
    if (str(r['title'], '').isEmpty ||
        !['http', 'https'].contains(Uri.parse(str(r['url'])).scheme)) {
      return null;
    }
    return r;
  } catch (_) {
    return null;
  }
}

class SharedReaderPage extends StatelessWidget {
  const SharedReaderPage(this.id, {super.key});
  final String id;
  @override
  Widget build(BuildContext context) {
    final s = context.read<AtlasStore>();
    return FutureBuilder<Json>(
      future: s.api.get('/api/shares/$id'),
      builder: (ctx, snapshot) {
        if (snapshot.hasData) {
          final data = snapshot.data!,
              item = obj(data['item']),
              code = str(data['code'], '');
          return ReaderPage(
            item: item,
            document: data['kind'] == 'announcement' && code.isNotEmpty
                ? () =>
                      s.api.get('/api/announcement', parameters: {'code': code})
                : null,
          );
        }
        return Scaffold(
          appBar: AppBar(title: Text(s.t('站内分享'))),
          body: Center(
            child: snapshot.hasError
                ? Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text('${snapshot.error}'),
                  )
                : const CircularProgressIndicator(),
          ),
        );
      },
    );
  }
}
