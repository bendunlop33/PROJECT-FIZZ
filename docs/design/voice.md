# Voice (tap-to-talk, spoken set logging, spoken replies, cues)

> **Revision 2026-10-19 (Ben approved).** Built: spoken cues while the app is open ("10 seconds", "Rest done" + optional set details), coach replies read aloud in the coach sheet (default only during a live workout; header speaker toggle), and Profile › Voice (Spoken cues Off / Timer only / Timer and set details; Read coach replies During workouts / Always / Off; installed Apple voice; speed 0.8–1.2; Test), plus a quick cue toggle in the workout ⋯ menu. Where this file or rest-state.md §5 says otherwise (cue modes, "Ready when you are…", replies only when asked by voice), the CHANGELOG entry of 19 Oct 2026 wins. Code: `packages/domain/src/spoken-cues.ts`, `spoken-reply.ts`; `apps/mobile/src/voice/`.

> **Revision 2026-10-08 (consolidation).**
> - VO4 is applied in flow-first-milestone.md §5.1 step 3 (the strip carries the Undo for voice logs; no separate toast) and in design-system §9.10.
> - `timing.coachFirstToken` → `timing.coachTimeout` (design-system §6). Voice timing tokens are now in design-system §6; `VoiceStrip`, `RecordingIndicator` and `ClarifyChips` in §9.37–9.39.
> - Settings: the `Talking` group (§2.5) sits in Profile → Voice & alerts after the cue modes (profile-and-settings.md §2.6). `setVoicePreferences` is folded into `saveVoiceSettings(patch, opId)` (profile-and-settings.md §6).
> - Microphone-denied wording aligned with active-workout.md and system-states.md: `Voice isn't available: microphone is off in iOS Settings.`
> - "Remember …" with a general training rule goes to the playbook as a candidate, not to memory (coach-memory.md CM9).

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** Spoken check-ins: with the check-in sheet open, or after "start my workout" on Today, `parseVoiceCommand` hands the utterance to the new pure `parseCheckInUtterance` (grammar, clarifications and outcomes in [check-in.md](check-in.md) §4.5). "Feeling a 3, tired" saves score 3 + `Tired` with no AI and no network. Words are never turned into a number ("feeling great" asks `What number, 1 to 5?`), and a bare "sore" asks the CM6 question. Talk sits in the sheet's bottom bar and uses the same strip, timings and Undo rules (the in-workout toast carries `Change`). After the first set is logged, check-in phrases are not parsed as a check-in. Changed: §4.3, §6, checks 22–24.

Status: v0.1 draft, 8 Oct 2026. The single spec for voice **input** and coach **speech**, covering brief §3, §12 (spoken set companion), validation scenarios in §10, CHANGELOG v0.2 (on-device first, deterministic `parseSpokenSet`) and v0.6 (Apple voices for cues; Apple or opt-in OpenAI voice for coach replies; en-GB on-device recognition), CLAUDE.md rules 1, 3, 5, 7 and 8, and [device probe build 7](../device-tests/2026-10-08-probe-build7.md). Scripted cue wording and cue modes stay in [rest-state.md](rest-state.md) §5; the inline voice strip's placement stays in [active-workout.md](active-workout.md) §2.5. This file defines what happens inside them. Tokens: [design-system.md](design-system.md).

Voice is **another way to do the same things**. It uses the same services, operation IDs, guards and Undo as taps. With no network and no AI, simple set logging and workout commands still work by voice (rule 1).

## 1. Purpose

Voice answers **"Can I log this set and ask a quick question without putting the dumbbells down, and be sure it heard me right?"**

- The control is `Talk` (`TalkButton`): bottom-left of the workout action bar, in the coach sheet composer, and as a long-press on the `Ask` pill elsewhere. In the workout, `Log …` stays the single primary; Talk is secondary.
- Every spoken result is shown in writing before or as it takes effect: what was heard, what it became, and whether it was saved.

### What runs where (first release)

