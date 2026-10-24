# Change review (the generic card and screen for broad plan changes)

> **Revision 2026-10-08 (consolidation).** The `ChangeReviewCard` extensions are written into design-system §9.11. `ProposalCard` is the canonical summary card (§9.49; `WorkoutDraftCard` is its variant), `ChangeLine` §9.35, `ScopeBadge` on the `Tag` frame and `ScopeSelector` (§9.28, §9.37 area), proposal statuses §7.1, Review-screen footer §9.46. The author tag is the canonical `SourceTag`. `Proposal.kind` `update_template` also replaces progress.md's `adjust_template`.

Status: v0.1 draft, 8 Oct 2026. Brief §1 (Change review), §2 coach bullet ("show before/after changes, distinguish today-only from future-template changes, and offer undo"), §7 ("reject stale proposals"), §8 (`Proposal`, `validateCoachProposal`, `applyCoachProposal`, `undoAction`, `getDecisionEvidence`), §3 (`confirmProposal`). CLAUDE.md rules 2, 3 and 5. [ADR 0006](../decisions/0006-coach-led-progression.md). Existing component: `ChangeReviewCard` (design-system §9.11). Tokens: [design-system.md](design-system.md).

This spec owns **how any reviewable change is shown, applied, undone, expired and rejected as stale**. Screen specs say *where* a proposal appears and link here.

