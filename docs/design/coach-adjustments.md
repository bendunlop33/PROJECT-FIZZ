# Coach adjustments (in-workout and next-session)

> **Revision 2026-10-08 (consolidation).** `setPainFlag` uses the canonical multi-exercise signature from [coach-memory.md](coach-memory.md) §6; pain flags are cleared from the canonical Pain flags list (coach-memory.md §2.7) and shown on the set card as `PainFlagNote`. The Coach offers settings screen is profile-and-settings.md §2.7. CA2 (swaps keep the Apply card) now has a pending alternative for swaps Ben picks himself (exercise-library.md EL4, open-decisions.md). Proposal kinds, scopes and the generic review UI are in [change-review.md](change-review.md); `Why?` uses the evidence frame in [coach-sheet.md](coach-sheet.md) §4.6.

> **Revision 2026-10-09 (pre-workout check-in, brief v0.9).** A fourth way in: **path B′, check-in offer** ([check-in.md](check-in.md) §4.4). A low pre-workout check-in (score at or below the setting, default 2, or `Tired` / `Poor sleep`) makes `evaluateCheckInOffer` (pure, no AI) show `Want a lighter session today?` / `You said 2 of 5 · …` [No thanks] [Adjust] in the **first set card's coach slot, in Ready, before any set is logged**: the one exception to §2.3's "only in the rest card" (CI5). It is never spoken. `Adjust` counts as Ben accepting (CA1) and sends `requestCoachAdjustment(…, {origin: 'check_in_offer', checkInId, intent: 'lighter_session'}, …)` for all of today's pending sets. Two new deterministic guards: `lighter_no_increase` (a lighter-session result can't raise anything) and `pain_unspecified` (Ben picked `Pain` in the check-in without choosing movements: no increases anywhere in that session). Offline after a low check-in: one outcome line, no adjustment; the built-in rules ignore check-ins. Changed: §1 table, §2.3, §2.6, §6, checks 22–25.

> **Revision 2026-10-09 (playbook v1 review fixes).** §4.6 now says plainly that the built-in rule (playbook 7-F, equipment-aware, no added sets) sets next-session targets in two cases: when the coach is unavailable, and when the coach is connected but Ben doesn't apply its proposal. Whether the coach's target should apply instead is playbook D21, for Ben; it would need CLAUDE.md rule 3 and ADR 0006 changed. The trigger thresholds in §1 path B and §4.7 still read as fixed numbers. They follow rule T's planned-effort conditions once built (listed in open-decisions.md "Playbook v1 follow-ups"). Changed: §4.6, §6.

