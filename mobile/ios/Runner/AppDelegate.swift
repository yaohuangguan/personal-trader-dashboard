import Flutter
import UIKit
import JavaScriptCore
import PhotosUI
import Vision
import UniformTypeIdentifiers

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private let studyQueue = DispatchQueue(label: "space.ps6.marketAtlas.study", qos: .userInitiated)
  private var studyContext: JSContext?
  private var watchImport: WatchImportBridge?
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
    if let importer = engineBridge.pluginRegistry.registrar(forPlugin: "WatchImport") {
      let bridge = WatchImportBridge()
      watchImport = bridge
      let channel = FlutterMethodChannel(name: "space.ps6.marketAtlas/watch-import", binaryMessenger: importer.messenger())
      channel.setMethodCallHandler { [weak bridge] call, result in bridge?.handle(call, result: result) }
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


/// Uses the system limited picker and on-device Vision; never uploads image bytes.
private final class WatchImportBridge: NSObject, PHPickerViewControllerDelegate, UIDocumentPickerDelegate {
  private var pending: FlutterResult?
  private let queue = DispatchQueue(label: "space.ps6.marketAtlas.watch-ocr", qos: .userInitiated)
  private func finish(_ value: Any?) { let callback = pending; pending = nil; callback?(value) }
  private func presenter() -> UIViewController? {
    var view = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }.first { $0.isKeyWindow }?.rootViewController
    while let shown = view?.presentedViewController { view = shown }
    return view
  }
  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    if call.method == "recognizeImage", let bytes = call.arguments as? FlutterStandardTypedData,
       bytes.data.count < 32 * 1024 * 1024, let image = UIImage(data: bytes.data) {
      queue.async {
        do { let text = try self.recognize(image); DispatchQueue.main.async { result(["text": text]) } }
        catch { DispatchQueue.main.async { result(FlutterError(code: "ocr_failed", message: error.localizedDescription, details: nil)) } }
      }
      return
    }
    guard call.method == "pickImages" || call.method == "pickTextFile" else { result(FlutterMethodNotImplemented); return }
    guard pending == nil, let controller = presenter() else {
      result(FlutterError(code: "picker_busy", message: "请关闭当前选择器后重试", details: nil)); return
    }
    pending = result
    if call.method == "pickImages" {
      var configuration = PHPickerConfiguration()
      configuration.filter = .images
      configuration.selectionLimit = 20
      let picker = PHPickerViewController(configuration: configuration)
      picker.delegate = self
      controller.present(picker, animated: true)
    } else {
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.plainText, .commaSeparatedText, .json], asCopy: true)
      picker.delegate = self
      controller.present(picker, animated: true)
    }
  }
  private func recognize(_ image: UIImage) throws -> String {
    let factor = min(1, 3200 / max(image.size.width, image.size.height))
    let format = UIGraphicsImageRendererFormat(); format.scale = 1
    let size = CGSize(width: max(1, image.size.width * factor), height: max(1, image.size.height * factor))
    let normalized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    guard let cg = normalized.cgImage else { return "" }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: cg).perform([request])
    return (request.results ?? []).sorted {
      abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.012
        ? $0.boundingBox.midY > $1.boundingBox.midY : $0.boundingBox.minX < $1.boundingBox.minX
    }.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  }
  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    if results.isEmpty { finish(["cancelled": true]); return }
    let group = DispatchGroup()
    var texts = Array(repeating: "", count: results.count)
    var failed = 0
    for (index, item) in results.enumerated() {
      group.enter()
      item.itemProvider.loadObject(ofClass: UIImage.self) { object, _ in
        self.queue.async {
          let value = autoreleasepool { () -> String? in
            guard let image = object as? UIImage else { return nil }
            return try? self.recognize(image)
          }
          DispatchQueue.main.async {
            texts[index] = value ?? ""
            if value?.isEmpty != false { failed += 1 }
            group.leave()
          }
        }
      }
    }
    group.notify(queue: .main) {
      self.finish(["text": texts.joined(separator: "\n"), "images": results.count, "failedImages": failed])
    }
  }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(["cancelled": true]) }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let url = urls.first else { finish(["cancelled": true]); return }
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    do {
      guard ((try url.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0) <= 2_000_000 else {
        finish(FlutterError(code: "file_large", message: "文件过大，请分批导入", details: nil)); return
      }
      let bytes = try Data(contentsOf: url)
      let gb = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)))
      guard let text = String(data: bytes, encoding: .utf8) ?? ((bytes.starts(with: [0xFF, 0xFE]) || bytes.starts(with: [0xFE, 0xFF])) ? String(data: bytes, encoding: .utf16) : nil) ?? String(data: bytes, encoding: gb) else {
        finish(FlutterError(code: "file_encoding", message: "请使用纯文本 TXT、CSV 或 JSON 文件", details: nil)); return
      }
      finish(["text": text, "name": url.lastPathComponent])
    } catch { finish(FlutterError(code: "file_read", message: error.localizedDescription, details: nil)) }
  }
}