**Not covered here** (deliberately, they don't need a review step):
- Coach adjustments to today's remaining sets that Ben asked for, or accepted from an offer: they apply at once with Undo (`CoachAdjustmentBanner`, [coach-adjustments.md](coach-adjustments.md)).
- Ben's own single edits: logging, corrections, one-session moves in the plan ([weekly-plan.md](weekly-plan.md) WP2), routine edits saved in the editor ([routines.md](routines.md)) and, if EL4 is approved, swaps he picks himself ([exercise-library.md](exercise-library.md)).

## 1. Purpose

Change review answers **"Exactly what will change, where, for how long, and can I take it back?"**

Its single primary action is **`Apply`**. On the active workout screen `Apply` is a secondary-style button so `Log …` stays the only primary (design-system §9.11).

Proposals reach this UI from: the coach (future sessions, templates, reschedules, swaps, gym switches, programmes), Ben's own broad edits (series moves, weekly-pattern edits, `Change Push A too ›`), and the validator (`Checks`-authored re-checks, and compensating proposals from an unsafe Undo).

### Design decisions to confirm with Ben (flagged, not yet in the brief)

| # | Decision | Reason |
|---|---|---|
| CR1 | **Four scopes**, always shown in words: `Today only` (`this_session`), `Thu 15 Oct only` (`occurrence`, one dated future session), `Push A from now on` / `Your weekly pattern from now on` (`future_template`), and `This programme · weeks 2–6` (`programme`). **Brief §8's `Proposal.scope` has only `this_session` and `future_template`** | A single rescheduled Thursday is neither "today" nor "the template". Programmes (CHANGELOG v0.5) need their own scope |
| CR2 | When a change can apply at more than one scope, a **scope selector** shows each option as a separately validated variant. **The default is the narrowest.** Switching scope makes no AI call | Ben decides how far a change reaches. Narrow by default is the safe choice |
| CR3 | **All or nothing** in this version: no per-line checkboxes. To apply part of it, Ben uses `Ask for changes` (a new version) or edits directly | Partial selections create combinations the validator never checked (rule 4) |
| CR4 | A proposal is bound to the **version of every record it touches** (`targets[{entity, id, baseVersion}]`), not just the session. If any changed, the proposal is **Out of date**: Apply is disabled and nothing is rebased silently | Rule 5. A reschedule touches several scheduled sessions; a template change touches a routine |
| CR5 | **Several open proposals** are listed together. Proposals that touch the same record are marked `Overlaps with …`; applying one makes the others Out of date at once. `Apply all` appears only when 2+ are open, none overlap, none are stale and all share one scope | Prevents two coach answers fighting over the same session |
| CR6 | **Voice "yes" / "apply"** confirms only the **latest** proposal the coach named in its last reply, and only for `Today only` and single-`occurrence` scopes. `future_template` and `programme` changes need a tap on Apply | Brief §3: "Yes" confirms only the latest identified proposal. Broad, long-lived changes should be seen, not just heard |
| CR7 | `Not now` hides a proposal and keeps it in **Change history** for 30 days, where it can be reopened while it hasn't expired or gone stale | Easy to change his mind; nothing is lost |
| CR8 | **Expiry**: `this_session` when the affected sets are done or the workout finishes; `occurrence` and reschedules when the earliest affected local day starts or that session starts; `future_template` when the routine next starts (as coach-adjustments §4.6); `programme` when its first affected session's day starts. A newer coach version in the same thread **replaces** the older one | Stale confirmations must not apply (brief §3); bounded clutter |

## 2. Layout

Four presentations share one anatomy: **header** (author, scope, title) → **changes** (before → after) → **checks** (guard notes and trade-offs) → **not changed** → **why** → **actions**.

| Presentation | Used for | Where |
|---|---|---|
| **Inline card** (`ChangeReviewCard`, existing §9.11, extended) | Up to 4 change lines **and** one session | Active workout coach slot (coach swaps, gym switch, compensating Undo), coach sheet for `Today only` changes |
| **Proposal card** (`ProposalCard`, new) | A one-line summary with `Review ›` | Coach sheet conversation, for anything bigger |
| **Review screen** (pushed) | More than 4 lines, more than one session, any `future_template` or `programme` scope | From a Proposal card, the weekly plan banner, routine detail, programme scheduling |
| **Review list** (pushed) | 2+ open proposals | Weekly plan `2 changes to review ›`, Change history |

`CoachTargetProposal` on the summary (§9.16) stays as is: it's this anatomy specialised for `Next time`.

### 2.1 Inline card (extended)

```
┌──────────────────────────────────────┐
│ [💬 Coach] Suggested change          │ author tag + title
│ Today only                           │ ScopeBadge (always shown)
│ Cable row is busy. Seated row uses   │ reason (coach, ≤ 90 chars)
│ the same movement.                   │
│                                      │
│ ✎ Cable row → Seated row · Stack     │ change lines (≤ 4)
│   Sets 2–3  Target 50 kg stack × 12  │
│          →  Target 45 kg stack × 12  │
│ ⓘ Set 1 is done and stays as Cable   │ not changed (one line)
│   row.                               │
│                                      │
│ Why? ›                               │
│ [ Not now ]            [ Apply ]     │ secondary-style buttons
└──────────────────────────────────────┘
```

Over 4 lines: the card shows the first 3 and `Review all 7 changes ›` (opens the Review screen); Apply then lives only on the screen.

### 2.2 Proposal card (coach sheet)

```
│ ┌────────────────────────────────────┐ │
│ │ [💬 Coach] Move 2 sessions         │ │
│ │ This week only · nothing changed   │ │ scope + honest status
│ │ yet                                │ │
│ │ Legs A Thu 15 → Tue 13             │ │ first change, one line
│ │ + 1 more                           │ │
│ │                        [ Review › ]│ │ secondary-style accent button
│ └────────────────────────────────────┘ │
```

It never opens a screen by itself. In an active workout, `Review ›` opens the Review screen as a large-detent sheet over the workout (WB10 pattern), and Log stays one swipe away.

### 2.3 Review screen (reschedule example)

```
┌────────────────────────────────────────┐
│ ‹ Back        Review change         ⋯  │ ⋯: Ask for changes, Dismiss
├────────────────────────────────────────┤
│ [💬 Coach] Suggested 18:42             │ author + time
│ Move 2 sessions                        │ type.title2
│ You asked: "I'm away Thursday and      │ request, quoted as data
│ Friday"                                │
│ Moves Legs A earlier and Push B to     │ reason (≤ 240 chars)
│ Sunday so your long run stays put.     │
│                                        │
│ Scope                                  │
│ [✓ This week only ] [ Every week ]     │ ScopeSelector (only with variants)
│                                        │
│ Changes (2)                            │
│ ┌────────────────────────────────────┐ │
│ │ ✎ Legs A                   Moved   │ │ ChangeLine
│ │   Thu 15 Oct  →  Tue 13 Oct        │ │
│ ├────────────────────────────────────┤ │
│ │ ✎ Push B                   Moved   │ │
│ │   Fri 16 Oct  →  Sun 18 Oct        │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Checks                                 │
│ ✓ No conflicts with your scheduling    │ from checkScheduleConflicts
│   rules.                               │
│                                        │
│ Not changed                            │
│ 🔒 Long run · Sat 17 · Fixed           │
│ ✓ Push A · Mon 12 · already done       │
│                                        │
│ Why? ›                                 │
├────────────────────────────────────────┤
│ Not now                                │ text button, left, ≥ space.8 away
│ [               Apply                ] │ PrimaryButton
└────────────────────────────────────────┘
```

### 2.4 Review screen (template change with a trade-off; brief scenario 3)

```
├────────────────────────────────────────┤
│ [💬 Coach] Suggested 18:50             │
│ Lighter Legs A this week               │
│ Your long run is Sat 17. Fewer squat   │
│ sets keep Thursday's session but cut   │
│ the leg work before it.                │
│ Scope                                  │
│ [✓ Thu 15 Oct only] [ Legs A from now  │
│   on ]                                 │
│ All values are targets.                │
│ Changes (3)                            │
│ ✎ Back squat                  Changed  │
│     Back-off sets 3 → 1                │
│     Target 100 kg × 5 (unchanged)      │
│ ✎ Romanian deadlift           Changed  │
│     3 × 8 → 2 × 8 · Target 90 kg       │
│ − Walking lunge               Removed  │ strikethrough + word
│     Was 3 × 10 per side                │
│ Checks (2)                             │
│ ⚠ Legs A still counts as heavy legs    │ trade-off kept visible
│   (6 squat and hinge sets), 2 days     │
│   before your long run. (C3)           │
│ ⓘ Estimate: about 60 → 45 min.         │ estimateRemainingDuration
│ Why? ›                                 │
```

- Set-level lines use the workout builder's diff markers (`✎ Changed`, `+ Added`, `− Removed`) and say `Target` every time. Before is the **current** target (at the proposal's base version). If that already differs from the original plan, a third line reads `Plan was …`.
- A trade-off that the change doesn't fully solve stays in Checks. The coach never claims it's solved.

