# 0018: Worklet errors are caught inside the worklet

**Status:** Proposed, 2026-10-10 (developer, from review [howto-crash.md](../reviews/howto-crash.md)). Ben to confirm. Built and tested on Linux; **not yet run on an iPhone** (see [device-tests/howto-crash-fix.md](../device-tests/howto-crash-fix.md)). Amends ADR 0013's containment section.

## Context
Build 83 closed the app as soon as How to started a guide. A parameter default in the clock worklet read a closure value, which is a `ReferenceError` once the worklets plugin moves closure values into the body. ADR 0013 assumed a UI-thread error would reach JS and fall back to the cues. In a release build it doesn't:
- React Native's Podfile builds every pod with `-DNDEBUG` in Release.
- In `react-native-worklets` 0.10.1 the only code that forwards a UI-runtime error to JS (`callGuarded`, `JSLogger::handleJSError`) sits inside `#ifndef NDEBUG`.
- In release, an uncaught worklet throw escapes as a C++ exception and aborts the app. React Native's JS error handler never runs, so nothing in JS can catch it, record it or fall back.

A JS-side "containment scope" added in the first fix could therefore never see this failure. It could only catch fatal JS errors from the rest of the app (a rest alert, a timer, a save) and hide them behind the guide's notice, so it was removed (review B1).

## Decision
- **Every app worklet that the runtime runs directly** (frame callbacks, derived values, gesture or animation handlers) wraps its whole body in `try/catch`. Only the closure destructure and a cheap `if (done) return` guard may sit outside it. The catch stops the work (e.g. `done.value = true`) and reports the message to JS with `scheduleOnRN`, itself inside a `try`. JS then fails visibly through the feature's own path (for the guide: rethrown in render into `GuideBoundary`, recorded as Last error, cues shown).
- Worklet helpers called only from inside such a `try` (e.g. `guide/clock.ts`) needn't wrap themselves. They must not have parameter defaults that read closure values.
- **Enforced by test** (`apps/mobile/test/worklet-runtime.test.ts`): it runs the real worklets plugin over every app file with a worklet. It checks that no parameter default reads a closure value, and that every non-helper worklet body is a single `try/catch`. It also runs the guide's frame callback from its generated code with a throwing clock and checks it stops and schedules the error to JS. A new worklet file must be added to the test's list, or the test fails.
- **The global JS error handler records, then always passes on** to React Native's handler. It never swallows an error.
- **For native failures** (Skia, Reanimated's own mappers, or a worklet we missed), the fallback is **Profile › Developer › Exercise guide animations** off, which shows stills only and never starts the frame clock. While the guide player is on screen with the app in the foreground, a small breadcrumb file (`guide-open.json`) is kept. If one is still there at the next launch, Last error shows "Closed during How to", unless a JS error recorded after it already explains the close. App status says plainly that animation-thread and native crashes leave no error of their own.

## Consequences
- A UI-thread failure in our own worklets becomes a visible, recorded fallback. A failure inside Skia or Reanimated still closes the app. The breadcrumb only shows that it happened, not why.
- The breadcrumb may also report a close that iOS caused (e.g. ended for memory) while How to was open. The message says so.
- Debug builds still forward UI-thread errors to the red box, so this behaviour only shows in Release. Any device test of worklet code has to use a CI-built `.ipa`, not a dev build.
