import Foundation

let scriptURL = URL(fileURLWithPath: #filePath)
let fixtureRoot = scriptURL
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("contracts/v1/fixtures")
let fileManager = FileManager.default
guard let enumerator = fileManager.enumerator(
    at: fixtureRoot,
    includingPropertiesForKeys: [.isRegularFileKey],
    options: [.skipsHiddenFiles]
) else {
    fatalError("Mac Access contract fixture directory is unavailable")
}

var parsed = 0
for case let fileURL as URL in enumerator where fileURL.pathExtension == "json" {
    let data = try Data(contentsOf: fileURL)
    _ = try JSONSerialization.jsonObject(with: data)
    parsed += 1
}

guard parsed > 0 else {
    fatalError("no Mac Access contract fixtures found")
}
print("parsed \(parsed) Mac Access contract fixture files")