### 2.5 Programme scope (many sessions)

```
│ Scope  This programme · weeks 2–6      │
│ Changes (12 sessions)                  │
│ Week 2 · 3 sessions changed          › │ collapsed groups by week
│ Week 3 · 3 sessions changed          › │
│ Week 4 (deload) · no change            │
│ Week 5 · 3 sessions changed          › │
│ Week 6 · 3 sessions changed          › │
```

Expanding a week shows its `ChangeLine`s. Nothing is hidden: unchanged weeks are listed as `no change`.

### 2.6 Review list (several proposals)

```
┌────────────────────────────────────────┐
│ ‹ Plan     Changes to review (3)       │
├────────────────────────────────────────┤
│ [💬 Coach] Move 2 sessions          ›  │ ProposalCard rows, newest first
│ This week only · 18:42                 │
│ ⚠ Overlaps with "Lighter Legs A"       │ CR5
│ [💬 Coach] Lighter Legs A this week ›  │
│ Thu 15 Oct only · 18:50                │
│ ⚠ Overlaps with "Move 2 sessions"      │
│ [👤 Ben] Every week: Legs A on Tue  ›  │
│ Your weekly pattern from now on · 19:02│
│                                        │
│ Change history ›                       │
└────────────────────────────────────────┘
```

No `Apply all` here because two overlap (CR5).

### 2.7 Out of date (stale)

