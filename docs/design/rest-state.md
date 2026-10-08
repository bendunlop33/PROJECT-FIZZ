# Rest state

Status: v0.1 draft, 8 Oct 2026. Rest is part of the Active workout screen, not a separate screen. See [active-workout.md](active-workout.md) and the state machine in [flow-first-milestone.md](flow-first-milestone.md) §3. Tokens: [design-system.md](design-system.md) §9.6.

## 1. Purpose

Rest answers **"How long until my next set, and what is it?"**

There is no rest-specific primary action. The primary remains **`Log <next set>`**, so the loop stays at one tap per set (proposal P2). The rest controls (−30 s, +30 s, Skip) are secondary.

## 2. Layout

### 2.1 Focus view

Regions inside the focused card, top to bottom:

1. **Context line.** `Bench press · Set 3 of 4 next`, or `Next exercise: Incline DB press` after an exercise's final set.
2. **Rest timer (full).**
   - The label `Rest`.
   - The countdown in `type.timerDisplay`.
   - A control row: [−30 s] [+30 s] [Skip].
3. **Just-saved line.** `✓ Set 2 saved: 100 kg × 7`. This is the actual result. Tap it to correct.
4. **Effort chips (optional).** `Effort (optional)` 6 7 8 9 10 (or RIR 4+ 3 2 1 0, set in preferences). This edits the set that was just saved.
5. **Inline coach card (optional).** A `ChangeReviewCard`, if there is a valid proposal.
6. **Up next.** The next set's draft fields, with the `Target …` line and `Rest after: 1:30 ›`.
7. **Action bar.** `Log …` for the next set.

```
┌────────────────────────────────────────┐
│ ⌄  Push A          26:05     ⏸    ⋯   │
│ [⌂ Main Gym ▾] [🔈 Cues ▾] [Focus|All] │
├────────────────────────────────────────┤
│ Bench press · Set 3 of 4 next          │
│ ┌────────────────────────────────────┐ │
│ │ ⏱ Rest                             │ │
│ │                                    │ │
│ │              2:47                  │ │ type.timerDisplay, tabular
│ │                                    │ │
│ │ ┌────────┐  ┌────────┐  ┌────────┐ │ │
│ │ │ −30 s  │  │ +30 s  │  │  Skip  │ │ │ 52pt targets
│ │ └────────┘  └────────┘  └────────┘ │ │
│ └────────────────────────────────────┘ │
│ ✓ Set 2 saved: 100 kg × 7            › │
│ Effort (optional)                      │
│ [ 6 ] [ 7 ] [ 8 ] [ 9 ] [ 10 ]         │
│                                        │
│ Up next · Set 3                        │
│ ┌──┬────────────┬──┐ ┌──┬───────┬──┐   │
│ │− │  100 kg    │+ │ │− │   8   │+ │   │
│ └──┴────────────┴──┘ └──┴───────┴──┘   │
│  Target 100 kg · 6–8 reps              │
├────────────────────────────────────────┤
│ [ 🎙 ] [       Log 100 kg × 8        ] │
└────────────────────────────────────────┘
```

### 2.2 Rest ended (Ready)

```
│ ┌────────────────────────────────────┐ │
│ │ ✓ Ready when you are               │ │ accent icon + text
│ │ Rested 3:12                        │ │ count-up, text.secondary
│ └────────────────────────────────────┘ │
```
The rest card shrinks to this two-line block, so the next set's fields move up.

### 2.3 Overview view (compact)

There is a 52pt bar above the action bar: `⏱ Rest 2:47   [−30] [+30] [Skip]`. When rest ends it reads `✓ Ready · rested 3:12`, and Skip is hidden.

### 2.4 Rest duration editor (tap the countdown, or `Rest after: … ›`)

```
┌────────────────────────────────────────┐
│ Rest after set 2                  Done │
│                                        │
│        [ 2 min ▾ ] [ 30 s ▾ ]          │ wheel picker, 15 s steps
│                                        │
│ From: Heavy preset (Bench press,       │
│ working sets)                          │ preset source shown here only
│                                        │
│ Apply to                               │
│ (•) This rest only                     │
│ ( ) Bench press working sets, today    │
│ ( ) Save as Bench press default        │ writes routine preset (explicit)
└────────────────────────────────────────┘
```
- Opening it from the running countdown edits the running timer. Opening it from `Rest after:` edits the upcoming rest.
- Only the third option changes the saved routine. Saving it shows a toast: `Saved for future Bench press workouts` [Undo].

