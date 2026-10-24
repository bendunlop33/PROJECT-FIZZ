# Lock screen and alerts

> **Revision 2026-10-08 (consolidation).** P-L1 is applied in rest-state.md §4.8 (no Time Sensitive option; the brief's wording is the product manager's to change). profile-and-settings.md §2.6 now hosts this file's `When rest ends`, `Alert check` and `Test rest alert` unchanged, and its own duplicate rest-alert rows (`Loud alerts (AlarmKit)` with a threshold picker) are withdrawn in favour of `Loud rest alerts` here. `runAlertTest()` is renamed `runRestAlertTest()` (one name across specs). Capability evidence from tests is shown in App status (system-states.md). Tokens and the widget colour mirror are merged into design-system (§2.2, §3 `type.liveCountdown`, §6 timings, `sound.restEnd`).

Status: v0.1 draft, 8 Oct 2026. Designer. Tokens: [design-system.md](design-system.md). Timer behaviour inside the app: [rest-state.md](rest-state.md) and [flow-first-milestone.md](flow-first-milestone.md) §4–§5. App-wide permission and capability states: [system-states.md](system-states.md).

Sources: brief §12 (rest state, spoken set companion); CHANGELOG v0.2 and v0.3 (layered rest alerts in the first milestone; AlarmKit as the loud fallback on Ben's iPhone 17); research `ios-platform-feasibility.md` §2.3–§2.5, `free-ios-install.md` §1.2; [ADR 0004](../decisions/0004-free-distribution-sidestore.md) (no push, no time-sensitive); [ADR 0007](../decisions/0007-mobile-shell-identity-and-ipa-pipeline.md) (App Group rename risk, background-audio experiment); device test [build 7](../device-tests/2026-10-08-probe-build7.md); `apps/mobile/src/live-activity/RestCountdownActivity.tsx` (current probe widget).

**Where things stand on Ben's phone (build 7, 8 Oct):**

| Layer | Result | Consequence for this design |
|---|---|---|
| Local notification while locked | PASS (interruption level "active") | The one layer the design can rely on today |
| Rest deadline after force-close | PASS | In-app timer is always right on return |
| Live Activity | **FAIL** (SideStore renamed the App Group; the widget has no shared container) | Must look complete without it. Everything below works with Live Activity missing |
| AlarmKit | Not run (framework present) | Opt-in, behind its own capability check |
| Spoken cue while locked | Unavailable (build made without background audio) | Experiment, hidden unless the build and probe say it can work |
| Time-sensitive notifications | Not possible on a free Apple ID (ADR 0004) | Removed from this design. rest-state.md §4.8's "Time Sensitive only if Ben enables it" no longer applies |

---

## 1. Purpose

These surfaces answer one question when Ben **isn't looking at Fizz**: **"Is my rest over, and what's my next set?"**

There is no primary action on the lock screen. Every surface opens the active workout in one tap, where `Log …` is already waiting. **Nothing on the lock screen logs a set** (rest-state.md §4.8): logging without seeing the values risks wrong data.

Design rules:
1. **One alert per rest end, never zero when Ben has allowed alerts, never two.** Each layer has a defined job; the arbitration in §4.1 picks which one fires.
2. **Lock-screen text is written once, at the moment the app last ran, and must stay true without the app.** The Live Activity can't change itself when rest ends (no push). So it shows the end time and the next set from the start.
3. **Targets say "target".** Lock-screen and notification text names the next set's planned values as a target, never as a result.
4. **Honest capability.** If a layer isn't available, Voice & alerts says so in plain words. No error appears mid-workout because a layer is missing.

---

## 2. Layout

### 2.1 Live Activity (when available)

**Lifecycle.** One Live Activity per workout, started by `startWorkout` (or by reconcile on relaunch), updated by the app at every committed event while it is running, and ended on Finish or Discard. Updates only ever happen while Fizz is running, which is always true when a set is logged, rest is adjusted or the workout is paused (all are in-app taps). Data stays well under the 4 KB limit.

**Content states.**

| State | When | Banner (Lock Screen) | Compact (Dynamic Island) | Minimal |
|---|---|---|---|---|
| Ready | Workout started; rest skipped; a zero-length rest; after the app updates an ended rest | `figure.strengthtraining.traditional` `Ready · Push A` / `Bench press · Set 3 of 4` / `Target 100 kg × 6–8` | leading: figure icon · trailing: `Set 3` | figure icon |
| Resting | `commitSetAndBeginRest` returned a timer, or `adjustRestTimer` | `timer` `Rest` + countdown / `Until 18:42 · Bench press · Set 3 of 4 next` / `Target 100 kg × 6–8` | leading: `timer` (accent) · trailing: countdown `2:47` | countdown `2:47` |
| Working (timed) | `startWorkInterval` | `timer` `Work · Plank` + countdown / `Until 18:40 · Target 0:45` / `Open Fizz to log it` | leading: `timer` · trailing: countdown | countdown |
| Paused | `pauseSession` | `pause.circle.fill` (warning) `Paused · Push A` / `Rest 1:10 left when you resume` (or `Ready for set 3`) | leading: pause icon · trailing: `1:10` (static) | pause icon |
| Ended | Finish, Discard, or a stale workout found on relaunch | Activity ended with immediate dismissal | — | — |

**Wireframes** (system container; Fizz controls only the content):

Lock Screen banner, Resting:
```
┌──────────────────────────────────────┐
│ ⏱ Rest                         2:47  │ countdown: system-rendered,
│ Until 18:42 · Bench press ·          │ 28pt semibold, monospaced digits
│ Set 3 of 4 next                      │
│ Target 100 kg × 6–8                  │
└──────────────────────────────────────┘
```

The same banner after the deadline, with Fizz suspended (nothing can update it):
```
┌──────────────────────────────────────┐
│ ⏱ Rest                         0:00  │ the system timer stops at 0:00
│ Until 18:42 · Bench press ·          │ "Until 18:42" keeps it unambiguous
│ Set 3 of 4 next                      │
│ Target 100 kg × 6–8                  │
└──────────────────────────────────────┘
```
The rest-end notification (§2.2) arrives at the same moment and says `Rest done`. Opening Fizz switches the activity to Ready.

Lock Screen banner, Ready (written by the app while running):
```
┌──────────────────────────────────────┐
│ 🏋 Ready · Push A                     │
│ Bench press · Set 3 of 4             │
│ Target 100 kg × 6–8                  │
└──────────────────────────────────────┘
```

Lock Screen banner, Working (timed set):
```
┌──────────────────────────────────────┐
│ ⏱ Work · Plank                 0:38  │
│ Until 18:40 · Target 0:45            │
│ Open Fizz to log it                  │
└──────────────────────────────────────┘
```

Lock Screen banner, Paused:
```
┌──────────────────────────────────────┐
│ ⏸ Paused · Push A                    │ status.warning icon + word
│ Rest 1:10 left when you resume       │ static, not counting
└──────────────────────────────────────┘
```

Dynamic Island, compact and minimal (Resting):
```
 ( ⏱ ·············· 2:47 )        ( 2:47 )
   leading         trailing        minimal
```

Dynamic Island, expanded (long-press), Resting:
```
┌──────────────────────────────────────┐
│ ⏱ Rest                         2:47  │ leading / trailing (24pt)
│ Bench press · Set 3 of 4 next        │ center
│ Target 100 kg × 6–8 · until 18:42    │ bottom
└──────────────────────────────────────┘
```

**Visual rules.**
- System material background (`activityBackgroundTint` left to the system) so it reads on any wallpaper in light and dark appearance. Text uses the system primary and secondary label colours, which meet contrast on that material.
- Accent is used only for the `timer` icon (`#5AA9FF` in dark appearance, `#0A63C9` in light; mirrored from `color.accent`). Paused uses `status.warning` (`#F2B84B` / `#8A5A00`) for the icon, plus the word `Paused`.
- Countdown digits are monospaced (`.monospacedDigit()`), so they don't jitter. If the `@expo/ui` subset can't express this, the widget needs a small native modifier (developer note).
- Always-On Display (`isLuminanceReduced`): regular weight, no accent tint; content unchanged.
- No buttons in this milestone (§8, P-L4). Tapping anywhere opens `fizz://workout` (the active workout).
- Long exercise names: one line, tail ellipsis; the target line never truncates its numbers.

### 2.2 Notifications

All are local, scheduled by Fizz, interruption level `active`, sound `rest-end.caf` (a short chime matching `sound.restEnd`, under 2 s). They all open the active workout when tapped.

| Kind | Identifier (replaces the previous one of the same kind) | Title | Body | When |
|---|---|---|---|---|
| Rest done | `fizz.rest.<sessionId>` | `Rest done` | `Next: Bench press · 100 kg × 6–8 target` | At the rest deadline, unless a louder layer owns this rest (§4.1) |
| Rest done, next exercise | same | `Rest done` | `Next: Incline DB press · 30 kg each × 8–10 target` | same |
| Rest done, coach target | same | `Rest done` | `Next: Bench press · 95 kg × 8 coach target` | same |
| Rest done, no load target | same | `Rest done` | `Next: Lat pulldown · 8–10 reps (no load target)` | same |
| Rest done, unilateral | same | `Rest done` | `Next: Single-arm row · 25 kg stack × 10 per side target` | same |
| Work time up | `fizz.work.<sessionId>` | `Time` | `Plank: 0:45 is up. Open Fizz to log it.` | At the work-interval deadline. Never says "done" or "logged" |
| Resting until (optional, quiet) | `fizz.resting.<sessionId>` | `Resting until 18:42` | `Next: Bench press · 100 kg × 6–8 target` | Only when the Live Activity is unavailable **and** Ben turned on `Show rest end time on the Lock Screen`. Posted when Fizz goes to the background during rest, interruption level `passive` (no sound, doesn't light the screen) |
| Workout still running (optional, off by default) | `fizz.running.<sessionId>` | `Push A is still running` | `Last set 1 h ago. Open Fizz to finish or keep going.` | 60 min after the last set, rescheduled at every Log; cancelled on Finish, Discard, Pause |
| Refresh reminder | see system-states.md | `Refresh Fizz by Sun` | see system-states.md | — |

Grouping: every workout notification uses thread `fizz.workout.<sessionId>`, so the Lock Screen shows at most one stack, and at most one of each kind.

Lock Screen, notifications-only (today's reality), at the deadline:
```
┌──────────────────────────────────────┐
│ [icon] FIZZ                    now   │
│ Rest done                            │
│ Next: Bench press · 100 kg × 6–8     │
│ target                               │
└──────────────────────────────────────┘
```

If Ben wears an Apple Watch, iOS mirrors these notifications to it while the phone is locked. Nothing is built for this, and the design doesn't depend on it.

### 2.3 Loud rest alerts (AlarmKit, opt-in)

Name and priming copy match onboarding.md §4.6: setting `Loud rest alerts`.

- **What it is:** an AlarmKit timer for the rest. It rings like an alarm, even in silent mode and in a Focus, with a system alarm screen and `Stop`.
- **Alert only, no countdown presentation.** AlarmKit's countdown UI needs the widget extension (research §1.2), which is the part currently failing. The alarm alert itself is system UI.
- **Modes:** `Off` (default) · `Long rests only (2:00 or more)` · `Every rest`.
- **Alarm content:** title `Rest done`; stop button `Stop`; tint `color.accent`. Optional secondary button `Open Fizz` only if the device test shows it works without extra entitlements (`DEP-ALARM`).

```
┌──────────────────────────────────────┐
│               Fizz                   │ system alarm screen
│            Rest done                 │
│                                      │
│        [       Stop        ]         │
└──────────────────────────────────────┘
```

### 2.4 Spoken cues while locked (experiment, opt-in)

Visible in Voice & alerts **only** when the build includes background audio (`FIZZ_BACKGROUND_AUDIO=1`, ADR 0007) and cue mode is `Set cues` or `Conversation`. Off by default. Turning it on as a product feature still needs Ben's approval as a brief change (ADR 0007).

- **What it does:** `audio-coach` keeps a silent, mixable audio session alive from the first set to Finish (not while paused), so Fizz stays running when locked and can speak the rest-end cue from rest-state.md §5 ("Ready when you are. Bench press, 100 kilos, target 6 to 8 reps.") with music ducked.
- **Safety net:** the rest-done notification stays scheduled. Fizz removes it about 1 s before the deadline only if the keep-alive is confirmed running; if speaking then fails, Fizz posts the notification immediately. So Ben gets exactly one alert either way.
- **When iOS stops it** (phone call, another app takes the audio session, memory pressure, force-close): the notification fires as normal. Voice & alerts shows `Stopped by iOS at 18:40. Notifications took over.` for that workout.

### 2.5 Voice & alerts: "When rest ends" section and Alert check

Profile → Voice & alerts is owned by profile-and-settings.md. This file specifies the content of its **When rest ends** section, the **Alert check** panel and **Test rest alert**.

```
┌────────────────────────────────────────┐
│ ‹ Profile       Voice & alerts         │
├────────────────────────────────────────┤
│ …voice mode rows (rest-state.md §5)…   │
│                                        │
│ When rest ends                         │
│ Notification                     On  › │
│ Loud rest alerts                 Off › │
│ Speak while locked (experiment)  Off › │ only in builds that support it
│ Show rest end time on the        Off   │ only when Live Activity is
│ Lock Screen                     [   ]  │ unavailable
│                                        │
│ Alert check                            │
│ ✓ Notifications allowed, with sound    │
│ ⚠ Lock Screen timer: not working on    │
│   this install. The signing tool       │
│   renamed the shared storage it needs. │
│ – Loud rest alerts: off                │
│ – Speak while locked: not in this build│
│                                        │
│ With your phone locked, rest end is    │
│ signalled by: a notification (sound    │
│ and vibration, unless silent mode or a │
│ Focus mutes it).                       │
│                                        │
│ Test rest alert                      › │
└────────────────────────────────────────┘
```

The summary sentence under Alert check is built from the same arbitration as §4.1, so it always describes what will actually happen.

**Test rest alert** starts a 10-second practice rest using the real layers: `Lock your phone now. In 10 seconds you should get the rest alert.` Afterwards: `Did the alert arrive?` [Yes] [No]. `No` shows the matching fix from §3.2 (for example `Alert sounds are off for Fizz in iOS Settings.` [Open Settings]). It never touches workout data.

---

## 3. States

### 3.1 Capability states per layer

`getRestAlertCapabilities()` reports each layer; screens never probe on their own.

| Layer | State | Alert check line | Effect |
|---|---|---|---|
| Notifications | Allowed, sound on, Lock Screen on | `✓ Notifications allowed, with sound` | Used |
| | Allowed, sounds off for Fizz | `⚠ Notifications allowed, but sounds are off for Fizz in iOS Settings.` [Open Settings] | Used, silent |
| | Allowed, hidden on Lock Screen | `⚠ Fizz alerts are hidden on the Lock Screen in iOS Settings.` [Open Settings] | Used |
| | Not asked yet | `– Not set up yet. You'll be asked at your first rest.` [Allow now] | Asked in context (rest-state.md §3) |
| | Denied | `⚠ Rest alerts are off in iOS Settings.` [Open Settings] | Not used |
| Live Activity | Available | `✓ Lock Screen timer` | Used |
| | Off in iOS Settings (Fizz → Live Activities) | `⚠ Lock Screen timer: Live Activities are off for Fizz in iOS Settings.` [Open Settings] | Not used |
| | App Group renamed (current) | `⚠ Lock Screen timer: not working on this install. The signing tool renamed the shared storage it needs.` | Not used; offers `Show rest end time on the Lock Screen` |
| | Not in this build (`FIZZ_LIVE_ACTIVITY=0`) | `– Lock Screen timer: not in this build` | Not used |
| | Start failed (other) | `⚠ Lock Screen timer didn't start (<system reason>).` | Not used this workout; retried next workout |
| Loud rest alerts | Off | `– Loud rest alerts: off` | — |
| | On, authorised | `✓ Loud rest alerts: long rests` / `every rest` | Used per §4.1 |
| | On, denied in iOS Settings | `⚠ Loud rest alerts are turned off in iOS Settings.` [Open Settings]; the switch shows Off (onboarding.md §4.6) | Not used |
| Speak while locked | Not in this build | `– Speak while locked: not in this build` | Hidden in the section |
| | Off | `– Speak while locked: off` | — |
| | On, ready (between workouts) | `✓ Speak while locked: on (uses more battery)` | Keep-alive starts with the next workout |
| | Running | `✓ Speak while locked: running` | Speaks; notification is the safety net |
| | Stopped by iOS | `⚠ Stopped by iOS at 18:40. Notifications took over.` | Notification fires |

### 3.2 What Ben sees, case by case

Assume a 3:00 rest that ends at 18:42, with the next set Bench press set 3, target 100 kg × 6–8.

| Case | While resting, phone locked | At 18:42, phone locked | When he opens Fizz |
|---|---|---|---|
| **A. Today (build 7):** notifications on, Live Activity failing, loud off | Nothing from Fizz on the Lock Screen | `Rest done` notification with sound and vibration | Rest card: `Ready when you are` + `Rested 0:20`; notification removed from Notification Centre |
| **A+.** As A with `Show rest end time on the Lock Screen` on | Quiet notification `Resting until 18:42 · Next: Bench press · 100 kg × 6–8 target` (visible when he wakes the screen) | `Rest done` notification (same stack) | As A; both notifications removed |
| **B.** Live Activity working | Banner countdown `2:47 … Until 18:42 · Set 3 of 4 next · Target 100 kg × 6–8`; Dynamic Island when unlocked in another app | Countdown shows `0:00` with `Until 18:42`; `Rest done` notification | Activity switches to Ready |
| **C.** Silent switch on | As A or B | Notification without sound; it vibrates if iOS haptics in silent mode are on | As A |
| **D.** In a Focus that doesn't allow Fizz | As A or B (Live Activities still show) | Notification delivered quietly to Notification Centre: **no sound, no banner** | As A. Alert check suggests: `In a Focus, allow Fizz or turn on Loud rest alerts.` |
| **E.** Loud rest alerts on and this rest qualifies | As A or B | Alarm rings, even in silent mode and Focus; `Stop` | As A. No notification was sent for this rest |
| **F.** Loud rest alerts `Long rests only`, rest is 1:30 | As A or B | Normal notification (as A) | As A |
| **G.** Speak while locked running | As A or B; music plays normally | "Ready when you are. Bench press, 100 kilos, target 6 to 8 reps." over ducked music. No notification | As A |
| **H.** Speak while locked stopped by iOS | As A or B | Notification (as A) | As A; Voice & alerts shows the stopped line |
| **I.** Notifications denied, Live Activity failing, loud off | Nothing | **Nothing.** | As A. Alert check says: `With your phone locked, Fizz can't tell you when rest ends.` with the fixes |
| **J.** Fizz force-closed during rest | Live Activity (if working) keeps counting: the system renders it | Notification or alarm fires (scheduled with iOS). No speech | Flow §4.2: `Rest ended at 18:42` banner; activity reconciled to Ready |
| **K.** Phone in hand, Fizz open at 18:42 | — | In-app cue only (spoken per cue mode, `haptic.restEnd`, `sound.restEnd`). Notification cancelled, no alarm | — |
| **L.** Workout paused | Paused banner (if Live Activity works) | Nothing: every alert was cancelled by `pauseSession` | Paused state |
| **M.** Rest skipped, or next set logged early | Activity updates (Fizz was running) | Nothing for the old rest (cancelled) | — |

---

## 4. Interactions

### 4.1 Alert arbitration (`scheduleTimerCue`)

`scheduleTimerCue(timerId, version)` (brief) decides the layers for one timer version, and runs again on every event that changes the timer or the app's foreground state. Inputs: the timer, app state (`active` / `background`), settings and `getRestAlertCapabilities()`.

| App state | Live Activity | Notification (`fizz.rest`) | Alarm | Spoken while locked |
|---|---|---|---|---|
| Active (Fizz on screen) | Updated | **Scheduled** as a safety net if Fizz crashes. Cancelled at the deadline by the in-app cue (rest-state.md §4.7) | Not scheduled | n/a (in-app cue) |
| Background, loud applies and authorised | Updated before leaving | **Removed** | Scheduled for the remaining time | n/a |
| Background, keep-alive running | Updated | Scheduled; removed ~1 s before the deadline only if the keep-alive is confirmed, re-posted at once if speech fails | Not scheduled | Speaks at the deadline |
| Background, otherwise | Updated | Scheduled | Not scheduled | n/a |

Every alert is keyed `(timerId, timerVersion, kind)` (flow §4.2). These events cancel the old version's layers and apply the table to the new one: `RestAdjusted` (±30 s, edit), `RestEnded` (Skip, Log early, expiry in-app), `SetUndone`, `SessionPaused` / `SessionResumed`, `ProposalApplied` / `CoachAdjustmentApplied` (the next-set text changes), `SessionFinished`, `SessionDiscarded`, restore and delete (data-import-export.md). Moving to the foreground cancels a scheduled alarm; moving to the background schedules it. A spoken cue more than 5 s late is dropped (`timing.lateCueDrop`).

### 4.2 Live Activity
- **Tap** (banner or Dynamic Island): opens `fizz://workout` → Active workout in its persisted state (zero further taps).
- **Long-press** the Dynamic Island: system expanded view (§2.1). No controls.
- **Swipe the banner away:** iOS removes it from the Lock Screen. Fizz doesn't start another one for this workout until the next app launch reconcile.
- **Relaunch reconcile:** `getInstances()` against `getActiveSession`. Unknown or finished workouts → end with immediate dismissal. The current workout → update to its true state. A workout that is now stale (≥ 6 h, flow §4.2) → end.
- **Gym switch, coach adjustment, set correction during rest:** the next-set lines update (Fizz is running). Rest time is unchanged (rest-state.md §4.5).

### 4.3 Notifications
- **Tap:** opens the active workout. If the workout has since been finished, it opens Today.
- **Foreground arrival:** never shown as a banner (the in-app cue is the alert).
- **On return to the foreground:** Fizz removes its delivered workout notifications from Notification Centre, since they're stale once the screen shows the truth.
- **No actions** (no `Log`, no `+30 s`). See §8 P-L4.

### 4.4 Loud rest alerts
- Turning the setting on from Off shows onboarding.md's priming sheet (`Loud alerts ring even in silent mode and Focus, with a full-screen alarm. Best for long rests.` [Turn on] [Cancel]), then the system authorisation prompt (usage text below). Denied → switch returns to Off with `Turned off in iOS Settings`.
- Choosing the mode: `Long rests only (2:00 or more)` / `Every rest`.
- `Stop` on the alarm silences it. It doesn't open Fizz and doesn't change any data.

### 4.5 Speak while locked
- Turning it on shows: `Fizz keeps a silent audio session running during workouts so it can speak when rest ends with your phone locked. It uses more battery. If iOS stops it, you'll get the notification instead.` [Turn on] [Cancel].
- It is never offered in `Quiet` mode, and switching to Quiet turns the keep-alive off for the rest of the workout.

### 4.6 Voice equivalents
Spoken commands live in rest-state.md §4.9 ("add thirty seconds", "skip rest"). They need Fizz in the foreground with the microphone open; there is no voice control from the lock screen.

### 4.7 Undo
Nothing on these surfaces changes data, so there is nothing to undo. Timer changes made in the app are undone in the app (rest-state.md §4.10), and the lock-screen layers follow automatically.

---

## 5. Copy

| Element | Text | Target or actual |
|---|---|---|
| LA Resting | `Rest` · countdown · `Until 18:42 · Bench press · Set 3 of 4 next` · `Target 100 kg × 6–8` | Target |
| LA Resting, next exercise | `Until 18:42 · Next: Incline DB press` · `Target 30 kg each × 8–10` | Target |
| LA Resting, coach target | `Coach target 95 kg × 8` | Target |
| LA Ready | `Ready · Push A` · `Bench press · Set 3 of 4` · `Target 100 kg × 6–8` | Target |
| LA Working | `Work · Plank` · countdown · `Until 18:40 · Target 0:45` · `Open Fizz to log it` | Target |
| LA Paused | `Paused · Push A` · `Rest 1:10 left when you resume` / `Ready for set 3` | — |
| LA compact trailing | `2:47` · `Set 3` · `1:10` | — |
| Notification, rest | `Rest done` / `Next: Bench press · 100 kg × 6–8 target` (variants in §2.2) | Target |
| Notification, work | `Time` / `Plank: 0:45 is up. Open Fizz to log it.` | — |
| Notification, quiet | `Resting until 18:42` / `Next: Bench press · 100 kg × 6–8 target` | Target |
| Notification, still running | `Push A is still running` / `Last set 1 h ago. Open Fizz to finish or keep going.` | — |
| Alarm | `Rest done` · `Stop` (· `Open Fizz` if available) | — |
| AlarmKit usage description (Info.plist `NSAlarmKitUsageDescription`) | `Fizz rings an alarm when a rest ends, if you turn on Loud rest alerts.` | — |
| Section | `When rest ends` · `Notification` · `Loud rest alerts` · `Speak while locked (experiment)` · `Show rest end time on the Lock Screen` | — |
| Loud modes | `Off` · `Long rests only (2:00 or more)` · `Every rest` | — |
| Alert check lines | §3.1 | — |
| Alert check summary | `With your phone locked, rest end is signalled by: <layers>.` e.g. `a notification (sound and vibration, unless silent mode or a Focus mutes it).` / `a loud alarm for rests of 2:00 or more, and a notification for shorter ones.` / `Fizz speaking, with a notification if that stops.` / none: `With your phone locked, Fizz can't tell you when rest ends.` | — |
| Focus hint | `In a Focus, allow Fizz or turn on Loud rest alerts.` | — |
| Test | `Test rest alert` · `Lock your phone now. In 10 seconds you should get the rest alert.` · `Did the alert arrive?` [Yes] [No] · `Good. That's what you'll get at the end of each rest.` | — |
| Speak while locked prompt | §4.5 · stopped: `Stopped by iOS at 18:40. Notifications took over.` | — |
| Spoken rest-end (while locked) | "Ready when you are. Bench press, 100 kilos, target 6 to 8 reps." (rest-state.md §5; same script, same rules) | Target |

All numbers in Fizz-rendered text use the design-system number format (no trailing `.0`, no-break spaces, `×`). Units come from the equipment convention (design-system §8): `kg each`, `kg stack`, `per side`.

VoiceOver labels (Live Activity): Resting `Rest, 2 minutes 47 seconds left, until 18:42. Next: Bench press, set 3 of 4, target 100 kilograms, 6 to 8 reps.` Paused `Workout paused. Rest 1 minute 10 seconds left when you resume.`

---

## 6. Data needed

From the brief and existing specs:
- `commitSetAndBeginRest(command)` → `restTimer {timerId, deadlineUtc, durationS, version}`; `adjustRestTimer`, `endRestTimer`, `pauseSession`, `resumeSession`, `startWorkInterval`, `finishWorkout`, `discardWorkout`.
- `scheduleTimerCue(timerId, version)` with the arbitration in §4.1; `cancelObsoleteCues(sessionId, version)`; `buildSetCue(event, sessionVersion)` for the spoken text.
- `getActiveSession(userId)` for reconcile on launch.
- `buildActiveSetView(sessionId)` for the next set's committed values.
- `audio-coach`: `speak`, `startKeepAlive`, `stopKeepAlive`, interruption events (ADR 0007).

**Proposed new functions:**

| Function | Purpose |
|---|---|
| `buildLockScreenContent(sessionId, version)` → `{state: 'ready' \| 'resting' \| 'working' \| 'paused', title, lines[], countdown?{startUtc, endUtc}, endLocalTime?, notification{title, body}, a11yLabel}` | One pure function for Live Activity props, notification text and VoiceOver labels, built from committed values only. Unit-testable on Linux |
| `getRestAlertCapabilities()` → `{notifications{status, sound, lockScreen}, liveActivity{status, reason?: 'app_group_renamed' \| 'disabled_in_settings' \| 'not_in_build' \| 'start_failed'}, alarmKit{status: 'authorized' \| 'denied' \| 'not_determined' \| 'unavailable'}, lockedSpeech{status: 'not_in_build' \| 'off' \| 'ready' \| 'running' \| 'stopped', stoppedAtUtc?}}` | Drives Alert check, the arbitration and system-states.md. Reuses the probe's App Group check |
| `startWorkoutActivity(sessionId)` / `updateWorkoutActivity(content)` / `endWorkoutActivity(sessionId)` / `reconcileActivities(activeSession)` | Live Activity lifecycle (§4.2) |
| `scheduleRestAlarm(timerId, version, deadlineUtc)` / `cancelRestAlarm(timerId)` | AlarmKit layer |
| `runRestAlertTest()` (was `runAlertTest()`) | The 10-second practice rest; no workout data. Records each layer's result with `recordCapabilityObservation` for App status |

---

## 7. Acceptance checks

On Ben's iPhone, with the build noted in the test report.

Notifications (must pass on today's build)
1. A 3:00 rest with the phone locked from 0:10 gives exactly one `Rest done` notification within 2 s of the deadline, with the next set's target in the body and the word `target`.
2. `+30 s` at 1:00 left, then lock: one notification, 30 s later than before; none at the old time.
3. Skip, Log early, Undo the set, Pause, Finish or Discard during rest: no notification for that rest ever arrives.
4. Fizz open at the deadline: no notification banner and no alarm; the in-app cue plays once.
5. Force-quit during rest: the notification still arrives on time; reopening shows `Rest ended at 18:42` and no second alert.
6. A timed set's work interval ending while locked gives `Time` / `Plank: 0:45 is up. Open Fizz to log it.`, and nothing is logged.
7. Tapping a notification opens the active workout (or Today if the workout has finished).
8. Returning to Fizz removes its delivered workout notifications.

Live Activity (when `getRestAlertCapabilities` reports available)
9. Starting a workout shows the Ready banner; logging a set switches it to Resting with the countdown, `Until hh:mm` and the next target, all at once.
10. Locked through the deadline: the countdown stops at `0:00`, the `Until` time and target stay, and the notification arrives. Opening Fizz switches it to Ready.
11. Pause freezes it with `Paused` and the remaining time; Resume restores the countdown.
12. Finish or Discard ends it within 1 s. Force-quit mid-rest then relaunch after 6 h: the activity is ended on launch.
13. The countdown digits don't shift sideways as they change.
14. With the App Group renamed (current build), no error appears during a workout; Alert check shows the `not working on this install` line, and the workout behaves as case A.

Loud rest alerts
15. With `Long rests only`, a 1:30 rest gives a notification and no alarm; a 3:00 rest with the phone locked and the silent switch on rings the alarm and sends no notification.
16. Unlocking and opening Fizz before the deadline cancels the alarm; locking again reschedules it for the remaining time.
17. Denying AlarmKit permission returns the switch to Off with `Turned off in iOS Settings`.

Speak while locked (experiment builds only)
18. In a 75-minute session with the keep-alive on, every rest end produces exactly one of: the spoken cue, or the notification. Never both, never neither (log each rest).
19. A phone call during rest stops the keep-alive; that rest still ends with a notification; Voice & alerts shows the stopped line.
20. The section is hidden in builds without background audio, and in Quiet mode.

General
21. Every lock-screen and notification string that names a planned value contains `target` (or `coach target`); none contains a value that wasn't committed at the time.
22. A coach adjustment applied during rest changes the Live Activity lines and the pending notification body to the new target (rest-state.md check 11), without moving the deadline.
23. The Alert check summary sentence matches what actually happens in a locked test for cases A, D, E and I.
24. `Test rest alert` never creates, changes or deletes workout data.
25. VoiceOver reads the Live Activity with units in full and the word "target".

---

## 8. Proposed changes (for Ben / the product manager)

| # | Change | Reason |
|---|---|---|
| P-L1 | Remove "Time Sensitive only if Ben enables it" from rest-state.md §4.8 and the brief's alert layers; the free route can't use it (ADR 0004) | Avoids designing a control that can't work |
| P-L2 | One Live Activity per workout (Ready / Resting / Working / Paused), not one per rest | Shows the next set even between rests, and avoids starting and ending an activity at every Log |
| P-L3 | Lock-screen text carries the absolute end time (`Until 18:42`) | The activity can't change at the deadline without push; the end time keeps `0:00` unambiguous. Use `staleDate` once on SDK 58 |
| P-L4 | No lock-screen buttons (+30 s, Skip, Log) in the first milestone | Logging blind risks wrong data; timer buttons need `LiveActivityIntent`, which must first pass a free-provisioning device test. Revisit after Ben uses it |
| P-L5 | Alarm only while Fizz is in the background (§4.1) | Keeps "exactly one alert" without racing the in-app cue |
| P-L6 | Optional quiet `Resting until 18:42` notification when the Live Activity is unavailable | Gives the lock screen the end time and next set on the free route today |
| P-L7 | Optional `still running` reminder, off by default | Catches a forgotten Finish before the stale-workout path (6 h) |
| P-L8 | Live Activity fix choice is still Ben's (ADR 0007 Known risks: (a) runtime group resolution, (b) build with the suffixed group, (c) upgrade trigger). This design works unchanged with any of them | — |

Device tests still open: `DEP-LIVE` after the App Group fix; `DEP-ALARM` (authorisation, alert-only timer without the widget, silent and Focus breakthrough, secondary button); `Text(timerInterval:)` behaviour at `0:00`; passive notification visibility on the Lock Screen; the locked-speech battery cost over 75 minutes (report a measured number, never an estimate).

---

## Proposed design-system additions

No new colours. The widget can't import `theme.ts` (it's serialised alone), so it mirrors these values in a comment-labelled constant.

| Addition | Spec |
|---|---|
| Live Activity colour mirror | `accent` `#5AA9FF` (dark) / `#0A63C9` (light) for the `timer` icon; `status.warning` `#F2B84B` / `#8A5A00` for the paused icon; text in system primary/secondary label colours on the system material. Re-check contrast when tokens change |
| `type.liveCountdown` | Banner 28pt semibold, expanded trailing 24pt semibold, compact trailing system size; monospaced digits; regular weight when luminance is reduced **Pending designer:** the build ships 56pt banner / 44pt expanded with `minimumScaleFactor(0.6)` (Ben asked for "a bit bigger"); size to be set from device test L10 (progress.md build note, review ben-bugs r3 S2). |
| `sound.restEnd` asset | `rest-end.caf`, ≤ 2 s, used by the in-app chime and the notification sound |
| `timing.lateCueDrop` | 5 s. A spoken cue later than this is not spoken (currently written as prose in rest-state.md §4.7) |
| `timing.loudModeMinRest` | 2:00. The threshold for `Long rests only` |
| `timing.stillRunningReminder` | 60 min after the last set (optional notification) |
| Alert check row | Reuse `StatusRow` from system-states.md: icon (`checkmark.circle.fill` / `exclamationmark.triangle` / `minus.circle`) + `type.body` line + optional `Open Settings` text button |

## Cross-links

- [rest-state.md](rest-state.md): in-app timer, cue modes and scripts, and §4.7–§4.8, which this file extends (and corrects per P-L1).
- [flow-first-milestone.md](flow-first-milestone.md): `DEP-NOTIF` (passed), `DEP-LIVE` (failing on the free route until the App Group fix), cue de-duplication keys (§4.2), layer rules (§5).
- [active-workout.md](active-workout.md): the `fizz://workout` target and the Paused / Working states mirrored here.
- [onboarding.md](onboarding.md) §4.6: permission priming for notifications and `Loud rest alerts`.
- [system-states.md](system-states.md): permission-denied states, the refresh reminder notification, and `StatusRow`.
- [data-import-export.md](data-import-export.md): restore and delete cancel every layer here.
- [profile-and-settings.md](profile-and-settings.md) §2.6: hosts Voice & alerts; this file supplies the `When rest ends` section, Alert check and Test rest alert.
- [ADR 0004](../decisions/0004-free-distribution-sidestore.md), [ADR 0007](../decisions/0007-mobile-shell-identity-and-ipa-pipeline.md), [device test build 7](../device-tests/2026-10-08-probe-build7.md).
