# Review: spoken cues, coach replies read aloud, Settings › Voice (branch `claude/voice-19oct`)

Diff: `5217386..ad840c9` (7 commits). Reviewer run on 19 Oct 2026, in `/home/user/wt-voice`:

- `npm run typecheck`: pass
- `npm run lint`: pass
- Targeted vitest (`spoken-cues` domain and app, `device-prefs`, `rest-alerts`): 4 files, 57 tests, all pass
- Full suite `--maxWorkers=2`: 344 files, 6,909 tests passed (1 todo)
- Swift: read only. No Mac here, so the next CI `.ipa` build is the first compile.

## Verdict: **CHANGES NEEDED**

Two blocking issues. The spoken set detail can say a different load or reps from the one on the card. A coach reply can start speaking after Ben has closed the sheet. The Swift changes, the session category, ducking and deactivation, the cue timing, the force-close and once-only handling, the settings persistence, the unavailable state and rule 7 all look right.

## Blocking

### B1. "Rest done. Set 2 …" reads the plan's target, not the values on the card
`packages/domain/src/spoken-cues.ts:138-139`

```ts
const hasTarget = p.load !== null || p.reps !== null || p.durationS !== null || (p.distanceM ?? null) !== null;
const d = !hasTarget && set.draft ? set.draft : null;
```

The card's prefill (`prefillDraft`, `packages/domain/src/session/view.ts:141`) gives a **saved draft precedence over the target**. The cue does the reverse and uses the draft only when there's no target at all.

**Failure:** Bench set 2 has a target of 100 kg × 6–8. During the rest Ben changes the next set to 85 kg, and the debounced `save_draft` stores it. At rest end the phone says "Rest done. Set 2, Bench press, 100 kilos for 6 to 8." The card shows 85, and 85 is what gets logged. A second failure comes from partial targets (load open, reps 8): the card fills the load from history, but the voice says "8 reps" as if it were a bodyweight set. The main point of the set-detail cue is to say the right load, and this one contradicts the screen.

**Fix:** use the same precedence as the card. Take the draft when there is one, and otherwise the target field by field. Better still, build `spokenSetOf` from `prefillDraft(state, setId)`, or from the Focus view's values, so voice and screen can't drift apart. When a field has no value in either, leave it out rather than changing the phrasing to "N reps". Add tests: a draft that differs from the target, and a partial target.

### B2. A reply that arrives after the sheet has closed is still read aloud
`apps/mobile/src/screens/coach/CoachSheetScreen.tsx:126, 268`

On unmount the sheet calls `hush()`, but `send()` keeps waiting on `services.coach.send(...)`. When the turn completes, line 268 calls `replyVoice.say(words)` on the unmounted sheet's voice, and nothing stops it.

**Failure:** mid-workout, Ben asks the coach something, closes the sheet while it is thinking (turns take several seconds), and goes back to his set. A few seconds later the reply is read over his workout. The brief says speech stops when Ben closes the sheet. A related case: if Ben is typing the next message when a reply arrives, it starts speaking anyway.

**Fix:** keep a `mounted` ref, or an `AbortController` cleared on unmount, and skip `say` once the sheet has closed. Also skip it when the field already has text (`text.trim() !== ''` at arrival). Move the decision into `read-aloud.ts`, for example `replyToSpeak(r, on, { open, typing })`, so it can be tested on Linux. Add a test for "closed before the reply arrives → nothing spoken".

## Should fix

### S1. Stopping a reply also kills a rest cue that is queued or playing; a cue queued behind a reply speaks late
`apps/mobile/src/voice/read-aloud.ts:55, 64`; native `stop()` (`AudioCoachModule.swift`, `AsyncFunction("stop")`)

`hush()` and `say()` (when they interrupt) call the module's `stop()`. That does `stopSpeaking(at: .immediate)` and `cancelAll()`, which cancels **every** queued utterance, cues included. The comment "a rest cue playing meanwhile isn't cut" only holds while no reply of ours is speaking.

