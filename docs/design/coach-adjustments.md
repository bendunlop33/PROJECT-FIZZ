# Coach adjustments (in-workout and next-session)

Status: v0.1 draft, 8 Oct 2026. This is the **single spec** for coach-led progression ([ADR 0006](../decisions/0006-coach-led-progression.md), CLAUDE.md rule 3, brief CHANGELOG v0.4). Other specs link here instead of repeating it:
- [active-workout.md](active-workout.md): where Adjust sits on the set card, coach target markers, Log guard
- [rest-state.md](rest-state.md): the offer line and adjustment banner in the rest card, cues
- [workout-summary.md](workout-summary.md): `Next time` with `Coach` vs `Built-in rule` sources
- [flow-first-milestone.md](flow-first-milestone.md): state machine rows, events, invariants
- [today.md](today.md): the "coach suggestions to review" hint
- [design-system.md](design-system.md): `AdjustControl`, `CoachOfferLine`, `CoachAdjustmentBanner`, `TargetSourceTag`, new timing tokens

The coach is an **optional layer**. Nothing here adds a tap to the normal Log loop, and the whole loop still works with no network and no AI (rule 1).

## 1. Purpose

This behaviour answers **"Given how that set went, what should my remaining sets be?"** It also answers **"What should I lift next time?"** on the summary.

There are three ways in:

| Path | Who starts it | What happens | Taps |
|---|---|---|---|
| **A. Ben asks** | Voice ("that was a grind", "too easy"), text in the coach sheet, or the `Adjust` control | The coach answers briefly. Today's remaining sets change **at once**. A banner shows the change with one-tap Undo | Voice: 0 (Talk + speech). Control: 2 (`Adjust` → a reason chip) |
| **B. Coach offers** | A deterministic trigger in `packages/domain` (RPE ≥ 9.5, reps short by ≥ 2, RPE ≤ 6 on a working set) | One line in the rest card: `That looked hard. Adjust remaining sets?` [No thanks] [Adjust]. **Nothing changes, and no AI call is made, until Ben taps Adjust.** Then it continues as path A | 1 (`Adjust`), or 0 if ignored |
| **C. Next session** | Finishing the workout (one coach call per workout, together with the coach note) | `Next time` shows the coach's proposal next to the built-in rule's target, with before/after, reasoning, Apply and Undo | 1 per Apply |

The single primary action on the workout screen stays **`Log …`**. Every control in this spec is secondary. The single primary on the summary stays **`Done`**.

### Design decisions to confirm with Ben (flagged, not yet in the brief)

| # | Decision | Reason |
|---|---|---|
| CA1 | Tapping **Adjust on a coach offer counts as Ben asking**. The coach's result then applies at once with Undo, as in path A. There is no second Apply card | Rule 3 says a coach-raised change doesn't apply "until Ben accepts". Adjust *is* the acceptance. A second review card would add a tap between sets for every offer, and Undo already makes it reversible. **Alternative**: show the result as a `ChangeReviewCard` with Apply (one more tap). |
| CA2 | Path A covers **targets of pending sets**: load, reps, and adding or removing pending sets, in this exercise or later ones today. **Swapping an exercise or changing the gym** still goes through the `ChangeReviewCard` (Apply) | Swaps change equipment and history comparability, so they're bigger than a number change. Rule 2 still wants a review for broad plan changes |
| CA3 | **Rest durations are not changed by adjustments** in this version | Keeps the rest timer rules simple (rest-state §4.5). Ben can still change rest himself |
| CA4 | **"At most once per exercise unless a new trigger fires"** is read as: after one offer for an exercise, another offer for that exercise only appears for a **different trigger kind** (`rpe_high`, `reps_short`, `rpe_low`), or after an adjustment was applied to that exercise (the plan changed, so a trigger means something new) | Otherwise a run of hard sets would raise an offer after every set, which is the "constant" coaching ADR 0006 rules out |
| CA5 | Triggers never fire on **warm-up or drop sets**. "Reps short" is counted from the **bottom** of a rep range (target 6–8, did 4 → short by 2) | A short warm-up or drop set is normal. The bottom of the range is the least the plan asked for |
| CA6 | With the coach offline, **no in-session adjustment is offered** (the brief's deterministic `evaluateSessionAdjustment` isn't used). Ben edits the next set's numbers directly. | ADR 0006 defines the built-in fallback only for next-session targets. Ben may want an offline in-session rule later; that would need a brief change |
| CA7 | If Ben logs while the coach is still working, the request is **re-sent once** with the new state (if any set it covers is still pending), otherwise dropped | "Recompute or discard" from the brief; a single retry keeps cost and confusion bounded |

