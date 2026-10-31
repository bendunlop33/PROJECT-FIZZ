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
5. ~~**No Log button** (P-L4b): only after the rest buttons pass on the phone.~~ Reversed by Ben on 27 Oct: see the amendment below.
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

## Amendment 2026-10-27: Log on the Lock Screen (Ben, 27 Oct)

**Status:** ACCEPTED (Ben approved the feature on 27 Oct; the mechanism below is the developer's choice, for PM and reviewer review). Not yet run on the phone. **Reverses decision 5 (P-L4b)**: Ben chose to ship Log before the rest buttons have passed on the phone; `FIZZ_LA_LOG=0` is the fallback if it misbehaves.

**Decision.**
1. **Same route, no native change.** `Log 80 kg × 8` is another `Button(target:)` in the same widget, so it runs the same patched `LiveActivityUserInteraction` intent: queued in `UserDefaults.standard` (`fizz.liveActivity.tap.<id>`), event posted, the intent waits up to 8 s for JS to remove the entry. The patch queues any target, so nothing in Swift or the patch changes; CI's patched-binary markers are unchanged.
2. **Target carries what was shown.** `fizz.log|<session>|<set>|<set version>|<draft key>|<load>|<unit>|<convention>|<reps>|<side>|<rpe>|<rir>`, built from the same helpers as the in-app `Log` (`log-values.ts`, shared with `buildFocus`). The values logged are the values on the button, never values worked out later from history or carry that could have moved.
3. **Rule 5.** Operation ID `lock:log:<set>:<version>`; `log_set` gains an optional `expectedSetVersion` (`stale_version`). Saving a draft doesn't move a set's version, so the target also carries a short key of the set's saved draft and side; a different key is stale. A completed set is `already_logged`. The rest timer ID is derived from the operation ID.
4. **Applied in the app process, with the queue as the safety net.** The JS drain (already run on the event, at launch and on foreground) decides the tap (`lockScreenLogCommand`), dispatches through `services.sessions.dispatch`, awaits the rest-alert / Live Activity reconcile for the next rest, then acks. Rest taps expire after 60 s; **Log taps are kept up to 6 h** (the stale-workout limit) because a Log that launched a killed app must not be lost: the next launch applies it **at the tap's time** (clamped to the workout's last activity and now), only if the set is still pending at the same version and draft.
5. **Undo in the app.** The set records its operation ID (`completedByOpId`), so the app derives `Set 3 logged from Lock Screen · Undo` from the stored workout on the next foreground open (latest commit, made by a `lock:log:` op, within 15 min), once per log per run; it survives a kill without new storage. Undo is the in-app versioned `undo_log`.
6. **Not on the Lock Screen:** no Log while a rest counts (the rest buttons are there) and no timed Undo on the activity (the activity can't change without the app running).

**Trade-offs considered.**
- *Write directly from Swift into SQLite or an App Group queue for the app to apply later:* rejected. The intent already runs in the app process with JS awake, so the normal write path (reducer, opId, version) applies it at once and the next rest's notification and activity follow. A Swift-side writer would be a second write path for the same command.
- *Recompute the values at apply time instead of carrying them:* rejected. A cold launch may not have last time read yet, and the carry can change without the set's version moving; recomputed values could differ from what Ben saw.
- *Same operation ID as the in-app Log (`log:<set>:<undoCount>`):* not needed (a set already logged in the app is refused by state), and a distinct prefix is what lets the app show the Lock Screen toast.

**Consequences.**
- The Lock Screen can now write a set. Risks: whether iOS delivers the tap under SideStore signing (unproven for the rest buttons too); the 8 s wait may not cover a cold launch's database open (the entry then stays and is applied at the next launch, at the tap's time); the banner's height with the Log row.
- `FIZZ_LA_LOG=0` (build time) removes Log only; `FIZZ_LA_BUTTONS=0` removes both.
- Device test `2026-10-12-live-activity-rest.md`, steps L1–L7.
