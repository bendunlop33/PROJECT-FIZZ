# Flow: first milestone loop (Today → Active set → Rest → Summary)

> **Revision 2026-10-08.** Aligned with [ADR 0003](../decisions/0003-domain-review-decisions.md) and review S1–S5: Undo is guarded on the set's own version and commit order (S1); Skip is `endRestTimer(…, 'skipped')` with no cue (S2); Finish is refused while a work timer runs (S4); end time goes into `finishWorkout(…, endedAt?)`, later edits use `updateSessionTiming` (S5). Added the `empty` phase and homes for add set / add exercise / delete set / skip exercise / discard (§3.4).
>
> **Revision 2026-10-08 (re-review).** Aligned with ADR 0003 "Re-review decisions": Stop is allowed while paused and ends the interval at the pause start without resuming (§3.2, S8); pauses are stored as intervals and only those inside the start–end window are subtracted (§4.1, S9); a Left/Right log adds a pending other-side set that Undo removes (§3.2, §3.3).
>
> **Revision 2026-10-08 (coach-led progression, v0.4).** Aligned with [ADR 0006](../decisions/0006-coach-led-progression.md) and rewritten rule 3; behaviour specified in [coach-adjustments.md](coach-adjustments.md). Added transition rows for coach offers, requests, applied adjustments and undo (§3.2); invariant 6 now covers coach adjustments and a new invariant 7 says a coach result never applies to a done set or a newer state; new events and the trigger check in §5; speech rule 3 covers offers; rule 5 now separates applied adjustments from review cards; data (§6); P8 marked as amended by v0.4 (§7); checks 17–20. Coach adjustments are an optional layer: the core loop and its tap counts are unchanged.

Status: v0.1 draft, 8 Oct 2026. Screen specs: [today.md](today.md), [active-workout.md](active-workout.md), [rest-state.md](rest-state.md), [workout-summary.md](workout-summary.md). Tokens: [design-system.md](design-system.md).

## 1. Purpose

This flow answers one question: **can Ben train a full session on his iPhone, one tap per set, and lose nothing if the app is killed?** Its single primary action at every step is the next logging action: Start or Resume, then Log, then Finish, then Done.

This document defines the loop's state machine, its persistence and force-close recovery, and how the optional layers attach without blocking logging. Those layers are spoken cues, voice input, the AI coach and lock-screen surfaces.

## 2. Research dependencies (revisit when research lands)

Research on voice, AI and Live Activity is happening in parallel. Each optional feature below is tagged with the dependency it waits on. The core loop has **no** dependency on any of them.

| Tag | Open question | Fallback if the answer is "no" or "not yet" |
|---|---|---|
| `DEP-AUDIO` | Can an Expo development build speak device TTS cues, lower music for a cue and resume it, and speak while the app is in the background or the phone is locked? | Foreground-only speech. Background cues fall back to notification sound and haptic. |
| `DEP-NOTIF` | Do local notifications at a stored deadline work reliably, including Time Sensitive, and can they be cancelled or replaced by ID? | An in-app cue only, and a banner on reopen saying "Rest ended at 18:42". |
| `DEP-LIVE` | Can the dev build show a Live Activity or Dynamic Island with a system-rendered countdown worked out from the deadline? | Notification only. Lock-screen copy is defined so it can be reused either way. |
| `DEP-STT` | Is on-device speech-to-text good enough to parse "one fifteen, four reps" in a noisy gym without an LLM? | Voice logging goes through the coach pipeline when AI is available, and is unavailable otherwise (shown honestly). |
| `DEP-AI` | Is own-account (Sign in with ChatGPT) inference eligible for a local personal build, and which capability flags are available? | The coach shows `Coach not connected`. Logging, targets and cues are unaffected. |

## 3. State machine

### 3.1 Session states

