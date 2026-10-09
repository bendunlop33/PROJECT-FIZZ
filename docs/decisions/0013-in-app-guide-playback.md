# 0013: In-app exercise guide playback (Skia + Reanimated)

**Status:** Accepted, 2026-10-09. Ben approved adding the playback code on 9 Oct 2026 (provisional decision 5, ADR 0011 "Later slice"). Built and checked on Linux; **not yet run on an iPhone** (see [device-tests/guide-playback.md](../device-tests/guide-playback.md)). Each guide stays `Draft` until Ben approves it.

## Context
ADR 0011 built the catalogue, the `guide.json` format and a pure TypeScript rig that renders previews on Linux. Showing guides in the app needs a native drawing and animation layer. Research ([exercise-bank-and-visuals.md](../research/exercise-bank-and-visuals.md) §5.4, §5.7) recommended Skia drawn from the same pure code, animated on the UI thread, with a static Reduce Motion version.

## Decision

### Dependencies (exact SDK 57 bundled versions)
- `@shopify/react-native-skia` **2.6.2**, `react-native-reanimated` **4.5.1** and `react-native-worklets` **0.10.1**. These match `expo/bundledNativeModules.json` for SDK 57.0.27, and `npx expo install --check` reports "Dependencies are up to date".
- **No Babel config.** babel-preset-expo 57 adds `react-native-worklets/plugin` automatically once the package is installed. The exported Hermes bundle shows the app's worklets transformed (`frameIndexAt`, `advanceClock`, the frame callback and the derived picture).
- **No Jest/vitest mocks needed.** Tests run on the pure modules only; nothing under `test/` imports Skia or Reanimated.
- **Autolinking:** a scratch `expo prebuild --platform ios --no-install` links all three via `react-native-config` (`react-native-skia.podspec`, `RNReanimated.podspec`, `RNWorklets.podspec`). `check-entitlements --prebuild` passes: the only entitlement is the existing App Group. Skia links MetalKit, AVFoundation, AVKit and CoreMedia, none of which needs an entitlement. The expo-widgets patch still applies.
- **Skia's postinstall** copies prebuilt xcframeworks into `node_modules/@shopify/react-native-skia/libs/`, and its podspec fails without them. CI runs `npm ci` with scripts enabled, so this works, but it must never switch to `--ignore-scripts`. `npm ci` now downloads about 650 MB of Skia binaries (iOS 205 MB, Android 218 MB, macOS/tvOS, plus canvaskit-wasm 25 MB) in both CI jobs.

### Size impact (measured on Linux; the `.ipa` size still needs the CI build)
- **JS (Hermes bytecode):** 4.14 MB → 5.88 MB (+1.74 MB, +749 modules). Of the minified JS: Reanimated ~740 KB, Skia ~257 KB plus its react-reconciler ~107 KB, worklets ~90 KB, catalogue code ~70 KB and catalogue JSON ~340 KB (133 entries plus 10 guides of ~2 KB each). Preview PNGs and `meta.json` are not bundled.
- **Native:** Shopify quotes about 6 MB for Skia on iOS. Not measured yet: compare the next `.ipa` with build 7.

### Architecture
- **One drawing, two renderers.** `packages/catalogue/src/figure/draw.ts` `frameOps(pose)` gives every shape, paint and the draw order. `svg.ts` serialises those ops (the output is byte-identical to before for every guide, scheme and frame, and the preview PNG is byte-identical too). The app records the same ops into Skia. A headless CanvasKit run of the app's `bake.ts` matched resvg's render of all 10 guides in both schemes, for animation and key frames, to within 0.004% of pixels (anti-aliasing at edges).
- **Bake on the JS thread, swap on the UI thread.** Each frame (30 fps of guide time, `playbackTimes`) is recorded into a unit-size `SkPicture`, in 8 ms slices so the JS thread never stalls. The first frame is drawn at once. A Reanimated `useFrameCallback` advances a clock (`clock.ts`, worklets) and a derived value picks the picture. No React render happens per frame, and the rig maths never runs on the UI thread. Up to 4 bakes are cached per session, keyed by guide, kind and colours.
- **Fitted cameras are precomputed** into `src/generated/guide-files.ts` (by `catalogue:index`; `guide:check` refreshes it), along with static imports of every `guide.json`. `catalogue:validate` fails when the file is stale. Without this, fitting would sample a whole cycle on Hermes before the first frame.
- **Lazy validation.** `createLazyCatalogue` and `createGuideLibrary` validate one entry or guide when first asked. The picker only reads a `tier` hint, because validating all 133 entries takes ~50 ms cold in V8 and several times that on Hermes. A broken guide or entry gives an honest notice and never crashes.
- **Behaviour** (research §5.7): autoplay loops at the guide's tempo and stops after **3 passes**, holding the first frame with `Replay`. `Pause` is always shown. Playback pauses when the screen loses focus, the player is scrolled away or the app is backgrounded (battery during rest). **Reduce Motion** starts on the key frames (the guide's labelled key positions, the same frames as the preview), one at a time with Previous/Next and an opt-in `Play animation`. Turning Reduce Motion on mid-play stops the animation at once. The canvas is one VoiceOver image whose label is fixed (`Animated guide for <name>. <a11y.summary>`), so it isn't re-announced. Colours are the six neutral guide tokens from the live theme, never `accent` (tested for both looks and schemes). The art contains no text. `Draft guide` is shown until `review.status` is `approved`.
- **Where it appears:** a `How to` modal (`HowToScreen`). It's the first item in the active exercise's `⋯` menu when the exercise has a guide or rich cues. In the picker, rows like that get a separate ⓘ button, so a row tap still adds the exercise in one tap. The modal shows the player, key positions, setup and execution cues, and common mistakes. Exercises without a guide show their cues only. Everything is bundled, so it works offline (rule 1). It's Coaching knowledge only (rule 10).

### Fallback
If Skia or Reanimated fails on the device (build, signing, smoothness or battery): use `react-native-svg` **15.15.4** (also SDK 57 bundled) with a JS-driven frame index at 30 fps. `svg.ts` already produces the markup from the same `frameOps`, and `clock.ts`, `player-model.ts`, `how-to.ts` and the screens are renderer-independent. Only `bake.ts` and `GuidePlayer.tsx` would change.

## Consequences
- Adding or editing a guide now also means `npm run catalogue:index` (or `guide:check <id>` without `--verify`, which refreshes the index). `npm run check` fails otherwise.
- **Needs a real iPhone:** smoothness, battery while resting on the How to screen, legibility at 240 pt, Reduce Motion, VoiceOver, light/dark, how long the first bake takes on Hermes, and the `.ipa` size and build time.
- **Open for the designer and Ben:** exercise-library.md still has EL8 ("no images or videos") and no `Guide` section; design-system principle 5 needs the guide motion exception (research brief change 3). The ⓘ picker button and the `How to` menu item follow research §5.7 but aren't in a design spec yet. Safety `stopIf` lines and variations aren't shown on How to (the scope was cues and mistakes).