## 3. States

| State | Display | Entered by | Left by |
|---|---|---|---|
| Not resting | No rest card. `Rest after: m:ss` line on the set card | Initial set; Skip; expiry; Log | Log (with rest > 0) |
| Running | Countdown, controls | `commitSetAndBeginRest` returned a timer | Expiry, Skip, Log early, Pause, Undo |
| Heads-up (optional) | Same, plus a cue at 15 s (off by default) | 15 s remaining | — |
| Ended (Ready) | `Ready when you are` + count-up | Deadline reached | Log (count-up stops), or the next set changes |
| Skipped | Same as Ready, but no count-up and no rest-end cue | Skip | Log |
| Ended early | Not shown. The next set's rest replaces it | Log during rest | — |
| Paused | Countdown frozen at the remaining time, warning `Paused` label, controls disabled | `pauseSession` | `resumeSession` |
| Cancelled by undo | The rest card disappears and the undone set is active again | Undo of the set that started it | — |
| Restored after force-close | Countdown from `deadlineUtc − now`, or Ended with the banner `Rest ended at 18:42` | Relaunch | — |
| Zero-length rest | No card. Goes straight to the next set (e.g. superset member, rest preset 0) | Commit | — |
| After the workout's final set | No rest. Primary `Finish workout` | Commit of the final set | — |
| Transition (optional) | After an exercise's final set, only if Ben has configured one: `Move to Incline DB press · 0:30` | Commit | As Running |
| Notifications not allowed | Rest works normally. A one-time inline row in the rest card: `Get an alert when rest ends while your phone is locked?` [Allow] [Not now] | First rest of the first workout, if permission is undetermined | Answering. If it's denied, Profile shows `Rest alerts are off in iOS Settings` |

## 4. Interactions and timer behaviour

### 4.1 Start
- Rest starts **inside** `commitSetAndBeginRest`, in the same transaction as the set. The duration is snapshotted from `resolveRestPreset`.
- The timer starts at once, without waiting for:
  - AI analysis
  - RPE entry
  - network access
  - cue playback

### 4.2 Rest preset resolution order (`resolveRestPreset(sessionId, setId)`)

The first match wins:
1. **Explicit set override.** A duration set for this specific set, either in the routine or by "This rest only" or "…sets, today".
2. **Routine exercise + set-type preset.** For example, Bench press working sets → Heavy 3:00. Warm-ups → Warm-up 1:00.
3. **Exercise default.** The catalogue or user default for Bench press.
4. **Global default.** Profile → Rest presets → Standard.

Example presets ship as editable starting points: `Warm-up 1:00`, `Standard 1:30` and `Heavy 3:00`. These are examples, not a prescription. Ben edits them in Profile → Rest presets, and the onboarding shows them once.

The resolved **source** is shown only in the duration editor (§2.4). The set card shows only `Rest after: 3:00`.

### 4.3 Adjust
- **−30 s / +30 s** call `adjustRestTimer(timerId, ±30)`. This creates a new deadline and version, replaces any scheduled alert and cue, and fires `haptic.step`.
  - Going below 0 clamps to 0 and ends rest. Treat this as Ended, not Skipped, and play the rest-end cue.
  - Adjusting doesn't change the saved routine preset.
- **Tap the countdown** to open the editor with the remaining time preselected.
- **Skip** calls `endRestTimer(timerId, 'skipped')` (proposed). It goes to Ready, cancels cues, and no rest-end cue plays.

### 4.4 Ending early by logging
- Tapping `Log …` during rest ends the current timer with the reason `ended_early`, cancels its cues, commits the new set and starts the new rest.
- The 1 s commit guard (design system §5) stops a double tap on the previous Log from being read as this action.

### 4.5 Changes that don't touch rest
These never restart, extend or shorten the countdown:
- changing effort
- correcting the just-saved set
- editing the next set's draft
- switching Focus/Overview
- opening the coach

Applying a coach proposal also leaves rest alone. It changes targets, not timers.

### 4.6 Pause
- Pause lives in the top bar and pauses the whole workout (proposal P4). The rest card controls are disabled while paused.
- `pauseSession` stores the remaining time and cancels scheduled alerts and cues. `resumeSession` sets the deadline to now + remaining and reschedules.
- Paused time is excluded from active workout duration.