## 2. Layout

### 2.1 Where the pieces sit (Focus view)

All coach-adjustment UI lives **inside the focused card**, between the rest timer / effort chips and `Up next`. Nothing is added to the action bar or the top banner slot. The Log button never moves.

```
┌────────────────────────────────────────┐
│ v  Push A          26:05     ||    ... │ top bar
│ [Main Gym v] [Cues v] [Focus|All]      │ status row
├────────────────────────────────────────┤
│ Bench press · Set 3 of 4 next  Adjust .│ header: AdjustControl left of ...
│ ┌────────────────────────────────────┐ │
│ │ Rest            2:47               │ │ RestTimer (unchanged)
│ │ [ -30 s ]  [ +30 s ]  [ Skip ]     │ │
│ └────────────────────────────────────┘ │
│ ✓ Set 2 saved: 100 kg × 6            > │ actual
│ Effort (optional)                      │
│ [ 6 ] [ 7 ] [ 8 ] [ 9 ] [ 10 ]         │
│                                        │
│ ── coach slot (0 or 1 item) ────────── │ CoachOfferLine OR
│                                        │ CoachAdjustmentBanner OR
│                                        │ pending / outcome line
│ Up next · Set 3                        │
│ [- 95 kg +]  [- 8 +]                   │ draft
│  Coach target 95 kg × 8                │ target, with source
│  Plan was 100 kg × 6–8                 │
├────────────────────────────────────────┤
│ [Mic ] [       Log 95 kg × 8         ] │ action bar (unchanged)
└────────────────────────────────────────┘
```

Rules for the coach slot:
- It holds **at most one item**. Priority: pending > adjustment banner > outcome message > offer. A newer item replaces an older one.
- It never covers the rest controls, effort chips, the draft fields or the action bar.
- The rest card's `Notifications not allowed` row (rest-state §3) sits below it if both are present.
- In **Ready** (not resting), the slot sits under the target line of the focused card.
- In **Overview**, the slot sits directly under the active exercise's header row.

### 2.2 `Adjust` control and reason chips (path A)

The `Adjust` text button sits in the exercise header line, to the left of `⋯`, in both Ready and Resting. It's in the same place every time, and it's away from the thumb zone on purpose: it is used rarely, and voice is the hands-free route.

Tapping it opens a chip row **inline** under the header (no sheet):

```
│ Bench press · Set 3 of 4 next  Adjust .│
│ What should change?                  x │
│ [Too hard] [Too easy] [Pain] [Type...] │ 52pt chips
```

- `Too hard` / `Too easy` send the request straight away (path A, §4.1).
- `Pain` sets the pain flag for this movement (§4.5) and then asks the coach to adjust, with increases blocked.
- `Type…` opens the coach sheet (medium detent) with the text field focused and the context `Adjusting Bench press` attached.
- `x`, tapping `Adjust` again, or logging closes the row. Nothing is sent.

At AX1 and larger, the chips wrap to two rows of two.

### 2.3 Coach offer line (path B)

Only in the rest card (Resting). Never in Ready, because Ben may be mid-set.

```
│ That looked hard. Adjust remaining sets?│ type.callout, text.primary
│ RPE 10 on set 2                         │ type.callout, text.secondary (fact)
│ [ No thanks ]               [ Adjust ]  │ text buttons, 52pt hit areas
```

It's a line of text and a row of two small buttons, with no card border, no icon animation and no colour fill. Its fact line is the trigger's own deterministic fact, never the model's words.

### 2.4 Pending (coach working)

