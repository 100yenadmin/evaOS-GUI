# Uninstall evaOS Mac Access

1. Open the Mac Access menu and choose **Prepare to Uninstall…**.
2. Wait for Mac Access to revoke the selected VM, turn access Off, erase the active connector
   credential, unregister its exact login item, and quit.
3. Move **evaOS Mac Access.app** to the Trash.

If the app does not quit, cleanup did not complete. Leave the app installed and retry; do not delete
its files while it may still be connected.

Mac Access intentionally preserves its non-secret revoked/Off policy tombstone and redacted audit
chain in `~/Library/Application Support/evaOS/MacAccess`. Reinstalling the signed app remains revoked
and Off until a new pairing succeeds. The helper, connector, private runtime, and Sparkle components
remain inside the app bundle; v0.1 installs no LaunchAgent or privileged helper outside that bundle.