```
                 startWorkout / resume
   ┌─────────┐  ───────────────────────►  ┌────────┐
   │ No      │                            │ Ready  │◄────────────────────────┐
   │ session │                            └───┬────┘                         │
   └─────────┘                     Log (rep set)│  Start work timer (timed)  │
        ▲                                   │   ▼                            │
        │                                   │ ┌─────────┐ Stop/ends → Log    │
        │                                   │ │ Working │───────┐            │
        │                                   │ └─────────┘       │            │
        │                                   ▼                   ▼            │
        │                             ┌──────────────┐  (transient, <100 ms) │
        │                             │ Result saved │                       │
        │                             └──────┬───────┘                       │
        │              more sets, rest > 0   │   superset mid-round / rest 0 │
        │                     ┌──────────────┴──────────────────────────────►┤
        │                     ▼                                              │
        │               ┌──────────┐  expires / Skip / Log next set early    │
        │               │ Resting  │─────────────────────────────────────────┘
        │               └──────────┘
        │   final set saved → Ready(final) → primary becomes "Finish workout"
        │
        │  Done          ┌──────────┐   finishWorkout     ┌──────────┐
        └────────────────│ Finished │◄────────────────────│ Finishing│ (sheet)
                         └──────────┘                     └──────────┘

   Paused: reachable from Ready, Working or Resting; Resume returns to the
   exact prior state with timers shifted by the paused duration.
```

| State | Meaning | Persisted fields | What's on screen |
|---|---|---|---|
| No session | No unfinished workout | none | Today: Start |
| Empty | A workout with no live sets (started empty, or every set deleted). Domain phase `empty` | session row | `Add an exercise to start`, primary `Add exercise` |
| Ready | The current set is waiting. For rep sets, Ben may already be lifting (see the P1 proposal) | `activeSetId`, draft values | Focused card, `Log …` |
| Working | **Timed exercises only.** A work interval is running | `workInterval.deadlineUtc`, `startedAtUtc` | Work countdown, `Stop` |
| Result saved | The set and the rest timer have committed in a single transaction. Lasts only as long as the write | set row, `restTimer` | `Saved` guard (1 s), undo toast |
| Resting | The rest deadline is in the future | `restTimer {id, setId, durationS, source, startedAtUtc, deadlineUtc, version, status}` | Rest card plus the next set's draft and `Log …` |
| Ready (rest ended) | The deadline has passed. This is still Ready, with the count-up showing | as Ready plus the ended timer | `Ready when you are` |
| Paused | The session clock is frozen, and so is any running rest or work timer | `pausedAtUtc`, `pausedFromState`, `remainingMs` | Paused banner, `Resume` |
| Finishing | The finish sheet is open. Nothing has been written yet | none | Finish sheet |
| Finished | `finishWorkout` committed | session `endedAtUtc`, summary | Summary |

### 3.2 Transition table

