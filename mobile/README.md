# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   bun install
   ```

   (Bun creates/updates a `bun.lockb` lockfile — much faster than npm!)

2. Start the app

   ```bash
   bun expo start
   ```

   In the output, you'll find options to open the app in a

   - [development build](https://docs.expo.dev/develop/development-builds/introduction/)
   - [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
   - [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
   - [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

   You can also run platform-specific commands directly:

   ```bash
   bun run ios     # or: bun expo run:ios
   bun run android # or: bun expo run:android
   ```

   You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
bun run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.
- [Using Bun with Expo](https://docs.expo.dev/guides/using-bun): Official guide for Bun + Expo workflows

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.


### Quick notes
- Use `bun expo install <package>` (instead of `npx expo install`) when adding Expo-managed libraries — it picks the right compatible version automatically.
- If you ever need to force Bun explicitly: `bun expo start --bun`
- Bun is usually 4–25× faster than npm for installs, so you'll notice the difference right away.

## Formatting

- This repository uses Biome as the formatter/linter source of truth for JS/TS files.
- Use `bunx biome format --write .` from this `mobile/` directory when you want to format files manually.
- Prettier is intentionally not configured at project level in this workspace.

## Static Data Environment Setup

Mobile static data endpoints are controlled by Expo public env vars:

- `EXPO_PUBLIC_STATIC_DATA_BASE_URL`
- `EXPO_PUBLIC_STATIC_BUNDLES_BASE_URL`

Resolution order in app code:

1. If `EXPO_PUBLIC_*` vars are set, those values are used.
2. If not set:
   - Development (`__DEV__`): `http://127.0.0.1:3002/data`
   - Production: `https://davar.bible/data`

Local setup:

1. Keep `.env.example` as the committed template.
2. Treat `.env` as safe defaults only (no real secrets, no machine-specific LAN IPs).
3. Create `.env.local` for your machine-specific values.
4. For a physical device, replace `127.0.0.1` with your machine LAN IP.

Production setup:

1. Define the same `EXPO_PUBLIC_*` keys in EAS build environment variables (do not commit production secrets).
2. Point them to the production static JSON origin/path.

Notes:

- TS2009 translations are online-only and loaded from the static chapter JSON origin (`https://davar.bible/data` in production).
- TS2009 is intentionally excluded from the mobile offline bundle download and version-update path; the offline download covers Hebrew text, Spanish TTH, dictionary, and DSS data.
- Supabase is not required by the mobile runtime. The static data URLs above are the source of truth for mobile content.

## OTA Runtime Version Policy

- `expo.runtimeVersion` in [app.json](app.json) is intentionally a plain string for Expo bare workflow compatibility.
- Bump this string only when native compatibility changes (new/updated native modules, native config changes, SDK changes that alter native runtime expectations).
- Do not bump it for JS-only OTA updates, or you will unnecessarily fragment update targets.
- Keep this value aligned with release notes so build/update routing stays predictable.

## EAS Channel Policy

- Build profiles in [eas.json](eas.json) intentionally omit explicit channel fields.
- EAS uses the profile name as the implicit channel, so development, preview, and production map directly without extra channel config.
- Keep profile names stable, because renaming a profile changes its implicit update channel.

## Typography QA Checklist

Use this checklist after changing hebrewVerseMedium in [src/theme.ts](src/theme.ts):

1. Open a verse card screen and verify Hebrew word wrapping, line spacing, and selected-word states remain visually balanced.
2. Open the Settings slider preview and verify the sample Hebrew text scale still matches expected readability.
3. Compare Android and iOS side by side for clipping, overlap, or unexpected row spacing regressions.
4. Verify detail variant text density remains readable compared to card variant.
5. Capture before and after screenshots for VerseCard and Settings preview during release QA.

## Troubleshooting: Android Physical Device Cannot Load Books Metadata

Symptom:

- Logs show `Failed to load books metadata` with `Network request failed`.

Checklist:

1. Ensure phone and development machine are on the same Wi-Fi network.
2. Use LAN-IP endpoints in local env values for physical-device testing:
   - `EXPO_PUBLIC_STATIC_DATA_BASE_URL=http://<YOUR_LAN_IP>:3002/data`
   - `EXPO_PUBLIC_STATIC_BUNDLES_BASE_URL=http://<YOUR_LAN_IP>:3002/data/bundles`
3. Do not use `127.0.0.1` or `localhost` for physical devices.
4. Confirm `http://<YOUR_LAN_IP>:3002/data/metadata.json` opens in the phone browser.
5. Verify your local static server is running and bound to a non-loopback interface.

The app now prints a dev diagnostic line with resolved static URLs and Metro host, and network errors include actionable hints for Android physical-device setup.

