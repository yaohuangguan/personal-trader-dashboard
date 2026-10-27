import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
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
