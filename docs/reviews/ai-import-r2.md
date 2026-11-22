VERDICT: PASS

# Review r2: import from any app (AI layout)

Branch `claude/ai-import` at `1878721`, diffed against `claude/gracious-knuth-joxqpw`. This round covers the fixes since `38a653a` (`docs/reviews/ai-import.md`): commits `f3daa38`, `f3c31be`, `769d23e`, `c65a6ef` and `1878721`. Reviewed against Ben's 12 Oct direction and the Q1–Q3 decisions, `docs/design/data-import-export.md` §9 (AI1–AI16, checks 34–60), `docs/research/ai-import.md`, ADR 0016, ADR 0026 and `docs/design/ai-import-build-plan.md`. Independent reviewer, 13 Oct 2026.

## What was checked

- Run by the reviewer in `/home/user/wt-ai-import`:
  - `npm run typecheck`: exit 0.
  - `npm run lint`: exit 0.
  - `npx vitest run` (default suite): 289 files passed, 5403 tests passed, 1 todo, exit 0.
- Read in full: the r1→r2 diff for `review.ts`, `import-profiles.ts`, `import-layout.ts` (schemas), `layout-service.ts`, `layout-views.ts`, `import-service.ts`, `app-services.ts`, `ImportLayoutCheckScreen.tsx`, `ImportNewLayoutScreen.tsx`, ADR 0026 and the build plan. Also every new or changed test: `import-layout-any-file.test.ts`, `import-layout-requests.test.ts`, `import-layout-commit.test.ts`, `import-layout-views.test.ts`, `import-layout-apply.test.ts` and `import-profiles.test.ts`.
- Probed with a throwaway domain test (deleted, not committed):
  1. A DD/MM sheet with one MM/DD typo. The coach's spec is `rejected` with `{kind: 'date'}`, which is honest.
  2. `liftosaur-like` with one `Completed Weight Unit` cell blanked on a loaded row. Result: `open 0, pending 1, stuck 1, ready false`, and the questions are only `record_kind`. See S1.
- Fixtures: the new `spreadsheet-packed-at.synthetic.csv` and its spec are made up. No real export is in the diff.

## r1 findings: status

| r1 | Status |
|---|---|
| B1 wide / packed-with-load dead-end | **Fixed.** `loadsInCells` (`review.ts:144-148`) asks `Weight unit` when loads come from `100x8`, `3x8 @ 100` or `100x5,100x5` cells. The mobile end-to-end tests take `spreadsheet-wide` and `spreadsheet-packed-at` from `previewImport` to a committed job, answering only through `updateImportLayout` (`import-layout-any-file.test.ts`). A backstop `stuck` count plus `stuckLine` means `open 0 && !ready` is never silent. Every fixture is asserted `stuck 0` after its answers. |
| S1 reuse skips checks / no fresh read | **Fixed in the service.** Reuse is keyed on `sampleHash` + `fileHash`, only while `closedAt` is null, and `validateImportSpec` runs again before a spec is adopted (`layout-service.ts:389-395`). `Read with the coach again` is built. Undo no longer brings the layout back (commit test). One gap remains: no screen calls the layout `discard`. See S2. |
| S2 `No layout returned.` when nothing was sent | **Fixed.** `not_found` shows `Choose the file again.`, and `sample_changed` returns to the consent screen. Views tests cover both. |
| S3 stale `layoutVersion` at commit | **Fixed** for a live session (`import-service.ts:952-956`), with an end-to-end test. ADR §6 now says why a draft from a gone session commits as previewed. The copy Ben then sees is wrong: see S3. |
| S4 remap hash | **Fixed** (`layout-service.ts:468`), with a test that the job and the saved layout carry the remapped spec's own hash. |
| S5 Stop during the record write | **Fixed** (`layout-service.ts:793-797`). `run.stopped` is set from the start of `propose`, and a fake store whose write triggers Stop shows zero requests and `failed/stopped`. |
| N3 rejected spec kept | Fixed. |
| N5 replay checks the sample | Fixed. |
| N1, N2, N4, N7 | Open (carried below). |
| N6 conflicting slash dates on a saved layout | Now visible as `stuck`, but still not importable. Folded into S1. |

