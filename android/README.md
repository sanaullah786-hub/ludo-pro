# android/

This folder holds the native Android project (Gradle) that Capacitor generates.

It is created by `npx cap add android` from `capacitor.config.json`
(app id `com.sanaullahkhoso.ludopro`, app name `Ludo Pro`). The GitHub Actions workflow
`.github/workflows/build-apk.yml` does this automatically when `android/gradlew` is not present,
so you do not have to commit the generated project.

To work on it locally:

```bash
npm install
npm run build
npx cap add android      # once
npm run assets           # native icons + splash from /assets
npm run android:sync     # copies www/ into the project and patches it
cd android && ./gradlew assembleDebug
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.
