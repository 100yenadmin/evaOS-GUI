import Foundation

enum MacAccessConnectorPath {
    static func containingAppURL(
        connectorURL: URL,
        bundleIdentifierAt: (URL) -> String? = { Bundle(url: $0)?.bundleIdentifier }
    ) -> URL? {
        let connector = connectorURL.standardizedFileURL
        guard connector.lastPathComponent == "evaOS Mac Access Connector.app" else { return nil }
        let loginItems = connector.deletingLastPathComponent()
        guard loginItems.lastPathComponent == "LoginItems" else { return nil }
        let library = loginItems.deletingLastPathComponent()
        guard library.lastPathComponent == "Library" else { return nil }
        let contents = library.deletingLastPathComponent()
        guard contents.lastPathComponent == "Contents" else { return nil }
        let app = contents.deletingLastPathComponent()
        guard app.lastPathComponent == "evaOS Mac Access.app",
              bundleIdentifierAt(app) == "com.evaos.mac-access"
        else { return nil }
        return app
    }
}