| Job | Engine | Network | Cost |
|---|---|---|---|
| Speech to text | Apple on-device recognition, device locale (en-GB) | No | Free |
| Set logging and workout commands | `parseSpokenSet` / `parseVoiceCommand`, deterministic, `packages/domain` | No | Free |
| Anything else ("that was a grind", "swap this") | Coach text route (ChatGPT plan or Ben's key) | Yes | Plan / Ben's key |
| Set cues | Apple voice via the audio-session module | No | Free |
| Coach replies spoken | Apple voice (default) or OpenAI voice (opt-in, Ben's key) | OpenAI: yes | Free / Ben's key |
| Live speech-to-speech (Realtime/GPT-Live) | Not in this release (later, explicit decision) | — | — |

### Design decisions to confirm with Ben (flagged, not yet in the brief)

| # | Decision | Reason |
|---|---|---|
| VO1 | **Tap to talk is the default**: tap to start, it stops on `timing.voiceEndSilence` (1.2 s) of quiet or on a second tap, with a hard stop at `timing.voiceMaxUtterance` (12 s). `Hold to talk` is a setting | Holding a button with chalky fingers while holding a dumbbell is hard. Gym noise can defeat silence detection, so the hard stop and the tap-to-stop matter |
| VO2 | **Deterministic first.** Every final transcript goes through `parseVoiceCommand` and `parseSpokenSet` before anything else. Only what they don't match goes to the coach, and only if one is connected | Rule 1; no AI call for "100 for 8" or "skip rest" |
| VO3 | **An unambiguous spoken set saves at once** with Undo in the voice strip (no extra confirm tap). Anything ambiguous asks **one** question and saves nothing until answered | Brief §3 and §12. Asking every time would make voice slower than tapping |
| VO4 | **The voice strip carries the Undo for voice logs**; the separate undo toast isn't shown for them | One Undo, next to the words it undoes. (Changes the wording of flow §5.1 step 3, which says the toast appears) |
| VO5 | **Use the iPhone's microphone even when headphones are connected**, with sound still going to the headphones (setting, on by default) | Recording through AirPods mics switches them to call-quality audio and dips or pauses music. Needs confirming in the audio-session spike (`DEP-AUDIO`) |
| VO6 | **On-device recognition only by default.** If the phone can't recognise on device for the locale, voice input shows as unavailable; Apple's server recognition is a separate opt-in. OpenAI transcription is a later decision (v0.6: only if gym accuracy is poor) | Privacy and offline use. No silent upload of audio |
| VO7 | **Interrupt by tap only** in this release. Talking over a spoken reply doesn't stop it | Speaker echo would trigger false barge-ins; tap is reliable |
| VO8 | **Spoken replies are capped at two sentences** (~200 characters). Longer replies speak the first two and end with "More on screen." | Keeps rest time for resting, and the full text is always in the conversation |
| VO9 | **Voice can't spend money or change credentials**, and can't start a coach-built workout, approve a playbook rule or clear a pain flag. These need a tap | Higher-stakes or irreversible; workout-builder WB7, coach-memory §4.2 |

## 2. Layout

### 2.1 Voice strip (workout; placement from active-workout §2.5)

The strip sits above the action bar, below the content, and never covers `Log …`. One state at a time.

```
├────────────────────────────────────────┤
│ ● Mic on · Listening…         [ Stop ] │ red dot + text; Stop 52pt
│ "bench 100 kg for"                     │ live partial transcript
├────────────────────────────────────────┤
│ [ ■  ] [       Log 100 kg × 8        ] │ Talk shows Stop; Log usable
│ [Stop]                                 │
└────────────────────────────────────────┘
```

Heard and saved (VO3, VO4):

```
├────────────────────────────────────────┤
│ ✓ Saved · Bench press set 2   [ Undo ] │ status.done icon + word
│ 100 kg × 8 (actual) · RPE 8            │ parsed values, tabular
│ Heard: "Bench 100 kg for eight RPE 8"  │ exact transcript, text.secondary
├────────────────────────────────────────┤
│ [ 🎙 ] [        Log 100 kg × 8       ] │ now the next set's Log
└────────────────────────────────────────┘
```

Clarification (one question, two to four answers):

```
├────────────────────────────────────────┤
│ ? 115 kg or 150 kg?        Not saved   │ questionmark.circle + words
│ [  115 kg × 4  ]    [  150 kg × 4  ]   │ 52pt buttons
│ Heard: "one fifty for four"            │
│ Say the number, or tap.     [ Cancel ] │
├────────────────────────────────────────┤
│ [ 🎙 ] [        Log 115 kg × 4       ] │ Log shows the draft, unchanged
└────────────────────────────────────────┘
```

While a clarification is open, the mic stays open for `timing.voiceClarifyWindow` (8 s) so Ben can just answer ("one fifteen", "the first one"), with `● Mic on` shown.

Coach turn (not a set):

```
│ … Asking the coach                     │ static icon, after 3 s elapsed 0:04
│ You: "that was a grind, what now?"     │
```
then
```
│ 🔊 Coach: "Sets 3 and 4: 95 kilos for  │ speaking; text as it is spoken
│ 8."                           [ Stop ] │
```

The coach's actual change shows in the card's coach slot as usual (coach-adjustments §2.5); the strip only carries the words.

Interrupted / error / unavailable:

```
│ ⓘ Voice stopped for a call.    [ OK ] │
│ ⓘ Didn't catch a number. Say it again  │
│   or use the buttons.                  │
│ ⊘ Voice isn't available: microphone is │
│   off in iOS Settings.   [ Settings ]  │
```

The strip has a `Type instead` link (opens the coach sheet) in Listening and error states, as active-workout §2.5.

### 2.2 Coach sheet composer

Same states inside the composer area (coach-sheet §2.1): while listening, the text field is replaced by the live transcript line and `● Mic on`; the `Talk` button shows `Stop`. On end of speech the transcript becomes Ben's message (with a `mic` icon) and is sent (coach-sheet §4.3).

### 2.3 Today and other tabs

Long-press the `Ask` pill (≥ 0.4 s) to start listening; release isn't needed in tap mode. A strip appears above the tab bar (same component, `bg.surface`), and the pill shows `Stop`. Short tap still opens the coach sheet. Commands here are Today's (`Start my workout`, `Build me a 45-minute push session`) plus coach questions.

### 2.4 First-use microphone explainer (inline, never full-screen)

On the first Talk tap, before iOS asks for permissions, the strip expands:

```
├────────────────────────────────────────┤
│ Talk to log sets and ask the coach.    │
│ Speech is turned into text on this     │
│ iPhone. Audio isn't saved.             │
│ [ Not now ]             [ Continue ]   │ Continue → iOS mic + speech prompts
├────────────────────────────────────────┤
│ [ 🎙 ] [        Log 100 kg × 8       ] │
```

If this happens during a workout, `Log …` stays usable throughout.

### 2.5 Settings: Profile → Voice & alerts → Talking

The cue-mode section above it is rest-state §5. This section is added under it:

```
┌────────────────────────────────────────┐
│ Talking                                │
│ Talk button                            │
│ (•) Tap to start, stops when you stop  │
│     talking                            │
│ ( ) Hold to talk                       │
│                                        │
│ [✓] Use iPhone mic with headphones     │ VO5
│     Keeps music quality on AirPods.    │
│ [ ] Say "done" to log shown values     │ brief §12, off by default
│ [ ] Listen during rest (mic on in rest)│ rest-state §5 (same switch)
│                                        │
│ Recognition                            │
│ Language: English (UK)               › │ device locale by default
│ ✓ On this iPhone                       │ status
│ [ ] Allow Apple's servers if this      │ VO6, off by default
│     iPhone can't recognise speech      │
│     itself                             │
│                                        │
│ Spoken coach replies                   │
│ Apple voice · Serena (Enhanced)      › │ → ai-connection §2.8
│ [✓] Speak replies to questions I ask   │
│     by voice                           │
│                                        │
│ Transcripts                            │
│ Kept with conversations (Forever)    › │ coach-sheet §2.8 retention
│                                        │
│ Your voice: audio is never saved.      │ text.secondary
│ Speech is turned into text on this     │
│ iPhone. With OpenAI voice, the coach's │
│ reply text is sent to OpenAI to be     │
│ spoken. Your voice is never sent to    │
│ OpenAI.                                │
└────────────────────────────────────────┘
```

## 3. States

### 3.1 State table

| State | Strip | Talk caption | Mic | Notes |
|---|---|---|---|---|
| Idle | Hidden | `Talk` (or `Ask` without voice) | Off | — |
| Requesting permission | §2.4, then iOS prompts | `Talk` | Off | Once |
| Permission denied | `Voice isn't available: microphone is off in iOS Settings.` [Settings] | `Ask` | Off | Talk opens the sheet for typing |
| Recogniser unavailable (no on-device support for the locale, assets missing) | `Voice isn't available: speech recognition for English (UK) isn't on this iPhone yet.` [Settings] | `Ask` | Off | No silent switch to server recognition (VO6) |
| Listening | `● Mic on · Listening…` + live partial | `Stop` | On | Indicator: our red dot **and** the iOS orange dot |
| Processing | `Working out what you said…` | `Wait` | Off | Local; normally < 300 ms |
| Clarifying | §2.1 clarification; `Not saved` | `Talk` | On for 8 s, then off | Expires when the active set changes or after 30 s (`Not saved`) |
| Saved | §2.1 heard and saved, Undo | `Talk` | Off | Stays for `timing.undoToast` |
| Command done | `✓ Skipped rest` / `✓ Added 30 s` etc. | `Talk` | Off | For deterministic commands (§4.3) |
| Asking the coach | `… Asking the coach` + Ben's words | `Wait` | Off | `timing.coachTimeout` |
| Speaking | `🔊 Coach: "…"` [Stop] | `Stop` | Off | Talk tap = stop speaking and start listening (VO7) |
| Reconnecting | `Reconnecting to the coach…` | `Wait` | Off | One retry within 5 s, same turn ID; then Error |
| Interrupted (call, Siri, alarm, another app) | `Voice stopped for a call.` / `Voice stopped: another app is using audio.` [OK] | `Talk` | Off, released | Never resumes listening by itself |
| Route lost mid-utterance | `Lost the microphone. Say it again.` | `Talk` | Off | Partial transcript discarded, nothing saved |
| No speech | `Didn't hear anything.` (auto-hides 3 s) | `Talk` | Off | — |
| No number | `Didn't catch a number. Say it again or use the buttons.` | `Talk` | Off | Nothing saved |
| Not a set, coach offline | `Heard: "swap this for cables"` + `The coach is offline. Set logging and workout commands still work by voice.` | `Offline` (design-system §9.8) | Off | Spoken (if voice reply allowed): "The coach is offline. Your sets haven't changed." |
| Not a set, coach not connected | Same with `Coach not connected.` [Connect in Profile] | `Talk` | Off | — |
| Error | `Voice stopped: something went wrong. Nothing was saved.` [Try again] | `Talk` | Off | — |
| Quiet mode | Strip works normally for input; **nothing is spoken**, not even replies | `Talk` | — | Quiet means no speech output (rest-state §5) |
| Paused workout | Talk works; set logging by voice is refused: `Workout paused. Say "resume" or tap Resume first.` | `Talk` | — | Matches Log being hidden while paused |

### 3.2 Spoken-reply engine states

| State | Shown | Behaviour |
|---|---|---|
| Apple voice | Nothing extra | Default |
| OpenAI voice, ready | Nothing extra | Reply audio requested after the text completes; Apple speaks set cues meanwhile |
| OpenAI voice too slow (> `timing.ttsFallback`, 3 s, to first audio) | Strip line once per workout: `Using Apple voice: OpenAI voice too slow` | This reply in Apple voice |
| OpenAI offline / key fails / cap reached | `Using Apple voice: <reason>` once per workout | Apple voice until the reason clears. Never another paid route |

### 3.3 Transitions

```
 Idle ──Talk──► (first time) Explainer ──Continue──► iOS prompts ──granted──► Listening
  ▲                                                     └─denied──► Permission denied
  │
  │   Listening ──silence 1.2 s / tap / 12 s──► Processing
  │       │ call / route lost / background            │
  │       ▼                                           ├─ set, unambiguous ──► commit ──► Saved ──8 s──► Idle
  │   Interrupted / Route lost                        ├─ set, ambiguous ──► Clarifying ──answer──► commit ──► Saved
  │                                                   │                          └─ Cancel / 30 s / set changed ──► Idle (Not saved)
  │                                                   ├─ command ──► run ──► Command done ──► Idle
  │                                                   ├─ other + coach ──► Asking ──► (Speaking) ──► Idle
  │                                                   │                     └─ drop ─► Reconnecting ─► Asking / Error
  │                                                   └─ other, no coach ──► "coach offline" line ──► Idle
  └──────────── Stop (any state): stop mic, stop speech, cancel unconfirmed coach turn; committed actions stay
```

## 4. Interactions

### 4.1 Talk button

| Current state | Tap | Long-press |
|---|---|---|
| Idle (workout) | Start listening | Open coach sheet (typed) |
| Idle (`Ask` pill) | Open coach sheet | Start listening |
| Listening | Stop listening and process what was heard | — |
| Processing / Asking | Nothing (caption `Wait`) | — |
| Speaking | Stop speaking (`interruptSpeech`) and start listening | — |
| Clarifying | Start listening for the answer | — |

`Stop` in the strip stops everything: mic, speech and any coach turn that hasn't applied anything (`cancelCoachTurn`). Anything already committed stays, with its Undo (brief §3 `interruptSpeech`).

Hold-to-talk mode: press starts, release stops and processes. A press shorter than 0.3 s is treated as a tap and shows `Hold to talk` as a hint.

### 4.2 Spoken set logging (`parseSpokenSet`)

Context passed in: the active set (exercise, convention, unit, target, draft, side), the session's other exercises, the equipment's achievable loads, the last comparable result, and the recogniser's alternatives if any.

**Accepted forms** (recogniser output varies: probe build 7 wrote "kg", not "kilos", and mixed digits and words, e.g. "Bench 100 kg for eight"):

| Part | Accepted | Notes |
|---|---|---|
| Numbers | Digits (`100`, `97.5`), words (`eight`, `a hundred and five`), mixed (`100 and a half`), compact (`one fifteen` = 115, `one oh five` = 105), `and a half`, `point five`, `and a quarter` (where the equipment allows .25) | Comma or point decimals |
| Load units | `kg`, `kgs`, `kilo(s)`, `kilogram(s)`, `k`; `lb`, `lbs`, `pound(s)` | Missing unit → the equipment's unit, shown as `100 kg (unit from Main Gym barbell)` on first use per exercise |
| Convention words | `each`, `per hand`, `a side` → per dumbbell; `on the stack`, `stack` → stack; `assist`, `assistance` → assisted; `bodyweight`, `BW` → bodyweight; `plus 10` on BW+added | Only where the equipment's convention matches; else clarify |
| Reps | `for 8`, `x 8`, `times 8`, `8 reps`, `by 8`, `8` after a load | — |
| Effort | `RPE 8`, `R P E eight and a half`, `at 8` after reps; `2 in the tank`, `2 in reserve`, `RIR 2` | RPE/RIR as Ben's preference; quoted back as entered |
| Exercise | Catalogue names and aliases (`bench` → Bench press, `DB` → dumbbell) | Only exercises in this workout without a clarification |
| Side | `left`, `right`, `left side`, `left arm` | Unilateral exercises only |
| Time | `45 seconds`, `forty five`, `0:45` on a timed exercise | — |
| Shortcut | `done`, `log it` | Only if `Say "done" to log shown values` is on and the active set is unambiguous (brief §12) |
| Reps only | `8 reps` | Uses the **displayed** load; the saved line says `100 kg (as shown) × 8` |

**When it asks instead of saving** (one question at a time, VO3):

| Situation | Question | Answers |
|---|---|---|
| Teen/ty pair (13/30 … 19/90, 115/150 …) where both readings are achievable and within ±30% of the target or last result, or recogniser alternatives disagree | `115 kg or 150 kg?` · reps: `13 or 30 reps?` | Both values |
| Only one reading is plausible (e.g. 150 kg is above the bar's max) | No question: uses the plausible one; the saved line shows it clearly with Undo | — |
| Spoken unit differs from the equipment's | `You said pounds. This bar is set up in kg.` | `Log 100 lb` · `Log 100 kg` · Cancel. Never converted |
| About double the expected per-hand load on dumbbells | `30 kg each or 60 kg each?` | Both |
| Load outside the equipment (above max, not achievable) | `Log 150 kg × 4? That's more than Main Gym's plates make.` | `Log 150 kg × 4` (saved with the off-profile flag, active-workout §4.3) · `Say it again` |
| No reps | `How many reps?` | Number by voice or the reps stepper |
| Two bare numbers with no markers (`10 12`) where both orders are plausible | `10 kg × 12 or 12 kg × 10?` | Both |
| Named exercise isn't the active one but is in the workout | `Log to Bench press set 3, or Incline DB press?` | Both |
| Named exercise isn't in the workout | `Bench press isn't in this workout. Add it and log?` | `Add and log` · Cancel |
| Several sets in one go ("three sets of 8 at 100") | `Log 3 sets of 100 kg × 8?` (list shown) | `Log 3 sets` (tap only) · Cancel |
| Side missing on a set that needs one (other-side set) | Uses the fixed side; no question | — |

A clarification is tied to the session version. If a set is logged by tap, the active set changes, or 30 s pass, it closes with `Not saved` and nothing is saved (rule 5).

**On commit:** the same `commitSetAndBeginRest` as the Log button, with the opId from `handleVoiceTurn(turnId, …)`. Duplicate final-transcript events for the same turn commit once. The set's audit records `source: voice` and the transcript (provenance). The commit cue (Set cues / Conversation) is the normal "Logged 100 kilos for 8. Rest 3 minutes."; success is never announced before the local commit returns.

### 4.3 Workout commands (`parseVoiceCommand`, no AI)

| Say | Does | Spoken reply (Set cues / Conversation) |
|---|---|---|
| "undo" / "undo that" | `undoAction` on the most recent action (set, adjustment, command), same guards as tap | "Removed set 2." / "Back to 100 kilos for sets 3 and 4." |
| "skip rest" | `skip_rest` | none (strip `✓ Skipped rest`) |
| "add thirty seconds" / "take off thirty" | `adjustRestTimer(±30)` | none |
| "how long left?" | Reads the timer | "1 minute 40." |
| "what's next?" | Reads the next target | "Bench press, set 3: 100 kilos, target 6 to 8 reps." |
| "repeat that" | Repeats the last cue or reply | the same words |
| "pause" / "resume" | `pauseSession` / `resumeSession` | "Paused." / "Resumed." |
| "quiet" / "cues on" | Switches cue mode | "Quiet mode." (the last thing said) / "Cues on." |
| "stop" | Stops speech and listening | none |
| "machine's busy" | `setTemporaryAvailability` for the active exercise's equipment; a swap needs the coach | "Marked busy for today." |
| "my shoulder hurts on this" | `classifyPainMention` → `setPainFlag` (coach-memory §4.2) | "Pain noted for overhead press. No increases until you clear it." |
| "yes" / "adjust" / "no thanks" | Answers the **visible** offer or the latest awaiting card only (brief §3) | per coach-adjustments §5.3 |
| "start my workout" (Today) | Start the planned routine (today.md §4). With a check-in due, opens the check-in sheet (2026-10-09) | "Starting Push A." |
| "start my workout, feeling a 3, tired" (Today, 2026-10-09) | Start + check-in in one go; the sheet appears only for the pain or ill step (check-in.md §4.5) | "Starting Push A." |
| "feeling a 3", "I'm a 2, slept badly", "4" (check-in sheet open, 2026-10-09) | `parseCheckInUtterance` → same as tapping the score and reasons | "Got it. 3, tired." |
| "train anyway" / "skip workout" / "reschedule" (check-in ill step, 2026-10-09) | The matching button; Reschedule opens the move picker, the day is tapped | "Skipped. Say undo to put it back." (skip only) |

Everything else goes to the coach (if connected) as a turn with `modality: 'voice'` and the transcript.

### 4.4 When the app may speak

From flow-first-milestone §5 rule 3, applied to everything voice produces:

| Moment | May speak |
|---|---|
| Ready (Ben may be mid-set) | Only: the rest-end cue, the commit cue right after Log, and replies to something Ben just asked by voice |
| Resting | The above, plus a coach offer in Conversation mode only with ≥ 20 s left, never over the rest-end cue |
| Working (timed set) | Only the `Time.` cue |
| Quiet mode | Nothing |
| A coach reply would overlap a scripted cue | Cue waits up to 3 s, then is dropped if stale; the rest-end cue beats a reply that hasn't started |
| Clarification asked by voice | Spoken once ("115 or 150?") only if Ben started by voice and the mode isn't Quiet |

Replies Ben asked for are spoken only when **he started by voice** and `Speak replies to questions I ask by voice` is on. Typed questions are never spoken.

### 4.5 Audio routes and interruptions

| Event | Listening | Speaking | Afterwards |
|---|---|---|---|
| Headphones disconnect | Stop, discard partial: `Lost the microphone. Say it again.` (if the mic was the headset's) or continue (iPhone mic, VO5) | Stop the current utterance | Later speech follows `Speak through phone speaker when no headphones` (rest-state §5); default off → haptic/sound only |
| Headphones connect | Continue | Next utterance goes to headphones | — |
| Phone or FaceTime call, Siri, alarm | Stop, release the mic | Stop | `Voice stopped for a call.`; no auto-resume; session and timers unaffected |
| Another app takes audio | Same | Same | `Voice stopped: another app is using audio.` |
| Music playing | — | Music is lowered for speech and restored after (probe: PASS) | — |
| App to background / phone locked while listening | Stop listening (no background mic) | Current cue may finish if background audio is available (`DEP-AUDIO`); otherwise stops | Nothing replayed on return |
| Silent switch on | Unaffected | Behaviour depends on the audio-session module's category; verify on device (`DEP-AUDIO`). If speech is muted, Profile says `Spoken cues are silent while your iPhone is on silent.` | — |
| Bluetooth route change mid-reply | — | Stop, don't replay | — |

All audio-session changes go through the custom Swift module (CLAUDE.md stack). Each event is recorded locally (probe build 7: audio events PASS) for debugging, without audio.

### 4.6 Undo

| What | Undo |
|---|---|
| Set logged by voice | Strip `Undo` (8 s), or say "undo"; later the done row → Delete |
| Clarified set | Same |
| Command (skip rest, ±30 s, pause) | Say the opposite or tap it (no toast, as rest-state §4.10) |
| Coach change from a voice request | Its banner/card `Undo`, or "undo" |
| Pain flag by voice | Strip `Undo` (8 s); after that Memory → Clear |
| Something spoken | Nothing to undo; "stop" stops it |

"Undo" by voice always says what it undid.

## 5. Copy

### 5.1 On screen

| Element | Text |
|---|---|
| Talk captions | `Talk` · `Ask` · `Stop` · `Wait` · `Offline` (design-system §9.8) |
| Explainer | `Talk to log sets and ask the coach.` · `Speech is turned into text on this iPhone. Audio isn't saved.` [Not now] [Continue] |
| Listening | `● Mic on · Listening…` · live partial in quotes |
| Processing | `Working out what you said…` |
| Saved | `✓ Saved · Bench press set 2` · `100 kg × 8 (actual) · RPE 8` · `Heard: "<transcript>"` · [Undo] |
| Unit note | `100 kg (unit from Main Gym barbell)` · reps only: `100 kg (as shown) × 8` |
| Clarify | `115 kg or 150 kg?` · `13 or 30 reps?` · `You said pounds. This bar is set up in kg.` · `30 kg each or 60 kg each?` · `Log 150 kg × 4? That's more than Main Gym's plates make.` · `How many reps?` · `10 kg × 12 or 12 kg × 10?` · `Log to Bench press set 3, or Incline DB press?` · `Bench press isn't in this workout. Add it and log?` · `Log 3 sets of 100 kg × 8?` · status word `Not saved` · hint `Say the number, or tap.` · [Cancel] |
| Command done | `✓ Skipped rest` · `✓ Added 30 s` · `✓ Took off 30 s` · `✓ Paused` · `✓ Marked busy for today` · `✓ Quiet mode` |
| Coach | `… Asking the coach` · `You: "<transcript>"` · `🔊 Coach: "<reply>"` · `Reconnecting to the coach…` |
| Offline | `The coach is offline. Set logging and workout commands still work by voice.` |
| Not connected | `Coach not connected.` [Connect in Profile] |
| Paused | `Workout paused. Say "resume" or tap Resume first.` |
| Interrupted | `Voice stopped for a call.` · `Voice stopped: another app is using audio.` · `Lost the microphone. Say it again.` |
| Nothing heard | `Didn't hear anything.` · `Didn't catch a number. Say it again or use the buttons.` |
| Error | `Voice stopped: something went wrong. Nothing was saved.` [Try again] |
| Unavailable | `Voice isn't available: microphone is off in iOS Settings.` [Settings] · `Voice isn't available: speech recognition for English (UK) isn't on this iPhone yet.` [Settings] |
| Reply engine | `Using Apple voice: no connection` · `…: key not accepted` · `…: voice cap reached` · `…: OpenAI voice too slow` |
| Hold hint | `Hold to talk` |
| Settings | as §2.5 |

### 5.2 Spoken

Cue scripts (commit, rest end, set intro, timed end, finish) are in rest-state §5 and are not repeated here. Voice-specific lines:

| Event | Script | Target / actual |
|---|---|---|
| Voice log saved | (the commit cue) "Logged 100 kilos for 8. Rest 3 minutes." | Actual |
| Voice log saved, reps only | "Logged 100 kilos for 8." (same) | Actual |
| Clarify number | "115 or 150?" | — |
| Clarify unit | "Pounds or kilos?" | — |
| Clarify reps | "How many reps?" | — |
| Not saved (clarification expired) | none (screen only) | — |
| Undo | "Removed set 2." | — |
| What's next | "Bench press, set 3: 100 kilos, target 6 to 8 reps." | Target |
| How long left | "1 minute 40." | — |
| Pain | "Pain noted for overhead press. No increases until you clear it." | — |
| Coach offline | "The coach is offline. Your sets haven't changed." | — |
| Long reply | First two sentences, then "More on screen." | — |
| Not allowed by voice (VO9) | "Tap Start now when you're ready." / "Change that in Profile." / "Clear it on screen." | — |
| Paused | "The workout's paused. Say resume first." | — |

Speech uses "kilos" and "pounds" for units (design-system §8), whatever the recogniser wrote. Numbers like 97.5 are spoken "97 and a half".

## 6. Data needed

Existing (brief §3, §7, §12; coach-adjustments §6): `startVoiceSession(sessionId, mode)`, `stopVoiceSession(voiceSessionId)`, `transcribeUtterance(audio, locale)` (returns transcript and alternatives where the recogniser gives them; never an invented confidence), `parseSpokenSet(transcript, context)`, `handleVoiceTurn(turnId, transcript)`, `speakReply(text, preferences)`, `interruptSpeech(voiceSessionId)`, `confirmProposal(proposalId, sessionVersion)`, `commitSetAndBeginRest`, `undoAction`, `adjustRestTimer`, `endRestTimer`, `pauseSession` / `resumeSession`, `setTemporaryAvailability`, `buildSetCue`, `cancelObsoleteCues`, `getAchievableLoads`, `getComparableHistory`, `buildActiveSetView`, `getAiCapabilities`, `runCoachTurn`, `cancelCoachTurn`, `setPainFlag`, `classifyPainMention` (coach-memory §6).

`parseSpokenSet` result (proposed shape, discriminated):
`{kind: 'set', exerciseId, setId, values: {load?: {value, unit, convention, unitSource: 'spoken' | 'equipment' | 'shown'}, reps?, durationS?, rpe?, rir?, side?}, heard}` · `{kind: 'clarify', question: ClarifyKind, options: SetCandidate[], heard}` · `{kind: 'multi_set', sets[], heard}` · `{kind: 'not_a_set', heard}`.

**Proposed new (contracts to add; flagged for the developer and Ben):**

| Function | Contract |
|---|---|
| `parseVoiceCommand(transcript, context)` → `{command, args} \| null` | **Pure, `packages/domain`, unit-tested** grammar for §4.3. Runs before `parseSpokenSet` for command words; never calls the model |
| `parseCheckInUtterance(transcript, locale, ctx)` (2026-10-09) | **Pure, unit-tested.** Called by `parseVoiceCommand` when `ctx.checkInOpen` or after a start command. Result union and word lists in check-in.md §4.5 and §6. Uses `classifyPainMention` for pain words |
| `getVoiceCapabilities()` | `{micPermission, speechPermission, onDeviceSupported, locale, serverRecognitionAllowed, ttsVoices[], route: {input, output}}` from the native module; feeds `getAiCapabilities.speechIn` |
| `resolveClarification(turnId, choice, sessionVersion)` | Commits the chosen candidate with the turn's opId; rejects if the version moved (`Not saved`) |
| (folded) `saveVoiceSettings(patch, opId)` with `{talkMode, phoneMicWithHeadphones, doneShortcut, listenDuringRest, serverRecognition, speakVoiceReplies, locale}` | Profile settings; canonical name in profile-and-settings.md §6 (was `setVoicePreferences`) |
| Audio events (native module) | `interruptionBegan/Ended`, `routeChanged {reason}`, `mediaServicesReset`; the voice layer maps them to §4.5 |
| Spoken-reply summariser (UI rule, not a model call) | First two sentences up to ~200 characters (VO8) |

## 7. Acceptance checks

Run on Ben's iPhone, en-GB locale (probe build 7 used en-US; re-run that probe with en-GB first).

1. Airplane mode, no AI: "Bench 100 kg for eight" logs one set via `commitSetAndBeginRest`, the strip shows `✓ Saved…`, `Heard: "…"` and `Undo`, and the commit cue plays (Set cues mode). No network request is made.
2. The 30-utterance gym-noise set from spike S6 ("one fifteen", "a hundred and five", "RPE eight and a half", "ninety seven and a half", "thirty each for ten"): record parse accuracy; no utterance saves a wrong number without first asking or showing it in the saved line with Undo.
3. "One fifty for four" with target 115 kg and both 115 and 150 achievable: asks `115 kg or 150 kg?`, saves nothing until answered, then saves exactly one set (brief §10 noisy-gym scenario).
4. "100 pounds for 8" on kg equipment asks the unit question; nothing is converted.
5. "60 for 10" on dumbbells with last 30 kg each asks `30 kg each or 60 kg each?`.
6. "8 reps" saves the displayed load and shows `(as shown)`.
7. "Done" logs nothing unless the shortcut is on; with it on, it logs the displayed values once.
8. The same final transcript delivered twice (simulated) commits one set.
9. A clarification left unanswered while Ben logs by tap closes with `Not saved`; the tapped set is the only one saved.
10. Tap Talk while the coach is speaking: speech stops within 300 ms and listening starts. `Stop` during a coach turn cancels it; a set committed earlier in the turn stays with Undo, and nothing proposed after Stop applies (brief §10 interrupt scenario).
11. A phone call during listening releases the mic (iOS orange dot off), shows `Voice stopped for a call.`, and doesn't resume listening after the call; the rest timer is unaffected (brief §10 Bluetooth/call scenario).
12. Disconnect AirPods mid-reply: speech stops, isn't replayed, and with the speaker option off nothing plays from the phone speaker.
13. With `Use iPhone mic with headphones` on and music playing on AirPods, starting Talk doesn't switch the AirPods to call-quality audio (`DEP-AUDIO` check).
14. In Ready, no unrequested speech happens: run 10 sets with Conversation mode and RPE 10 entries; offers are spoken only in rest with ≥ 20 s left.
15. Quiet mode: voice input still logs sets; nothing is spoken at all.
16. Raw audio is never written to disk (file-system check after a session); transcripts appear only in conversations and set audit records and follow the retention setting.
17. With on-device recognition unsupported (simulated), voice shows unavailable; no audio is sent to Apple's servers unless the opt-in is on.
18. OpenAI voice selected and offline: the reply is spoken in the Apple voice and `Using Apple voice: no connection` shows once per workout.
19. "Start it" on a coach-built draft and "use my API key" do nothing and give the tap instruction (VO9).
20. Every strip state has an icon or word as well as colour; the red `Mic on` dot always comes with the words; `Log …` stays visible and tappable in every strip state at 375pt and AX3.
21. Voice "undo" says what it undid and follows the same version guard as the tap Undo (`Can't undo: set 2 changed…` when rejected).
22. (2026-10-09) Airplane mode, check-in sheet open: "feeling a 3, tired" saves score 3 and `Tired` and starts the workout; the strip shows `Heard: "…"`. "Feeling great" and "feeling a 7" ask for a number; "a bit sore" asks `Sore like after training, or pain?`; nothing is saved until answered.
23. (2026-10-09) "Start my workout, feeling a 4" on Today creates one session with a linked check-in of 4 and no sheet.
24. (2026-10-09) After a set has been logged, "feeling a 2" creates no check-in.

## Proposed design-system additions

No new colours.

| Token / component | Value / spec |
|---|---|
| `timing.voiceEndSilence` | 1.2 s of quiet ends a tap-mode utterance |
| `timing.voiceMaxUtterance` | 12 s hard stop |
| `timing.voiceClarifyWindow` | 8 s mic-open window after a spoken clarification |
| `timing.clarifyExpiry` | 30 s; an unanswered clarification closes as `Not saved` |
| `timing.ttsFallback` | 3 s to first OpenAI audio before using the Apple voice for that reply |
| `VoiceStrip` | Formalises active-workout §2.5: `bg.surface`, top 1pt `border.divider`, padding `space.3`/`space.4`; line 1 status icon + words (`type.headline`), line 2 values (`type.callout`, tabular), line 3 `Heard: "…"` (`type.callout`, `text.secondary`); trailing action (`Stop`/`Undo`/`Cancel`/`Settings`) 52 × 52 hit area. Max 4 lines; at AX1+ `Heard` collapses behind `Heard ›`. Never overlaps the action bar; replaces the `UndoToast` for voice logs (VO4) |
| `RecordingIndicator` | Static 8pt dot in `status.danger` + text `Mic on`; no pulse (Reduce Motion or not) |
| `ClarifyChips` | As coach-sheet additions (52pt, 2–4 options) with status word `Not saved` |

## Cross-links

- [rest-state.md](rest-state.md) §5: cue modes, cue scripts, `Listen during rest`, headphones and music rules.
- [active-workout.md](active-workout.md) §2.5, §4.1, §4.7: strip placement, `Say "done"` shortcut, Talk behaviour.
- [flow-first-milestone.md](flow-first-milestone.md) §5 rules 3–4 and §5.1: speech timing rules and the voice logging path (step 3 changes per VO4).
- [coach-sheet.md](coach-sheet.md) §4.3: Talk in the composer.
- [coach-adjustments.md](coach-adjustments.md) §4.1–4.2, §5.3: "that was a grind", spoken offers and replies.
- [coach-memory.md](coach-memory.md) §2.8, §4.2: pain words and the soreness question.
- [ai-connection.md](ai-connection.md) §2.8: Apple vs OpenAI voice for replies, voice key and cap.
- [workout-builder.md](workout-builder.md) §5.3 (WB7): voice can request but not start.
- [design-system.md](design-system.md) §8 (spoken unit words), §9.8 (`TalkButton`), §9.9 (`VoiceModePill`).
- [device-tests/2026-10-08-probe-build7.md](../device-tests/2026-10-08-probe-build7.md): recogniser output format, ducking, audio events.
