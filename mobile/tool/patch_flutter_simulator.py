"""Backport Flutter PR #193142 for the pinned CI-only SDK (3.47.5).

Wait until the iOS log stream is ready before launching the simulator app.
Flutter issue #181771: https://github.com/flutter/flutter/pull/193142
The original SDK's BSD-3-Clause header and license stay intact.
No product code, local user SDK or shipped engine is modified by CI.
"""
from pathlib import Path
import hashlib
import sys

SOURCE_SHA = '8a877c1d5dd8535be3e8b1c95b753d4c97b09b2adfcf6fa4f90b545734981514'
PATCHED_SHA = '2a18c6b07acdf84ed2707d0342f4e7c8a3b6208b2b2925858ab8c98dd547a66b'
REPLACEMENTS = [('final _logReaders = <IOSApp?, DeviceLogReader>{};', 'final _logReaders = <IOSApp?, _IOSSimulatorLogReader>{};'), ('DeviceLogReader getLogReader({covariant IOSApp? app, bool includePastLogs = false})', '_IOSSimulatorLogReader getLogReader({covariant IOSApp? app, bool includePastLogs = false})'), ('      vmServiceDiscovery = ProtocolDiscovery.vmService(\n        getLogReader(app: package),\n        ipv6: debuggingOptions.ipv6,\n        hostPort: debuggingOptions.hostVmServicePort,\n        devicePort: debuggingOptions.deviceVmServicePort,\n        logger: globals.logger,\n      );', '      final _IOSSimulatorLogReader logReader = getLogReader(app: package);\n      vmServiceDiscovery = ProtocolDiscovery.vmService(\n        logReader,\n        ipv6: debuggingOptions.ipv6,\n        hostPort: debuggingOptions.hostVmServicePort,\n        devicePort: debuggingOptions.deviceVmServicePort,\n        logger: globals.logger,\n      );\n      // Flutter PR #193142: do not lose the VM service URL before logs are ready.\n      await logReader._ready.future;'), ('  @override\n  @visibleForTesting\n  StreamController<String> get linesController => _linesController;', '  var _ready = Completer<void>();\n\n  @override\n  @visibleForTesting\n  StreamController<String> get linesController => _linesController;'), ('  Future<void> _start() async {\n    // Unified logging iOS 11 and greater (introduced in iOS 10).', '  Future<void> _start() async {\n    _ready = Completer<void>();\n    final Completer<void> ready = _ready;\n    // Unified logging iOS 11 and greater (introduced in iOS 10).'), ('      _deviceProcess?.stdout.transform(utf8LineDecoder).listen(_onUnifiedLoggingLine);', '      _deviceProcess?.stdout.transform(utf8LineDecoder).listen((String line) {\n        if (!ready.isCompleted) {\n          ready.complete();\n        }\n        _onUnifiedLoggingLine(line);\n      });'), ('      _deviceProcess?.exitCode.whenComplete(() {\n        if (_linesController.hasListener) {', '      _deviceProcess?.exitCode.whenComplete(() {\n        if (!ready.isCompleted) {\n          ready.complete();\n        }\n        if (_linesController.hasListener) {')]

def transformed(source):
    digest = hashlib.sha256(source.encode()).hexdigest()
    if digest == PATCHED_SHA:
        return source
    if digest != SOURCE_SHA:
        raise ValueError("Unexpected Flutter simulator source; review the SDK before patching")
    for before, after in REPLACEMENTS:
        if source.count(before) != 1:
            raise ValueError("Flutter patch context is not unique")
        source = source.replace(before, after)
    if hashlib.sha256(source.encode()).hexdigest() != PATCHED_SHA:
        raise ValueError("Patched Flutter simulator source failed verification")
    return source

def main():
    root = Path(sys.argv[1]).resolve(strict=True)
    path = root / "packages/flutter_tools/lib/src/ios/simulators.dart"
    if not path.resolve(strict=True).is_relative_to(root):
        raise ValueError("Simulator source is outside the SDK")
    original = path.read_text(encoding="utf-8")
    output = transformed(original)
    if output != original:
        path.write_text(output, encoding="utf-8")
    # Flutter's tool snapshot is keyed by SDK revision, so rebuild it after this backport.
    snapshot = root / "bin/cache/flutter_tools.snapshot"
    if not snapshot.resolve().is_relative_to(root):
        raise ValueError("Tool snapshot is outside the SDK")
    snapshot.unlink(missing_ok=True)
    print("Flutter simulator log readiness backport verified; tool snapshot will rebuild")

if __name__ == "__main__":
    main()
