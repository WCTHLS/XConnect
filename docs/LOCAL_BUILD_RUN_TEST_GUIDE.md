# Local Build, Run & Test Guide (main branch)

This is a practical, field-tested companion to the root [`README.md`](../README.md). The README covers
the intended happy path; this document covers what actually happens the first time you set this up on a
clean Windows machine, including two real bugs currently present on `main` that will block you unless you
patch them first.

**If you're on `feature/motion-sensor`**, all three fixes in §2 below are already applied there as
uncommitted working-tree changes (not yet committed to that branch, but present on disk), you can skip
straight to [Running It](#running-it). Any other branch, including `main` itself, still has all three bugs
and needs the patches applied manually.

---

## 1. Environment Prerequisites

Beyond what the README lists, in practice you need all of these installed and verified working, in order:

1. **Node.js v20+** and **pnpm v10+** (`npm install -g pnpm`).
2. **Android Studio**, with the SDK actually downloaded, installing the app is not enough:
   - Open Android Studio → **More Actions → SDK Manager** → do a **Standard** install. This is a separate
     multi-GB download from the app itself.
   - Confirm `adb` exists: `C:\Users\<you>\AppData\Local\Android\Sdk\platform-tools\adb.exe`.
3. **Environment variables** (Windows: System Properties → Environment Variables):
   - `ANDROID_HOME` = `C:\Users\<you>\AppData\Local\Android\Sdk`
   - Add to `Path`: `%ANDROID_HOME%\platform-tools` and `%ANDROID_HOME%\emulator`
4. **JDK 17** specifically, not whatever else you have installed:
   - Gradle 8.x (used by this project) cannot run on JDK 21+ (`Unsupported class file major version` error),
     and a 32-bit JRE will fail with `Could not reserve enough space for ... object heap`.
   - Easiest fix: point `JAVA_HOME` at Android Studio's bundled JBR
     (`C:\Program Files\Android Studio\jbr`) **if** it resolves to a compatible version, otherwise install
     Temurin 17 explicitly:
     ```
     winget install --id EclipseAdoptium.Temurin.17.JDK -e
     ```
     then set `JAVA_HOME` to wherever that installed (e.g. `C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot`).
5. **A physical Android phone**, BLE cannot be tested in an emulator. Enable Developer Options (tap Build
   Number 7×) and USB Debugging, plug in via USB, accept the "Allow USB debugging?" prompt.

Verify everything before going further:
```bash
adb version        # should print a version, not "not recognized"
adb devices         # should list your phone as "device", not "unauthorized" or empty
java -version        # should report 17.x
```

---

## 2. Known Issues on `main` (patch these first)

These two bugs are real, reproducible, and unrelated to any environment problem, they're in the checked-in
native Android code. Without patching them, a dev-client build will install but crash/fail to load on
launch with `Unable to load script` or a `NullPointerException` on the dev-launcher's own error screen.

### 2.1 `getUseDeveloperSupport()` is hardcoded to `false`

> ✅ Already fixed (uncommitted) on `feature/motion-sensor`.

File: `apps/mobile/android/app/src/main/java/com/confpresence/zero/MainApplication.kt`

```kotlin
// Currently on main:
override fun getUseDeveloperSupport(): Boolean = false
```

This means the app never even attempts to reach Metro, it behaves like a release build permanently,
regardless of any network/firewall/JDK setup. Fix:

```kotlin
override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG
```

### 2.2 Missing `expo-splash-screen` dependency

> ✅ Already fixed (uncommitted) on `feature/motion-sensor`.

`expo-dev-launcher` (this project's SDK 54 version) requires `expo-splash-screen` as a companion
dependency that was never added. Without it you'll see:
```
java.lang.ClassNotFoundException: expo.modules.splashscreen.SplashScreenManager
```
Fix:
```bash
npx expo install expo-splash-screen
```
(run from `apps/mobile`)

### 2.3 Metro fails to resolve `./App` in this monorepo layout

> ✅ Already fixed (uncommitted) on `feature/motion-sensor`.

Symptom: `Unable to resolve module ./App from <repo root>/.` even though `App.tsx` exists right there in
`apps/mobile/`. This happens because Metro's bundle-URL-to-file resolution defaults to
`config.projectRoot`, which in a pnpm workspace can end up misaligned. Fix, in
`apps/mobile/metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);

config.server = {
  ...config.server,
  unstable_serverRoot: __dirname,
};

module.exports = config;
```

---

## 3. Running It

### 3.1 Start the API server
```bash
pnpm --filter @confpresence/api dev
```
Confirm: `curl http://localhost:3000/health` → `{"ok":true}`.

### 3.2 Start Metro
**Must be run from `apps/mobile`, not the repo root** — running it from the wrong directory silently
serves a broken config and reintroduces the `./App` resolution error above.
```bash
cd apps/mobile
npx expo start --dev-client
```

### 3.3 Build and install on your phone (first time, or after any native change)
```bash
pnpm --filter @confpresence/mobile android
```
This compiles the native Kotlin BLE/Wi-Fi modules, installs the APK, and connects to Metro. Takes several
minutes. You only need to redo this for native (`android/`) changes, pure JS/TS edits hot-reload instantly
through the already-running Metro instance.

### 3.4 Getting the phone to actually reach the API server

This is the step most likely to silently fail. Two working paths:

#### In-app server selector

The app has a three-way server picker (`apps/mobile/App.tsx`):

- **Cloud** — points at the deployed Render.com API (`CLOUD_API_URL`), works out of the box with no local
  setup, but you won't see any of your local backend changes since it's hitting production, not `pnpm dev:api`.
- **Local Laptop** — a one-tap convenience button, but it's backed by a **hardcoded IP address**
  (`LOCAL_API_URL` in `App.tsx`) that belonged to whoever last edited that constant. It will almost
  certainly be wrong on your machine. Either edit that constant to your own current LAN IP, or just ignore
  this button and use **Custom** instead.
- **Custom** — a free-text field where you type the exact URL to hit. This is the one you actually want for
  local development:
  - USB tunnel: `http://localhost:3000`
  - Wi-Fi/LAN: `http://<your-PC's-current-LAN-IP>:3000`

**Your PC's LAN IP changes** depending on which network you're on (home Wi-Fi vs. a phone hotspot vs. a
different office network all give you a different IP), and it can also change on the *same* network after a
router reboot or lease renewal. There's no way around re-checking it (`ipconfig`) each time you switch
networks and re-typing it into the Custom field, the app doesn't auto-detect this for you reliably (there is
an "Auto-Detect Local Laptop IP" button that sweeps a short hardcoded candidate list plus your current
value, but it isn't guaranteed to include your actual current IP).



**USB (most reliable):**
```bash
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
```
This tunnels the phone's own `localhost` to your PC's `localhost` over the cable, bypassing Wi-Fi and
firewall entirely. In the app, set the server URL to `http://localhost:3000`.

**Note:** these tunnels do **not** persist across USB reconnects/reboots. If the app suddenly can't reach
the server after unplugging/replugging, re-run the two commands above.

**Wi-Fi:**
1. Find your PC's LAN IP: `ipconfig` → IPv4 Address under your Wi-Fi adapter.
2. In the app, use **Custom** → `http://<that-IP>:3000`.
3. **This will likely fail with "Server unreachable" the first time**, for two possible reasons:
   - **Windows Firewall**: by default, inbound connections to Node.js are blocked unless an explicit Allow
     rule exists. Run as Administrator:
     ```powershell
     New-NetFirewallRule -DisplayName "ConfPresence Dev" -Direction Inbound -Protocol TCP -LocalPort 3000,8081 -Action Allow -Profile Private
     ```
     Also confirm your Wi-Fi's network profile is **Private**, not **Public**
     (Settings → Network & Internet → Wi-Fi → your network → Network profile type).
   - **Router client isolation**: if you don't control the router (hotel/shared/guest Wi-Fi), it may block
     devices from reaching each other even on the same network. If disabling isolation isn't an option,
     turn on a mobile hotspot from one phone and connect both the PC and the other test device to it, phone
     hotspots essentially never have this restriction.

---

## 4. Testing

### 4.1 Backend inference tests
```bash
pnpm --filter @confpresence/api test
```

### 4.2 Typechecking
```bash
pnpm typecheck
```

### 4.3 Multi-device manual test (the real test — BLE cannot be meaningfully unit tested)
1. Device 1: role **Presenter**, set a room name, tap Start.
2. Device 2 (different physical device, same Wi-Fi/session): role **Attendee**, tap Start.
3. Within 15–30 seconds, Device 2 should be detected in Device 1's live roster, and Device 2 should
   auto-detect the presenter's room.
4. Watch the API server's terminal, it live-logs every ingested batch, BLE peer counts, Wi-Fi AP counts,
   and room cluster resolution as they happen.
5. In-app, the floating **Logs** button opens a real-time diagnostics view (BLE/WIFI/API/ROOM event log),
   useful for debugging without a laptop-tethered `adb logcat`.

### 4.4 Full reload without a rebuild
For JS/TS-only changes after the app is already installed, you don't need to rebuild the APK:
```bash
adb shell am force-stop com.confpresence.zero
adb shell am start -n com.confpresence.zero/.MainActivity
```
This relaunches the app fresh against whatever Metro is currently serving.

---

## 5. iOS Build Guide

> ⚠️ **Unverified.** Everything above this section was tested live against a real Android device this
> session. This iOS section was **not** tested against a real device or Xcode, there was no macOS machine
> available. It's written from the project's actual current state plus standard Expo/React Native practice.
> Treat it as a starting point, not a guarantee, and expect to hit at least one undocumented snag.

### 5.1 Hard requirement: macOS

Building and running an iOS native app requires Xcode, which only runs on macOS. There is no way to do this
from Windows, you'll need a Mac (or a cloud Mac service / CI like EAS Build) for anything in this section.

Prerequisites on the Mac:
- **Xcode 15+** (from the Mac App Store), plus its Command Line Tools (`xcode-select --install`).
- **CocoaPods**: `sudo gem install cocoapods`.
- **An Apple ID**, a free personal team is enough to build and run on your own device for local testing
  (builds expire after 7 days and need re-signing); a paid Apple Developer account ($99/yr) is only needed
  for TestFlight/App Store distribution.
- A physical iPhone, same as Android, BLE cannot be meaningfully tested in the iOS Simulator.

### 5.2 Important: the native iOS project doesn't exist yet

Unlike `apps/mobile/android/`, which is a fully generated, checked-in native project, `apps/mobile/ios/`
currently contains **only** the loose native module source files:
```
apps/mobile/ios/ConfPresenceBleModule.swift
apps/mobile/ios/ConfPresenceBleModule.m
apps/mobile/ios/ConfPresenceWifiModule.swift
apps/mobile/ios/ConfPresenceWifiModule.m
```
There is no `.xcodeproj`, `.xcworkspace`, or `Podfile` yet. These files aren't wired into anything until a
real Xcode project is generated around them.

### 5.3 Generate the native project

From `apps/mobile`, on the Mac:
```bash
npx expo prebuild --platform ios
```

**Do not use `--clean`** the first time, or if you do, **back up the four files listed above first**.
`expo prebuild --clean` regenerates the `ios/` folder from scratch based on `app.json` and installed Expo
modules; since these custom native modules aren't registered through an Expo config plugin (there's no
`plugins` entry in `app.json`), a clean prebuild has no way of knowing to keep them and will likely wipe
them. After a clean prebuild, you'd need to manually re-copy the four files back into the generated `ios/`
folder and re-add them to the Xcode target (see 5.4).

### 5.4 Verify the native modules are actually linked

After prebuild, open the workspace (see 5.5) and confirm the four files show up under the app target in
Xcode's file navigator. If they don't (likely, since prebuild only knows about files it generated), add them
manually: right-click the app group in Xcode → **Add Files to "mobile"** → select the four files → ensure
**Copy items if needed** is off (they're already in place) and the app target's checkbox is ticked.

### 5.5 Install pods and open the project

```bash
cd ios
pod install
open *.xcworkspace
```
Always open the `.xcworkspace`, not the `.xcodeproj`, once CocoaPods is involved.

### 5.6 Configure signing

In Xcode: select the project → the app target → **Signing & Capabilities** → set your **Team** to your
Apple ID's personal team (or your organization's, if you have a paid account) → let Xcode auto-manage the
provisioning profile.

### 5.7 Build and run

1. Plug in your iPhone, trust the computer on the device if prompted.
2. Select your device (not a simulator) from Xcode's device dropdown.
3. Press **Run** (▶), or from the terminal instead of Xcode:
   ```bash
   npx expo run:ios --device
   ```
4. First launch may require, on the iPhone: **Settings → General → VPN & Device Management** → trust your
   developer certificate.

### 5.8 Metro

Same as Android, run from `apps/mobile`:
```bash
npx expo start --dev-client
```
The iOS dev-client connects the same way (shake gesture opens the same Dev Menu). No `adb reverse`
equivalent is needed if the iPhone and Mac are on the same Wi-Fi network with no client isolation, iOS
devices don't have a USB-tunnel workflow like `adb reverse`; Wi-Fi is the normal path.

### 5.9 Platform constraints specific to this app (know these before testing)

These aren't setup bugs, they're real iOS platform restrictions that affect what will and won't work,
covered in more depth earlier in this project's design discussions:

| Capability | iOS behavior |
|---|---|
| Wi-Fi AP scanning | **Not available at all.** Apple provides no public API for apps to scan nearby Wi-Fi access points. The Wi-Fi-fingerprint half of this app's room-detection logic has no iOS equivalent, expect `wifiFingerprint` to always be empty on iOS unless this is reworked. |
| BLE advertising in background | Only reliable while the app is in the **foreground**. A backgrounded iPhone will stop broadcasting its rotating token. |
| BLE scanning/region detection in background | Reliable *only* if restructured around iOS's iBeacon region-monitoring API (`CoreLocation`), which is a different mechanism from the raw BLE central-mode scanning currently used (`ConfPresenceBleModule`). |
| `DeviceMotion` (motion-sensor feature) | Works identically to Android while the app is foregrounded; updates are **not delivered while the app is suspended** in the background. |
| Info.plist permissions | Already declared in `app.json` (`NSBluetoothAlwaysUsageDescription`, `NSBluetoothPeripheralUsageDescription`, `NSLocationWhenInUseUsageDescription`); no changes needed for BLE/location. `DeviceMotion` needs no permission entry at all. |

---

## 6. Quick Diagnosis Reference

| Symptom | Likely cause |
|---|---|
| `adb devices` shows nothing / `unauthorized` | USB debugging not enabled, or the on-phone confirmation popup wasn't accepted |
| `Unsupported class file major version ...` | Wrong JDK version active for Gradle — needs JDK 17 |
| `Could not reserve enough space for ... object heap` | 32-bit JRE selected instead of a 64-bit JDK |
| App installs but shows "Unable to load script" | Either `getUseDeveloperSupport()` still hardcoded `false`, or Metro isn't reachable (check §3.4), or Metro was started from the wrong directory (§3.2) |
| App crashes on pressing Reload in the dev-menu error screen | Known upstream Expo bug ([expo/expo#40183](https://github.com/expo/expo/issues/40183)), unrelated to this project — force-stop and relaunch instead of using that Reload button |
| `ClassNotFoundException: SplashScreenManager` | Missing `expo-splash-screen` — see §2.2 |
| App says "Server unreachable" over Wi-Fi but works over USB | Firewall/network-profile block, or router client isolation — see §3.4 |
| Works, then suddenly doesn't after unplugging/replugging USB | `adb reverse` tunnels dropped — rerun the two commands in §3.4 |