```
│ ... Coach is working on sets 3–4       │ static ellipsis icon, no spinner loop
│ Nothing has changed yet.      [Cancel] │
```

The rest timer keeps running. The draft fields and `Log …` stay live. `TalkButton` shows `Wait` only when the request came from voice.

### 2.5 Adjustment banner (applied)

```
┌────────────────────────────────────────┐
│ [Coach] Coach adjusted sets 3–4        │ CoachAdjustmentBanner
│ 100 → 97.5 kg × 8 · Set 2 was RPE 10;  │ before → after (targets) · reason
│ a little lighter should keep 8 reps.   │
│ Rounded to 97.5 kg: nearest your bar   │ guard note (only when one applied;
│ and plates allow.                      │ here the coach asked for 98 kg)
│ Why? >                       [ Undo ]  │
└────────────────────────────────────────┘
```

- Line 1: `Coach adjusted` and the affected sets.
- Line 2: before → after, then `·` and the coach's reason (2 lines max; the full text is in `Why?`).
- Line 3 (optional): one guard note per kind (§2.6).
- `Undo` is a text button on the right, `Why? ›` on the left; both have 52pt hit areas (`target.workout`).
- If several exercises changed: `Coach adjusted 3 sets` + `Bench press 3–4 · Incline DB press 1` and `Why? ›` lists each change.

### 2.6 Guardrail outcomes (deterministic; shown in the banner or as an outcome line)

| Outcome | When | Shown as |
|---|---|---|
| Snapped | The coach's load isn't achievable; `roundToAvailableLoad` picked the nearest one, except that it never rounds above the coach's number when the request was "too hard" (or a `rpe_high` / `reps_short` offer), and never below it when "too easy" (or `rpe_low`) | Guard note: `Rounded to 97.5 kg: nearest your bar and plates allow.` Dumbbells: `…nearest your dumbbell rack allows.` Stack: `…nearest the stack allows.` |
| Capped | The coach's load is above the equipment max | Guard note: `Capped at 30 kg each: the most Main Gym's rack goes to.` |
| Pain-blocked (all) | Every change would increase load, reps or sets on a movement with an active pain flag | **Outcome line, no Undo (nothing changed):** `Not increasing: you flagged shoulder pain. Sets unchanged.` If no area was given: `Not increasing: you flagged pain on Bench press. Sets unchanged.` |
| Pain-blocked (part) | Some changes were increases on a pain-flagged movement | The rest apply. Guard note: `Not increasing Overhead press: you flagged shoulder pain.` |
| No achievable load | No load on the equipment is near the coach's value, or the equipment can't make any load | Outcome line: `Couldn't use the coach's load: 31 kg each isn't possible on this rack. Sets unchanged.` |
| Completed set named | The coach tried to change a set that's already done | Those changes are dropped silently from the apply (never applied), and `Why?` lists them as `Not changed: set 2 is already done.` |
| No change | The coach advises keeping the plan | Outcome line: `Coach kept sets 3–4 as planned.` + reason. No Undo |

Guard notes are produced by `validateCoachProposal`, not by the model or the UI.

### 2.7 Marked values (coach-set vs original plan)

Wherever a pending set's target came from a coach adjustment:
- **Focused card target line:** `Coach target 95 kg × 8` with the `TargetSourceTag` (`Coach`), and a second line `Plan was 100 kg × 6–8` in `text.secondary`.
- **Mini set list:** `○ 3  Coach target 95 kg × 8` with the `Coach` tag.
- **Overview Target cell:** `95×8` plus the text badge `C` (like set-type badges). VoiceOver: "Coach target, 95 kilograms, 8 reps. Plan was 100 kilograms, 6 to 8 reps."
- **Done sets** keep showing the **actual** result only. A set logged against a coach target keeps that fact in the record (`targetSource: 'coach'`), visible in the history sheet as `Coach target was 95 kg × 8`.
- Unchanged sets show the plain `Target` label (plan or built-in rule). Only coach-changed values carry the tag.

## 3. States

### 3.1 State table

