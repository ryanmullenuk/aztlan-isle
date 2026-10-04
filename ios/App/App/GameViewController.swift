import UIKit
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
}