| From | Event | Guard | Effects (in order) | To |
|---|---|---|---|---|
| No session | Tap `Start workout` | none | `startWorkout(routineId?, gymId, opId)` snapshots the routine and equipment, then `buildActiveSetView` | Ready (Empty if no routine) |
| Empty | Tap `Add exercise` → pick | none | `addExercise(…)` adds the exercise with one empty working set, which becomes active | Ready (values incomplete) |
| No session (unfinished exists) | Tap `Resume` | none | `getActiveSession` → `buildActiveSetView` | the persisted state (Ready, Resting or Paused) |
| Ready | Tap `Log …` / Cmd+Return / voice "log it"* | Draft valid; outside the commit guard | `commitSetAndBeginRest(cmd{opId})`, then cues (§5) | Result saved → Resting, or Ready (when rest is 0, mid-superset, or the final set) |
| Ready | Tap `Start 0:45` (timed) | Timed exercise | `startWorkInterval(setId, duration)` | Working |
| Working | Work deadline reached | none | End cue; primary becomes `Log 0:45` with the actual value filled in. **Nothing is saved** | Ready (timed result draft) |
| Working / Paused (work timer) | Tap `Stop` | Allowed while paused: the interval ends when the pause began | Actual = elapsed (paused time never counted). The draft becomes `0:38` (primary `Log 0:38` once active). While paused, Stop does not resume the workout. A Stop just after the deadline is a no-op success (the interval already completed) | Ready (timed result draft); from Paused, stays Paused (Finish is then allowed) |
| Resting | Deadline reached | none | Rest-end cue (once), haptic | Ready (rest ended) |
| Resting | `Skip` | none | `endRestTimer(timerId, 'skipped')`, then `cancelObsoleteCues`. No rest-end cue | Ready |
| Resting | `−30 s` / `+30 s` / edit time | none | `adjustRestTimer(timerId, ±30)`: new version, alerts replaced. A `−30 s` that reaches 0 is an **expiry** (status ended, rest-end cue plays), not a Skip | Resting (or Ready (rest ended) if the time reaches 0) |
| Resting | Tap `Log …` for the next set | Outside the commit guard | Ends the current rest (status `ended_early`), cancels its cues, then commits the new set and starts its rest | Result saved → … |
| Resting | Edit the previous set's RPE or values | none | `correctSet` only. **The rest timer is untouched**. Then `evaluateCoachTrigger` (local, no AI) may show an offer | Resting |
| Resting | Trigger fires on the just-saved set | Coach reachable; offers on; not a warm-up or drop set; CA4 allows it | `recordTriggerResponse(triggerId, 'shown')`; offer line in the rest card. **No AI call, no change** | Resting (offer shown) |
| Resting (offer shown) | `No thanks` / next Log / Finish | none | `recordTriggerResponse(…, 'dismissed' \| 'expired')` | unchanged |
| Ready / Resting | Ben asks (voice, text, `Adjust` chip) or taps `Adjust` on an offer | Coach reachable (else the honest offline line) | `requestCoachAdjustment(…, baseVersion, opId)` runs in the background. Nothing awaits it | unchanged (coach pending) |
| Any active (coach pending) | Coach result arrives | `validateCoachProposal` passes and `baseVersion` is current | `applyCoachProposal(id, {confirmation: 'ben_request' \| 'offer_accepted', expectedVersion})`: pending targets only, reason + evidence + guard notes stored; `ProposalApplied` → `cancelObsoleteCues` → cues rebuilt. Log guarded 1 s if its label changed | unchanged (adjustment banner) |
| Any active (coach pending) | Ben logs a set first | none | The Log commits first. The request is cancelled, then re-sent once if any covered set is still pending, else dropped (`Your workout moved on…`) | Result saved → … |
| Any active | `Undo` on an adjustment | Affected sets still pending; it is the latest adjustment | `undoAction(actionId)` restores pending targets only; drafts that followed the target revert | unchanged |
| Any active | Relaunch with a coach request pending | none | The request is dropped, never applied (`Coach request was interrupted. Nothing changed.`) | the persisted state |
| Any active | Tap `Undo` on the latest set | The set is still the latest commit (by commit order) and its version matches the one shown (`expectedSetVersion`) | `undoAction(actionId)` removes the set (audited), restores the pointer, cancels the rest timer and its cues. For a single-side log it also removes the pending other-side set and restores the set's previous side | Ready (on the restored set) |
| Ready / Working / Resting | Tap `Pause` | none | `pauseSession`: stores remaining time, cancels scheduled alerts | Paused |
| Paused | Tap `Resume` | none | `resumeSession`: deadline = now + remaining, alerts rescheduled | the previous state |
| Any active | `Finish workout` → confirm | No work timer running or paused (stop it first; its time becomes the draft) | `finishWorkout(sessionId, expectedVersion, endedAt?)`: pending sets → skipped; `endedAt` between the last set and now; the tap time is kept in the timing audit; then `cancelObsoleteCues` | Finished |
| Any active | `Discard workout` → confirm | Session version matches | `discardWorkout(sessionId, expectedVersion)` (`discard`). Cancels any rest or work timer and all cues. Session status `discarded` | No session (Today) |
| Finished | Tap `Done` | none | none | No session (Today) |