**Failure 1:** a 300-character reply is being read, the rest ends, and "Rest done …" queues behind it. Ben starts typing, and both the reply and the rest cue are cancelled without a sound.
**Failure 2:** Ben doesn't type. "Rest done" then plays about 15–20 s late, after the reply. The JS late-drop check ran when the cue was handed over, not when it actually played.

**Fix (choose one):**
- Have cues pre-empt replies. `fire()` stops a reply that is speaking before it speaks the cue.
- Use two synthesizers natively, or add `stop(kind)` so only reply utterances are stopped.

At minimum, `hush` must not cancel a queued cue. Add a test using the fake speaker.

### S2. Double alert off the workout screen (the developer's question 1)
`apps/mobile/src/alerts/presentation.ts:12` (unchanged) together with `apps/mobile/src/voice/cue-controller.ts:374`

Cues speak whenever the app is active. The banner is suppressed only while the workout screen is focused. With the coach sheet open over a workout (where replies are read by default) or on Today, the phone shows the banner and plays its sound when not on silent, and the voice speaks as well. The brief asks for "No double alert". Ben needs to choose one of two options:
- (a) speak cues only while the workout screen or the coach sheet over it is showing
- (b) suppress the foreground banner whenever a spoken cue is going to play: cues on, module available and app active

Option (b) keeps one alert everywhere and is probably the better choice. See also Spec issues.

### S3. The CHANGELOG labels the developer's own deviations as "Ben approved"
`docs/brief/CHANGELOG.md:249-256`, `docs/design/voice.md:3`

The entry's title says "(Ben approved 19 Oct)". It also contains decisions Ben didn't make:
- Five speed buttons instead of a slider
- Replacing rest-state §5's Quiet / Set cues / Conversation modes
- Reading typed questions aloud during a workout by default
- "45 kilos on the stack"
- Spoken "10 seconds." and "Time." cues for timed sets

The voice.md note says "Ben approved" for the whole thing. CLAUDE.md says Ben approves brief changes. Move these into a "Pending Ben's approval" sub-list, or ask him, before they are recorded as approved.

### S4. Read-aloud "During workouts" is off when the sheet isn't opened from the workout
`apps/mobile/src/screens/coach/CoachSheetScreen.tsx:468`

`liveWorkout = entry.kind === 'workout' && workout?.active === true`. If Ben opens the coach from the tab or from Today while a workout is in progress, replies stay silent, although the brief says "default ON only while a workout is in progress". Use "a session is active" rather than the entry kind, or confirm with Ben that only the in-workout entry should count.

### S5. The header speaker rewrites the global setting in ways that surprise
`apps/mobile/src/screens/coach/CoachSheetScreen.tsx:491`, `apps/mobile/src/voice/read-aloud.ts:444`

Muting a reply mid-workout sets `readReplies = 'off'` for good, so the next workout stays silent until Ben finds Settings. Tapping the speaker on in a non-workout sheet sets `'always'`. The brief only asks for "a speaker toggle in the coach sheet header". Consider a toggle for this sheet session that doesn't write the setting, or ask Ben. If it stays, make it visible in Settings (it is), and test `toggleReadReplies` together with the next-workout default.

## Nits

