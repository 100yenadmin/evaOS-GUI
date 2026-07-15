import Foundation

let scriptURL = URL(fileURLWithPath: #filePath)
let contractRoot = scriptURL
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("contracts/v1")
let fileManager = FileManager.default

var parsed = 0
for directoryName in ["fixtures", "golden"] {
    let directory = contractRoot.appendingPathComponent(directoryName)
    guard let enumerator = fileManager.enumerator(
        at: directory,
        includingPropertiesForKeys: [.isRegularFileKey],
        options: [.skipsHiddenFiles]
    ) else {
        fatalError("Mac Access contract \(directoryName) directory is unavailable")
    }
    for case let fileURL as URL in enumerator where fileURL.pathExtension == "json" {
        let data = try Data(contentsOf: fileURL)
        _ = try JSONSerialization.jsonObject(with: data)
        parsed += 1
    }
}

guard parsed > 0 else {
    fatalError("no Mac Access contract fixtures or golden vectors found")
}
print("parsed \(parsed) Mac Access contract fixture and golden-vector files")