| State | Coach slot shows | Primary | Notes |
|---|---|---|---|
| Idle | nothing | `Log …` | `Adjust` in the header |
| Adjust chips open | §2.2 chip row | `Log …` (unchanged) | Logging closes the row; nothing sent |
| Offer shown | §2.3 | `Log …` | Only while Resting; only if the coach is reachable now |
| Pending | §2.4 | `Log …` | Rest keeps running. Timeout `timing.coachTimeout` (20 s) |
| Pending, re-sending | `Updating for the set you just logged…` | `Log …` | Once only (CA7) |
| Applied | §2.5 banner | `Log <new values>` | Draft changes are guarded (§4.3) |
| Applied, guard note | §2.5 with line 3 | as Applied | — |
| No change / blocked | Outcome line (§2.6), no Undo | `Log …` | Auto-hides on the next Log |
| Undone | `Back to the plan for sets 3–4.` (or `Back to the previous targets for sets 3–4.` if an earlier adjustment was in place) | `Log <restored values>` | Auto-hides on the next Log |
| Undo partly possible | `Undone for set 4. Set 3 was already logged.` | as Undone | Done sets are never touched |
| Stale, dropped | `Your workout moved on before the coach answered. Nothing changed.` [Ask again] | `Log …` | `Ask again` re-sends the same request on the current state |
| Timed out | `The coach didn't answer in time. Nothing changed.` [Try again] | `Log …` | Never a canned answer |
| Failed (limit/error) | `Couldn't reach the coach (limit reached). Nothing changed.` | `Log …` | Never switches to a paid route (rule 7) |
| Coach offline / not connected | `Adjust` shows the `Coach offline` caption; tapping it shows the offline line (§5) and only the `Pain` chip | `Log …` | No offers are shown at all |
| Paused | Slot content is kept; a pending request continues; Undo and Adjust still work | `Resume` | An applied result changes targets only, not timers |
| Restored after force-close | Applied adjustments are in SQLite and show their markers. A pending request is **dropped** (`Coach request was interrupted. Nothing changed.` [Ask again]). An unanswered offer is not shown again | per state | Nothing applies after a relaunch without Ben seeing it |

### 3.2 Transitions

```
            Adjust → chip            trigger fires (Resting,
   Idle ───────────────────┐         coach reachable, not yet offered)
    ▲  ▲                    ▼                │
    │  │ voice / text ──► Pending ◄── Adjust ─┤ Offer shown
    │  │                  │  │  │              │   │ No thanks / next Log /
    │  │   Log (sets left)│  │  │ timeout/err  │   │ rest ends → Idle
    │  │      ▼           │  │  ▼              │   ▼
    │  │  Re-sending ─────┘  │ Failed/Timed out (outcome line) ──► Idle on Log
    │  │      │ Log again / no sets left → Stale, dropped
    │  │      ▼             ▼
    │  └── Undone ◄─ Undo ─ Applied ──(next Log)──► Idle (markers stay)
    │                       │
    └──── next Log ─── No change / blocked
```

- **Applied → Idle** happens on the next Log. The banner collapses; the coach markers stay on changed pending sets. Undo stays available from `Why?` and from exercise `⋯` → `Undo coach change` while any affected set is still pending.
- **Offer shown → Idle**: `No thanks`, the next Log, the rest card being replaced by a new rest, or the workout finishing. The offer is counted as shown for CA4 in each case.
- A new Ben request while one is pending cancels the first (`cancelCoachTurn`) and starts again.

## 4. Interactions

### 4.1 Path A: Ben asks

1. **Start.** Any of:
   - Talk → "that was a grind" / "too easy, what next?" / "drop the weight for the last two". `classifyCoachIntent` returns `adjust_pending_sets`.
   - Coach sheet text (long-press Talk, or `Type…`).
   - `Adjust` → `Too hard` / `Too easy` / `Pain`.