\* Voice "log it" or "done" is available only if Ben has enabled that shortcut and the active set is unambiguous (brief §12). Otherwise voice must state the result.

**Invariants (the reviewer should check every one):**
1. Only an explicit Log (tap, keyboard or a confirmed voice result) commits a set. A timer expiring, an AI reply, a notification or a duplicate transcript cannot commit one.
2. `commitSetAndBeginRest` returns success **before** any cue, coach call or RPE prompt.
3. Each draft carries an operation ID created when that set becomes active. Retrying the same draft (double tap, a voice duplicate, a relaunch after a crash during the write) commits exactly once.
4. Rest time is always worked out as `deadlineUtc − now`. No JS interval is the source of truth.
5. Changing RPE or correcting a value never restarts, extends or shortens rest.
6. Completed sets change only through an explicit correction, undo or delete by Ben. Coach adjustments and proposals never change completed sets; any change naming one is dropped by `validateCoachProposal`.
7. A coach result is applied only to the session version it was computed for. If anything was logged, corrected, undone or switched since, it is re-sent once or dropped, never applied to newer state (rule 5).
8. Today's remaining sets change at once only when Ben asked (or tapped `Adjust` on an offer). A trigger alone never changes a value and never makes an AI call.

### 3.3 Sets that need special handling (summary; details in active-workout.md)

- **Final set of an exercise:** rest starts as normal unless a transition timer is configured. The rest card shows the next exercise.
- **Final set of the workout:** no rest timer. The primary becomes `Finish workout`. If Ben is unsure, he can add a set from the exercise menu.
- **Superset:** logging a member before the last moves to the next member. Rest is 0 or the configured transition. Rest starts after the last member of the round.
- **Timed exercise:** the work interval is separate from rest. Saving needs Log, unless the timed auto-complete setting is on (off by default, and explained where it is switched on). Finish is not available while the work timer runs; Stop first. If Ben then finishes without logging, the set is marked skipped but keeps the stopped time as its draft, so nothing is lost. Discard is the exception: it is confirmed and throws away the whole workout, running timer included.
- **Empty workout:** phase `empty`, not `all_done`. The card reads `Add an exercise to start`. A set added while nothing is active becomes the active set.
- **Unilateral exercise:** sets default to `Both sides` (values are per side). Ben can log a set as Left or Right instead. That Log also adds a pending other-side set (`pairedWithSetId`, logged values drafted) at the end of the exercise, which becomes the next set and accepts only its own side. Undo or delete of the single-side log removes the pending partner (active-workout §2.9).

### 3.4 Session edits (each has one home in the UI)

| Command | UI home | Guard | Notes |
|---|---|---|---|
| `add_set` (`addSet`) | Exercise `⋯` → `Add set`; `+ Add set` in Overview; `Add set` link on the All-done card | none | Copies the planned values and rest of the exercise's last set. Becomes active if nothing else is active |
| `add_exercise` (`addExercise`) | Empty card primary; `+ Add exercise` at the end of Overview; All-done card link | none | Catalogue picker → one empty working set. Tools and voice use the same service call |
| `delete_set` | Correction sheet → `Delete set` (done sets); a pending row's `⋯` in Overview → `Delete set` | Set version matches; the set's work timer isn't running | Kept as an audited deleted record, hidden from lists, history and volume. No Undo yet (ADR 0003 Open), so it always confirms |
| `skip_exercise` | Exercise `⋯` → `Skip exercise` | Its work timer isn't running | Marks pending sets skipped. Logged sets untouched. No Undo yet, so it confirms |
| `discard` (`discardWorkout`) | Top-bar `⋯` → `Discard workout`; summary footer for 0-set workouts | Session version matches | Confirmed when any set is logged |
| `update_session_timing` (`updateSessionTiming`) | Top-bar `⋯` → `Edit workout times` (start only, before Finish); summary `Edit workout` (start and end) | Session version matches; end time only after Finish | Each changed field adds a timing-audit entry keeping the previous value |

