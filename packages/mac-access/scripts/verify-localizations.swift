import Foundation

private let expectedLocales = Set([
    "en-US", "es-ES", "fa-IR", "fr-FR", "ja-JP", "ko-KR", "pt-BR", "ru-RU", "tr-TR", "uk-UA",
    "zh-CN", "zh-TW",
])
private let sourceLocale = "en-US"
private let keyPattern = try! NSRegularExpression(
    pattern: #"\"((?:action|activity|approval|blocker|mode|onboarding|permission|status)\.[A-Za-z0-9]+)\""#
)

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("localization verification failed: \(message)\n".utf8))
    exit(1)
}

guard CommandLine.arguments.count == 3 else {
    fail("usage: verify-localizations.swift Localizable.xcstrings SourceDirectory")
}

let catalogURL = URL(fileURLWithPath: CommandLine.arguments[1])
let sourceDirectory = URL(fileURLWithPath: CommandLine.arguments[2])
guard
    let root = try JSONSerialization.jsonObject(with: Data(contentsOf: catalogURL)) as? [String: Any],
    root["sourceLanguage"] as? String == sourceLocale,
    let strings = root["strings"] as? [String: Any], !strings.isEmpty
else {
    fail("catalog is missing sourceLanguage=en-US or non-empty strings")
}

var pendingTranslationCount = 0
for key in strings.keys.sorted() {
    guard
        let entry = strings[key] as? [String: Any],
        let localizations = entry["localizations"] as? [String: Any],
        Set(localizations.keys) == expectedLocales,
        let sourceEntry = localizations[sourceLocale] as? [String: Any],
        let sourceUnit = sourceEntry["stringUnit"] as? [String: Any],
        sourceUnit["state"] as? String == "translated",
        let sourceValue = sourceUnit["value"] as? String, !sourceValue.isEmpty
    else {
        fail("\(key) does not have one translated source plus exactly the 12 repository locales")
    }

    for locale in expectedLocales where locale != sourceLocale {
        guard
            let localization = localizations[locale] as? [String: Any],
            let unit = localization["stringUnit"] as? [String: Any],
            let state = unit["state"] as? String,
            let value = unit["value"] as? String, !value.isEmpty,
            state == "translated" || state == "needs_review"
        else {
            fail("\(key) has an empty or invalid \(locale) translation unit")
        }
        if state == "translated" && value == sourceValue {
            fail("\(key) falsely marks the source text as translated for \(locale)")
        }
        if state == "needs_review" { pendingTranslationCount += 1 }
    }
}

guard let enumerator = FileManager.default.enumerator(at: sourceDirectory, includingPropertiesForKeys: nil) else {
    fail("cannot enumerate \(sourceDirectory.path)")
}
var referencedKeys = Set<String>()
for case let fileURL as URL in enumerator where fileURL.pathExtension == "swift" {
    let source = try String(contentsOf: fileURL, encoding: .utf8)
    let range = NSRange(source.startIndex..<source.endIndex, in: source)
    for match in keyPattern.matches(in: source, range: range) {
        guard let keyRange = Range(match.range(at: 1), in: source) else { continue }
        referencedKeys.insert(String(source[keyRange]))
    }
}

let catalogKeys = Set(strings.keys)
let missingKeys = referencedKeys.subtracting(catalogKeys)
let unusedKeys = catalogKeys.subtracting(referencedKeys)
if !missingKeys.isEmpty { fail("source keys missing from catalog: \(missingKeys.sorted().joined(separator: ", "))") }
if !unusedKeys.isEmpty { fail("catalog keys not referenced by source: \(unusedKeys.sorted().joined(separator: ", "))") }

print(
    "Native catalog covers \(strings.count) source keys in exactly 12 locales; "
        + "\(pendingTranslationCount) non-English units remain explicitly marked needs_review."
)
