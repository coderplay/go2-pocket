# Go2 Pocket

An independent iPhone and Android app for the Unitree Go2, built with
TypeScript, Three.js, WebRTC and Capacitor. The mobile apps connect directly to
the robot; a Mac or desktop relay is not required during use.

Based on [legion1581/unitree_ui](https://github.com/legion1581/unitree_ui).
This is a community project, not the official Unitree app or SDK.

## Features

- Phone-oriented English interface, landscape driving and foldable layouts.
- Dual joysticks, Stop, stand/lie-down and the robot's action menu.
- Camera video and 3D LiDAR with switchable main/PiP views and zoom gestures.
- Unitree account/device-key login, local Wi-Fi, direct AP and remote connections.
- Native Bluetooth provisioning and Wi-Fi discovery on both platforms.
- Robot audio playback/upload/recording, listen and push-to-talk interfaces.
- LiDAR/SLAM, mapping, navigation, patrol and docking interfaces, subject to
  robot firmware and available hardware.
- Local map storage, import/export and native file sharing.
- Dance 1 with a saved Trick or Treat recording, including audio-loop cleanup.

Robot firmware determines which functions actually work. No automatic charging
dock is included or assumed. API 1029 (New Year greeting) remains blocked after
an unsafe test; restoring the button is not evidence that an action is safe.

## Quick start

Use Node.js 22.18 or later and npm. Native builds additionally require the
platform tools described below.

```sh
git clone https://github.com/coderplay/go2-pocket.git
cd go2-pocket
npm ci
npm run check
npm run build
```

For an interface preview with robot/cloud/Bluetooth requests blocked:

```sh
npm run dev
# Open http://127.0.0.1:5186/?preview=1
```

The optional `server/` helpers are for desktop/browser development. Native
iPhone and Android builds use their own networking and Bluetooth integrations.

## iPhone

Requires macOS, Xcode and an Apple development-signing account.

```sh
npm run ios:sync
npm run ios:open
```

In Xcode, select your team under **Signing & Capabilities**, choose a unique
bundle identifier if needed, select your connected iPhone, then build/run.
See [iPhone build and installation](docs/ios.md), including development-signing
renewal. Signing identities and provisioning profiles are not in this repository.

## Android

Requires Java 21 and Android SDK 37.0 / Build Tools 36.0.0. Configure `JAVA_HOME`
and `ANDROID_HOME` for your own installations.

```sh
npm run android:build
adb install -r output/android/Go2Pocket-debug.apk
```

Alternatively, run `npm run android:open` and build in Android Studio.
See [Android setup, permissions and foldable behavior](docs/android.md).

## Connect to a robot

1. Sign into your Unitree account and load the robot/device key while online.
   Use the matching account region (China for a mainland-China account).
2. For Local Network, put the phone and Go2 on the same Wi-Fi. For AP, manually
   join the robot's hotspot in the phone's Wi-Fi settings first.
3. Open Drive, choose the connection mode and connect. AP uses `192.168.12.1`.
4. Use the app's Bluetooth setup page when provisioning is needed. System
   Bluetooth pairing is not required.

Use an open, level test area and have a physical controller available for motion
tests. Preview and automated tests do not execute physical robot movements.

## Source layout

| Path | Contents |
| --- | --- |
| `src/mobile/` | Phone shell, native transports, Bluetooth and mobile styling |
| `src/ui/` | Shared controls, camera, LiDAR, audio, maps and robot features |
| `ios/` | Xcode project and native Swift discovery integration |
| `android/` | Gradle project, Java discovery/routing and Drive presentation |
| `public/` | App icons, robot models, media and other bundled assets |
| `scripts/` | Protocol, media and lifecycle checks; Android build helper |
| `server/` | Optional desktop/browser development helpers |
| `docs/` | Protocol notes, platform setup and known issues |

## Current validation status

- The iPhone build has been installed and launched on a physical iPhone.
- The Android build has connected to a Go2 AP on a Pixel Fold; camera, LiDAR
  and device telemetry were verified on the physical phone.
- The current Android source restores the top toolbar and consolidates native
  rotation/fullscreen sequencing. Seven JVM timing/lifecycle tests pass, but
  this latest change **still needs physical-device validation** for the Pixel
  top-edge touch issue. See [the investigation](docs/android-top-touch-investigation.md).
- Tests cover protocol cryptography, native BLE fixtures, framing, bundled
  audio and dance/audio lifecycle. CI runs the hardware-independent checks.

The repository contains source, not signed iPhone binaries or Android release
keys. Build products, SDK downloads, device logs and local deployment records
are excluded.

## License

The upstream MIT license and original copyright notice are preserved in
[LICENSE](LICENSE).
