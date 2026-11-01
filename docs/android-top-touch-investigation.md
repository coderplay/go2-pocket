# Pixel landscape top-edge touch investigation

Status on 2026-10-24: investigation in progress; no permanent fix claimed.

Device build: `google/yogi/yogi:17/CD1A.261005.003/16262255:user/release-keys`.
Cover landscape: 2342 × 1080 native pixels, about 1135 × 523 CSS pixels.

## Evidence from the device

- DOM hit testing returned the correct top toolbar buttons.
- Top native taps did not produce DOM pointer events. The same buttons received
  native pointer down/up/click after moving them down.
- A temporary Activity `dispatchTouchEvent` counter stayed at zero for top taps.
  The WebView's native bounds covered the whole 2342 × 1080 window. Diagnostics
  were removed after collecting this evidence.
- Input-window diagnostics showed a touchable `NotificationShade` system window.
  Capturing the active touch recipient is the next step to establish the exact
  owner, rather than assuming that this window intercepted every lost tap.
- Both landscape directions were affected. Switching fullscreen behavior,
  explicitly refreshing shown/hidden system bars, legacy fullscreen flags and
  collapsing the notification panel did not restore top taps.

These results locate the loss before the app Activity receives the event. They
do not establish which Android source-code defect produced the stale region.

## External evidence and next controlled check

An [original Pixel user report](https://www.reddit.com/r/GooglePixel/comments/1wf5mf8/pixel_10_pro_android_17_top_part_of_touchscreen/)
describes the same Android 17 fullscreen/landscape behavior in multiple apps,
including both orientations. Its reported recovery was toggling Transparent
navigation bar on/off and rebooting. This is a hypothesis to test on this phone,
not proof that its cause or a permanent fix is the same.

[AOSP's preference implementation](https://android.googlesource.com/platform/packages/apps/Settings/+/refs/heads/main/src/com/android/settings/development/TransparentNavigationBarPreferenceController.java)
shows that the switch enables/disables the resource overlay
`com.android.internal.systemui.navbar.transparent`. A controlled test should
record the existing overlay state, capture the input recipient before/after a
temporary toggle, restore the original state and retest the actual top buttons.
Rebooting needs coordination with the owner because it interrupts the phone.

## Confirmed app sequencing defects and prepared changes

The installed ScreenOrientation plugin's `lock()` resolves immediately after
`setRequestedOrientation`; its promise does not wait for rotation/layout. The
old Android shell then called StatusBar.hide/show and a separate native
setDriving method, with another immediate system-bar application inside
onConfigurationChanged. This allowed fullscreen requests while the compact
window still had portrait bounds. The code path also captured a requested mode
across several asynchronous calls, permitting obsolete display work during
rapid navigation. These are confirmed sequencing issues in our code; they are
not yet proven to have caused the observed SystemUI touch loss.

Build 22 removes the compact bottom-dock workaround and restores the toolbar,
Stop button, PiP and quick actions to their original positions. Android now
routes orientation and bars through one native DrivePresentation controller.
It applies bars after layout, checks actual focus and measured viewport
readiness, coalesces callbacks and always uses the latest requested mode.
Large inner displays can enter Drive without waiting for an orientation request
that Android may ignore. The iOS display path remains unchanged.

Seven new JVM tests cover delayed rotation, leaving before rotation completes,
rapid reentry, large-screen orientation behavior, focus return, coalesced layout
callbacks and destroyed windows. They passed, as did the existing npm checks,
native build, APK signature verification and all 190 packaged-asset comparisons.
The new version has not been installed or verified on the phone. The owner
requested continuing code work while the phone is disconnected. Its current
installation remains build 20.

`output/checks/pixel-top-touch.py` requires native button down/up/click events
with each button still in the top quarter of the screen. It also checks actual
Settings open/close and Back navigation in isolated preview mode. This prevents
declaring success by moving controls out of the failing region. After recovery,
repeat across leaving/reentering Drive, both landscape directions and folding.
