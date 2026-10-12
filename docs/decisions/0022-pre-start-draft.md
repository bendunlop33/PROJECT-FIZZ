# 0022: The pre-start draft (today's edits before a workout exists)

**Status:** Accepted pending Ben, 11 Oct 2026. The PM defaults below stand until Ben confirms or changes them. Design: [overview-today-edits.md](../design/overview-today-edits.md). Builds on [workout-overview.md](../design/workout-overview.md) §6–§7, ADR 0019 (`snapPlanToGym`, intended vs fitted) and ADR 0021 (fenced session start). Replaces the unnumbered `draft-pre-start-draft.md`.

## Context

The Workout overview opens before any session exists (OV1). Ben wants to change today's plan there: swap an exercise, skip one, or change the order. The edits need a home between the first tap and `Start`, and they must:
- keep the overview's preview equal to what Start creates (OV3);
- be versioned, with op IDs, and never be applied to newer state (rule 5);
- survive a force-close;
- never touch the routine template (rule 2; template changes go through a change-review card);
- stay achievable at the selected gym, which can change on the page (rule 4);
- respect pain flags (rule 9).

## Decision

### 1. A saved `PreStartDraft`, separate from sessions (migration 7)

```ts
type DraftBasis =
  | { kind: 'routine'; routineId: string }
  | { kind: 'next'; sourceSessionId: string };   // the next session of a non-routine workout

interface PreStartDraft {
  id: string;
  ownerId: string;
  basis: DraftBasis;                             // one open draft per (owner, basis)
  status: 'open' | 'consumed' | 'discarded' | 'expired';
  sessionId: string | null;                      // set when consumed
  edits: TodayEdit[];                            // append-only; Undo marks an edit removed, never deletes it
  version: number;                               // bumped by every write
  createdAt: ZonedTimestamp; updatedAt: ZonedTimestamp;
  tz: string;                                    // the timezone of the latest write
  expiresAtUtc: string;                          // next local midnight in `tz` after the latest write
}

type TodayEditBase = {
  editId: string; opId: string; atUtc: string;
  replacesEditId: string | null;                 // a newer swap/order on the same slot/list replaces the older one
  removed: null | { atUtc: string; opId: string; why: 'undo' | 'reset' | 'replaced' | 'stale' | 'redundant' };
};

type TodayEdit = TodayEditBase & (
  | { kind: 'swap'; slotKey: string; toExerciseId: string }
  | { kind: 'skip'; slotKey: string }
  | { kind: 'order'; slotKeys: string[] }        // the full order
);
```

- **`slotKey`** is the `RoutineExercise.id` (routine basis; the same id the planner already passes to the shared fit as `slotId`) or the source session's part-root `SessionExercise.id` (next basis). Edits never point at array positions or at dry-run ids.
- **Intent, not numbers.** A swap stores the exercise, never a load. Targets are re-planned on every read, so a gym change, a routine edit or a late D21 target can't leave a stale number in the draft (as GS2).
  - *Amended 12 Oct 2026 (overview-today-edits TE13, slice B):* the one exception is Ben's own `load` edit, which stores his **intended** load (convention explicit) and is fitted on every read like any intended load (toward easier, never past a max), so a gym change still re-fits it.
- **Seam for target edits.** The `TodayEdit` union is closed in this version. A later target-changing kind (for example a lighter start after a break, once playbook R1/R2/R6 are approved) is added as a new variant that `applyTodayEdits` applies **after** the structural edits and before the fit. Nothing for it is built now.
- **Your data.** Drafts are owner-scoped. They are exported and deleted with Your data, and they are never in coach context (rule 10). The overview makes no AI call.

### 2. One pure function, before the unchanged planner