### 4.7 Background, lock and force-close
- **Backgrounding or locking does not pause.** The deadline is persisted, and the countdown is always worked out from `deadlineUtc − now`.
- **At commit,** `scheduleTimerCue(timerId, version)` schedules:
  - a local notification at the deadline (`DEP-NOTIF`)
  - the optional heads-up
  - a Live Activity update (`DEP-LIVE`)
- **Reopening** shows the true remaining time, never the full preset.
- **Delivery de-duplication:** if the app is in the foreground at the deadline, the in-app cue plays and the pending notification is cancelled. If it's in the background, the notification is the only delivery. On returning, nothing is replayed.
- **Late speech is dropped.** A spoken cue more than 5 s late is not spoken.
- Force-close behaviour is specified in flow §4.2.

### 4.8 Lock screen and notification content
Available only where supported (`DEP-LIVE`, `DEP-NOTIF`).

- **Live Activity, compact:** `Rest 2:47`, worked out by the system from the deadline.
- **Live Activity, expanded:** `Bench press · Set 3 of 4`, `Rest 2:47`, `Next: 100 kg × 6–8 (target)`.
- **Notification at the deadline:** title `Rest done`, body `Next: Bench press · 100 kg × 6–8 target`.
  - It is Time Sensitive only if Ben enables it.
  - It has no Log action in this milestone, because logging from the lock screen without seeing the values risks wrong data. That can be revisited later.
- **If `DEP-LIVE` fails:** notification only. The design doesn't depend on a Live Activity.

### 4.9 Voice equivalents (Conversation mode; `DEP-STT`/`DEP-AI`)
- "Add thirty seconds" / "skip rest" / "how long left?" map to the same functions. The reply is spoken and shown in the voice strip.
- Speaking never extends rest by itself.

### 4.10 Undo
- **Undo the set that started this rest:** the timer is cancelled and its cues are cancelled (`cancelObsoleteCues`).
- **Undo a ±30 s change:** tap the opposite button. No toast is shown for timer nudges, because they are low-stakes and easy to reverse.
- **Undo "Save as … default":** toast [Undo].

## 5. Spoken cue modes and copy

The mode is chosen from the `VoiceModePill` menu (active workout) or Profile → Voice & alerts. It applies to future workouts until changed.

```
┌────────────────────────────────────────┐
│ Voice during workouts                  │
│ (•) Quiet                              │
│     Screen, vibration and alert sound. │
│ ( ) Set cues                           │
│     Short spoken prompts. No AI, no    │
│     microphone.                        │
│ ( ) Conversation                       │
│     Set cues plus tap-to-talk with the │
│     coach.  ⚠ Coach not connected      │
│ ─────────────────────────────────────  │
│ [ ] Heads-up at 15 seconds left        │
│ [ ] Announce each set before you start │
│ [ ] Listen during rest (mic on in rest)│
│ [ ] Speak through phone speaker when   │
│     no headphones                      │
└────────────────────────────────────────┘
```

| Mode | Uses | Needs | Unavailable state |
|---|---|---|---|
| Quiet | The screen, `haptic.restEnd` and an optional `sound.restEnd` | Nothing | — |
| Set cues | Local scripted speech from `buildSetCue`. No LLM call | Device TTS (`DEP-AUDIO`) | If TTS fails: the pill shows `Cues ⚠` and the menu says `Spoken cues aren't working on this phone. Using vibration and sound instead.` |
| Conversation | Set cues + push-to-talk coach. Optional rest-only listening | Mic permission, STT (`DEP-STT`), an AI text route (`DEP-AI`) | The option is selectable only if `getAiCapabilities` reports a route. Otherwise it shows `Coach not connected` and is disabled, with a link to Profile |

Rules:
- **No microphone is ever opened just to run a timer.** "Listen during rest" is off by default. When it's on, the mic opens only in Resting, the recording indicator (`● Mic on`) shows in the status row, and it closes at rest end.
- **Headphones disconnect mid-workout:**
  - If "Speak through phone speaker" is off (the default), cues fall back to haptic and sound, and the pill shows `Cues · no headphones`.
  - If a phone call comes in, speech stops and the session continues.
