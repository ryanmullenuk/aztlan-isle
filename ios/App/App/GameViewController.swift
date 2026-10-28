import UIKit
import WebKit
import Capacitor

/// The game's screen: the Capacitor web view, played full screen. The status bar and home
/// indicator are hidden (SystemBars `hidden` in capacitor.config.ts), and a swipe in from a screen
/// edge needs a second swipe to leave the game, so dragging the map near the edge doesn't close it.
class GameViewController: CAPBridgeViewController {
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Black behind the game while it loads (no white flash).
        view.backgroundColor = .black
        webView?.isOpaque = false
        webView?.backgroundColor = .black
        webView?.scrollView.backgroundColor = .black
        // Pinch and drag belong to the game's camera, never to page zoom or bounce.
        webView?.scrollView.bounces = false
        webView?.scrollView.pinchGestureRecognizer?.isEnabled = false
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Copy Island hands its file to the app, which offers the share sheet (AirDrop, Messages,
        // Save to Files). (Load Island uses the web page's own file picker, which iOS provides.)
        webView?.configuration.userContentController.add(IslandFileHandler(self), name: "islandFile")
    }

    /// Write the island file somewhere temporary and share it.
    fileprivate func share(name: String, text: String) {
        let safe = name.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe.isEmpty ? "island.aztlan.json" : safe)
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            return
        }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        // iPad: the sheet is a popover from the middle of the screen.
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        sheet.popoverPresentationController?.permittedArrowDirections = []
        present(sheet, animated: true)
    }
}

/// Receives Copy Island's file from the page (held weakly, so the web view never keeps the screen alive).
private final class IslandFileHandler: NSObject, WKScriptMessageHandler {
    weak var owner: GameViewController?
    init(_ owner: GameViewController) { self.owner = owner }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let text = body["text"] as? String else { return }
        owner?.share(name: body["name"] as? String ?? "island.aztlan.json", text: text)
    }
}