2. **Send.** `requestCoachAdjustment(sessionId, {origin: 'ben_request', reason, text?}, baseVersion, opId)`. The slot shows Pending. This is a background call: the UI never awaits it before accepting a Log.
3. **Answer.** The coach returns an `adjust_pending_sets` proposal and a one-sentence reply. `validateCoachProposal` snaps loads, caps at max, applies pain blocks, drops completed sets and checks `baseVersion`.
4. **Apply.** If valid and not stale: `applyCoachProposal(id, {confirmation: 'ben_request', expectedVersion})` commits in one transaction, with the reason and evidence stored. Then `ProposalApplied` → `cancelObsoleteCues` → the rest-end cue is rebuilt from the new targets.
5. **Show.** The banner (§2.5). If voice started it, the reply is spoken (§5.3) and shown in the voice strip.

### 4.2 Path B: coach offers

1. On `SetCommitted` (reps short) or `SetCorrected` with a new effort value (RPE high or low), the UI calls `evaluateCoachTrigger(set, target, thresholds)`. This is a pure domain check: **no AI call**, no network.
2. The offer shows only if **all** hold: the session is Resting; `getAiCapabilities` reports a usable route now; the set isn't a warm-up or drop set; CA4 allows it for this exercise; nothing is pending.
3. `No thanks` → `recordTriggerResponse(triggerId, 'dismissed')`. The line disappears. Nothing else happens.
4. `Adjust` → `recordTriggerResponse(triggerId, 'accepted')`, then step 2 of path A with `origin: 'trigger_offer'` and the trigger's facts attached (CA1).
5. Ignoring it is fine: the next Log removes it (`'expired'`).
6. **Spoken offer** (Conversation mode only): spoken once, only while Resting with at least 20 s left, never over the rest-end cue, and never in Ready (Ben may be lifting). Ben replies by Talk: "yes" / "adjust" = Adjust; "no" = No thanks.

RIR mode: the triggers use the equivalent effort entries (`RIR 0` for RPE ≥ 9.5, `RIR 4+` for RPE ≤ 6). The fact line quotes what Ben entered (`RIR 0 on set 2`), never a converted RPE.

### 4.3 Logging while a request is pending or just applied

- **Log while Pending:** the Log commits normally and first. Then the pending turn is cancelled. If any set it covered is still pending, it is re-sent once on the new state (`Updating for the set you just logged…`). Otherwise, or on a second Log during the re-send: Stale, dropped. **A suggestion is never applied to a set that is already done**, and never to a newer session state than the one it was computed for.
- **Draft update on apply:** a set's draft follows the coach target only if its draft came from the target (`draftSource: 'target'`). A draft Ben edited is kept. The caption then reads `Your edit kept · Coach target 95 kg × 8`, and the Log label shows his edit.
- **Log guard on a changed label:** when an apply changes the active set's Log label, Log ignores taps for `timing.valueChangeGuard` (1 s). The button shows the new label at once. This stops a tap aimed at `Log 100 kg × 8` from saving `95 kg × 8` by accident. It doesn't apply in normal logging, so the loop has no extra taps.

### 4.4 Undo

| What | How | Result |
|---|---|---|
| Applied adjustment (banner visible) | `Undo` on the banner, or voice "undo" when it's the most recent action | `undoAction(actionId)` restores the previous targets of sets that are still pending, and removes or restores pending sets it added or removed. Drafts that followed the target revert; edited drafts stay. Toast-free: the slot shows `Back to the plan for sets 3–4.` |
| Applied adjustment (banner gone) | `Why?` on a coach-marked set → `Undo this change`; or exercise `⋯` → `Undo coach change` | Same, for still-pending sets only |
| Older adjustment under a newer one | Not directly. `undoAction` returns a compensating proposal shown as a `ChangeReviewCard` (`Today only`) | Rule 5: never applied to newer state silently |
| Offer | Nothing to undo: nothing changed |
| Pain flag | `Pain` chip again, or Profile → Pain flags → Clear | Clearing is always explicit by Ben |

Voice "undo" undoes the most recent action of any kind (a set log or an adjustment). The strip says which: `Undid the coach change to sets 3–4.`

### 4.5 Pain

