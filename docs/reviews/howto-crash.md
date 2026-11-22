VERDICT: CHANGES NEEDED

# Review: How to closes the app (build 83), fix commits b83d1df..9d9ecec

Reviewed: `662817f..9d9ecec` on `claude/gracious-knuth-joxqpw` (b83d1df, 1eb1b5e, 853c315, 634789a, 8eb38f7, 9d9ecec; 8f668ae is an unrelated docs commit). Read: CLAUDE.md, the fix report, `GuidePlayer.tsx`, `clock.ts`, `sliced.ts`, `player-model.ts`, `how-to.ts`, `GuideBoundary.tsx`, `guarded-load.ts`, `load-player.ts`, `diagnostics/*`, `HowToScreen.tsx`, `AppNavigator.tsx`, `Root.tsx`, `prefs.ts`, `DeveloperScreen.tsx`, `AppStatusScreen.tsx`, `WorkoutScreen.tsx` header. I also read the native sources the fix depends on: `react-native-worklets` 0.10.1 (`WorkletRuntime.h`, `JSLogger.cpp`, `debug/errors.native.ts`, `runLoop/uiRuntime/requestAnimationFrame.ts`), Reanimated 4.5.1 `ReanimatedModuleProxy.cpp`, and RN 0.86.3 `scripts/cocoapods/utils.rb`.

## What I ran

| Check | Result |
|---|---|
| `npm run check` | Exit 0. 102 files, 1361 tests, catalogue validate, guide check, 10/10 motion |
| Real worklets plugin on the **pre-fix** `clock.ts` (662817f), scratch script | `function advanceClock_…(elapsedMs,dtMs,durationMs,loop,maxPasses=MAX_AUTOPLAY_PASSES){const{MAX_AUTOPLAY_PASSES,passMs}=this.__closure;…` |
| Evaluated that generated function with its `__closure` bound, 4 arguments (as `tick` calls it) | `ReferenceError: MAX_AUTOPLAY_PASSES is not defined`. Root cause reproduced |
| Same on the fixed `clock.ts` | Default resolved in body (`maxPasses!==null&&maxPasses!==void 0?…`), no throw |
| `npx expo export --platform ios --no-minify` (scratchpad), `strings` over the Hermes `.hbc` | Builds. Fixed `advanceClock` and the `try/catch`-wrapped `tick` and `AnimatedArt` worklets are in the bundle, so `babel-preset-expo` applies the worklets plugin without a `babel.config.js` |
| Scan of every worklet in the bundle (470 with a `this.__closure`) for a parameter default reading a closure name | 0 found |
| Worklets release error path (source read) | See S1: with `-DNDEBUG` (RN pods add it in Release) a UI-runtime throw is **not** forwarded to `ErrorUtils`; it escapes as a C++ `jsi::JSError` and aborts the process |

## What is solid

- **Root cause is right and fixed.** The default parameter in a worklet read a body-destructured closure name; the first frame of every guide threw on the UI runtime. That matches "closes immediately", and it has been there since 811cc08, so no guide frame has ever advanced on the phone. `worklet-runtime.test.ts` runs the real plugin and the generated code, and fails on the old source.
- **The actual safety net is in the worklets.** `tick` (GuidePlayer.tsx) and `AnimatedArt`'s derived value catch everything; `tick` stops the clock and hands the message to JS via `scheduleOnRN`, which rethrows in render into `GuideBoundary`, which records it as Last error and shows the cues. This path works in release, and it is the only path that does for UI-thread errors (see S1).
- `runSliced` now catches `onDone`/`onProgress` throws from timers (tested). Button handlers are wrapped. The lazy load of HowToScreen is guarded with an honest "How to couldn't open" screen.
- Stills-only safe mode: `isRunning` is false and `show_animation` is a no-op when `stillsOnly`, so the frame clock can never start; the notice says why. Tested.
- Discoverability (Ben: "it's on the prior screen"): a visible "How to" next to the exercise name in the active set header when a guide exists; the rest-screen link stays.
- Versions match SDK 57 `bundledNativeModules`; the 5 `@babel/*` devDependencies are pinned.
- Privacy: the error record holds name, message (≤500), stack (≤4000), route name only, time, build. Local file, shared only by Ben's action. No product-rule regressions (no logging, proposals, targets or persistence touched).

## Blocking

### B1. The guide containment scope swallows unrelated fatal JS errors and protects against nothing it was added for
`apps/mobile/src/screens/workout/HowToScreen.tsx:103-108`, `apps/mobile/src/diagnostics/error-record.ts:203`

The scope's stated purpose (comment at HowToScreen.tsx:100) is "including a UI-thread error Worklets forwards as fatal". In a release build Worklets doesn't forward those (S1), so the scope never sees the failure class that closed the app. The guide's own JS failures are already contained elsewhere: bake errors go to `onError`, render errors go to `GuideBoundary`, and handlers go through `safely`. What remains for the scope to catch is **every other fatal JS error in the app** while How to is open.

