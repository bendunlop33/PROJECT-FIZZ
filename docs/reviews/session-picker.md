# Review: session picker (`claude/session-picker`)

**Verdict: CHANGES NEEDED.**

Scope reviewed: `git diff claude/gracious-knuth-joxqpw...claude/session-picker` (one commit, `d46ba3c`): `packages/domain/src/session/session-types.ts` (new), `packages/domain/test/session-types.test.ts` (new), and one export line in `packages/domain/src/index.ts`. Reviewed against `docs/design/session-picker.md` v0.1 and its mockup (both **untracked** in the worktree), `workout-overview.md`, `today.md`, ADR 0016, D19, D21 and CLAUDE.md rules 1–10.

Checks run in `/home/user/wt-picker`:

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npx vitest run --testTimeout=120000`: first run had 1 failure, `apps/mobile/test/app-services.test.ts:300` ("catches up a backup at launch when the last one was cut short"). That file passed 3 of 3 times on its own, and the full suite then passed (193 files, 3830 tests, 1 todo). The failing test isn't in this diff (N1).

The pure functions are tidy, strictly typed, take `now` as a parameter, and compute day gaps in Ben's time zone. Their tests cover most of SP3–SP5. However, Ben asked to "choose what day/type of session I am hitting", and this branch doesn't let him do that. Nothing is wired in: no service, no persistence read, no picker sheet, no Today change and no overview title button. In addition, the recommendation can pick a session type that the app refuses to start.

---

## Blocking

### B1. Ben still can't choose a session: the feature isn't built past the domain layer

- **Where:** whole branch. `session-types.ts` is exported from `packages/domain/src/index.ts:35`, but nothing outside its test imports it. `apps/mobile` is untouched.
- **Failure scenario:** Ben opens Today and wants Legs instead of Up next. He still has no `Change`, no `SESSIONS` list and no title button on the overview, so he can't do it. Acceptance checks SP1, SP2 (on screen), SP6–SP11 and SP13–SP17 can't be checked and are unmet. I couldn't confirm that every start path still works, that preview equals Start, or how switching interacts with today's edits, because none of those paths changed.
- **Why it's blocking:** this is the user's request. The commit message says wiring was held back for Ben's decisions 1 and 2 and for P-I3. Those decisions only cover category grouping of imports and the longest-gap fallback. Most of the picker doesn't depend on them: choosing among routines and named workouts, the sheet, `Change`, `SESSIONS`, switching the overview in place, and keeping drafts per basis (SP-D6).
- **Fix:** build the vertical slice from §7:
  - `services.sessions.list()`, which never throws;
  - `SessionPickerSheet` and `SessionPickerRow`;
  - Today's `SESSIONS` section and `Change` link;
  - the overview title button, with `services.overview.load` taking a source session (see SI2).

  Gate category types and the longest-gap fallback behind Ben's decisions. Until then, keep D19's existing `last_workout` fallback. Add service-level tests for SP6 (preview equals Start for a picked type), SP10 (drafts survive a switch, and `Edited` shows) and SP14 (no provider call, works offline).

### B2. `recommendSession` can make an unstartable imported workout "Up next"

- **Where:** `session-types.ts:276-282` and `154-164`, against `packages/domain/src/session-service.ts:183` (`imported_not_repeatable`) and ADR 0016 (P-I3 option (a)).
- **Failure scenario:** the §8 fixture. Every history type (Legs, Shoulders, Back, Chest) is an unnamed FitNotes import, so each has `sourceSessionId` = an imported session. `recommendSession` returns `Legs` (test at `session-types.test.ts:154`). Once this is wired, Today shows `Up next Legs`. The overview has to plan from `i-legs`, and Start refuses it with "Workouts imported from FitNotes can't be repeated yet." The same happens for every category row in the picker. If the overview did plan from it anyway, it would plan loads that no equipment had checked. Review r2 B1 already rejected that (rule 4).
- **Fix:** give `SessionType` a `startable` flag (or a `sourceImported` flag), set from the source session.
  - `recommendSession` should skip types that can't be started until P-I3 is decided.
  - The domain contract should say how such a row starts: for example, the exercises with `—` loads and `NEW` markers, as §2.4 does for a never-done routine.
  - Add tests for this.
  - This also needs a spec answer (SI1).

---

## Should fix

### S1. After a break of more than 42 days, Today falls back to "First workout"

- **Where:** `session-types.ts:276-285`.
- **Failure scenario:** Ben has five types, all last done more than 42 days ago (holiday or injury). `active` is empty, so `oldest` is `undefined`. `types.length > 1`, so the function returns `null`, which the spec maps to the First-workout hero (as on a fresh install). Today, D19's `last_workout` path offers his last workout instead. This is a regression for a likely scenario.
- **Fix:** when no type is active, recommend the most recently done type (basis `single` / `From …`), or fall back to `nextInRotation`'s `last_workout`. Add a test. The spec also needs a matching change (SI3).

### S2. The spec and mockup aren't committed

- **Where:** `docs/design/session-picker.md` and `docs/design/mockups/session-picker.html` are untracked in the worktree and aren't in any branch's history.
- **Failure scenario:** the code and test comments cite §3.1, §3.3, SP-D3 and so on. If this branch merges without the spec, the PM, Ben and the next developer can't trace any of the behaviour.
- **Fix:** commit the spec and mockup (with Ben's decisions 1 and 2 still marked open), or link them to the branch that holds them.

### S3. Missing tests for edge cases

Add tests for:

- all types `older` (S1);
- an imported source being recommended (B2);
- the last finished workout being a named session that joins a routine by name: it should be excluded as "just done", and `nextInRotation` should return `last_workout`;
- a never-done routine never being recommended, including the case where it is the only alternative to yesterday's session (SI5);
- a tie on `lastDone`;
- `formatLastDone` for a date more than a year old (S4);
- an imported workout whose Category matches a routine's name joining that routine and setting its `lastDone` (code at lines 179–181 and 194; the only test, line 117, mixes three kinds at once).

### S4. Dates over a year old show no year

- **Where:** `session-types.ts:318` (`dayMonthText`).
- **Failure scenario:** FitNotes history goes back about 2 years. An `OLDER` row reads `14 Aug` for 14 Aug 2024. Ben will read it as two months ago, which is a misleading actual (rule 6, honest data).
- **Fix:** add the year when the date isn't within the last ~11 months (`14 Aug 2024`). This needs a matching spec copy change (SI4).

---

## Nits

- **N1.** `apps/mobile/test/app-services.test.ts:300` (backup catch-up at launch) failed once under full-suite load, then passed 3 of 3 times on its own and in the next full run. It isn't from this diff, but it's flaky and timing-dependent. Track it separately.
- **N2.** `session-types.ts:277` finds "just done" by `t.sourceSessionId === lastFinished.sessionId`. This assumes the caller's "last finished" is also the newest-by-`startedAt` member of its group. Keep a session-ID → type-key map from grouping and look it up instead, so a caller that orders by `finishedAt` can't silently stop the exclusion.
- **N3.** `categoryLabel` (`session-types.ts:70-75`) merges cells by trimmed spelling, not by normalised name. So `{Legs: 5, legs: 5}` gives the label `Legs + legs` instead of `Legs`. This is unlikely within one FitNotes file. Merge by `normaliseSessionName` and show the most frequent spelling.
- **N4.** A routine type's `lastDone` includes workouts that only match by name or Category (lines 181 and 194), but D19's `After X · date` uses `isFromRoutine` only. The picker's `N days ago` and Today's basis line can name different dates for the same routine. This is acceptable, but document it in the spec or the doc comment.
- **N5.** `OLDER_AFTER_DAYS` and `RELATIVE_DAYS_MAX` are exported. Only the module uses them, so export them only if the UI or service will use them.

---

## Rules check (for what this branch contains)

- **Rule 1 (offline, no AI) and rule 3 (coach):** the functions are pure, make no provider call, and have no coach content. Nothing here chooses loads, so D21 is untouched. SP7 can only be checked once the overview is wired.
- **Rule 4 (achievable loads):** not exercised here. It is at risk through B2 if imported sources get planned.
- **Rule 5 (idempotent, versioned writes):** no writes. Save as routine (SP13) isn't built.
- **Rule 6 (no invented data):** all values are actuals. See S4 for the missing year.
- **Rule 10 (Your data vs Coaching knowledge):** Category labels are used as Ben typed them and are treated as Your data. That's correct.
- **Minimal copy:** the only strings are `Today` / `Yesterday` / `N days ago` / a date. That's fine.

---

## Spec issues (for the designer and PM; not code defects)

- **SI1. SP-D5 and SP6 contradict ADR 0016.** The spec plans a history type "from its most recent session", but every category type is an imported session by definition (§0). Imported workouts can't be repeated or planned while P-I3 (open-decisions B7) is open. So Decision 1 (group imports by Category) gives rows that can't start. Ben has to decide P-I3 together with Decision 1, or the spec has to say what a category row starts with (for example its exercises with `NEW` / `—` and no loads, as in §2.4).
- **SI2. §7 says the overview basis `{kind: 'next', sourceSessionId, name}` already exists. It doesn't.** `OverviewTarget` is `{ kind: 'next' } | { kind: 'routine'; routineId }` (`apps/mobile/src/services/workout-services.ts:386`), and it always resolves to the newest repeatable workout (around line 1095). Extending the target, `previewKey` and the draft basis is new work, and the spec should list it.
- **SI3. §3.3 step 3 returns null once every type is `OLDER`** (S1). Add a step: "else the most recently done type".
- **SI4. §6 copy `14 Aug` has no year** for history that's more than a year old (S4).
- **SI5. Never-done routines can never become Up next.** With one active type and a new routine, step 2 recommends the session Ben did yesterday (the "unless it is the only one" clause). That contradicts the point of SP-D4. Consider letting a `New` routine win over repeating the type just done.
- **SI6. Decision 2 amends D19.** It needs Ben's approval and a `docs/brief/CHANGELOG.md` entry before the longest-gap fallback replaces `last_workout` in `services.next.preview`. Weekly-plan check 18 also depends on it.