- `Pain` (chip), or voice ("my shoulder hurts on this"), calls `setPainFlag(exerciseId, true, note?)`. This is deterministic and works offline. The domain then blocks increases for that movement, here and in `Next time`.
- The coach is then asked to adjust with increases blocked. It can lower or hold, suggest stopping the exercise (as a `Skip exercise` suggestion that Ben confirms) or suggest a swap (`ChangeReviewCard`). It never diagnoses.
- Copy: `Pain noted for Bench press. No increases for this movement until you clear it.` Offline: `Pain noted for Bench press. Coach offline, so your sets are unchanged. Change them directly or skip the exercise.`

### 4.6 Next session (path C)

Specified in [workout-summary.md](workout-summary.md) §2 and §3. In short:
- After `finishWorkout` commits, **one** coach turn (`runCoachTurn` with summary context) returns the coach note and `future_template` proposals.
- `Next time` shows each changed exercise with **before** = the built-in rule's target (what happens if Ben does nothing) and **after** = the coach's target, both labelled, plus the coach's reason, guard notes, `Why?`, `Not now` and `Apply`.
- If the coach is offline, not connected or fails: the built-in rule's targets show with the label `Built-in rule (coach offline)` (or `Built-in rule (coach unavailable)` on errors).
- Unapplied proposals expire when the next session of that routine starts. The built-in rule's targets then apply.

### 4.7 Settings (Profile → Coach)

```
│ Coach offers                           │
│ [x] Offer to adjust after a hard or    │
│     easy set                           │
│ Offer when effort is at least  [ 9.5 ] │
│ Offer when reps are short by   [ 2   ] │
│ Offer when effort is at most   [ 6   ] │
│ Reset to defaults                      │
```
Thresholds are stored as data and read by `evaluateCoachTrigger`. The switch turns path B off completely; path A and C are unaffected.

## 5. Copy

Values are labelled as **target** or **actual** every time. `→` reads "to" in VoiceOver.

### 5.1 On screen

| Element | Text | Target / actual |
|---|---|---|
| Adjust control | `Adjust` · offline caption `Coach offline` | — |
| Chip row | `What should change?` · `Too hard` · `Too easy` · `Pain` · `Type…` | — |
| Offer (hard) | `That looked hard. Adjust remaining sets?` + fact `RPE 10 on set 2` or `6 reps on set 2 (target 8–10)` | Fact = actual; range = target |
| Offer (easy) | `That looked easy. Adjust remaining sets?` + fact `RPE 6 on set 2` | Actual |
| Offer buttons | `No thanks` · `Adjust` | — |
| Pending | `Coach is working on sets 3–4` · `Nothing has changed yet.` · `Cancel` | — |
| Re-sending | `Updating for the set you just logged…` | — |
| Banner line 1 | `Coach adjusted sets 3–4` / `Coach adjusted set 4` / `Coach adjusted 3 sets` | — |
| Banner line 2 | `100 → 95 kg × 8 · <reason>`. Reps only: `95 kg × 8 → 6`. Set removed: `Set 4 removed · <reason>`. Set added: `Set 5 added: 90 kg × 8 · <reason>` | Targets |
| Banner actions | `Why? ›` · `Undo` | — |
| Guard notes | `Rounded to 97.5 kg: nearest your bar and plates allow.` · `Capped at 30 kg each: the most Main Gym's rack goes to.` · `Not increasing Overhead press: you flagged shoulder pain.` | Targets |
| Blocked | `Not increasing: you flagged shoulder pain. Sets unchanged.` | — |
| No achievable load | `Couldn't use the coach's load: 31 kg each isn't possible on this rack. Sets unchanged.` | — |
| No change | `Coach kept sets 3–4 as planned.` + reason | — |
| Undone | `Back to the plan for sets 3–4.` · `Back to the previous targets for sets 3–4.` · `Undone for set 4. Set 3 was already logged.` | — |
| Stale | `Your workout moved on before the coach answered. Nothing changed.` [Ask again] | — |
| Timed out | `The coach didn't answer in time. Nothing changed.` [Try again] | — |
| Failed | `Couldn't reach the coach (limit reached). Nothing changed.` | — |
| Interrupted | `Coach request was interrupted. Nothing changed.` [Ask again] | — |
| Offline (Adjust tapped) | `Coach offline. Your sets are unchanged. Change the next set's numbers directly.` (+ `Pain` chip only) | — |
| Not connected (Adjust tapped) | `Coach not connected. Your sets are unchanged.` [Connect in Profile] | — |
| Target line | `Coach target 95 kg × 8` + `Plan was 100 kg × 6–8` | Targets |
| Edited draft kept | `Your edit kept · Coach target 95 kg × 8` | Target |
| Source tags | `Coach` · `Built-in rule` · `Built-in rule (coach offline)` · `Built-in rule (coach unavailable)` | — |
| Pain | `Pain noted for Bench press. No increases for this movement until you clear it.` | — |
| Why sheet heading | `Why the coach changed this` · sections `What it used` (evidence) · `Checks` (guard notes) · `Not changed` | — |