Failure scenario: Ben logs a set, the rest timer starts, he opens How to from the rest screen. A fatal error then fires on the JS thread from the workout underneath, for example in a rest-alert or notification callback, a timer in the workout screen, or a persistence write path. `createGlobalErrorHandler` hands it to the guide scope and returns without calling React Native's handler. The app stays open with the workout in an unknown state. The only visible sign is How to's "The animated guide couldn't be shown" notice, which blames the wrong thing. That conflicts with honest status, and with durability for the logging path, which CLAUDE.md puts first. The fix report lists this as a trade-off, but the trade buys nothing, because the scope can't catch the crash it was meant for.

Fix: remove the containment scope (`openContainment` in HowToScreen, and the `scopes` and `take` path in the global handler), keeping the handler as record-then-delegate. If a scope is kept, it should only take errors whose stack points into `guide/` code, and it should never take `isFatal` errors from other screens.

## Should fix

### S1. Crash capture is described as catching UI-thread (worklet) errors; in release it can't
`apps/mobile/src/diagnostics/crash-capture.ts:13`, `apps/mobile/src/diagnostics/error-record.ts:8`, `apps/mobile/src/guide/GuideBoundary.tsx:17-19`, `apps/mobile/src/screens/workout/HowToScreen.tsx:100-101`, `apps/mobile/src/screens/profile/AppStatusScreen.tsx:135`; also the fix report's mechanism paragraph

RN's Podfile adds `-DNDEBUG` to every pod in Release (`react-native/scripts/cocoapods/utils.rb:677`). In `react-native-worklets` 0.10.1, `callGuarded` and `JSLogger::handleJSError`, the only code that forwards a UI-runtime `JSError` to `__reportFatalRemoteError`/`ErrorUtils`, are inside `#ifndef NDEBUG` (`WorkletRuntime.h:58-62, 205-220`, `JSLogger.cpp:48-90`). In release, `runSync` is a bare `function.call`, and the UI rAF loop (`requestAnimationFrame.ts`) has no try/catch. An uncaught worklet throw therefore escapes as a C++ exception and aborts the process, and the JS handler never runs. The build-83 crash was this kind of native abort, not `reportFatalError`.

Failure scenario: a remaining UI-thread throw outside `tick`/`AnimatedArt` (Skia's or Reanimated's own mappers, or a future worklet) closes the app. Ben opens App status and sees "No error recorded… App errors are recorded here", then reasonably concludes the app didn't error. The "Last error has the details" advice in the device-test plan and in `HowToUnavailable` doesn't apply to this class.

Fix: correct the comments and the report to say UI-thread errors are only recorded when the worklet catches them itself (as `tick` does). Change the App status copy to something like: "Errors the app catches are recorded here. If the app closed and nothing is here, it was a native or animation-thread crash: try Profile › Developer › Exercise guide animations off." Optionally, record a "How to opened" breadcrumb file before the player mounts and clear it on unmount. A breadcrumb still present at the next launch then shows a native close during How to without needing the JS handler.

### S2. No device-test steps for this fix
`docs/device-tests/` (no change in this range)

Build 84 needs a short checklist. Open How to from the header link, the ⋯ menu and the rest screen, and check the guide plays 3 passes and stops on Replay. Toggle Developer › Exercise guide animations off and check How to shows stills and the notice. Check App status › Last error shows "No error recorded". Without it, the "about 90%" confidence in the fix never becomes a device result. `guide-playback.md` G1–G10 never ran past G1, so it should be re-run in full as well.

### S3. The `tick` catch path, the only real UI-thread net, has no test
`apps/mobile/src/guide/GuidePlayer.tsx` (tick, AnimatedArt)

`worklet-runtime.test.ts` runs `clock.ts` from the generated code but never runs `tick` or the derived-value worklet. A later edit could drop the try/catch, or put a closure-reading default back into `tick`, without failing a test. The static default-parameter scan does cover `GuidePlayer.tsx`. Fix: assert in `worklet-runtime.test.ts` that every worklet body in `GuidePlayer.tsx` begins with `try` (after the closure destructure and the `done` guard), or run `tick` from its generated code with a throwing `advanceClock` and check that `onClockError` is scheduled.

## Nits

- N1. `Root.tsx:166,170`: if Ben toggles a preference before `loadPrefs` resolves, the late `setPrefs(loaded)` overwrites the change in memory. The file already has the change, so it comes back on the next launch. This is low impact; fix by merging in the `.then`, or by ignoring the load once `update` has run.
- N2. `WorkoutScreen.tsx` header: the name (`title1`, `flex:1`), "How to" and ⋯ share one row. At large Dynamic Type the name gets very narrow. Check at AX sizes, and consider moving "How to" under the name on the header line.
- N3. `WorkoutScreen.tsx`: no test asserts the header How to link appears only when `howToKeyForExerciseId` is non-null and goes to the same `HowTo` params as the ⋯ menu.
- N4. `last-error.json` holds error messages that could contain personal data. Check that "delete Your data" removes it too.
- N5. Copy or share opens the share sheet. That's acceptable for now, as the report says.

## Spec issues

- The brief and ADR 0013 treat "a UI-thread error is caught and falls back" as achievable at the app level. In release builds of Worklets 0.10 it isn't: only a try/catch inside each worklet works. ADR 0013 (or a new ADR) should record a rule that every app worklet wraps its body in try/catch and reports through `scheduleOnRN`, enforced by test. The Developer safe-mode toggle should be recorded as the fallback for native-level failures.