`applyTodayEdits(basis, edits, ctx)` (`packages/domain`) runs on the **start input**, not on a planned session:
- the routine (or source session's exercise list) has swapped slots re-pointed to the substitute (equipment cleared, so the shared fit maps an item at this gym, GS3) and the order rewritten;
- the `targets` map gets the substitute's own targets (`substituteTargets`, design §6.2) in place of the original's;
- skipped slot keys are returned separately.

Then the existing planner runs unchanged (`planRoutineStart` / `startWorkoutFromSession`, which call `startWorkout` and its `snapPlanToGym` mode `start`). Skipped slots' sets are then marked `skipped` with `skippedBy: 'before_start'`. The overview's dry run and Start call the same `planWithTodayEdits`, so OV3 holds by construction.

Each open edit gets an outcome: `applied`, `stale` (its slot is gone, or an `order` no longer lists exactly the plan's slots) or `redundant` (a swap whose substitute is now the template's own exercise). Stale and redundant edits are marked removed on the next write.

### 3. Lifecycle

- **Created** by the first edit (`expectedDraftVersion: null`).
- **Every write** carries an `opId` and `expectedDraftVersion`. A repeated `opId` returns the current draft. A version mismatch writes nothing (`stale_draft`).
- **Close keeps it** (PM default).
- **Consumed** by the overview's Start. The draft row (`pre_start_drafts`, id + version) joins the `WriteFence` (ADR 0021), and its id + version join `previewKey`. In the session save's transaction: the fence is re-checked, the session is created with `session.source.todayEdits` (the applied edits, for history and `Why?`), and the draft becomes `consumed` with its `sessionId`. On any mismatch nothing is written.
- **Discarded** when any session is created by another path. The repository's create-session write marks every other open draft of the owner `discarded` in the same transaction, so no path can forget it. `Reset today's edits` doesn't discard: it marks every edit removed and keeps the draft open, so Undo can restore them.
- **Expired** at `expiresAtUtc` (local midnight in the draft's stored `tz`). `services.overview.load` and Start both check it. A Start with an expired draft creates nothing (`stale_preview`). The page re-reads without the edits and shows `Earlier edits cleared` once.

### 4. Session effects at Start

- Swapped slots start as the substitute with its own targets, fitted. `planned.provenance` records `Swapped before start · <original>`.
- Skipped slots start as `skipped` sets (`SetRecord.skippedBy: 'before_start' | 'in_workout'`, new optional field). They stay visible, and `Add set` brings the exercise back.
- The order becomes the session's exercise order.
- No completed set is touched: there are none yet.

### 5. Storage and backup

- **Migration 7** (`0007-pre-start-drafts`): table `pre_start_drafts` (`id`, `owner_id`, `basis_key`, `status`, `version`, `expires_at_utc`, `data` JSON). Partial unique index on `(owner_id, basis_key) WHERE status = 'open'`.
- `FenceTable` gains `pre_start_drafts`.
- Backups include the rows (ADR 0005). **Restore marks every `open` draft `discarded`**, so a restored phone never starts from an old draft. The erase list for Your data includes the table. `Reset coaching knowledge` and `Undo last reset` are not restores and keep open drafts as they are; Delete my data removes them as Your data (ADR 0023, proposed).
- New optional fields: `WorkoutSession.source.todayEdits?` and `SetRecord.skippedBy?`. Older sessions read unchanged.

## Alternatives considered

1. **A session with a `planned` status, created when the overview opens.** Rejected: it breaks OV1, every reader of active sessions (Resume, P6 auto-open, the stale card, rotation, `session_already_active`) would need a new status, and a force-close would leave something that looks like a workout.
2. **In-memory draft, no schema.** Same UI and same `applyTodayEdits`, and no migration, but a force-close loses the edits. Rejected by the PM default (a). It stays a valid fallback if Ben prefers it: the UI and domain function don't change.
3. **Store fitted loads in the draft.** Rejected: a gym change or a late D21 target would make them wrong (GS2).
4. **Apply edits to the planned session after the planner.** Rejected: the planner's per-exercise target lookup, set-template ids and snap warnings are all keyed before planning. Editing its output would duplicate the fit and risk a preview that differs from Start.

## Consequences

- One pure function sits on the path to Start, guarded by the existing OV3 test extended to every edit combination and load convention.
- `previewKey`, `previewFence` and `services.overview.start` gain the draft.
- Today's Up next card must read the same edited preview, or it will disagree with the overview.
- `Change <routine> too ›` needs a minimal Ben-authored change-review card and an `update_routine` `ActionDetail` (design §4.3). This is the first built change-review card.

## Open for Ben

1. Saved draft (PM default) or in-memory (alternative 2)?
2. Close keeps the draft until local midnight (PM default), or Close discards it with an Undo toast?

## Implementation notes (build, 11 Oct 2026)

Small differences from the text above, found while building; none changes behaviour Ben sees.

- `WorkoutSession.source` is the string `manual | import`, so the applied edits live in a new optional `WorkoutSession.todayEdits` (`SessionTodayEdits`: draft ID and version, swapped rows with the original's name, skipped rows, reordered), not `source.todayEdits`.
- `PreStartDraft` also stores `opIds` (the operations already applied, for idempotency) and `updatedAtUtc` (the document store's version column).
- Migration 7 also rebuilds `coach_actions` so its `kind` CHECK accepts `update_routine` (SQLite can't alter a CHECK); rows, indexes and the no-delete trigger are kept. The `update_routine` detail stores the slot before and after and the routine versions, so Undo restores exactly `before`.
- A substitute's targets use the built-in rule's own rep range for that exercise (with the slot's set count); a substitute with no comparable history keeps the slot's sets and reps with no load.
- An expired draft is closed (`expired`) on the next overview read or write; restore discards open drafts only when it actually replaces data (restoring a backup identical to the phone is a no-op).