## Rules

- **Rule 7 (route).** Unchanged and sound. There is one forced tool on the coach's ChatGPT-plan port, no API-key path, and `unavailable` with the coach's own reason when the route is down. Nothing new in this round touches the route.
- **Rule 8 (file is data).** Unchanged. The fixes add no model-text display. `stuckLine` and `readAgain` are fixed strings. A rejected spec is no longer stored, so the model's strings never persist.
- **Rule 6 (no invented data).** Holds. The unit comes only from a file word or Ben's answer, including cell loads now. No row is guessed: rows that can't be answered stay pending and are counted.
- **Rules 2 and 5.** Holds. Operation IDs, the request repeat-wait, `layoutVersion` at confirm and commit, the stale replay guard, and ADR 0016 commit and Undo are all in place.
- **Rule 10.** `fileHash` and `closedAt` are fields in the Your-data `import_layout_requests` document. Both default for old rows and old backups (`import-layout.ts:263,282`). No coaching-knowledge store is touched.
- **Copy.** It is minimal. `<n> rows can't be read with this layout.` and `Read with the coach again` on every coach layout aren't in §9.5 yet (spec issue 7).

## Blocking

None.

## Should fix

### S1. One row that waits for something no question asks blocks the whole import, with no way through

- **Where:**
  - `packages/domain/src/import/layout/read.ts:105-122` (`unitFor`): a loaded row whose unit cell is blank falls through to `wait: true`.
  - `packages/domain/src/import/layout/review.ts:186`: no `Weight unit` question is asked while a unit column exists (`s.unit !== null`).
  - `review.ts:278,293`: `stuck` is counted, but `ready` still needs `applied.pending === 0`.
  - `apps/mobile/src/import/layout-views.ts:491`.
- **Failure scenario.** Ben has a Liftosaur-style (or hand-kept) sheet with a `Weight Unit` column. One of 400 rows has a weight but an empty unit cell.
  - The coach's layout passes every check, because the dry run reads provisionally.
  - Check the layout shows `1 row can't be read with this layout.` and a disabled `Use this layout`.
  - No question and no `Check` can unblock it. `Read with the coach again` gives the same layout. The other 399 rows can never be imported, though §9 lets up to 5% of rows go to `Rows not read`.
  - The reviewer's probe confirms this: `open 0, pending 1, stuck 1, ready false`.
  - The same applies to a saved layout's slash dates when a later file has both `21/11` and `11/21` (r1 N6): `dateOrderOf` returns `conflict`, every slash-date row is stuck, and the import is blocked.
- **Why it matters.** r1 B1's dead-end is now visible but still a dead-end. Q1's generic spreadsheets are where blank or odd cells are most likely.
- **Fix.**
  - Turn a stuck row into an unreadable row with a fixed reason, such as `No weight unit` or `Date doesn't fit the layout (<cell>)`, so it is listed under `Rows not read`. The 95% rule then decides.
  - Or ask the file-level `Weight unit` as a fallback for rows whose unit cell is blank, still never guessing.
  - Keep the `stuck` backstop for any reason that remains.
  - Add a domain test (a unit column with one blank cell on a loaded row) and a mobile test that such a file reaches the preview with that row listed.

### S2. `Cancel` on New file layout and Check the layout isn't built, so the service's "Cancel sets the layout aside" never runs from the UI

- **Where:**
  - `apps/mobile/src/import/layout-service.ts:670-676`: `discard` closes the request.
  - `ImportLayoutCheckScreen.tsx` and `ImportNewLayoutScreen.tsx` have no `Cancel` and no `beforeRemove` listener.
  - `AppNavigator.tsx:177,179` uses the default back button.
  - §9 wireframes (`data-import-export.md:1228,1358`) show `Cancel` on both screens.
- **Failure scenario.**
  - Ben reads a file and doesn't like the coach's layout, so he taps back.
  - The session stays in memory with its request open (`closedAt` null). The next time he chooses the same file, the layout he just walked away from is adopted again as `reused` with no new request.
  - ADR 0026 §6 and the `discard` doc say the opposite: "an undone or cancelled layout never comes back". The test `` `Cancel` sets the layout aside`` passes only because it calls the service directly.
  - `Read with the coach again` is a workaround, which is why this isn't blocking.
  - Sessions also pile up in memory for the life of the app.