- **Music** is lowered briefly for cues, then restored (`DEP-AUDIO`). If lowering isn't supported, the cue mixes with the music, and Profile states this.
- **Stale cues are never queued.** If the next set changes during rest (correction, proposal applied, set reordered), `cancelObsoleteCues` runs and the rest-end cue is rebuilt from the new committed values.
- **No countdown announcements** (no "3, 2, 1"), no reading of summaries, and no speech during Ready except the rest-end cue itself.

### Cue scripts (deterministic; `buildSetCue(event, sessionVersion)`)

Numbers are read as digits by TTS. The unit word comes from the equipment convention (design system §8).

| Event | Default in Set cues | Script | Target or actual |
|---|---|---|---|
| Result commits, rest follows | On | "Logged 100 kilos for 8. Rest 3 minutes." | Actual |
| Result commits, last set of the exercise | On | "Logged 100 kilos for 8. Bench press done. Rest 2 minutes." | Actual |
| Result commits, final set of the workout | On | "Logged 100 kilos for 8. That was the last set." | Actual |
| Heads-up | Off | "15 seconds." | — |
| Rest ends | On | "Ready when you are. Bench press, 100 kilos, target 6 to 8 reps." | Target |
| Rest ends, new exercise | On | "Ready when you are. Incline dumbbell press, 30 kilos each, target 8 to 10 reps." | Target |
| Set intro | Off | "Bench press. Set 3: 100 kilos, target 6 to 8 reps." | Target |
| Timed work ends | On | "Time." | — |
| Plan change applied | On | "Remaining sets updated for today." | — |
| Undo (only when triggered by voice) | On | "Removed set 2." | — |
| Workout finished | On | "Workout saved. Your summary is ready." | — |

Durations are spoken as:
- ≤ 90 s: "90 seconds"
- whole minutes: "3 minutes"
- otherwise: "2 minutes 30"

## 6. Data needed

- `commitSetAndBeginRest(command)` returns `{set, restTimer{timerId, deadlineUtc, durationS, source, version}}`, or `null` for a zero-length or final rest.
- `resolveRestPreset(sessionId, setId)` returns `{durationS, source: 'set_override' | 'routine_set_type' | 'exercise_default' | 'global_default', sourceLabel}`.
- `adjustRestTimer(timerId, deltaSeconds)`, and the proposed `endRestTimer(timerId, reason)`.
- `pauseSession(sessionId)` / `resumeSession(sessionId)`.
- `startRestTimer(setId, duration)` is used internally by the commit and is not called directly by the UI.
- `buildSetCue(event, sessionVersion)`, `scheduleTimerCue(timerId, version)`, `cancelObsoleteCues(sessionId, version)`.
- `correctSet` handles effort chips and just-saved corrections.
- `getAiCapabilities` decides whether Conversation is selectable.
- `startVoiceSession` handles rest-only listening.

## 7. Acceptance checks

1. Rest starts within 100 ms of the Log tap, with airplane mode on and no AI.
2. A 3:00 rest, backgrounded for 1:00 and reopened, shows 2:00 (±1 s), not 3:00.
3. Force-quit during rest and reopen after the deadline: the app shows `Ready when you are`, there is no spoken cue, and there is exactly one notification (if notifications are allowed).
4. Tapping effort `8` during rest changes the set's RPE and leaves the countdown unchanged. Correcting the just-saved set also leaves it unchanged.
5. `+30 s` at 0:20 gives 0:50, and the alert is rescheduled: one alert, at the new time. `−30 s` at 0:20 ends rest and plays one rest-end cue.
6. Skip ends rest with no rest-end cue and no later notification.
7. Logging the next set at 1:00 remaining cancels the old alert. Only the new rest's alert fires.
8. Pause at 1:10, resume 2 min later: the countdown continues from 1:10, and no alert fires during the pause.
9. Timer expiry never marks a set done and never changes the active set.
10. With rest presets of Warm-up 1:00 and Heavy 3:00 configured, a warm-up set rests 1:00 and a working bench set rests 3:00. The editor shows the matching source label. "This rest only" doesn't change the next workout's preset.
11. In Set cues mode, an accepted proposal during rest changes the next set to 92.5 kg, and the rest-end cue says 92.5 (not 100).
12. In Quiet mode no speech is ever produced. In Set cues mode the microphone is never activated (check the iOS recording indicator).
13. With headphones disconnected and the speaker option off, no cue plays through the phone speaker.
14. After the workout's final set, no rest timer starts.
15. The countdown digits don't shift horizontally as they change (tabular numerals), and nothing animates except the digit change.
