import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the bundled game files (`dist/` in the app's resources) to the web view.
final class GameSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    private let root = Bundle.main.resourceURL!.appendingPathComponent("dist", isDirectory: true).standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path.removingPercentEncoding ?? url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        // Only files inside dist/.
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            let missing = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            task.didReceive(missing)
            task.didFinish()
            return
        }
        let type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let mime = file.pathExtension == "js" ? "text/javascript" : file.pathExtension == "webmanifest" ? "application/manifest+json" : type
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
        ])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
