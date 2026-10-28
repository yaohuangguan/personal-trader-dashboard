import 'api.dart';

const multiDefaults = <String, dynamic>{
  'multiSystem': 'either',
  'multiLines': '4',
  'multi60': '0',
  'multiMiddle': '0',
  'multiDense': '10',
  'multiVolume': '1.2',
  'multiVolume5': '0',
  'multiGain': '3',
  'multiClose': '0.7',
};
bool passesMultiEvidence(Json e, String mode, Json options) {
  if (e['systems'] is List) {
    final entries = rows(e['systems']);
    final system = str(options['multiSystem'], 'either');
    if (system == 'both') {
      return ['classic', 'fibonacci'].every(
        (s) => entries.any(
          (v) =>
              v['system'] == s &&
              passesMultiEvidence({...v, 'systems': null}, mode, options),
        ),
      );
    }
    return entries.any(
      (v) =>
          (system == 'either' || v['system'] == system) &&
          passesMultiEvidence({...v, 'systems': null}, mode, options),
    );
  }
  if (e['version'] != 3 ||
      e['normal'] != true ||
      mode == 'strongmulti' && e['strong'] != true) {
    return false;
  }
  final f = {...multiDefaults, ...options};
  return (numOf(e['lines']) ?? 0) >= (numOf(f['multiLines']) ?? 4) &&
      (f['multi60'] != '1' || e['includes60'] == true) &&
      (f['multiMiddle'] != '1' || (numOf(e['middleOffset']) ?? 1) <= .25) &&
      (numOf(e['dispersion']) ?? 100) < (numOf(f['multiDense']) ?? 10) &&
      (numOf(e['volume20']) ?? 0) >= (numOf(f['multiVolume']) ?? 1.2) &&
      (numOf(e['volume5']) ?? 0) >= (numOf(f['multiVolume5']) ?? 0) &&
      (numOf(e['gain']) ?? 0) >= (numOf(f['multiGain']) ?? 3) &&
      (numOf(e['closeLocation']) ?? 0) >= (numOf(f['multiClose']) ?? .7);
}