## 4. Persistence and force-close recovery

### 4.1 What is written when

| Moment | Write (SQLite, single transaction) |
|---|---|
| Start | Session row, routine snapshot, equipment snapshot, first `activeSetId` |
| Draft edit | `saveSetDraft(setId, values)` (**new function, proposed**), debounced 300 ms. Drafts are stored apart from results and never count as completed |
| Log | The set result (actual values, `completedAtUtc` + tz, `opId`) + the rest timer row + the advanced `activeSetId` + the session version incremented. All or nothing |
| Rest adjust / skip / end | Timer row: new `deadlineUtc`, `version`, `status` |
| Pause / resume | `pausedAtUtc`, `pausedFromState`, `remainingMs`; each pause is kept as a closed interval (`session.pauses: {startUtc, endUtc}[]`), never only a running total. Active duration = end − start − paused time inside that window, so a corrected start or end is recomputed from the original intervals |
| Finish | `endedAtUtc`, skipped markers, and a timing-audit entry keeping the tap time if a different end time was chosen; then the summary |
| Later timing edit | `updateSessionTiming`: new `startedAtUtc` / `endedAtUtc` plus a timing-audit entry per changed field (`source: 'correction'`) |
| Delete set / skip exercise / discard | Set status `deleted` or `skipped`, or session status `discarded`, each with an audit entry. Nothing is physically removed |

### 4.2 Relaunch behaviour

On every cold start, the app reads `getActiveSession` before rendering Today.

| Persisted situation | What Ben sees | Cues |
|---|---|---|
| Unfinished session, last activity < 6 h ago | **Opens straight into Active workout** (no tap; proposal P6). A banner reads `Workout restored. Nothing was lost.` for 4 s | `cancelObsoleteCues`, then reschedule for the current timer version |
| Unfinished session, last activity ≥ 6 h ago | Today, with the stale-workout card (see today.md) | All old cues cancelled |
| Resting, deadline still in the future | Rest card showing the correct remaining time, never the full preset | Remaining cues rescheduled. No duplicate of a cue already delivered |
| Resting, deadline passed while closed | Ready (rest ended), `Rested 4:12` count-up, banner `Rest ended at 18:42` | **No late spoken cue.** If a notification already fired, nothing more |
| Paused | Paused, exactly as left | none |
| Working (timed), deadline passed | Ready with a timed result draft filled with the planned duration, and banner `Work timer ended while the app was closed. Check the time before logging.` | none |
| Draft edited but not logged | Same set, edited values restored, caption `Unsaved edit restored` | none |
| Killed during the Log write | Either the transaction committed (the set shows as done) or it didn't (the draft is still there). Tapping Log again reuses the same `opId`, so there is never a duplicate | none |

Cue de-duplication: each scheduled cue is keyed by `(timerId, timerVersion, kind)`. A cue that has been delivered is recorded, and a key is never delivered twice. A spoken cue more than 5 s late is dropped and not spoken (`DEP-AUDIO`).

## 5. Optional layers and how they plug in

```
 ┌────────────────────────────────────────────────────────────┐
 │ Core loop: domain + SQLite + screens  (always works)        │
 │ commitSetAndBeginRest · adjustRestTimer · finishWorkout ... │
 └───────────────┬────────────────────────────────────────────┘
                 │ emits committed events (after write):
                 │ SetCommitted, SetCorrected, SetUndone, RestStarted,
                 │ RestAdjusted, RestEnded, ActiveSetChanged,
                 │ SessionPaused, SessionResumed, SessionFinished,
                 │ ProposalApplied, CoachTriggerFired,
                 │ CoachAdjustmentApplied, CoachAdjustmentUndone
     ┌───────────┼───────────────┬──────────────────┬──────────────┐
     ▼           ▼               ▼                  ▼              ▼
 Alerts      Spoken cues      Lock screen        Voice input     Coach
 (DEP-NOTIF) (DEP-AUDIO)      (DEP-LIVE)         (DEP-STT/AI)    (DEP-AI)
 notification buildSetCue     Live Activity      tap-to-talk →   proposals →
 + haptic    scheduleTimerCue from deadline      parse → commit  inline review
```