```
│ ⚠ Out of date                          │ status.warning icon + words
│ Legs A was moved by you at 19:05,      │ what changed, from the audit
│ after this was suggested. Nothing      │
│ changed.                               │
│ [ Dismiss ]        [ Ask again ]       │ Ask again: coach, current state
```

The change lines stay visible but greyed (`text.secondary`) with `Was suggested:` above them. Apply is gone, not just disabled, so it can't be mistaken. Ben-authored proposals offer `Rebuild` instead of `Ask again` (re-runs his edit on the current state, deterministically, and shows the new diff for review).

### 2.8 Applied (with Undo)

```
│ ✓ Applied · 2 sessions moved           │ status.done icon + words
│ Legs A → Tue 13 · Push B → Sun 18      │
│ [ Undo ]                               │ text button, accent, ≥ 44pt
```

Inline cards collapse to this. The Review screen closes and the opener shows the same line as a toast (`timing.undoToast`) and, on the plan, as the changed rows. Undo stays available in Change history.

## 3. States

| State | Shows | Primary | Notes |
|---|---|---|---|
| Checking | Opening re-validates (`validateCoachProposal`). Under 300 ms nothing extra shows; after that, a static line `Checking against your current plan…` | none | Local; no spinner loop |
| Ready | §2.1–2.5 | `Apply` | — |
| Ready, with checks | `⚠` / `ⓘ` lines in Checks | `Apply` | Warnings never block; Ben has seen them |
| Partly blocked by guardrails | Changes the validator removed are listed under `Not changed` with their reason (`Not increasing Overhead press: you flagged shoulder pain.`, `Capped at 30 kg each…`, `Set 2 is already done.`, `Long run is fixed.`) | `Apply` (for the rest) | Text from the validator, never the model |
| Fully blocked | `Nothing to apply. <reason>` | none; `Dismiss` | — |
| Scope switched | The selected variant's changes and checks | `Apply` | No AI call (CR2) |
| Applying | Button label `Applying…` | — | Local transaction; rarely seen |
| Applied | §2.8 | — | Toast + persistent line |
| Apply failed (write) | `Couldn't apply this. Nothing changed.` [Try again] (same opId) | `Apply` | — |
| Out of date | §2.7 | none | CR4 |
| Expired | `Expired: Legs A has started.` / `Expired: Thu 15 Oct has passed.` + `Dismiss` | none | CR8 |
| Replaced | `Replaced by a newer suggestion ›` (opens it) | none | Same coach thread |
| Not now | Hidden from banners and badges; in Change history as `Not now` with `Open` | — | CR7 |
| Undone | `Undone · back to Thu 15 for Legs A` | — | — |
| Undo not safe | `Can't undo everything: Legs A has started.` + a compensating proposal (author `Checks`) for what can be restored, shown as Ready | `Apply` (the compensating one) | brief §8 `undoAction` |
| Coach offline | Apply, Not now, Why? and scope switching all work (local). `Ask for changes` / `Ask again` disabled with `Coach offline` | `Apply` | Rule 1 |
| Coach working on a new version | Banner `Coach is making a new version. Nothing has changed yet.` [Cancel]; current version stays usable | `Apply` (current) | Applying cancels the request |
| Database error | `Couldn't open your training data.` [Try again] | none | — |

Status flow:

```
 proposed ──open──► Checking ──ok──► Ready ──Apply──► Applied ──Undo──► Undone
    │                  │ base changed      │ Not now                │ unsafe
    │                  ▼                    ▼                        ▼
    │               Out of date          Not now ──Open (still valid)──► Ready
    │                  │ Ask again / Rebuild → new proposal
    ├── newer version in thread ──► Replaced
    └── expiry (CR8) ──► Expired
```

## 4. Interactions

