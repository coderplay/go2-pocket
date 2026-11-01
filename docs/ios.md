# iPhone build and installation

The iOS target uses the shared mobile UI, native CoreBluetooth and a Swift UDP
discovery plugin. Video and control data travel directly between phone and Go2.

## Build from a fresh checkout

Requirements: macOS, Xcode, Node.js 22.18+ and npm. Review and accept Apple's
development terms yourself, then sign into your Apple account in Xcode.

```sh
npm ci
npm run check
npm run ios:sync
npm run ios:open
```

Select the App target and your team under **Signing & Capabilities**. Use a
bundle identifier that your account can provision. The repository's default is
`com.mzhou.go2pocket`; it does not grant access to anyone else's signing team.

Connect the phone using a data cable, trust the computer, enable Developer Mode
if requested, and select the physical iPhone as the Xcode run destination.
Build and run. Handle keychain/password/verification prompts directly on your
devices, and trust the developer app in iPhone Settings if prompted.

For an optional local Debug signing override, create the ignored file
`ios/Signing.local.xcconfig`:

```xcconfig
DEVELOPMENT_TEAM = YOUR_TEAM_ID
```

Do not commit certificates, private keys or provisioning profiles.

## Renew an expired development installation

A free Personal Team development profile expires after seven days. To renew,
sign into Xcode, connect the same iPhone and build/run again with automatic
signing. Install over the existing app using the same bundle identifier and
team to retain its data; do not uninstall it first.

For an existing build's signing renewal, rebuilding the Xcode project is enough.
Run `npm run ios:sync` first only when you intend to install updated web assets.
If iOS asks to verify the developer again, open **Settings → General → VPN &
Device Management** and follow its Trust/Verify instructions with internet
access available.

## Connectivity permissions

- Allow local network access to discover/connect to Go2.
- Allow Bluetooth when using in-app provisioning or BLE remote support.
- Microphone permission is used for recording and push-to-talk.
- For AP mode, manually join Go2's hotspot in Settings → Wi-Fi before connecting.
- Sign in and cache the device key before joining an AP without internet.

The native app does not require a desktop BLE server or proxy to remain running.