- **Fix.**
  - Add the §9 `Cancel` to both screens and wire it to `importLayouts.discard`.
  - Decide what back or swipe means, which is probably the same as Cancel once a layout has arrived (the §9.3.3 interrupted case is a force-close, not a back tap). Also drop the session on `beforeRemove`.
  - Add a screen-level or navigation test.

### S3. A stale coach-layout commit tells Ben "The saved layout changed. Choose the file again."

- **Where:**
  - `apps/mobile/src/screens/import/ImportRunScreen.tsx:89-90`.
  - `apps/mobile/src/import/import-service.ts:952-956` reuses `layout_changed`.
- **Failure scenario.**
  - Ben previews, goes back to Check the layout, changes a marker, and then reaches Import on the old draft. The commit is correctly refused (r1 S3).
  - The copy says a *saved* layout changed, when nothing was saved. It tells him to choose the file again.
  - If he does, his answers are lost. The request was closed at confirm (`layout-service.ts:365`), so the file is read by the coach again: a second send of his sample that wasn't needed.
  - The right action is `Use this layout` again on Check the layout.
- **Fix.**
  - Give the session case its own reason, such as `layout_session_changed`. Use the copy `The layout changed. Check it again.` and route back to Check the layout.
  - Keep the current copy for a changed or deleted saved profile.
  - Add a views or screen test.

## Nits

- **N1 (r1 N1, open).** In `ImportNewLayoutScreen.tsx` the coach state is still read only on focus. The offline `Read with the coach` doesn't re-enable on reconnect (§9.3.2).
- **N2 (r1 N2, open).** `importCoachStateOf` (`layout-service.ts:91-109`) maps `not_eligible` and `region` to `not connected`.
- **N3 (r1 N4, open).** `sampleJson` (§9.6.4) isn't stored, only its hash. Store it or note the change in the ADR.
- **N4 (r1 N7, open).** `seen.negativeNames` is written but never read.
- **N5.** `confirmSession` closes the request even when `openLayout` doesn't return a preview (`layout-service.ts:364-365`). A force-close between confirm and commit also loses the reusable layout: reopening the file sends a new request. Close only on a `preview` result, or close at commit.
- **N6.** `loadsInCells` asks `Weight unit` even when the set columns' own headers carry a unit (`Set 1 (kg)`), because `unitReading` and `unitFor` look only at the load column's header. This is honest but asks one question more than needed.
- **N7.** The unit question's `range` pushes load-column values twice, from the column and from `reads` (`review.ts:189-191`). This is harmless for min and max.

## Spec issues (for the PM or designer, not the code)

1–6 are carried from r1 and are still open. §9 wasn't edited this round.

1. **§9.5 copy names model text,** which AI11 forbids. The build correctly drops the name.
2. **The AI6 zone storage for times with no zone** needs a decision (check 52).
3. **The S3 schema gate dropped:** the PM should confirm before L6.
4. **JEFIT sections are out of v1:** Ben should know.
5. **The §9.6.1 deterministic sample:** say what the reuse key is. It is now `sampleHash` + `fileHash`, unclosed only.
6. **The API-key rows (AI10, check 39 second half, §9.3.2)** should be removed from §9 per Q3.
7. **New copy needs the designer:** `<n> rows can't be read with this layout.`, and `Read with the coach again` on every coach layout (ADR 0026 item 11). §9 lists the latter only for `Too few rows`. Also decide what back and swipe mean on New file layout and Check the layout versus `Cancel` (S2).

## Acceptance checks: changes since r1

| Check | Status |
|---|---|
| 44 Unit asked with no unit word | Met, including cell loads (B1 fixed). A blank unit cell in a unit column is S1. |
| 46 `3x8` / `3x8 @ 100` | Met |
| 53 Stale `layoutVersion` | Met at confirm and commit. The copy is S3. |
| 54 Undo; the layout isn't reused | Met |
| 59 Provenance (remap hash) | Met |
| Others | As in r1 |
