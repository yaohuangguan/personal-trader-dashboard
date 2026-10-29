import Flutter
import UIKit
import JavaScriptCore

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private let studyQueue = DispatchQueue(label: "space.ps6.marketAtlas.study", qos: .userInitiated)
  private var studyContext: JSContext?
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let studyRegistrar = engineBridge.pluginRegistry.registrar(forPlugin: "LocalChartStudy") {
      let studyChannel = FlutterMethodChannel(name: "space.ps6.marketAtlas/study", binaryMessenger: studyRegistrar.messenger())
      studyChannel.setMethodCallHandler { [weak self] call, result in
        guard call.method == "compute", let args = call.arguments as? [String: Any],
          let payload = args["payload"] as? String, payload.utf8.count <= 1_500_000 else {
          result(FlutterError(code: "invalid_study", message: "无效图表参数", details: nil)); return
        }
        guard let self = self else { return }
        self.studyQueue.async {
          autoreleasepool {
            if self.studyContext == nil, let source = args["source"] as? String {
              let context = JSContext()
              context?.evaluateScript(source)
              if context?.exception == nil { self.studyContext = context }
            }
            guard let context = self.studyContext else {
              DispatchQueue.main.async { result(FlutterError(code: "study_init", message: "本机分析引擎未就绪", details: nil)) }; return
            }
            context.exception = nil
            let output = context.objectForKeyedSubscript("AtlasLocalStudy")?.objectForKeyedSubscript("computeJSON")?.call(withArguments: [payload])?.toString()
            let error = context.exception?.toString()
            DispatchQueue.main.async {
              if let error = error { result(FlutterError(code: "study_failed", message: error, details: nil)) }
              else if let output = output { result(output) }
              else { result(FlutterError(code: "study_empty", message: "本机分析未返回结果", details: nil)) }
            }
          }
        }
      }
    }
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "StockSnapshot") else { return }
    let channel = FlutterMethodChannel(
      name: "space.ps6.marketAtlas/snapshot", binaryMessenger: registrar.messenger())
    channel.setMethodCallHandler { call, result in
      guard call.method == "copyImage" else {
        result(FlutterMethodNotImplemented)
        return
      }
      guard let bytes = call.arguments as? FlutterStandardTypedData,
        bytes.data.count <= 32 * 1024 * 1024,
        let image = UIImage(data: bytes.data) else {
        result(FlutterError(code: "invalid_image", message: "无法读取截图", details: nil))
        return
      }
      UIPasteboard.general.image = image
      result(true)
    }
  }
}