Rules for every layer:
1. **They are subscribers, never gatekeepers.** The core never awaits a layer. A failing layer shows its own status and nothing else changes.
2. **Committed values only.** Cues and lock-screen text come from committed state through `buildSetCue(event, sessionVersion)`. When `ActiveSetChanged`, `RestAdjusted`, `SetUndone` or `ProposalApplied` fires, call `cancelObsoleteCues(sessionId, version)` and reschedule.
3. **No unsolicited speech outside Resting.** Rep sets have no explicit Working state (P1), so Ready may mean Ben is mid-set. Proactive coach speech, including a spoken coach offer, is allowed only while Resting with at least 20 s left, and only in Conversation mode. Scripted cues are allowed at commit (right after Log) and at rest end. Answers Ben asked for (push-to-talk, and the cue for an adjustment he asked for) are allowed any time.
4. **Speech never overlaps.** A scripted cue that would overlap a coach reply waits up to 3 s, then is dropped if it is stale. The rest-end cue takes priority over a coach reply that hasn't started yet.
5. **Coach output goes inline, in the card's coach slot.** An adjustment Ben asked for is applied and shown as a `CoachAdjustmentBanner` with Undo. A coach-raised change is first a `CoachOfferLine`. Swaps and gym changes are `ChangeReviewCard`s with Apply. Future-session changes are always proposals with before/after (summary). The coach sheet never opens by itself. See [coach-adjustments.md](coach-adjustments.md).6. **Proposals are bound to a version.** Every card and every coach request carries `baseVersion`. Any newer commit (another set, a correction, undo, a gym switch) makes it stale. Stale cards can't be applied, and a voice "yes" can't apply them either (`confirmProposal` checks the version). A stale adjustment request is re-sent once or dropped (coach-adjustments CA7).
7. **Honest status.** AI and voice availability come from `getAiCapabilities(userId)` and are shown on the Talk button and voice pill (and on `Adjust` as `Coach offline`). There are no canned coach replies.
8. **Triggers are cheap and local.** `evaluateCoachTrigger` runs in `packages/domain` after `SetCommitted` and `SetCorrected`. It never calls the model. There is no AI call after every set.

### 5.1 Voice set logging path (optional; `DEP-STT`, `DEP-AI`)

1. Ben taps Talk. This calls `startVoiceSession(sessionId, 'push_to_talk')`. A voice strip appears above the action bar showing `Listening… · Mic on`.
2. Ben says "100 kilos, eight reps, RPE eight". Then `transcribeUtterance` → `parseSpokenSet(transcript, context)` runs, using the active exercise and set.
3. If the result is unambiguous, it calls the **same** `commitSetAndBeginRest` with the `opId` from `handleVoiceTurn(turnId, …)`. The strip shows `Heard: 100 kg × 8, RPE 8`, the undo toast appears, and the cue says "Logged 100 kilos for 8. Rest 2 minutes."
4. If it is ambiguous, the strip asks one question with two buttons, for example `115 kg or 150 kg?`. Nothing is saved until Ben answers.
5. Proposal P7 asks for a deterministic on-device parser so that voice logging doesn't need the LLM. It depends on `DEP-STT`.

## 6. Data needed (flow-level)

