import Dispatch

@main
enum MacAccessHelperMain {
    static func main() {
        // A2 intentionally exposes no XPC authority until signed-client authentication exists.
        dispatchMain()
    }
}