> **Revision 2026-10-09 (Ben's decision D21, CLAUDE.md rule 3, ADR 0006 amendment 2; competitor follow-up 7).** Path C changes: **the coach's next-session targets are now the default.**
> - After the single post-workout coach call, its **small** changes (load, reps or sets on the same exercises) are saved for the next session of that routine without a tap, shown on the Summary with the reason, the built-in rule's value for comparison and one-tap `Undo`. "Small" is defined in code (new **CA8**). Bigger changes, stall resets (playbook rule 8) and deloads (rule 10) still come as proposals with Apply.
> - **The built-in rule (playbook 7-F) is the labelled fallback** when the coach is unavailable, gives no target for an exercise, or Ben undoes the coach's target.
> - **Structural changes** (swapping, adding or removing exercises, order, rotation, templates) are proposals, raised only when Ben asks (for example for variety) or a deterministic signal says something changed: goal, schedule, equipment or pain (new **CA9**).
> - A coach answer that arrives after Ben has left the Summary still applies, until that routine's next session starts (new **CA10**).
> - Every change line (banner, card, row, spoken cue) is app text from the saved action, and coach text that claims an unsaved change is hidden: [coach-contract.md](coach-contract.md).
> - Changed: §1 table and decisions (CA8–CA10), §4.6, §5.3, §6, checks 26–33.

> **Revision 2026-10-11 (Ben: "Offers follow the target RPE"; CHANGELOG 2026-10-11, ADR 0006 amendment 3).** CA6's built-in fallback for today's remaining sets is **approved** (offer only, applies on `Adjust`, `Rule` tag, Undo). Every working set now carries a **target RPE** (Ben's override, else the coach's, else the plan's, else the built-in rule's profile value), shown on the target line as `@ RPE 8`; Ben sets his own from the exercise `⋯` → `Target RPE` (this set, this exercise, today), or on a logged set from `Edit set`. **Triggers are deviation-based** against that target (CA5), and the too-hard drop is sized per RPE point over target (§4.8). Changed: §1 path B row, CA5, CA6, §4.2, §4.7, §4.8, checks 34–40 (the 11 Oct checks renumbered from 31–34, review r3 N2).

Status: v0.1 draft, 8 Oct 2026. This is the **single spec** for coach-led progression ([ADR 0006](../decisions/0006-coach-led-progression.md), CLAUDE.md rule 3, brief CHANGELOG v0.4). Other specs link here instead of repeating it:
- [active-workout.md](active-workout.md): where Adjust sits on the set card, coach target markers, Log guard
- [rest-state.md](rest-state.md): the offer line and adjustment banner in the rest card, cues
- [workout-summary.md](workout-summary.md): `Next time` with `Coach` vs `Built-in rule` sources; since D21 the coach's small changes are saved by default there
- [coach-contract.md](coach-contract.md): how every change line is rendered from the saved action, the claim check, and the tool registry (no tool can destroy history)
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
| **B. Coach offers** | A deterministic trigger in `packages/domain`, against the set's target RPE (CA5): effort ≥ target + 1.5 or reps below the range minimum, or effort ≤ target − 2, on a working set | One line in the rest card: `That looked hard. Adjust remaining sets?` [No thanks] [Adjust]. **Nothing changes, and no AI call is made, until Ben taps Adjust.** Then it continues as path A | 1 (`Adjust`), or 0 if ignored |
| **B′. Check-in offer** (2026-10-09) | A low pre-workout check-in ([check-in.md](check-in.md) §4.4), checked by `evaluateCheckInOffer` in `packages/domain` | One line in the first set card's coach slot before any set is logged: `Want a lighter session today?` [No thanks] [Adjust]. **No AI call until Adjust**; then path A for all of today's pending sets, with no increases allowed | 1 (`Adjust`), or 0 if ignored |
| **C. Next session** (revised 9 Oct, D21) | Finishing the workout (one coach call per workout, together with the coach note) | The coach's **small** changes (CA8) are saved for the next session of that routine without a tap. `Next time` shows each with its reason, `Rule: …`, `Why?` and `Undo`. Bigger changes are proposals with Apply. Structural changes appear only with a request or signal (CA9) | 0 (1 to Undo) |

The single primary action on the workout screen stays **`Log …`**. Every control in this spec is secondary. The single primary on the summary stays **`Done`**.

### Design decisions to confirm with Ben (flagged, not yet in the brief)

| # | Decision | Reason |
|---|---|---|
| CA1 | Tapping **Adjust on a coach offer counts as Ben asking**. The coach's result then applies at once with Undo, as in path A. There is no second Apply card | Rule 3 says a coach-raised change doesn't apply "until Ben accepts". Adjust *is* the acceptance. A second review card would add a tap between sets for every offer, and Undo already makes it reversible. **Alternative**: show the result as a `ChangeReviewCard` with Apply (one more tap). |
| CA2 | Path A covers **targets of pending sets**: load, reps, and adding or removing pending sets, in this exercise or later ones today. **Swapping an exercise or changing the gym** still goes through the `ChangeReviewCard` (Apply) | Swaps change equipment and history comparability, so they're bigger than a number change. Rule 2 still wants a review for broad plan changes |
| CA3 | **Rest durations are not changed by adjustments** in this version | Keeps the rest timer rules simple (rest-state §4.5). Ben can still change rest himself |
| CA4 | **"At most once per exercise unless a new trigger fires"** is read as: after one offer for an exercise, another offer for that exercise only appears for a **different trigger kind** (`rpe_high`, `reps_short`, `rpe_low`), or after an adjustment was applied to that exercise (the plan changed, so a trigger means something new) | Otherwise a run of hard sets would raise an offer after every set, which is the "constant" coaching ADR 0006 rules out |
| CA5 | Triggers never fire on **warm-up or drop sets**, or on a set planned all-out (target RPE 10). They compare the logged set with its **target RPE** (revised 11 Oct, Ben; `targetRpeOf`: Ben's override, else the coach's, else the routine's RPE/RIR, else the built-in rule's profile value, main barbell 8.5, compound 9, isolation 9). **Harder than planned:** logged effort ≥ target + 1.5, or reps below the range minimum (any rep below a **range's** floor: 3–6, did 2 → short, did 3 → not; a **single-number** target short by ≥ 2: 8, did 6), unless logged effort was clearly below target (≤ target − 1). A rep miss with no effort logged still fires. **Easier than planned:** logged effort ≤ target − 2, on ≤ 12 reps that weren't short. A set with no target at all uses the fixed D20 thresholds. Thresholds stay editable | Ben (11 Oct): "Hitting 10 RPE is not bad if that was the plan." Build 108: the Log button shows the top of the range (`× 6`), so 2 reps against `3–6` was a big miss Ben saw. Ben's cases: 3–6, 2 reps, no RPE → offer; RPE 10 on an RPE-10 plan → no offer; RPE 10 on an RPE-8 plan → offer |
| CA6 | (Revised 11 Oct, build 108 fix F2. **Approved by Ben 11 Oct**: CHANGELOG 2026-10-11, ADR 0006 amendment 3, playbook rule 5/6 notes.) With the coach **not reachable** (not signed in, unavailable, or `Offline` after a failed request), the **same triggers** show the **built-in rule's offer** on the rest card: the same prompt and fact, plus the concrete change and a `Rule` tag (`Next sets: 57.5 kg × 3–6  [Rule]`), `No thanks` / `Adjust`. `Adjust` applies it at once to **today's remaining sets of that exercise only**, through the same versioned, idempotent write as the coach's, with the banner `Adjusted sets 2–3 [Rule]`, `Why?` and one-tap Undo. Nothing changes until Ben taps `Adjust` (CLAUDE.md rule 3). If the rule has nothing it may change (no lighter load or fewer reps that fit; a raise blocked by pain; no pending set), no offer is shown and nothing extra appears. If the coach looked reachable but the `Adjust` turn fails (no network, unavailable, timeout), the rule's offer for the same trigger replaces the failure line (F3). **Ben's own `Too hard` / `Too easy`** (review coach-fallback S1): with the coach not reachable the two chips stay in the `Adjust` row (`Type…` is hidden when not connected or unavailable; it stays when `Offline`, which lapses once the network is back), and a tap applies the rule's change to the focused exercise's remaining sets at once (Ben asked, so no offer step), with the same banner, `Why?` and Undo; no AI call. If the coach looked reachable but the chip's turn can't answer, the rule's change applies the same way. Nothing it may change: `Nothing to change.` **Size of the change** (`evaluateSessionAdjustment`, `BUILT_IN_SESSION_RULE`), rule 5/6 sized by RPE points over the target: see §4.8 | CLAUDE.md rule 3: "With no AI available, the simple built-in progression rules are the labelled fallback." The earlier CA6 left Ben with nothing after a big miss whenever the coach couldn't answer (build 108). The diagnosis flagged the CLAUDE.md vs ADR 0006 scope disagreement; Ben resolved it in CLAUDE.md's favour (ADR 0006 amendment 3) |
| CA7 | If Ben logs while the coach is still working, the request is **re-sent once** with the new state (if any set it covers is still pending), otherwise dropped | "Recompute or discard" from the brief; a single retry keeps cost and confusion bounded |
| CA8 | (9 Oct, D21) **What counts as a "small" next-session change** is decided by code: `classifyNextSessionChange(before, after, stepCard, context)`. A coach target is `small` only if it keeps the same routine, exercises and order, and: the load stays or moves **one achievable step** up or down from the last target on that equipment (`buildStepCard`); the rep target moves by **at most 2** at either end; the set count changes by **at most 1**, and **+1 only when Ben has asked** for more sets or volume (playbook D1); effort targets and rest don't change. Anything else is `bigger` and comes as a `CoachTargetProposal` with Apply, except an added set Ben didn't ask for, which is dropped and listed in `Why?` (D1: extra sets only when he asks). Stall resets (rule 8) and deloads (rule 10) are always `bigger`, which keeps those approved rules' "propose" wording true. A set whose load Ben pinned as `Fixed` in the routine (routines RT3) is never changed by default; a coach change to it is `bigger`. A pain flag still blocks every increase | D21 says "small adjustments only". A definition the reviewer can test stops "small" drifting with the model. One step can be large on coarse dumbbells (10 → 12 kg, +20%); every row shows its %, so Ben sees it. **Alternative for Ben:** any load, rep or set change on the same exercises applies by default |
| CA9 | (9 Oct, D21) **Structural changes need a request or a signal.** `getStructuralChangeSignals(ownerId, routineId, sessionId)` (pure) returns any of: `variety_request` (Ben asked for variety or new exercises for this routine, in chat or by voice, not yet answered), `goal_changed` (goal version differs from the routine's), `schedule_changed` (days a week or session length changed), `equipment_changed` (the routine's gym equipment version changed, or this workout switched gym), `pain_flag` (a flag set on one of its movements since the routine's version). Without a request or signal the coach doesn't receive the structural proposal tools (coach-contract CC10) and the validator drops any structural item. With one, the Summary shows at most one `ChangeReviewCard` (`Because: …`, scope `Push A from now on`, Apply, Undo) | CLAUDE.md rule 3: structural changes are raised only when Ben asks or something changed. A gate makes "only" testable |
| CA10 | (9 Oct, D21) **A late coach answer still applies.** If the coach answers after Ben tapped `Done`, or after coming back online, its small changes are saved then, as long as that routine's next session hasn't started; otherwise they're dropped as stale (rule 5). They show in that workout's summary in history (with Undo until the next session starts) and in the next workout's `Why?` (`Set by  Coach · after Push A, 8 Oct`). A one-line Today hint for late answers is a suggested today.md follow-up |  D21 makes the coach the default. Dropping a late answer would let the built-in rule win just because Ben was quick |

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

Only in the rest card (Resting). Never in Ready, because Ben may be mid-set. **Exception (2026-10-09):** the check-in offer (path B′) sits in the first set card's coach slot in Ready before any set is logged, is never spoken, and expires when the first exercise's last set is logged or a set offer replaces it (check-in.md CI5).

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
| Snapped | The coach's load isn't achievable; `roundToAvailableLoad` picked the nearest one, except that it never rounds above the coach's number when the request was "too hard" (or a `rpe_high` / `reps_short` offer), and never below it when "too easy" (or `rpe_low`) | Guard note: `Rounded to 97.5 kg` Dumbbells: `…nearest your dumbbell rack allows.` Stack: `…nearest the stack allows.` |
| Capped | The coach's load is above the equipment max | Guard note: `Max here 30 kg each` |
| Pain-blocked (all) | Every change would increase load, reps or sets on a movement with an active pain flag | **Outcome line, no Undo (nothing changed):** `Not increasing: you flagged shoulder pain. Sets unchanged.` If no area was given: `Not increasing: you flagged pain on Bench press. Sets unchanged.` |
| Pain-blocked (part) | Some changes were increases on a pain-flagged movement | The rest apply. Guard note: `Not increasing Overhead press: you flagged shoulder pain.` |
| No achievable load | No load on the equipment is near the coach's value, or the equipment can't make any load | Outcome line: `Couldn't use the coach's load: 31 kg each isn't possible on this rack. Sets unchanged.` |
| Completed set named | The coach tried to change a set that's already done | Those changes are dropped silently from the apply (never applied), and `Why?` lists them as `Not changed: set 2 is already done.` |
| No change | The coach advises keeping the plan | Outcome line: `Coach kept sets 3–4 as planned.` + reason. No Undo |
| Lighter, no increase (2026-10-09) | A check-in lighter-session request (`intent: 'lighter_session'`) came back with an increase | That change is dropped; the rest apply. Guard note: `No increases in a lighter session.` |
| Pain, movement unknown (2026-10-09) | The session's check-in has `Pain` with no flagged movement (check-in.md CI8) | Every increase in that session is dropped. Guard note: `Not increasing anything today: you mentioned pain.` All dropped: outcome line with the same text and `Sets unchanged.` |

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
| Stale, dropped | `Out of date` [Ask again] | `Log …` | `Ask again` re-sends the same request on the current state |
| Timed out | `The coach didn't answer in time. Nothing changed.` [Try again] | `Log …` | Never a canned answer |
| Failed (limit/error) | `Couldn't reach the coach (limit reached). Nothing changed.` | `Log …` | Never switches to a paid route (rule 7) |
| Coach offline / not connected | `Adjust` shows the caption `Offline` / `Not connected` / `Unavailable`; tapping it shows `Too hard` · `Too easy` · `Pain` (+ `Type…` when `Offline`), no line; the two chips apply the built-in rule's change (CA6) | `Log …` | Offers are the built-in rule's, tagged `Rule` (CA6 revised) |
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

1. On `SetCommitted` (reps short) or `SetCorrected` with a new effort value (RPE high or low), the UI calls `evaluateCoachTrigger(set, setNumber, thresholds, targetRpe)` with the set's target RPE (`targetRpeOf`, CA5). This is a pure domain check: **no AI call**, no network.
   - (11 Oct, r3 N3) An effort chip after logging re-checks the same set. If its offer is showing and the set still triggers the same kind, the offer stays (CA4 would not show it again); if the effort now clears it (e.g. RPE 7 against 8.5 after a rep miss), it goes; a different kind replaces it.
2. The offer shows only if **all** hold: the session is Resting; the set isn't a warm-up or drop set; a pending set is left on that exercise; CA4 allows it for this exercise; nothing is pending. Whether it is the **coach's** offer or the **built-in rule's** (CA6 revised) depends on `getAiCapabilities` now: a usable route → the coach's; otherwise the rule's, shown only if the rule has a change to offer. CA4 counts both kinds.
   - (11 Oct, F7) A set logged with **no rest running** (a superset's 0 s transition, an exercise with rest 0) is held and checked when the next rest starts, newest first. The last set of an exercise never offers (nothing to adjust).
   - (11 Oct, F4) Correcting a logged set's reps or effort in the correction sheet runs the same check on the corrected set when Ben returns to the workout (new set version, so a new trigger).
3. `No thanks` → `recordTriggerResponse(triggerId, 'dismissed')`. The line disappears. Nothing else happens.
4. `Adjust` → `recordTriggerResponse(triggerId, 'accepted')`, then step 2 of path A with `origin: 'trigger_offer'` and the trigger's facts attached (CA1).
5. Ignoring it is fine: the next Log removes it (`'expired'`).
6. **Spoken offer** (Conversation mode only): spoken once, only while Resting with at least 20 s left, never over the rest-end cue, and never in Ready (Ben may be lifting). Ben replies by Talk: "yes" / "adjust" = Adjust; "no" = No thanks.

RIR mode: RIR counts as RPE 10 − RIR, logged and planned. The fact line quotes what Ben entered, with the target in the same scale (`RIR 0 on set 2 (target RIR 2)`, `RPE 10 on set 2 (target 8)`), never a converted RPE.

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
| Pain flag | Undo on the pain card (8 s); later `Pain` chip again, or Pain flags → `Clear…` → confirm (coach-memory.md §2.7) | Clearing is always explicit by Ben |

Voice "undo" undoes the most recent action of any kind (a set log or an adjustment). The strip says which: `Undid the coach change to sets 3–4.`

### 4.5 Pain

- `Pain` (chip), or voice ("my shoulder hurts on this"), calls `setPainFlag({exerciseIds: [exerciseId], active: true, source: 'workout'}, opId)` (canonical signature, coach-memory.md §6). The pain card with optional area and similar-movement chips is coach-memory.md §2.5; the set card then shows `PainFlagNote` (active-workout.md §2.1). This is deterministic and works offline. The domain then blocks increases for that movement, here and in `Next time`.
- The coach is then asked to adjust with increases blocked. It can lower or hold, suggest stopping the exercise (as a `Skip exercise` suggestion that Ben confirms) or suggest a swap (`ChangeReviewCard`). It never diagnoses.
- Copy: `Pain noted for Bench press. No increases for this movement until you clear it.` Offline: `Pain noted for Bench press. Coach offline, so your sets are unchanged. Change them directly or skip the exercise.`

### 4.6 Next session (path C; revised 9 Oct for D21)

Specified in [workout-summary.md](workout-summary.md) §2 and §3. In short:
1. After `finishWorkout` commits, **one** coach turn (`runCoachTurn` with summary context) returns the coach note and next-session targets for the routine just done. The turn gets `set_next_session_targets`, and the structural proposal tools only with a request or signal (CA9).
2. `validateCoachProposal` applies the guardrails: snap to achievable loads, cap at the equipment max, pain blocks, completed sets untouched, version checks. Then `classifyNextSessionChange` (CA8) splits the result.
3. **Small changes are saved at once**: `applyCoachProposal(id, {kind: 'default_next_session', expectedVersion, opId})`, one transaction and one `actionId` for the workout, each exercise undoable on its own. No tap.
4. **Bigger changes** (CA8) become `CoachTargetProposal`s with `Not now` / `Apply`. The built-in rule's target stays in use for that exercise until Ben applies.
5. Each saved row shows the target and its % change, the coach's reason, guard notes, `Rule: …`, `Why?` and `Undo`. `Undo` puts the built-in rule's target back for that exercise; `Use coach target` puts the coach's back.
6. **The built-in rule (playbook 7-F)** sets the target when the coach is offline, not connected or fails (tag `Rule`), when the coach gives no target for an exercise (`Built-in rule`), and after Ben's Undo. It is always computed, as the fallback and the comparison value. It is equipment-aware: smallest achievable step, reps first when that step is over ~10% or at the max, then hold, never an added set.
7. **Structural changes** appear only with a request or signal (CA9), as one `ChangeReviewCard` (scope `Push A from now on`, Apply, Undo; change-review.md). They expire when the routine next starts (change-review CR8).
8. **Undo window:** on the Summary until that routine's next session starts. After that, the set card's `Why?` → `Use built-in rule` (active-workout AW4) changes that day's pending sets.
9. Late answers: CA10. Change lines on every surface come from the saved action, not the model's words (coach-contract.md CC1).

"Next session" means the next time this routine comes up. With the rotation (weekly-plan WP14) that's when the rotation reaches it again, or when Ben starts it himself.

### 4.7 Settings (Profile → Coach)

The full screen, including RIR equivalents and `Reset to defaults` with Undo, is profile-and-settings.md §2.7 (`Coach offers`); calls `getCoachTriggerThresholds` / `saveCoachTriggerThresholds`.

```
│ Coach offers                           │
│ [x] Offer to adjust after a hard or    │
│     easy set                           │
│ Harder than target by at least [ 1.5 ] │
│ Easier than target by at least [ 2   ] │
│ Offer when reps are short by   [ 2   ] │
│ Reset to defaults                      │
```
Thresholds are stored as data and read by `evaluateCoachTrigger` (`harderBy`, `easierBy`, `clearlyBelowBy`; the fixed `rpeHigh` 9.5 / `rpeLow` 6 only for a set with no target, D20). The switch turns path B off completely; path A and C are unaffected. (Not built yet: the code uses the defaults; the settings screen is a follow-up.)

**Target RPE (11 Oct).** Not a setting: Ben sets it in the workout from the exercise `⋯` → `Target RPE` → `RPE 6` … `RPE 10` (current one ticked; `Default` clears his own) → `This set` / `This exercise` / `Today`. Pending working sets only; stored on the workout (`planned.rpeOverride`, `set_target_rpe`, versioned and idempotent; Your data). `Today` applies to the working sets in the workout at that moment; an exercise added afterwards keeps its coach, plan or rule target. A **logged** working set's target is set from its `Edit set` sheet (`Target RPE` chips, active workout only; `Default` clears his own, as in the `⋯` sheet; changing the set to a warm-up or drop set clears it in the same correction), saved in the same `correct_set` as any other correction: guarded on the set's version, idempotent, audited (`targetRpe` in the edit log's before/after), never touching the logged values or the `Edited` tag. The offer check then runs on the set again (F4), so a set Ben meant as all-out loses a wrong `That looked hard.` offer. It survives a coach change and that change's Undo. The coach may set a target RPE on today's pending sets (a raise above the set's target in force, built-in or RIR targets included, counts as an increase: blocked by pain and in a lighter session; restating it is no change; on a set with Ben's own target the coach's isn't used, guard note `Your target RPE stays.` under `Why?`) and on next-session targets (compared with the set's target without Ben's own override, which is for that workout only: the coach's, the plan's (10 − RIR) or the built-in rule's; a changed target RPE is `bigger` under CA8: a proposal; restating it is no change).

### 4.8 Built-in in-session rule (CA6 revised, 11 Oct)

`evaluateSessionAdjustment(aggregate, trigger, painFlags, sessionPainUnspecified)` in `packages/domain/src/coach/session-adjust.ts`. Pure; no AI, no network. Its result goes through `validateTodayAdjustment` (snap, cap, pain, completed sets) before it is shown, so the offer shows exactly what `Adjust` writes.

Size per rule 5/6 and D22 (Ben, 11 Oct: "≈ 2–4% per RPE point over target, rounded to an achievable load"). The rule asks the low end, **2% per RPE point over the target RPE, at least 5% and at most 10%**, then rounds down (`tooHardDropPct`). A rep miss logged **without RPE** (Ben's case), or Ben's own `Too hard`, has no points to count, so 5%:

| Trigger | Change to each remaining working set of that exercise | Source |
|---|---|---|
| Too hard (`reps_short`, `rpe_high`) | The next achievable load at least **max(5%, 2% × points over target)** lighter, at most 10% asked (rounded down to what the equipment makes), same reps. Target 8, logged 10: 5%; target 7, logged 10: 6% (100 kg → 92.5 kg on the bar) | Rule 5 (2–4% per point), D22 (5–10%) |
| …if that load is > 10% lighter, or there is none (equipment min, bodyweight) | **Same load, fewer reps**: the reps Ben just managed (`reps_short`, at least 1), or one fewer than he managed (`rpe_high`) | Rule 5 guardrail; equipment-aware progression §9 |
| Assisted machine, too hard | **One assistance step more** (no % without bodyweight) | Playbook rule 7 step 6, D5 |
| Too easy (`rpe_low`) | The next achievable load if it is **≤ 5% heavier**, else **+1 rep**; assisted: one step less assistance. Never past the equipment max | Rule 6 (+2–5% or +1–2 reps) |
| Ben's own `Too hard` / `Too easy` chip, coach not reachable (S1) | As the rows above, with `Too hard` as the fact. Fewer reps, when used: one fewer than the planned top (no logged set to go by) | Rule 5 guardrail; same as `rpe_high` |
| Pain flag on the movement, or pain at check-in | No raise, so no too-easy offer. A too-hard change still applies | Rule 9 |

Never after a miss: an increase, a removed or added set, a change to a done or warm-up set, or a change to another exercise. kg/lb and the load convention (total, per hand, stack, assisted) follow the row's own equipment.

Recorded: an `ActionRecord` with author `checks` (app code, not the coach), turn `null`, opId `built-in-adjust:<triggerId>` (a double tap applies once), the session version before/after, the guard notes, and the reason as app text (`2 reps on set 1 (target 3–6). Lighter load for the remaining sets (8%).`). Each changed target gets `source: built_in_rule` and a `rule` provenance, so `Why?` reads `Set by  Built-in rule · 10 Oct` and the rule's words, never `Coach`. `Adjust` re-works the change on the workout as it is now and applies it only if it touches the **same sets with the same targets** Ben was shown (the offer carries the version it was computed on, the set IDs and targets; review S2); otherwise `Out of date. Nothing changed.` (rule 5). The version alone isn't the test: a draft or rest edit during the rest moves it on without changing the offer. Ben's own chip (S1) is worked out and applied on the current version in one step, opId per tap.

At Summary (F5) a session with a set below the rule's range floor is always listed under `Next time` (`hold_after_miss`, tag `Rule`): `Same target: 62.5 kg × 3–6`, or `Target 57.5 kg × 3–6` when the rule held a lighter load used today. Two such sessions in a row at the same load reduce (7-F).

## 5. Copy

Values are labelled as **target** or **actual** every time. `→` reads "to" in VoiceOver.

### 5.1 On screen

| Element | Text | Target / actual |
|---|---|---|
| Adjust control | `Adjust` · caption `Offline` / `Not connected` / `Unavailable` | — |
| Chip row | `What should change?` · `Too hard` · `Too easy` · `Pain` · `Type…` | — |
| Offer (hard) | `That looked hard. Adjust remaining sets?` + fact `RPE 10 on set 2` or `6 reps on set 2 (target 8–10)` | Fact = actual; range = target |
| Offer (easy) | `That looked easy. Adjust remaining sets?` + fact `RPE 6 on set 2` | Actual |
| Offer, built-in rule (CA6) | Same prompt and fact, then `Next sets: 57.5 kg × 3–6` + tag `Rule` (one set: `Next set: …`; different targets: `Set 2: 95 kg × 6–8 · Set 3: 75 kg × 6–8`) | Targets |
| Banner, built-in rule | `Adjusted sets 2–3` + tag `Rule` · `62.5 → 57.5 kg × 3–6` · `Why? ›` (heading `Rule`) · `Undo` · after Undo `Change undone.` · `⋯` menu `Undo change` | Targets |
| Rule offer refused | `Out of date. Nothing changed.` · `Nothing to change.` | — |
| Offer buttons | `No thanks` · `Adjust` | — |
| Pending | `Coach is working on sets 3–4` · `Nothing has changed yet.` · `Cancel` | — |
| Re-sending | `Updating for the set you just logged…` | — |
| Banner line 1 | `Coach adjusted sets 3–4` / `Coach adjusted set 4` / `Coach adjusted 3 sets` | — |
| Banner line 2 | `100 → 95 kg × 8 · <reason>`. Reps only: `95 kg × 8 → 6`. Set removed: `Set 4 removed · <reason>`. Set added: `Set 5 added: 90 kg × 8 · <reason>` | Targets |
| Banner actions | `Why? ›` · `Undo` | — |
| Guard notes | `Rounded to 97.5 kg` · `Max here 30 kg each` · `Not increasing Overhead press: you flagged shoulder pain.` | Targets |
| Blocked | `Not increasing: you flagged shoulder pain. Sets unchanged.` | — |
| No achievable load | `Couldn't use the coach's load: 31 kg each isn't possible on this rack. Sets unchanged.` | — |
| No change | `Coach kept sets 3–4 as planned.` + reason | — |
| Undone | `Back to the plan for sets 3–4.` · `Back to the previous targets for sets 3–4.` · `Undone for set 4. Set 3 was already logged.` | — |
| Stale | `Out of date` [Ask again] | — |
| Timed out | `The coach didn't answer in time. Nothing changed.` [Try again] | — |
| Failed | `Couldn't reach the coach (limit reached). Nothing changed.` | — |
| Interrupted | `Coach request was interrupted. Nothing changed.` [Ask again] | — |
| Offline (Adjust tapped) | No line. Chips `Too hard` · `Too easy` · `Pain` · `Type…` (CA6 revised) | — |
| Not connected / unavailable (Adjust tapped) | No line. Chips `Too hard` · `Too easy` · `Pain` (CA6 revised) | — |
| Target line | `Coach target 95 kg × 8` + `Plan was 100 kg × 6–8` | Targets |
| Edited draft kept | `Your edit kept · Coach target 95 kg × 8` | Target |
| Source tags | `Coach` · `Rule` · `Suggested` | — |
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

(9 Oct, coach honesty contract) The coach's spoken sentence is checked before it's spoken: a sentence that claims a change with no saved action this turn is never spoken, and a voice turn then says "Nothing was changed." instead ([coach-contract.md](coach-contract.md) CC3, CC8). The scripted change line is always the rendered one. Next-session targets saved on the Summary are never spoken.

## 6. Data needed

Existing (brief §7–8, ADR 0006):
- `getAiCapabilities(userId)`: whether `Adjust`, offers and coach targets are available now.
- `buildCoachContext`, `classifyCoachIntent`, `runCoachTurn(turnId, input, modality)`.
- `validateCoachProposal(proposal, context)`: returns `{valid, stale, changes, guardNotes[]}` where a guard note is `{kind: 'snapped' | 'capped' | 'pain_blocked' | 'no_achievable_load' | 'completed_set_dropped', setIds, from?, to?, detail}`. Uses `getAchievableLoads` / `roundToAvailableLoad` and the pain flag (`PainStatus`).
- `applyCoachProposal(id, confirmation)`: `confirmation` adds `{kind: 'ben_request' | 'offer_accepted' | 'review_apply' | 'default_next_session', expectedVersion}`. (9 Oct, D21) `default_next_session` is accepted only from the summary turn, only for changes `classifyNextSessionChange` marks `small`, and only while that routine's next session hasn't started.
- `undoAction(actionId)`, `getDecisionEvidence(actionId)`.
- `buildActiveSetView(sessionId)`: adds, per set, `target.source: 'plan' | 'rule' | 'coach'`, `target.planned` (the pre-adjustment target), `adjustmentActionId`; and at session level `coachRequest {turnId, status, coveredSetIds}`, `coachOffer {triggerId, kind, fact, setId}`, `lastAdjustment {actionId, summary, reason, guardNotes}`.
- `calculateNextTargets(history, rule, equipment)`: the built-in comparison value on every coach row, and the target used when the coach is offline, gives no target, or Ben undoes the coach's target (D21). It implements playbook rule 7-F (§4.6).
- `buildWorkoutSummary(sessionId)`: `nextTime[]` with `builtIn`, `coachStatus`, `coachTarget?` (saved by default) and `coachProposal?` (bigger changes), plus `structuralProposal?` (workout-summary §6).
- `buildSetCue`, `cancelObsoleteCues`.

**Proposed new (contracts to add; flagged for the developer and Ben):**

| Function | Why |
|---|---|
| `evaluateCoachTrigger(set, target, thresholds)` → `{triggerId, kind: 'rpe_high' \| 'reps_short' \| 'rpe_low', fact}` or `null` | ADR 0006 trigger checks in `packages/domain`; pure, unit-tested |
| `recordTriggerResponse(triggerId, 'shown' \| 'accepted' \| 'dismissed' \| 'expired')` | Enforces CA4 and keeps evidence for later review |
| `requestCoachAdjustment(sessionId, request, baseVersion, opId)` | Wraps `runCoachTurn` for `adjust_pending_sets`, with `origin: 'ben_request' \| 'trigger_offer' \| 'check_in_offer'` (2026-10-09; the last carries `checkInId` and `intent: 'lighter_session'`) |
| `evaluateCheckInOffer(checkIn, settings)` → `{triggerId, kind: 'check_in_low', fact}` or `null` (2026-10-09) | Pure, `packages/domain`; check-in.md §4.4 and §6 |
| Guard note kinds `lighter_no_increase`, `pain_unspecified` (2026-10-09) | Added to `validateCoachProposal`'s guard-note union |
| `cancelCoachTurn(turnId)` | Cancel and Log-while-pending |
| `setPainFlag(exerciseId, active, note?)` → superseded by coach-memory.md §6 `setPainFlag({exerciseIds[], active, area?, note?, source}, opId)` | `PainStatus` exists in the domain; the UI needs a write path (and `PainFlagEvent` history, progress.md PG13) |
| `Proposal.origin`, `Proposal.guardNotes`, `ActionRecord.reason` + `evidenceRefs` (already in the brief) | Banner, `Why?` and rule 3's "recorded with its reason" |
| `classifyNextSessionChange(before, after, stepCard, context)` → `{size: 'small' \| 'bigger', reasons[]}` (9 Oct, D21) | **Pure, `packages/domain`, unit-tested.** CA8's rules. `context` carries whether Ben asked for more sets or volume (D1) and whether the change is a rule 8 reset or a rule 10 deload |
| `getStructuralChangeSignals(ownerId, routineId, sessionId)` → `[{kind: 'variety_request' \| 'goal_changed' \| 'schedule_changed' \| 'equipment_changed' \| 'pain_flag', fact, at, ref}]` (9 Oct, D21) | **Pure.** CA9. Reads the request log (`classifyCoachIntent` intent `request_variety`), `resolveTrainingContext().versions` against the routine's base context, equipment versions, `session.gymChanges` and pain flags. Its `fact` is the app text after `Because:` |
| `undoAction(actionId, {exerciseId?})` / `reapplyCoachTarget(actionId, exerciseId, expectedVersion, opId)` (9 Oct, D21) | Per-exercise Undo of the summary's single action, and Ben's own `Use coach target` (saved at once, with Undo). Both only until that routine's next session starts |
| `set_next_session_targets` tool, `renderActionResult`, `checkReplyClaims` | [coach-contract.md](coach-contract.md) §6 |

## 7. Acceptance checks

1. **No added taps.** Run the 3 × 3 matching-set workout from flow check 1 with the coach connected and no triggers firing: the tap count is identical to the coach-off run, and no coach UI appears except the `Adjust` control.
2. With airplane mode on, no AI call is made after any set. (Revised 11 Oct, CA6) RPE 10 or a rep miss shows the **built-in rule's** offer with its concrete change and `Rule` tag; nothing changes until `Adjust`.
3. With the coach connected, logging 10 sets with RPE 7–8 and reps on target makes **zero** AI calls (check the provider log).
4. Log bench set 2 at RPE 10: the rest card shows `That looked hard. Adjust remaining sets?` with `RPE 10 on set 2`. Targets for sets 3–4 are unchanged until `Adjust` is tapped. No modal or sheet opens, and nothing is spoken (Set cues mode).
5. Tap `No thanks`, then log set 3 at RPE 10: no new offer. Log set 3 at RPE 6 instead: an easy offer appears (different kind, CA4).
6. Offers never appear on warm-up or drop sets, or while Ready.
7. Say "that was a grind" during rest: the slot shows pending, then `Coach adjusted sets 3–4: 100 → 95 kg × 8 · <reason>`, the next set's draft and Log label read 95 kg, and the rest countdown is unchanged throughout (±1 s).
8. Tap `Undo` on the banner: sets 3–4 show `Target 100 kg × 6–8` again, the coach tags are gone, the rest-end cue (Set cues) says 100.
9. During pending, Log set 3 at once: set 3 saves with the values on the Log button. The coach result never changes set 3. Either the re-sent result changes only set 4, or `Out of date` appears.
10. The coach suggests 96 kg on a barbell with 1.25 kg pairs (95 and 97.5 achievable): after "too hard" the target is 95 kg, after "too easy" it is 97.5 kg; the banner shows `Rounded to 95 kg: …` / `Rounded to 97.5 kg: …`. The stored target is achievable (`getAchievableLoads`).
11. The coach suggests 35 kg each on a 30 kg rack: the target is 30 kg each with `Capped at 30 kg each…`.
12. With a shoulder pain flag on Overhead press, a coach increase is never applied, and the slot shows `Not increasing: you flagged shoulder pain. Sets unchanged.` with no Undo. A decrease still applies.
13. A coach proposal naming a completed set never changes it; the evidence sheet lists `Not changed: set 2 is already done.`
14. After an adjustment, done sets show only actual values. Pending changed sets show `Coach target` + `Plan was …` in Focus, `C` in Overview, and VoiceOver reads both values.
15. An adjustment arriving while Ben is on the Ready card changes the Log label, and Log ignores taps for 1 s afterwards. Normal logging has no such delay.
16. With a draft Ben edited by hand, an adjustment keeps his edit and shows `Your edit kept · Coach target …`.
17. Force-quit during pending and reopen: `Coach request was interrupted. Nothing changed.`; nothing was applied.
18. A timeout or quota error shows the honest message, never a made-up reply, and never uses a paid route.
19. (Revised 11 Oct, CA6) With the coach offline, tapping `Adjust` shows the `Offline` caption and `Too hard` · `Too easy` · `Pain` · `Type…` with no extra line (not connected / unavailable: the same without `Type…`). `Too hard` applies the built-in rule's change to the remaining sets at once with the `Rule` banner and Undo, no AI call; `Pain` still records the flag.
20. Every applied adjustment has a stored reason, evidence refs and guard notes, visible in `Why?` (`getDecisionEvidence`).
21. Coach UI is never colour-only: the `Coach` tag has text, the banner has an icon and text, the offer is text.
22. (2026-10-09) A check-in of 2 shows the check-in offer before the first set; no AI call is made until `Adjust`; nothing is spoken.
23. (2026-10-09) `Adjust` on the check-in offer changes only pending sets of today's session (template unchanged); a test reply that raises one set has that change dropped with `No increases in a lighter session.`
24. (2026-10-09) With `Pain` picked in the check-in and no movement flagged, any coach increase in that session is dropped with `Not increasing anything today: you mentioned pain.`
25. (2026-10-09) The check-in offer and a set-trigger offer never show together; the set offer replaces the check-in offer, which is then recorded as `expired`.
26. (9 Oct, D21) Finish a workout with the coach connected: exactly one coach call is made, and its small changes are saved with no tap. Starting that routine next time plans the coach's targets, and the set card's `Why?` row `Set by` reads `Coach · after Push A, 8 Oct` (active-workout §2.12).
27. (9 Oct, CA8) Unit tests for `classifyNextSessionChange`: 100 → 97.5 kg on a 2.5 kg-step bar is `small`; 100 → 90 kg is `bigger`; 10 → 12 kg dumbbells (the next step, +20%) is `small` and shows `+20%`; 8–10 → 8–12 reps is `small`; 8–10 → 12–15 is `bigger`; 4 → 3 sets is `small`; 3 → 4 sets is `small` only when Ben asked for more sets, otherwise dropped (D1); a rule 8 reset and a rule 10 deload are `bigger`; any change to exercise, order or rest is `bigger`; any change to a `Fixed` load is `bigger`.
28. (9 Oct) A `bigger` coach target is never saved without Apply: the next session uses the built-in rule's target until Ben taps Apply.
29. (9 Oct) With a pain flag on Overhead press, no coach increase for it is saved, by default or by Apply.
30. (9 Oct, CA9) With no request and no signal, the summary turn's tool list has no structural proposal tool, and no structural card appears. After Ben says "give me some variety on Push A" (or a pain flag, a goal or days change, or a gym switch in the workout), one card can appear with the matching `Because:` line.
31. (9 Oct, CA10) Tap `Done` while the coach is still working: the answer's small changes are saved when it arrives, appear in that summary in history with Undo, and are dropped if Push A has started again first.
32. (9 Oct) `Undo` on one row restores the built-in rule's target for that exercise only; the other coach targets stay. `Use coach target` restores the coach's. After the next Push A starts, neither button is offered on the summary.
33. (9 Oct, coach-contract) Every number in a saved row, banner or spoken cue equals the saved `ActionRecord`'s value; the model's raw numbers appear only in `Why?`.
34. (11 Oct, build 108) Built-in rule 62.5 kg × 3–6, log 2 reps: an offer appears in every connection state: the coach's when reachable, the rule's (`Next sets: 57.5 kg × 3–6`, `Rule`) when not signed in or offline. `Adjust` on the rule's offer changes sets 2–3 only, set 1 keeps its actual 2 reps, Undo restores 62.5 kg, a double tap applies once, and the change survives a force-close.
35. (11 Oct) The rule's change is refused as `Out of date` if the workout moved on so that the change no longer matches what was shown; nothing is applied to newer state.
36. (11 Oct) Correcting a logged set from 6 to 2 reps offers on return to the workout (F4).
37. (11 Oct) After a session below the range floor, the Summary lists the hold (`Same target: …`, `Rule`); a second such session at the same load lists `Target 55 kg × 3–6` (7-F).
38. (11 Oct, target RPE) Every working set's target line ends `@ RPE n`: 8.5 on a main barbell lift with the built-in plan, the routine's or coach's value when set, Ben's when he set one. Warm-ups and drop sets show none.
39. (11 Oct, target RPE) `⋯` → `Target RPE` → `RPE 10` → `This exercise`, then log RPE 10 with full reps: no offer. Set `RPE 8`, log RPE 10: `RPE 10 on set 2 (target 8)` offers; with the coach unreachable the rule's change is 5% lighter, rounded down. A stale version is refused; a double tap applies once.
40. (11 Oct, r3 N3/N5) An effort chip after a rep miss keeps the showing offer while it still holds and removes it once effort is ≤ target − 1. Two quick `Too hard` taps with no coach apply one change.