From the brief: `buildTodayView`, `startWorkout`, `getActiveSession`, `buildActiveSetView`, `commitSetAndBeginRest`, `correctSet`, `resolveRestPreset`, `startRestTimer` (called inside the commit), `adjustRestTimer`, `pauseSession`, `resumeSession`, `startWorkInterval`, `buildSetCue`, `scheduleTimerCue`, `cancelObsoleteCues`, `finishWorkout`, `updateSessionTiming`, `buildWorkoutSummary`, `undoAction`, `getAiCapabilities`, `startVoiceSession`, `stopVoiceSession`, `transcribeUtterance`, `parseSpokenSet`, `handleVoiceTurn`, `interruptSpeech`, `confirmProposal`, `applyCoachProposal`, `validateCoachProposal`, `getDecisionEvidence`, `setActiveGym`.

**Proposed new functions** (to add to the brief or contracts):

| Function | Why |
|---|---|
| `saveSetDraft(setId, values)` | So unsaved edits survive a force-close without counting as results |
| `setActiveSet(sessionId, setId, expectedVersion)` | Ben taps a different pending set (out of order) |
| `endRestTimer(timerId, reason: 'skipped' \| 'ended_early')` | More explicit than `adjustRestTimer(-remaining)`, and keeps the reason for later analysis |
| `addSet(sessionExerciseId, setType?, opId)` | The Add set control (now implemented as `add_set`) |
| `addExercise(…)` | Empty workout and Add exercise (implemented; service builds the catalogue snapshot) |
| `deleteSet(setId, expectedSetVersion, opId)` | Delete set (implemented as `delete_set`; audited tombstone) |
| `skipExercise(sessionExerciseId, opId)` | Skip exercise (implemented as `skip_exercise`) |
| `discardWorkout(sessionId, expectedVersion, opId)` | Discard workout (implemented as `discard`) |
| `recordReadiness(ownerId, localDate, level, note?)` | The Today readiness chips (writes `ReadinessEntry`) |
| `evaluateCoachTrigger`, `recordTriggerResponse`, `requestCoachAdjustment`, `cancelCoachTurn`, `setPainFlag` | Coach-led progression (ADR 0006). Signatures in coach-adjustments §6 |

## 7. Brief change proposals (for Ben to approve; not yet in CHANGELOG)

| # | Brief says | Proposal | Reason |
|---|---|---|---|
| P1 | Ready → Working → Result saved → Resting | For rep sets, merge Ready and Working in the UI. There is no "Start set" tap. Working is explicit only for timed exercises | A Start tap would double the taps per set. The app can't know when Ben unracks, so the speech rules treat Ready as "possibly lifting" |
| P2 | Rest is a separate state with its own controls | During rest, the Log button for the **next** set stays live. Tapping it ends rest early. A 1 s commit guard stops double taps | Keeps the loop at one tap per set. The brief already allows a set to end rest early |
| P3 | Optional RPE "before or after logging" | By default, ask for effort **after** logging, in the rest card. Ben can switch to "before" or "off" | Effort is only known after the set. Asking after keeps the Log tap clean and doesn't delay rest |
| P4 | Rest controls include Pause | Pause lives in the top bar and always means **pause workout**. The rest card has only −30 s, +30 s and Skip | Avoids two different "pause" meanings. The brief already defines pause as freezing the session and its timers |
| P5 | "Numeric keypad … large increment controls" | A custom in-app keypad whose step keys show the next **feasible** loads | The system decimal pad has no Done key and doesn't know about equipment. This puts rule 4 into the input itself |
| P6 | One tap to resume | A cold launch with a recent unfinished workout (< 6 h) opens straight into it (zero taps). Older ones show a Finish-or-Resume card | Faster, and handles a forgotten Finish honestly |
| P7 | Voice logging goes through the coach pipeline | Add a deterministic on-device route for set logging (STT → `parseSpokenSet` grammar → commit) that doesn't need the LLM | Voice logging would then work in Quiet/no-AI conditions, consistent with rule 1. Depends on `DEP-STT` |
| P8 | Summary: facts plus an optional coach note | Add a "Next time" section showing `calculateNextTargets` output, with the rule named. **Amended by v0.4 (ADR 0006):** with the coach available, rows show the coach's proposal (before built-in rule → after coach, Apply/Undo, source `Coach`); without it, the rule output labelled `Built-in rule (coach offline)` | Answers "what comes next" with or without AI, and always names who decided |
| P9 | Show the resolved rest preset before the first set | Show `Rest after: 1:30` on every current-set card, and tap it to edit | One line, always correctable, not just before set 1 |
| P10 | The coach opens as a sheet / collapsible panel | Tap-to-talk uses an inline **voice strip** above the action bar. Typed chat uses the sheet (medium detent) | A sheet hides the Log button. The strip keeps it visible |
| P11 | Today includes readiness | Readiness only records an entry in this milestone and never changes targets on its own. The coach may suggest changes later | Avoids a hidden adjustment the rules can't explain |
| P12 | Brief §1 lists Ask/Talk as consistent | In the workout, Talk sits bottom-left in the action bar. Elsewhere it is a bottom-trailing `Ask` pill | Thumb reach, and it never covers Start |

