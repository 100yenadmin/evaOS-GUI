import CryptoKit
import Foundation

private struct VerificationRequest: Decodable {
    let publicKey: String
    let message: String
    let signature: String
}

private let maximumRequestBytes = 96 * 1024
private let maximumMessageBytes = 64 * 1024

private func fail(_ status: Int32) -> Never {
    Foundation.exit(status)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard !input.isEmpty, input.count <= maximumRequestBytes else {
    fail(2)
}

let decoder = JSONDecoder()
guard
    let request = try? decoder.decode(VerificationRequest.self, from: input),
    let publicKey = Data(base64Encoded: request.publicKey),
    let message = Data(base64Encoded: request.message),
    let signature = Data(base64Encoded: request.signature),
    publicKey.count == 32,
    message.count <= maximumMessageBytes,
    signature.count == 64,
    let verifier = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey)
else {
    fail(2)
}

fail(verifier.isValidSignature(signature, for: message) ? 0 : 3)
