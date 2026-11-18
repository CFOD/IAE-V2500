# Android app

The Android app is the browser version (`dist-web/`) wrapped by Capacitor. The page runs in the system
WebView and needs no network: the model, the physics and the sounds are all inside the app.

| | |
|---|---|
| Package (application id) | `uk.co.cfod.v2500` |
| Name on the home screen | V2500 Sim |
| Android versions | 7.0 (API 24) and newer; built against API 36 |
| Screen | landscape (either way up), kept awake, status and navigation bars hidden (swipe to show) |

## Building

Needs Node, Java 21 and the Android SDK (platform 36, build-tools 36). Android Studio installs the SDK;
point `android/local.properties` at it (`sdk.dir=...`, not committed).

```
npm run android:debug     # web build with the sounds, copy into android/, debug APK
npm run android:store     # web build WITHOUT the sound pack, signed release bundle (.aab)
```

- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`. It is signed with the debug key, so it
  installs by sideloading (open the file on the phone and allow installs from that app) but cannot go
  to Play.
- Opening `android/` in Android Studio also works: run `npm run android:sync` first so the web files are
  copied in.

The web files under `android/app/src/main/assets/public` are copied by `npx cap sync` and are not
committed. Change the app in `app/` and `src/` as usual and rebuild.

## Native changes (android/app/src/main)

- `MainActivity.java`: keeps the screen on, hides the system bars (immersive), lets sound start without
  a tap on the page.
- `AndroidManifest.xml`: `sensorLandscape`.
- Icon and splash in `res/` (dark background, generated from the web icon).

## Putting it on Google Play

Things that have to be in place before a store release:

1. **Sound.** The FTSiM+ recordings are a commercial pack licensed to one user. They can go in a
   sideloaded copy for personal use, as on the test website, but not in an app published on a store.
   `android:store` therefore builds without them (the built-in synthesized sound is used). Store sound
   needs recordings we own or that are licensed for redistribution.
2. **Developer account.** A Play Console account (one-off fee, identity check).
3. **Testing rule.** New personal accounts must run a closed test with at least 12 testers for 14 days
   before production is unlocked. Internal testing (up to 100 testers, no review wait) is available at
   once and is the easiest way to get the app on your own phone through Play.
4. **Signing.** Play App Signing holds the app key; we sign uploads with an upload key kept
   outside the repository (`android/keystore.properties`, see below). Losing the upload key can be
   recovered through Play support, but keep a backup.
5. **Listing.** Privacy policy URL (the app collects nothing; a short page on cfod.co.uk will do),
   data-safety form (no data collected or shared), content rating questionnaire, screenshots, a
   512 px icon and a 1024x500 feature graphic.
6. **Names.** IAE, V2500, Airbus and A320 are trademarks. The listing should describe the app as an
   unofficial simulator "of the V2500 engine" and say it is not affiliated with or endorsed by IAE,
   Pratt & Whitney, MTU, JAEC or Airbus. Avoid their logos.
7. **Target API.** Play requires a recent target SDK (the project targets 36). Each August the
   minimum moves up; bump `targetSdkVersion` in `android/variables.gradle` when it does.

### Release signing

`android/app/build.gradle` reads `android/keystore.properties` if it exists:

```
storeFile=/path/to/upload-key.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

Create the key once with
`keytool -genkeypair -v -keystore upload-key.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000`.
Neither file goes in the repository.
