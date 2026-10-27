import 'package:flutter/material.dart';

abstract final class AtlasPalette {
  static bool light = false;
}

Color get ink =>
    AtlasPalette.light ? const Color(0xff20232a) : const Color(0xffeeeef4);
Color get surface =>
    AtlasPalette.light ? Colors.white : const Color(0xff141417);
Color get muted =>
    AtlasPalette.light ? const Color(0xff626875) : const Color(0xffa4a4b2);
Color get up =>
    AtlasPalette.light ? const Color(0xffce3546) : const Color(0xffee5b67);
Color get down =>
    AtlasPalette.light ? const Color(0xff00836b) : const Color(0xff38b59c);

/// Translate only neutral UI surfaces; semantic market colors keep their hue.
Color atlasColor(int value) {
  final c = Color(value);
  if (!AtlasPalette.light) return c;
  final rgb = [c.r, c.g, c.b]..sort(), l = (rgb.first + rgb.last) / 2;
  if (rgb.last - rgb.first > .19) return c;
  final target = l < 0.18
      ? 0.985 - l * 0.25
      : l < 0.4
      ? 0.91 - (l - 0.18) * 0.55
      : (1 - l).clamp(0.08, 0.44);
  return Color.from(
    alpha: c.a,
    red: target,
    green: target,
    blue: (target + .012).clamp(0, 1),
  );
}

Color chartColor(Color c) {
  if (!AtlasPalette.light) return c;
  final h = HSLColor.fromColor(c);
  return h
      .withLightness(h.saturation < 0.15 ? 0.18 : h.lightness.clamp(0.25, 0.4))
      .toColor();
}
