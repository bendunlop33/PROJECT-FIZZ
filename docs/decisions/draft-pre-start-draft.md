# Draft ADR: the pre-start draft (today's edits before a workout exists)

**Status:** Draft, 11 Oct 2026 (designer). Not numbered. **Needs Ben's go-ahead** before a developer picks it up. It adds a table, a migration and a `startWorkout` input. Design: [overview-today-edits.md](../design/overview-today-edits.md). Builds on [workout-overview.md](../design/workout-overview.md) §6–§7 and ADR 0019 (`snapPlanToGym`, intended vs fitted).

## Context

The workout overview opens before any session exists (OV1). Ben wants to change today's plan there: swap an exercise, skip one, change the order, or take a lighter start after a break. Those edits need somewhere to live between the first tap and `Start`, and they must:
- leave the overview's preview equal to what Start creates (OV3);
- be versioned with op IDs, and never be applied to newer state (rule 5);
- survive a force-close;
- never touch the routine template (rule 2; template changes go through change-review);
- stay achievable at the selected gym, which can change on the page (rule 4);
- respect pain flags (rule 9).

## Decision (proposed)

### 1. A `PreStartDraft` record, separate from sessions

```ts
type DraftBasis =
  | { kind: 'routine'; routineId: string }
  | { kind: 'next'; sourceSessionId: string };      // "next session" of a non-routine workout

interface PreStartDraft {
  id: string;
  ownerId: string;
  basis: DraftBasis;                                // one open draft per (owner, basis)
  status: 'open' | 'consumed' | 'discarded' | 'expired';
  sessionId?: string;                               // set when consumed
  edits: TodayEdit[];                               // append-only; Undo marks, never deletes
  version: number;                                  // bumped by every write
  createdAtUtc: string; updatedAtUtc: string; tz: string;
  expiresAtUtc: string;                             // end of the local day of the last edit
}

type TodayEditBase = { editId: string; opId: string; atUtc: string;
                       removed?: { atUtc: string; opId: string; why: 'undo' | 'reset' | 'stale' | 'redundant' } };

type TodayEdit = TodayEditBase & (
  | { kind: 'swap'; slotKey: string; toExerciseId: string }
  | { kind: 'skip'; slotKey: string }
  | { kind: 'order'; slotKeys: string[] }           // the full order; a newer one replaces (removes) the older
  | { kind: 'lighter_start'; author: 'rule' | 'coach'; ruleRef: 'R2'; gapDays: number;
      coachActionId?: string;
      changes: { slotKey: string; beforeIntended: Load; afterIntended: Load }[] }
);
```

- **`slotKey`** is the `RoutineExercise` id (routine basis) or the source session's part-root exercise id (next basis). Edits never point at array positions.
- **Intent, not fitted numbers.** A swap stores the exercise. A lighter start stores **intended** loads (before fitting), so a gym change re-fits it like any target (GS2) instead of making it stale.
- **Your data.** Drafts are owner-scoped, exported and deleted with Your data, and are never in coach context before Start (rule 10).

### 2. One pure function applies edits; the fit runs after it

`applyTodayEdits(plan, edits, ctx)` (`packages/domain`) runs on the unfitted dry-run plan, then `snapPlanToGym` (mode `start`) fits the result. Each open edit gets an outcome: `applied`, `stale`, `redundant` or `blocked`.
- A lighter start is `stale` (all or nothing, CR3) if any slot's current intended target ≠ `beforeIntended`.
- An `order` edit is `stale` if its slot set no longer matches the plan.
- A swap whose slot is gone is `stale`. A swap that now equals the template is `redundant`.

Stale and redundant edits are marked `removed` on the next write, and the UI says `Plan changed · 1 edit removed` for stale ones.

### 3. Lifecycle