### 5.2 Coach reply length

The coach's reason is **one sentence, at most 90 characters**, plain, no praise, no diagnosis, no scores (set in the instructions, brief AI proposal 2). The UI shows at most two lines and puts the rest in `Why?`.

### 5.3 Spoken

| Event | Mode | Script | Target / actual |
|---|---|---|---|
| Adjustment applied (Ben asked by voice or tapped Adjust) | Set cues, Conversation | "Sets 3 and 4: 95 kilos for 8." | Target |
| Applied with snap | same | "Sets 3 and 4: 97 and a half kilos for 8. Rounded to what your plates allow." | Target |
| Blocked by pain | same | "Not increasing. You flagged shoulder pain." | — |
| Coach reply (voice request only) | Conversation | The coach's one sentence, then the scripted line above | — |
| Offer | Conversation only, Resting with ≥ 20 s left | "That looked hard. Want me to adjust the remaining sets?" | — |
| Undo (voice) | Set cues, Conversation | "Back to 100 kilos for sets 3 and 4." | Target |
| Offline (voice request) | any with voice | "The coach is offline. Your sets haven't changed." | — |

Scripted lines come from `buildSetCue(event, sessionVersion)`. Nothing is spoken in Quiet mode. Nothing unrequested is spoken outside Resting.

## 6. Data needed

Existing (brief §7–8, ADR 0006):
- `getAiCapabilities(userId)`: whether `Adjust`, offers and coach targets are available now.
- `buildCoachContext`, `classifyCoachIntent`, `runCoachTurn(turnId, input, modality)`.
- `validateCoachProposal(proposal, context)`: returns `{valid, stale, changes, guardNotes[]}` where a guard note is `{kind: 'snapped' | 'capped' | 'pain_blocked' | 'no_achievable_load' | 'completed_set_dropped', setIds, from?, to?, detail}`. Uses `getAchievableLoads` / `roundToAvailableLoad` and the pain flag (`PainStatus`).
- `applyCoachProposal(id, confirmation)`: `confirmation` adds `{kind: 'ben_request' | 'offer_accepted' | 'review_apply', expectedVersion}`.
- `undoAction(actionId)`, `getDecisionEvidence(actionId)`.
- `buildActiveSetView(sessionId)`: adds, per set, `target.source: 'plan' | 'rule' | 'coach'`, `target.planned` (the pre-adjustment target), `adjustmentActionId`; and at session level `coachRequest {turnId, status, coveredSetIds}`, `coachOffer {triggerId, kind, fact, setId}`, `lastAdjustment {actionId, summary, reason, guardNotes}`.
- `calculateNextTargets(history, rule, equipment)`: the built-in "before" value and the offline fallback.
- `buildWorkoutSummary(sessionId)`: `nextTime[]` with `builtIn`, `coachProposal?`, `coachStatus`.
- `buildSetCue`, `cancelObsoleteCues`.

**Proposed new (contracts to add; flagged for the developer and Ben):**

