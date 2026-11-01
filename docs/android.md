# Go2 Pocket for Android

The Android app shares the same TypeScript, WebRTC, robot commands, audio,
LiDAR/SLAM and visual design as the iPhone app. It runs independently of a Mac.
Native Android code supplies Wi-Fi discovery/routing and immersive Drive mode;
the existing Capacitor plugins supply Bluetooth, microphone, file sharing,
haptics and orientation. G1/R1 remain hidden, as on iPhone.

## Build

Requirements: Node, Java 21, Android SDK **37.0**, Build Tools 36.0.0 and
Platform Tools. Accept the Google Android SDK license yourself before installing
SDK packages. `JAVA_HOME` and `ANDROID_HOME` can point to an existing installation.
On this Mac the downloaded tools are in `output/android-tools/`; no Android Studio
installation is required to run the build script.

```sh
npm install
npm run check
npm run android:build
```

Output: `output/android/Go2Pocket-debug.apk`. This is a development APK signed
with the Mac's Android debug key. Preserve that key for future in-place updates.
The Gradle wrapper uses 9.3.1 and AGP 9.1.1, officially supporting Android 17.
The legacy Android/Kotlin DSL flags remain enabled for Capacitor 8 plugins.

## Install

Enable Developer options and USB debugging on the phone. Authorize this Mac on
the phone, then use Android SDK Platform Tools:

```sh
adb devices -l
adb -s YOUR_PIXEL_SERIAL install -r output/android/Go2Pocket-debug.apk
adb -s YOUR_PIXEL_SERIAL shell am start -n com.mzhou.go2pocket/.MainActivity
```

Package: `com.mzhou.go2pocket`, display name: Go2 Pocket.
The iPhone installation is a separate native target and is not overwritten.

## Permissions and connectivity

- Android 17: allow the local network / Nearby devices prompt when searching
  for or connecting to Go2. Denial produces an actionable connection error.
- Bluetooth: allow Nearby devices when scanning for Go2 or a remote. Pairing
  in Android's Bluetooth Settings is not required. BLE scanning does not derive
  location; Android 12+ therefore does not request location permission.
- Microphone: requested when using talk/record. The robot camera is received
  over WebRTC; phone-camera access is not required.
- Wi-Fi: both phone and robot must be on the same LAN, or manually join Go2's
  hotspot in Settings. Selecting AP in the app does not join that Wi-Fi.
- During Local/AP control, the app selects the Wi-Fi network for its own HTTP
  and WebRTC connections, including when cellular is the internet default.
  Disconnecting or selecting Remote releases this selection. Sign in and cache
  the robot key before moving to an AP without internet.
- Sign into the existing Unitree account with Region China to load the bound
  Go2 key. iPhone account tokens/passwords are not copied into Android.

## Foldable behavior

The cover screen uses landscape Drive with the original top toolbar and
edge-to-edge scene. Android's native DrivePresentation controller owns both
orientation requests and system-bar visibility. It waits for the compact
landscape window to be measured before applying fullscreen, then reapplies it
on relevant layout/focus changes using the latest requested mode. The inner
screen can show both sticks and the camera/map without relying on an orientation
lock, which Android 17 can ignore on large displays. Fold/resize changes release
joystick inputs; the WebRTC session remains managed by the same app logic.
Drive hides system bars and keeps the screen awake; leaving Drive restores them.
Android Back releases controls and returns to Home; Back from Home exits.

The installed Pixel build 20 temporarily docks controls at the bottom because
top-edge touches were lost before reaching the Activity. The restored top
layout and sequencing changes are prepared locally in build 22 but await real
device validation; see [the investigation](android-top-touch-investigation.md).

## Validation

`npm run check` runs both Android and iPhone mock BLE V3 checks, crypto/routing,
camera framing, the saved Trick or Treat audio lifecycle and foldable layout
rules. Native JVM tests cover bounded discovery subnets and Go2 AP addressing.
Real robot movements are not run during build/install/UI validation.

Feature availability on Go2 Pro still depends on its firmware, exactly as on
iPhone; the existing API 1029 greeting guard is retained.

References: [Capacitor Android](https://capacitorjs.com/docs/android),
[Android local network permission](https://developer.android.com/privacy-and-security/local-network-permission),
[AGP 9.1.1 compatibility](https://developer.android.com/build/releases/agp-9-1-0-release-notes).
