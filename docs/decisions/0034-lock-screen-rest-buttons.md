# 0034: Lock Screen rest buttons and last time

**Status:** ACCEPTED by the developer on 26 Oct 2026 for Ben's approval the same day (competitor-landscape Pass 4,
changes 3 and 8). Not yet run on the phone. For PM and reviewer review. Renumber on merge if another branch took 0034.

## Context

Ben approved Hevy-style Lock Screen improvements: last time for the next set on the Live Activity and in the
rest-done notification, and `−15 s` / `+15 s` / `Skip` on the Live Activity "only if it works under free
provisioning". P-L4 (lock-screen-and-alerts §8) had deferred buttons until a `LiveActivityIntent` passed a
free-provisioning test.

Findings in-repo:
- App Intents need **no entitlement** (`com.apple.developer.siri` is only for SiriKit). The entitlement check is
  unchanged and passes.
- expo-widgets 57 already renders `Button` in a Live Activity as `Button(intent: LiveActivityUserInteraction)`, a
  `LiveActivityIntent` (iOS 17+), and posts `onExpoWidgetsUserInteraction` to JS. The intent is compiled into the
  app and the extension (same pod), so iOS runs it in the app's process, waking or launching the app in the
  background. No push, no new App Group.
- Stock, the intent posts the event and returns at once: a suspended app can be suspended again before JS has
  written anything, and a cold-launched app loses the event (JS isn't listening yet).

## Decision

1. **Buttons via expo-widgets' own intent**, with a target string `fizz.rest|<session>|<timer>|<version>|<action>`.
2. **Patch the intent** (`patches/expo-widgets+57.0.23.patch`, `FizzLiveActivityTaps`): store each tap as its own
   `UserDefaults.standard` entry (`fizz.liveActivity.tap.<id>`), post the event, then wait up to 8 s until the entry
   is removed. One key per tap, so the writer and the app never race on a shared list.
3. **AudioCoach gains `liveActivityTaps()` / `ackLiveActivityTaps(ids)`** (it already hosts the probe's App Group
   reads; a separate module would be more scaffolding for two functions). Optional in JS: absent means no buttons.
4. **JS drains the queue** on the event, at launch and on foreground (`live-activity/taps.ts`), decides each tap
   against the stored workout (`lockScreenTapCommand`, pure, in `@fizz/domain`), dispatches through the normal
   write path, awaits the Live Activity and alert reconcile, then acks. Rule 5: a deterministic opId per (action,
   timer, version) and a new optional `expectedTimerVersion` on `adjust_rest` / `skip_rest` (`stale_version` when
   older). Taps older than 60 s, for another workout, while paused or after the rest ended are dropped.
5. **No Log button** (P-L4b): only after the rest buttons pass on the phone.
6. **Last time** is `lastTimeOfSet` (domain): the same working set of the last comparable session, or nothing.
   History is read once per workout row (`last-time-cache.ts`); when it arrives the newest state is reconciled again.
7. **Fallbacks:** buttons hidden below iOS 17, without the native queue, or with `FIZZ_LA_BUTTONS=0` at build time;
   the rest-done notification stays the alert in every case.

## Consequences

- One more patched file in expo-widgets; CI's `check-patched-binaries.sh` markers are unchanged (still the App Group
  resolver). A future expo-widgets upgrade must carry both hunks.
- Not proven on the phone: whether the intent reaches the app under SideStore signing, the background wake, and the
  banner height with buttons (device test `2026-10-12-live-activity-rest.md`, steps 2–8). If taps don't arrive, build
  with `FIZZ_LA_BUTTONS=0` and record the result here.
