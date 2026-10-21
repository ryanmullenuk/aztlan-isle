import AppKit

/// Aztlan Isle for the Mac: the same game the website and iOS app play (the built `dist/`
/// bundled inside the app), in one window that opens straight into full screen.
@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = Self.makeMenu()
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(1440, screen.width * 0.85), height: min(900, screen.height * 0.85))
        window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.title = "Aztlan Isle"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .black
        window.minSize = NSSize(width: 1024, height: 640)
        window.collectionBehavior = [.fullScreenPrimary, .managed]
        window.contentViewController = GameViewController()
        // Adopting the view controller sizes the window to its view; restore the intended size.
        window.setContentSize(size)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        // Play full screen from the start; the green button or Ctrl-Cmd-F (View menu) leaves it.
        // macOS ignores the request until the app is frontmost and the window is on screen, so
        // ask once the app first becomes active.
        if NSApp.isActive { enterFullScreenSoon() }
    }

    private var startedFullScreen = false

    func applicationDidBecomeActive(_ notification: Notification) {
        enterFullScreenSoon()
    }

    private func enterFullScreenSoon() {
        guard !startedFullScreen else { return }
        startedFullScreen = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let window = self?.window, !window.styleMask.contains(.fullScreen) else { return }
            window.toggleFullScreen(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    private static func makeMenu() -> NSMenu {
        let main = NSMenu()
        let name = "Aztlan Isle"

        let appMenu = NSMenu(title: name)
        appMenu.addItem(withTitle: "About \(name)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(name)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit \(name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(withTitle: name, action: nil, keyEquivalent: "").submenu = appMenu

        let view = NSMenu(title: "View")
        let full = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        main.addItem(withTitle: "View", action: nil, keyEquivalent: "").submenu = view

        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimise", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        main.addItem(withTitle: "Window", action: nil, keyEquivalent: "").submenu = windowMenu
        NSApp.windowsMenu = windowMenu
        return main
    }
}