| Function | Why |
|---|---|
| `evaluateCoachTrigger(set, target, thresholds)` → `{triggerId, kind: 'rpe_high' \| 'reps_short' \| 'rpe_low', fact}` or `null` | ADR 0006 trigger checks in `packages/domain`; pure, unit-tested |
| `recordTriggerResponse(triggerId, 'shown' \| 'accepted' \| 'dismissed' \| 'expired')` | Enforces CA4 and keeps evidence for later review |
| `requestCoachAdjustment(sessionId, request, baseVersion, opId)` | Wraps `runCoachTurn` for `adjust_pending_sets`, with `origin: 'ben_request' \| 'trigger_offer'` |
| `cancelCoachTurn(turnId)` | Cancel and Log-while-pending |
| `setPainFlag(exerciseId, active, note?)` | `PainStatus` exists in the domain; the UI needs a write path |
| `Proposal.origin`, `Proposal.guardNotes`, `ActionRecord.reason` + `evidenceRefs` (already in the brief) | Banner, `Why?` and rule 3's "recorded with its reason" |

## 7. Acceptance checks

1. **No added taps.** Run the 3 × 3 matching-set workout from flow check 1 with the coach connected and no triggers firing: the tap count is identical to the coach-off run, and no coach UI appears except the `Adjust` control.
2. With airplane mode on, no AI call is made after any set, and no offer appears even when RPE 10 is entered.
3. With the coach connected, logging 10 sets with RPE 7–8 and reps on target makes **zero** AI calls (check the provider log).
4. Log bench set 2 at RPE 10: the rest card shows `That looked hard. Adjust remaining sets?` with `RPE 10 on set 2`. Targets for sets 3–4 are unchanged until `Adjust` is tapped. No modal or sheet opens, and nothing is spoken (Set cues mode).
5. Tap `No thanks`, then log set 3 at RPE 10: no new offer. Log set 3 at RPE 6 instead: an easy offer appears (different kind, CA4).
6. Offers never appear on warm-up or drop sets, or while Ready.
7. Say "that was a grind" during rest: the slot shows pending, then `Coach adjusted sets 3–4: 100 → 95 kg × 8 · <reason>`, the next set's draft and Log label read 95 kg, and the rest countdown is unchanged throughout (±1 s).
8. Tap `Undo` on the banner: sets 3–4 show `Target 100 kg × 6–8` again, the coach tags are gone, the rest-end cue (Set cues) says 100.
9. During pending, Log set 3 at once: set 3 saves with the values on the Log button. The coach result never changes set 3. Either the re-sent result changes only set 4, or `Your workout moved on…` appears.
10. The coach suggests 96 kg on a barbell with 1.25 kg pairs (95 and 97.5 achievable): after "too hard" the target is 95 kg, after "too easy" it is 97.5 kg; the banner shows `Rounded to 95 kg: …` / `Rounded to 97.5 kg: …`. The stored target is achievable (`getAchievableLoads`).
11. The coach suggests 35 kg each on a 30 kg rack: the target is 30 kg each with `Capped at 30 kg each…`.
12. With a shoulder pain flag on Overhead press, a coach increase is never applied, and the slot shows `Not increasing: you flagged shoulder pain. Sets unchanged.` with no Undo. A decrease still applies.
13. A coach proposal naming a completed set never changes it; the evidence sheet lists `Not changed: set 2 is already done.`
14. After an adjustment, done sets show only actual values. Pending changed sets show `Coach target` + `Plan was …` in Focus, `C` in Overview, and VoiceOver reads both values.
15. An adjustment arriving while Ben is on the Ready card changes the Log label, and Log ignores taps for 1 s afterwards. Normal logging has no such delay.
16. With a draft Ben edited by hand, an adjustment keeps his edit and shows `Your edit kept · Coach target …`.
17. Force-quit during pending and reopen: `Coach request was interrupted. Nothing changed.`; nothing was applied.
18. A timeout or quota error shows the honest message, never a made-up reply, and never uses a paid route.
19. With the coach offline, tapping `Adjust` shows `Coach offline. Your sets are unchanged…` and only `Pain`; `Pain` still records the flag.
20. Every applied adjustment has a stored reason, evidence refs and guard notes, visible in `Why?` (`getDecisionEvidence`).
21. Coach UI is never colour-only: the `Coach` tag has text, the banner has an icon and text, the offer is text.
