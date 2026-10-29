import AppKit
import WebKit
import UniformTypeIdentifiers

/// The game's web view. Pages come from `app://game/`, served from the bundled `dist/` folder, so
/// the module scripts load and the saved island (localStorage) persists between launches.
final class GameViewController: NSViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(GameSchemeHandler(), forURLScheme: GameSchemeHandler.scheme)
        config.websiteDataStore = .default()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = false
        // Inside an app: no browser-only hints (Add to Home Screen) and no web fullscreen requests.
        config.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.classList.add('native-app','mac-app');",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Copy Island hands its file to the app, which asks where to save it.
        config.userContentController.add(IslandFileHandler(self), name: "islandFile")
        config.userContentController.add(HapticHandler(), name: "haptic")
        config.userContentController.add(PhotoHandler(self), name: "photo")

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900), configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsMagnification = false
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = .black
        let container = NSView()
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.black.cgColor
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
        view = container
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.frame = view.bounds
        webView.load(URLRequest(url: URL(string: "\(GameSchemeHandler.scheme)://game/index.html")!))
        #if DEBUG
        webView.isInspectable = true
        #endif
    }

    /// Links that leave the game (none today) open in the browser, never inside the game window.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.scheme != GameSchemeHandler.scheme, url.scheme != "about" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    /// The web process can be ended by the system under memory pressure; reload rather than show a blank window.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    /// Load Island's file picker.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.message = "Choose an Aztlan Isle island file"
        guard let window = view.window else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
            return
        }
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    /// Save a copied island where the player chooses.
    fileprivate func saveIsland(name: String, text: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name.isEmpty ? "island.aztlan.json" : name
        panel.message = "Save a copy of your island"
        let write: (NSApplication.ModalResponse) -> Void = { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                try text.write(to: url, atomically: true, encoding: .utf8)
            } catch {
                let alert = NSAlert()
                alert.messageText = "The island could not be saved there."
                alert.informativeText = error.localizedDescription
                alert.runModal()
            }
        }
        if let window = view.window { panel.beginSheetModal(for: window, completionHandler: write) } else { write(panel.runModal()) }
    }

    /// Save a Photo Mode picture where the player chooses (Pictures by default).
    fileprivate func savePhoto(name: String, data: Data) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name.isEmpty ? "Aztlan Isle.jpg" : name
        panel.allowedContentTypes = [.jpeg]
        panel.directoryURL = FileManager.default.urls(for: .picturesDirectory, in: .userDomainMask).first
        panel.message = "Save your photo of the island"
        let write: (NSApplication.ModalResponse) -> Void = { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                try data.write(to: url)
            } catch {
                let alert = NSAlert()
                alert.messageText = "The photo could not be saved there."
                alert.informativeText = error.localizedDescription
                alert.runModal()
            }
        }
        if let window = view.window { panel.beginSheetModal(for: window, completionHandler: write) } else { write(panel.runModal()) }
    }

    /// `confirm()` (used when there is no room for a save backup).
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }
}

/// Receives Copy Island's file from the page (held weakly, so the web view never keeps the screen alive).
private final class IslandFileHandler: NSObject, WKScriptMessageHandler {
    weak var owner: GameViewController?
    init(_ owner: GameViewController) { self.owner = owner }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let text = body["text"] as? String else { return }
        owner?.saveIsland(name: body["name"] as? String ?? "island.aztlan.json", text: text)
    }
}

/// The page's haptic taps, felt on a Force Touch trackpad (ignored by other mice and trackpads).
private final class HapticHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let kind = message.body as? String else { return }
        NSHapticFeedbackManager.defaultPerformer.perform(kind == "light" ? .alignment : .levelChange, performanceTime: .now)
    }
}

/// Receives a Photo Mode picture (base64 JPEG) and offers to save it.
private final class PhotoHandler: NSObject, WKScriptMessageHandler {
    weak var owner: GameViewController?
    init(_ owner: GameViewController) { self.owner = owner }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else { return }
        owner?.savePhoto(name: body["name"] as? String ?? "Aztlan Isle.jpg", data: data)
    }
}
