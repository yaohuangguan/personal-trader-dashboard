class UITranslation {
  UITranslation(Map<String, dynamic> dictionary)
    : dictionary = dictionary.map(
        (key, value) => MapEntry(key, value.toString()),
      ) {
    for (final entry in this.dictionary.entries) {
      if (!RegExp(r'\{\w+\}').hasMatch(entry.key)) continue;
      final names = <String>[];
      final pattern = entry.key.splitMapJoin(
        RegExp(r'\{(\w+)\}'),
        onMatch: (m) {
          names.add(m[1]!);
          return '(.+?)';
        },
        onNonMatch: RegExp.escape,
      );
      templates.add((RegExp('^$pattern\$'), names, entry.value));
    }
  }
  final Map<String, String> dictionary;
  final templates = <(RegExp, List<String>, String)>[];
  String call(String value) {
    if (dictionary.containsKey(value)) return dictionary[value]!;
    for (final template in templates) {
      final match = template.$1.firstMatch(value);
      if (match == null) continue;
      return template.$3.replaceAllMapped(RegExp(r'\{(\w+)\}'), (m) {
        final captured = match[template.$2.indexOf(m[1]!) + 1]!;
        return dictionary[captured] ?? captured;
      });
    }
    final amount = RegExp(r'^([+−-]?\d+(?:\.\d+)?)(万|亿)(手|股|元)?$')
        .firstMatch(value);
    if (amount != null) {
      final number =
          double.parse(amount[1]!.replaceAll('−', '-')) *
          (amount[2] == '亿' ? 100 : .01);
      final formatted = number
          .toStringAsFixed(3)
          .replaceFirst(RegExp(r'\.?0+$'), '');
      return '${formatted}M${amount[3] == '手'
          ? ' lots'
          : amount[3] == '股'
          ? ' shares'
          : amount[3] == '元'
          ? ' CNY'
          : ''}';
    }
    return value;
  }
}