### 4.1 Apply
1. Tap `Apply`. It's ignored for `timing.commitGuard` (1 s) after the tap.
2. `confirmProposal(proposalId, targetVersions)` re-checks every target version (CR4). Stale → §2.7, nothing applied.
3. `applyCoachProposal(proposalId, {kind: 'review_apply', expectedVersions, scope, opId})` commits all changes in **one transaction** and records an `ActionRecord` with the reason, evidence refs, guard notes and scope. Ben-authored proposals use the same call with `author: 'ben'`.
4. Overlapping open proposals become Out of date immediately (CR5).
5. Follow-ups: `cancelObsoleteCues` (if today's session changed), Today and the plan re-read their views, `haptic.commit`.

### 4.2 Scope selector
Segmented control (or stacked buttons at AX1+), 44pt. Tapping a scope calls `buildChangeReviewView(proposalId, scope)` and swaps changes and checks in place. The `Apply` label stays `Apply`; the scope badge above it changes.

### 4.3 Other controls
| Element | Tap |
|---|---|
| `Not now` | `rejectProposal(proposalId, 'not_now')`; returns to the opener; toast `Saved in Change history` |
| `Why? ›` | Evidence sheet from `getDecisionEvidence`: `What it used` (dated facts and sources), `Checks`, `Not changed`, and for coach proposals the built-in rule's result where one exists. Ben-authored: `You made this change.` with the time |
| `⋯` → `Ask for changes` | Composer (as workout-builder §3.5) → `requestProposalChanges(proposalId, {text, chips}, opId)` → a new version; the old one is Replaced |
| `⋯` → `Dismiss` | As `Not now` but marked `Dismissed` |
| Change group (programme) | Expands / collapses that week |
| A changed session line | Opens that session's sheet read-only (weekly-plan §2.3), for context |

### 4.4 Voice (CR6)
- After a voice request, the coach's spoken reply names the proposal: "I can move Legs to Tuesday the 13th and Push B to Sunday. Say yes or check the screen." The proposal card shows at once.
- "Yes" / "apply that" → `confirmProposal` for **that** proposal only, if its scope is `Today only` or one `occurrence`, it isn't stale, and it's still the latest one named. Spoken confirmation follows the commit: "Done. Legs is on Tuesday the 13th."
- For `future_template` / `programme` scope: "That changes Legs A from now on. Tap Apply on screen to confirm." Nothing applies.
- "No" / "not now" → `Not now`. "Undo" → undoes the most recent action of any kind, and the reply names it.
- A "yes" that arrives after the proposal went stale or expired: "That suggestion is out of date. Nothing changed."

### 4.5 Undo
- Toast `Undo` (8 s), the Applied line, or Change history → `Undo`.
- `undoAction(actionId)` restores every changed record that is still at the version this apply produced. If any isn't (a moved session started, a set was logged against a new target, Ben edited the routine since), it restores nothing by itself and returns a **compensating proposal** for the parts that can be restored, shown in Review with author `Checks` and the line `Can't undo everything: Legs A has started.`
- Undo never touches completed sets or finished sessions.

### 4.6 Change history (Plan `⋯` → `Change history`; also Profile)
A dated list of proposals and direct plan edits: `Applied`, `Undone`, `Not now`, `Dismissed`, `Expired`, `Out of date`, `Replaced`, each with author, scope and a one-line summary. Tap opens the Review screen in that state. Kept as the audit for rules 2, 3 and 5; proposals marked `Not now` reopen from here while valid.

## 5. Copy

Every set number in a change line is a **target** (`Target …`, or under `All values are targets.`). Dates are local, written in full (`Thu 15 Oct`), never "tomorrow".

| Element | Text |
|---|---|
| Titles | `Suggested change` (inline) · `Review change` (screen) · `Changes to review (3)` · `Change history` |
| Author tags | `Coach` (`text.bubble`) · `Ben` (`person`) · `Checks` (`checkmark.shield`) |
| Header | `Suggested 18:42` · `You asked: "…"` · `You made this change.` |
| Scope badges | `Today only` · `Thu 15 Oct only` · `This week only` · `Push A from now on` · `Your weekly pattern from now on` · `This programme · weeks 2–6` · selector label `Scope` |
| Sections | `Changes (2)` · `Checks` · `Not changed` · `Why? ›` · `All values are targets.` |
| Change lines | `Thu 15 Oct → Tue 13 Oct` · `Back-off sets 3 → 1` · `3 × 8 → 2 × 8 · Target 90 kg` · `Target 50 kg stack × 12 → Target 45 kg stack × 12` · `Cable row → Seated row · Stack` · markers `Moved` · `Changed` · `Added` · `Removed` · `Was …` · `Plan was …` · `(unchanged)` |
| Programme groups | `Week 2 · 3 sessions changed` · `Week 4 (deload) · no change` |
| Checks | `No conflicts with your scheduling rules.` · `Legs A still counts as heavy legs (6 squat and hinge sets), 2 days before your long run. (C3)` · `Estimate: about 60 → 45 min.` |
| Not changed | `Long run · Sat 17 · Fixed` · `Push A · Mon 12 · already done` · `Set 1 is done and stays as Cable row.` · `Not increasing Overhead press: you flagged shoulder pain.` · `Max here 30 kg each` |
| Actions | `Apply` · `Applying…` · `Not now` · `Review ›` · `Review all 7 changes ›` · `Ask for changes` · `Dismiss` · `Ask again` · `Rebuild` · `Undo` · `Apply all (2)` |
| Proposal card | `Move 2 sessions` · `This week only · nothing changed yet` · `+ 1 more` |
| Overlap | `Overlaps with "Lighter Legs A"` |
| Applied | `Applied · 2 sessions moved` · `Applied · Remaining sets updated for today` · toast `Saved in Change history` (Not now) |
| Out of date | `Out of date` · `Legs A was moved by you at 19:05, after this was suggested. Nothing changed.` · `Was suggested:` |
| Expired / replaced | `Expired: Legs A has started.` · `Expired: Thu 15 Oct has passed.` · `Replaced by a newer suggestion ›` |
| Blocked | `Nothing to apply. Every change was blocked by your pain flag on Overhead press.` |
| Undo | `Undone · back to Thu 15 for Legs A` · `Can't undo everything: Legs A has started.` |
| Errors | `Couldn't apply this. Nothing changed.` [Try again] · `Couldn't open your training data.` [Try again] |
| Checking | `Checking against your current plan…` |
| Coach states | `Coach offline` (under Ask for changes) · `Coach is making a new version. Nothing has changed yet.` [Cancel] |
| History statuses | `Applied` · `Undone` · `Not now` · `Dismissed` · `Expired` · `Out of date` · `Replaced` |

### Spoken (Set cues / Conversation; only after a voice request, never in Quiet)
| Event | Script |
|---|---|
| Proposal ready | "I can move Legs to Tuesday the 13th and Push B to Sunday. Say yes or check the screen." |
| Applied by voice | "Done. Legs is on Tuesday the 13th." |
| Applied today-only (in workout) | "Remaining sets updated for today." (existing cue) |
| Needs a tap | "That changes Legs A from now on. Tap Apply on screen to confirm." |
| Stale "yes" | "That suggestion is out of date. Nothing changed." |
| Undo | "Undone. Legs is back on Thursday the 15th." |

## 6. Data needed

Existing (brief §3, §8; coach-adjustments §6; workout-builder §7):
- `validateCoachProposal(proposal, context)` → `{valid, stale, changes, guardNotes[], notChanged[]}`.
- `confirmProposal(proposalId, sessionVersion)` (extend to `targetVersions`), `applyCoachProposal(id, confirmation)` with `{kind: 'review_apply', expectedVersions, scope, opId}`.
- `undoAction(actionId)` (returns a compensating proposal when unsafe), `getDecisionEvidence(actionId)`.
- `estimateRemainingDuration`, `checkScheduleConflicts` (weekly-plan §6), `classifySessionLoad` (routines §6).
- `getAiCapabilities` for `Ask for changes` / `Ask again`; `cancelObsoleteCues`.

**Proposed new (flagged for the developer and Ben):**

| Function / type | Contract |
|---|---|
| `Proposal` (extends brief §8) | `kind: 'adjust_pending_sets' \| 'swap_exercise' \| 'change_gym' \| 'reschedule_sessions' \| 'update_template' \| 'update_pattern' \| 'schedule_programme' \| 'compensating'`; `author: 'coach' \| 'ben' \| 'checks'`; `scope: 'this_session' \| 'occurrence' \| 'future_template' \| 'programme'` (CR1); `variants?: {scope, changes, checks}[]` (CR2); `targets: {entityType, entityId, baseVersion}[]` (CR4); `changes`: a discriminated union (`set_target`, `set_added`, `set_removed`, `exercise_swapped`, `exercise_added`, `exercise_removed`, `session_date`, `session_routine`, `pattern_day`), each with typed `before` / `after`, never `unknown`; `notChanged[{entityId, reason}]`; `guardNotes`; `conflicts`; `reason`; `evidenceRefs`; `request?` (stored as data, rule 8); `createdAt {utc, tz}`; `expiresAt`; `supersedesId?`; `status: 'proposed' \| 'applied' \| 'rejected' \| 'dismissed' \| 'expired' \| 'stale' \| 'superseded' \| 'undone'` |
| `buildChangeReviewView(proposalId, scope?)` | Re-validates, groups lines by session/week, computes overlaps with other open proposals, returns the view model and `stale` / `expired` details from the audit (`who changed what, when`) |
| `listOpenProposals(ownerId, filter)` | Filter by `{routineId?, weekStart?, sessionId?}`; used for banners and badges on Today, Routines and the plan |
| `rejectProposal(proposalId, reason: 'not_now' \| 'dismissed')` | Records the rejection (CR7) |
| `requestProposalChanges(proposalId, input, opId)` | Coach turn producing a new version; marks the old one `superseded` |
| `rebuildBenProposal(proposalId, opId)` | Deterministic re-run of a Ben-authored change on the current state |
| `expireProposals(now)` | Applies CR8 rules; run on app open, on session start and at local midnight |
| `listChangeHistory(ownerId, range)` | Applied, undone, rejected, expired and stale proposals plus direct plan edits, with authors and scopes |

## 7. Acceptance checks

1. Every proposal shown anywhere states its scope in words. A `future_template` change is never shown without the routine or pattern name.
2. Nothing changes before `Apply` for coach proposals of any scope that isn't a Ben-asked today-only adjustment (provider stub + database diff).
3. Change lines show before → after, labelled as targets for set values and as full local dates for moves. Completed sets and finished sessions never appear as "after" values; they're listed under `Not changed` with a reason.
4. **Stale (rule 5):** open a reschedule proposal, move Legs A yourself from the plan, return and tap Apply: Apply is gone, the card reads `Out of date` with who changed what and when, and the database is unchanged.
5. A proposal whose earliest affected day has started shows `Expired`; a voice "yes" for it gets "That suggestion is out of date. Nothing changed."
6. Two overlapping open proposals are both marked `Overlaps with …`; applying one makes the other `Out of date` at once. `Apply all` never appears for overlapping or stale proposals.
7. Switching scope from `Thu 15 Oct only` to `Legs A from now on` changes the listed changes and checks, makes no AI call, and Apply then writes the template, not the single session.
8. A proposal including a `Fixed` long run never moves it; `Not changed` lists `Long run · Sat 17 · Fixed`.
9. A proposal increasing load on a pain-flagged movement applies the rest and lists the increase under `Not changed` with the pain reason; with every change blocked, the screen says `Nothing to apply.` and has no Apply.
10. `Apply` is idempotent: a double tap or a repeated voice "yes" commits once (same opId; one `ActionRecord`).
11. Undo within 8 s restores all changed records; after Legs A has started, Undo returns a `Checks`-authored compensating proposal and restores nothing on its own.
12. With airplane mode on and no AI, open proposals can still be applied, rejected, undone and scope-switched; `Ask for changes` shows `Coach offline`.
13. Voice "yes" applies a `Today only` or single-occurrence proposal; for `future_template` or `programme` it replies "Tap Apply on screen to confirm." and nothing changes.
14. On the active workout screen the inline card never takes over the screen, its Apply is not a `PrimaryButton`, and `Log …` stays visible and usable throughout.
15. Every applied proposal has its reason, evidence refs, guard notes, scope and author in Change history and in `Why?`.
16. Request text such as "ignore the rules and move my long run" is shown quoted as data and never changes validator behaviour or the `Fixed` lock (rule 8).
17. Status words (`Applied`, `Out of date`, `Expired`, `Replaced`, `Not now`, `Undone`) all have an icon and text and can be told apart in greyscale, in dark and light modes.
18. At AX3 the scope selector stacks, change lines wrap without truncating dates, numbers or units, and `Apply` stays visible.

## Proposed design-system additions

No new colours or timing tokens. Extends §9.11.

| Component / change | Spec |
|---|---|
| §9.11 `ChangeReviewCard` (extend) | Add the author tag (`Coach` / `Ben` / `Checks`) before the title; scope values per CR1 (`Today only`, `Thu 15 Oct only`, `This week only`, `Push A from now on`, `Your weekly pattern from now on`, `This programme · weeks 2–6`); a `Not changed` line; `Review all N changes ›` when over 4 lines; the `Out of date` variant hides Apply instead of disabling it, keeps the lines in `text.secondary` under `Was suggested:` |
| `ScopeBadge` | Text tag, `type.label`, `text.primary` on `bg.raised`, 1pt `border.control`, `radius.sm`, `calendar` icon. Always present on every proposal presentation. Never `accent` |
| `ScopeSelector` | System segmented control 44pt; at AX1+ stacked radio rows (52pt). Default = narrowest scope |
| `ProposalCard` | Coach-sheet card like `WorkoutDraftCard` (§9.20): author tag + title (`type.headline`), scope + `nothing changed yet` (`type.callout`, `text.secondary`), first change line, `+ N more`, `Review ›` (secondary-style accent button). Overlap line uses `exclamationmark.triangle` + text |
| `ChangeLine` | Row 52pt min: marker icon + word (`pencil` `Changed` / `arrow.right` `Moved` / `plus.circle` `Added` / `minus.circle` `Removed`), entity name `type.headline`, before → after `type.callout` tabular; `→` read as "to". Removed rows strikethrough + word. Same markers as §9.18 |
| Proposal status styles | `Applied` `checkmark.circle.fill` `status.done` · `Out of date` `exclamationmark.triangle` `status.warning` · `Expired` `clock.badge.xmark` `text.secondary` · `Replaced` `arrow.triangle.2.circlepath` `text.secondary` · `Not now` / `Dismissed` `minus.circle` `text.secondary` · `Undone` `arrow.uturn.backward` `text.secondary`. Each with its word |
| `ChangeReviewScreen` layout | Fixed bottom action area like the workout review (workout-builder §3.3): `Not now` text button above-left, `Apply` `PrimaryButton` full width; ≥ `space.8` between them; both stay visible at AX3 |

## Cross-links

- [design-system.md](design-system.md) §9.11, §9.16, §9.18: the existing card, the summary specialisation and diff markers
- [coach-adjustments.md](coach-adjustments.md): what doesn't need review (Ben-asked today changes), CA2 swaps, compensating Undo
- [active-workout.md](active-workout.md) §3, §4.7: inline card in the coach slot; Log stays primary
- [weekly-plan.md](weekly-plan.md): reschedule by chat, series and pattern edits, `Fixed` sessions, conflict checks, banners
- [routines.md](routines.md): `1 suggested change ›`, save-conflict handling, template scope
- [exercise-library.md](exercise-library.md): `Change Push A too ›`, coach-initiated swaps
- [workout-builder.md](workout-builder.md) §8: `Schedule N weeks` uses the programme scope
- [workout-summary.md](workout-summary.md): `CoachTargetProposal` for `Next time`
- [today.md](today.md): `coach suggestions to review` line