- N1. `spoken-cues.ts:113,122`: a unilateral set with a chosen side says both "left side" and "each side" ("Set 2, left side, split squat, 20 kilos each for 8 each side"). Drop "each side" when a side is set. `per_hand` on a one-dumbbell unilateral movement says "each", which is wrong for a single dumbbell.
- N2. `spoken-reply.ts:38`: the range regex turns dates and IDs into "2025 to 10 to 19". `:40` reads clock times such as "6:30" as "6 minutes 30". Limit ranges to plausible rep and load ranges, for example numbers up to 3 digits not followed by another `-digit`.
- N3. `AudioCoachModule.swift:279`: `getVoices` is a sync `Function` on the JS thread. The first `speechVoices()` call can take hundreds of ms and is first reached inside the first spoken cue (`speaker.ts` `installedVoices()`). Warm the cache at launch or on the Voice screen, or make it an `AsyncFunction`.
- N4. A relaunch within `timing.lateCueDrop` (5 s) of a rest deadline still says "Rest done". This is acceptable, but the brief says "not after force-close for a past deadline". Mention it in a comment or test it as intended.
- N5. Profile adds a new "Voice" section and row. profile-and-settings.md §2.6 calls it "Voice & alerts". Either is fine for now, but note it in the design doc.
- N6. Untested wiring: the Root `setVoicePrefs` sync, `appleSpeaker` (the voice/language/rate it passes) and the sheet's close and typing behaviour (B2) have no tests. The pure parts are well covered.
- N7. `CUE_EXAMPLE` subtitles in Settings are examples in quotes. This is fine under the minimal-copy rule, but it is the only explanatory copy on the screen.

## Checked and OK

- **Swift.** `voice` field on `SpeakOptions`. `AVSpeechSynthesisVoice(identifier:)` falls back to the language, then the system voice. `voiceTraits` (`.isNoveltyVoice`, `.isPersonalVoice`) is correctly behind `#available(iOS 17.0, *)`, which is needed because the podspec targets 16.4. The `describe` overload for `AVSpeechSynthesisVoiceQuality` has a `default` arm. The return type `[[String: Any]]` matches the existing `getSessionState` pattern. The pod builds in Swift 5.9 mode, so Swift 6 strict concurrency doesn't apply. This looks compilable. CI will confirm.
- **Session handling.** `.playback` / `.voicePrompt` with `.duckOthers` and `.interruptSpokenAudioAndMixWithOthers`, so speech plays with the silent switch on and music is ducked, not stopped. The category is re-applied only when idle. The session is deactivated with `.notifyOthersOnDeactivation` after the last pending cue. Interruption and route observers are untouched. A failed `setActive` during a call rejects the promise, and JS catches it.
- **Cue timing.** Cues are keyed by timer or set and deadline, so the expiry tick's version bump doesn't re-cue. Each plays once (`played`). Cues are dropped when late (warning 1.5 s, end `lateCueDrop`), when cues are off, when the app isn't active, or when the module is missing. A deadline that passed while the app was closed is never scheduled. Pause, Skip and ±30 s reschedule or drop. The cue controller runs behind the alert controller's version guard and can't throw into the alert or logging. The background path is unchanged.
- **Settings.** Off / Timer only / Timer and set details. The quick ⋯ toggle keeps the detail level. Settings parse defensively and persist in device prefs, not in backups, and hold no secrets. Delete my data resets them.
- **Honest unavailable state.** No module: Settings shows "Not in this build", and the menu item and speaker button are hidden. An old module without `getVoices` shows "Voice list not in this build". Failed coach turns are never spoken, so there are no canned replies.
- **Rule 7.** Apple voices only. There is no network or paid route. No entitlements or app.json changes.

## Spec issues

- **"No double alert" conflicts with "the notification banner suppression stays as is".** The suppression covers only the workout screen, but cues speak anywhere in the app. Both lines can't hold everywhere (S2). Ben should choose between "cues only on the workout screen" and "suppress the foreground banner when a cue will speak".
- **The spec doesn't say whether the header speaker is per sheet or global, or what "while a workout is in progress" means for a coach sheet opened from Today** (S4, S5).
- **The brief doesn't decide whether cues pre-empt coach speech** (S1). Proposal: cues always win, and a reply is cut or deferred.
- **The design docs rest-state.md §5 (cue modes, "Ready when you are…") and voice.md §4.4 (replies spoken only after a spoken question) are superseded without Ben's sign-off** on those parts (S3).