- **Created** by the first edit (`services.overview.edit` with `expectedDraftVersion: null`).
- **Every write** carries an `opId`, and an `expectedDraftVersion`. A repeated `opId` returns the current draft. A version mismatch is rejected (`stale_draft`).
- **Close keeps it** (pending Ben).
- **Consumed** by `services.workout.start({…, draft: {id, expectedVersion}, expectedPreviewKey, opId})`. In **one transaction** this re-plans, applies the edits, fits, compares the preview key (which now includes the draft id and version), creates the session, writes `session.source.todayEdits` (the applied edits, for history and `Why?`), and sets `status: 'consumed', sessionId`. On a mismatch nothing is written.
- **Discarded** when any workout starts by another path. `Reset today's edits` doesn't discard the draft: it marks every edit removed and keeps the draft open, so Undo can restore them.
- **Expired** at the end of the local day, by the same pass as change-review's `expireProposals` (app open, session start, local midnight).

### 4. Session effects at Start

- Swapped slots start as the substitute, with targets from its own history (`nextTargetsFor`), fitted.
- Skipped slots start as `skipped` sets with `skippedBy: 'before_start'` (new optional field). They stay visible and `Add set` revives them.
- The order becomes the session's exercise order.
- Lighter-start sets carry `planned.source: 'rule' | 'coach'` and a `lighter_start` provenance.
- No completed set is ever touched: there are none yet.

### 5. Storage and backup

- New table `pre_start_drafts` (`id`, `owner_id`, `basis_key`, `status`, `version`, `expires_at_utc`, `data` JSON). Partial unique index on `(owner_id, basis_key) WHERE status = 'open'`.
- One forward migration: the next free number (0006 at the time of writing; the overview worktree is still on 0004 and must rebase).
- Backups include the rows, as for every table (ADR 0005). **Restore marks every `open` draft `discarded`**, so a restored phone never starts from a stale draft.
- New optional fields: `WorkoutSession.source.todayEdits?`, `SetRecord.skippedBy?`. Sessions written before this read unchanged.

## Alternatives considered

1. **A session with a new `planned` status, created when the overview opens.** Edits would reuse the session commands (`swap_exercise`, `skip_exercise`). Rejected:
   - it breaks OV1 ("opening creates nothing");
   - every reader of `active` sessions (Resume, P6 auto-open, the stale card, Today, rotation, `session_already_active`) would need to learn a pre-start status;
   - a force-close would leave something that looks like a workout;
   - elapsed time and rest alerts have no meaning yet.
2. **In-memory draft only (no schema).** Same UI and same `applyTodayEdits`. Start takes `edits` inline. Edits are lost on force-close or app eviction. **This is the honest cheaper option:** no migration and no backup change, at the cost of redoing a few taps after a crash. It's a reasonable phase 0 if Ben wants the feature before the schema work, and can be upgraded to this ADR without changing the UI or the domain function.
3. **Start first, then edit in the workout** (today's behaviour). No new work, but the overview can't show the plan Ben will actually do, or its time, before he commits. That's the reason the overview exists.
4. **Store fitted loads in the draft.** Rejected: a gym change on the page or a late D21 target would make them wrong or stale. Intent plus the shared fit avoids both (GS2).

## Consequences

- One more pure function on the path to Start, guarded by a property test: the preview equals the session Start creates, for every edit combination and load convention.
- `previewKey` and `services.workout.start` gain the draft. Stale handling is the existing `stale_preview` path.
- Today's Up next rows must read the same edited preview, or they'll disagree with the overview.
- The check-in's lighter-session offer must know about an applied lighter start (suppressed).
- The coach path for Lighter start (after coach v1) needs `requestCoachAdjustment` to accept a **draft** target (`origin: 'break_offer'`) as well as a session. The validator rules are unchanged: no increases, snapped down, pain blocks.

## Open for Ben

1. Persisted draft (this ADR) or in-memory phase 0 (alternative 2)?
2. Close keeps the draft until midnight (proposed), or Close discards it with Undo?
3. Approve playbook candidates R1, R2 and R6 (return-to-load.md) so Lighter start can ship. Without them, ship Swap, Skip and reorder only.
