# 0021: A fenced session start for the Workout overview

**Status:** Proposed, 2026-10-11 (developer, from review [workout-overview.md](../reviews/workout-overview.md) S3). Ben to confirm. Built and tested on Linux (real SQLite through the node driver).

## Context
The Workout overview's Start sends the `previewKey` of the page Ben saw (workout-overview §7). The service compared the key against a fresh read, then planned and saved the session in separate steps. A write landing between the check and the save (once coach v1 exists, a late D21 result, CA10) would let Start create targets the page never showed (rule 5). The spec asks for the check inside the start transaction.

Running the whole planner inside one SQLite transaction would mean every repository read takes a transaction executor, which is a broad persistence change for one caller.

## Decision
- `SessionRepository.save` takes an optional **`WriteFence`**: rows pinned at a version (`routines`, `sessions` revision, `check_ins`, `profiles`) and exact sets (`gym_equipment` by gym, `active_pain_flags` by owner). The SQLite adapter re-reads them **inside the save's exclusive transaction**. On any difference it writes nothing and returns `stale_inputs`.
- `previewFence(parts)` (pure, `packages/domain`) builds the fence from the same `PreviewKeyParts` the key was computed from. `workout.previewCheck` returns `duplicate` / `stale` / `fresh + fence`. `startRoutine` / `startFromSession` pass the fence to the save, and the app maps `stale_inputs` to `stale_preview`.
- With no gym, Start saves the typical gym first, so the fence pins neither the gym nor the profile (setup may mark its gym step). The key check just before still covers both.
- The in-memory repositories pin `sessions` rows only. They are for tests and prototyping.

## Consequences
- A change that lands after the key check, at any point before the write, creates nothing. The page re-reads and Ben taps Start again, with the same opId.
- Coach v1's stored D21 next-session targets (`next_session_targets`, migration 6) are in `PreviewKeyParts.coachActions` and in the fence as a `next_session_targets` set (owner + source workout, every row's ID and version), so an Undo or a late coach result after the key check creates nothing. No new migration.

**Numbering:** written as 0019 on the overview branch; main took 0019 (gym switch) and 0020 (coach v1), so this is 0021. Reviews `workout-overview.md`, `-r2` and `-r3` call it ADR 0019.
