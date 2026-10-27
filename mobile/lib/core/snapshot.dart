import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

/// Visible viewport only. PNG stays in memory / the system share cache, never Photos.
class StockSnapshot {
  static const channel = MethodChannel('space.ps6.marketAtlas/snapshot');

  static Future<Uint8List> capture(
    GlobalKey key, {
    double pixelRatio = 3,
  }) async {
    await WidgetsBinding.instance.endOfFrame;
    final boundary = key.currentContext?.findRenderObject();
    if (boundary is! RenderRepaintBoundary || boundary.size.isEmpty) {
      throw StateError('当前画面尚未就绪');
    }
    final ratio = math.min(
      pixelRatio,
      math.sqrt(12000000 / (boundary.size.width * boundary.size.height)),
    );
    final image = await boundary.toImage(pixelRatio: ratio);
    try {
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      if (bytes == null) throw StateError('无法生成截图');
      return bytes.buffer.asUint8List(bytes.offsetInBytes, bytes.lengthInBytes);
    } finally {
      image.dispose();
    }
  }

  static Future<void> copy(Uint8List png) async {
    final copied = await channel.invokeMethod<bool>('copyImage', png);
    if (copied != true) throw StateError('当前设备无法复制图片');
  }

  static Future<void> share(Uint8List png, String symbol, Rect origin) async {
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile.fromData(png, mimeType: 'image/png')],
        fileNameOverrides: [
          'guanlan-${symbol.replaceAll(RegExp(r'[^A-Za-z0-9.-]'), '')}.png',
        ],
        sharePositionOrigin: origin,
        downloadFallbackEnabled: false,
        excludedCupertinoActivities: [CupertinoActivityType.saveToCameraRoll],
      ),
    );
  }
}