## 8. Acceptance checks (end-to-end, on a real iPhone)

1. Start from Today and complete 3 exercises × 3 sets where every set matches its prefilled values. Count the taps: 1 to start, 1 per set, 2 to finish (`Finish workout` + `Finish`), 1 for `Done`.
2. Log a set, then double-tap Log within 1 s. Exactly one set is saved.
3. During rest, force-quit from the app switcher and reopen within 10 s. The app opens on the workout, and the remaining time is correct to within 1 s, not reset.
4. During rest, force-quit and reopen after the deadline. The app shows `Ready when you are`, with the `Rest ended at hh:mm` banner. There is no late spoken cue and no second notification.
5. Edit reps from 8 to 7 (not logged), force-quit and reopen. The draft shows 7 with `Unsaved edit restored`, and the set is **not** marked done.
6. With airplane mode on and no AI connected, run the whole loop. Nothing is blocked. The Talk button reads `Offline`, and the summary saves with `Coach not connected`.
7. Change RPE on the just-logged set during rest. The countdown doesn't change.
8. Pause during rest at 1:10 left, wait 2 min, then resume. The timer resumes from 1:10, and active duration excludes the 2 min.
9. Lock the phone during rest. At the deadline, exactly one alert arrives (notification sound or haptic, or a spoken cue if `DEP-AUDIO` passes), and nothing is duplicated when the app is reopened.
10. Undo the last set during its rest. The set is removed, rest is cancelled, no rest-end cue fires, and the same set is active again with the undone values in the draft.
11. A coach proposal created before a new set is logged shows `Out of date` and can't be applied by tap or voice.
12. Log the final set. No rest starts, and the primary becomes `Finish workout`.
13. Log a set, tap effort `8` in the rest card, then tap `Undo` within 8 s. The set is removed (the RPE chip doesn't make Undo stale).
14. Skip rest: no rest-end cue, no notification. `−30 s` to zero: exactly one rest-end cue.
15. Start a timed set, then choose `Finish workout`. The sheet shows `Stop the timer first` with a [Stop] action instead of `Finish`; after Stop, the stopped time is kept as the set's draft even if Ben finishes without logging.
16. Start an empty workout. The card reads `Add an exercise to start`, not `All planned sets done`, and `Add exercise` → pick → the new set is active with `Enter load` / `Enter reps`.
17. Repeat check 1 with the coach connected and no triggers firing: the tap count is identical and the provider log shows no AI calls until Finish (then exactly one).
18. Log a set at RPE 10, tap `Adjust` on the offer, and log the next set before the coach answers: that set keeps exactly the values on its Log button, and the coach result changes only sets still pending, or is dropped.
19. Ask for an adjustment, then force-quit before the answer: on relaunch nothing was applied and the slot reads `Coach request was interrupted. Nothing changed.`
20. With airplane mode on, `Adjust` shows `Coach offline`, no offer ever appears, and the summary's `Next time` rows are tagged `Built-in rule (coach offline)`.
