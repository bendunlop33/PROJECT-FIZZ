VERDICT: CHANGES NEEDED

# Review: import from any app (AI layout), slices L1–L5

Branch `claude/ai-import` at `831369d`, diffed against `claude/gracious-knuth-joxqpw` (`44da7a7`), 10 commits. Reviewed against Ben's 12 Oct direction, `docs/design/data-import-export.md` §9 (AI1–AI16, checks 34–60), `docs/research/ai-import.md`, ADR 0016, ADR 0026 and `docs/design/ai-import-build-plan.md`. Independent reviewer, 13 Oct 2026.

## What was checked

- Run by the reviewer, in `/home/user/wt-ai-import`:
  - `npm run typecheck`: exit 0.
  - `npm run lint`: exit 0.
  - `npx vitest run` (default suite): 287 files passed, 5372 tests passed, 1 todo, exit 0.
- Read in full: `packages/coach/src/import-reader.ts`, `packages/schemas/src/import-layout.ts`, `apps/mobile/src/import/layout-service.ts`, `layout-views.ts`, the `import-service.ts` diff, `packages/domain/src/import/layout/{validate-spec,review,roles,role-words,sample,notation,apply-spec,remap,table}.ts`, migration 15, `import-profiles.ts`, the data-domain change, `ImportNewLayoutScreen.tsx`, and every new test file.
- Probed with a throwaway domain test (deleted, not committed): the `spreadsheet-wide` fixture, and a packed `3x8 @ 100` file with no load column, both fully answered. Results are under B1.
- Fixtures: every file in `packages/domain/test/fixtures/layouts/` is `*.synthetic.csv` or a scripted `*.spec.json`, and the README says they are made up. No real export file is in the diff.

## Summary

The safety design is sound and well tested:

- **Route (rule 7).** The request is one forced, strict function on the coach's own ChatGPT-plan port. It has no other route, no registry entry, and nothing from Your data or Coaching knowledge.
- **The file is data (rule 8).** The file goes in one JSON user message, and notes columns are masked. The model's text is dropped. Every model string that is kept is checked against file text first: column names, markers and self-check names.
- **Never guess (rule 6).** The spec has no field for a value. Code reads every row. Coach suggestions stay `Check` until Ben confirms them. The unit comes only from file words or Ben's answer, and slash dates use only file evidence or Ben's answer, never the spec's `DD/MM`.
- **Rule 10.** Layouts and requests are Your data. FitNotes stays offline, with golden IDs unchanged.
- **Commit and Undo (rules 2, 5).** Commit and Undo reuse the ADR 0016 pipeline, and layout saving is in the job transaction.

One blocking bug remains. A whole class of the generic spreadsheet layouts that Q1 asks for can never be imported: the review reaches zero open questions, but the primary stays disabled for good.

## Blocking

### B1. Wide (`Set 1…Set n`) and packed-with-load layouts dead-end: the unit is never asked, so every row stays `pending`

- **Where:**
  - `packages/domain/src/import/layout/review.ts:152`: the `unit` question is only pushed when `s.load !== null`.
  - `packages/domain/src/import/layout/read.ts:105-120`: `unitFor` makes every read row wait for `unit` when there is no unit column, no answer and no header token.
  - `apps/mobile/src/import/layout-views.ts:484-488` (`checkLayoutView`): with `open === 0` it shows an enabled-looking `Use this layout` label, gated on `r.ready`.
- **Failure scenario.** Ben has a spreadsheet laid out as `Date,Exercise,Set 1,Set 2,Set 3,Set 4` with `100x8` cells. This is the repo's own `spreadsheet-wide.synthetic.csv`, one of the generic layouts Q1 names.
  - The coach's spec validates. Ben answers `Workouts I did` and `100 × 8`.
  - The reviewer's probe then gives `questions = [record_kind ✓, notation ✓]`, `open = 0`, `pending = 6`, `ready = false`, `unit = {unit: null, source: null}`.
  - The screen shows no question and no `Needs your answer`. `Use this layout` is disabled, and nothing on the screen can enable it.
  - The same happens for `row_per_exercise_packed` with `sets_x_reps_at_load` (`3x8 @ 100`, probe: `open 0, pending 4, ready false`). It also happens for `all_sets` cells such as `100x5,100x5,100x3` when there is no `Weight` column.
- **Why the tests miss it.** `import-layout-apply.test.ts:89-95` asserts `pending === 6` after the notation answer and titles the case "asked once a load is read". It never checks that a `unit` question exists. `answerAll` and the passing wide tests inject `unit: 'kg'` directly into the answers, which the UI can't do. No mobile test takes a wide or packed file to the preview.
- **Fix.**
  - Ask `Weight unit` whenever some row reads a load and no unit evidence covers it: no unit column and no header token, whether the load comes from the load column or from the cells. Base `range` on the loads read from the cells too.
  - As a backstop, never let `open === 0 && !ready && pending > 0` happen silently. Count each pending reason that has no question as open, or show why.
  - Add a mobile end-to-end test that takes `spreadsheet-wide` and a `3x8 @ 100` file from `previewImport` to commit, answering only through `updateImportLayout`.

## Should fix

### S1. A reused layout skips `validateImportSpec`, and Ben can never get a fresh read of the same file

- **Where:** `apps/mobile/src/import/layout-service.ts:449-450` (`previewImport`) and `:689-693` (`propose`). Both adopt `proposedFor(owner, sampleHash)`.
- **Scenario 1: checks skipped.** The sample is the first 10 rows, the last 5, distinct values of low-cardinality columns, and rows with empty number cells. It is not a hash of the file.
  - Two files with the same sample can differ in their middle rows. For example, Ben fixes or extends rows in the middle of a sheet, or the file has a bad date or a non-unit word in a high-cardinality column.
  - The second file gets the first file's spec with no re-run of checks 3, 5 and 7, and is never refused. Only the 95% dry run is recomputed by the review.
  - The second file can't get wrong values (bad cells become unreadable or pending), but §9.2.4's "checked against the whole file" no longer holds.
- **Scenario 2: no fresh read.**
  - The coach returns a layout that passes the checks but is wrong for Ben, such as the wrong column as reps.
  - Ben cancels and chooses the file again, or taps `Read with the coach`. Every tap returns `{status: 'proposed', reused: true}` and sends nothing.
  - The only way to get a fresh request is to hide a column so the sample hash changes. `Read with the coach again` (§9.3.4, §9.5) isn't built.
  - The same reuse also happens after `Undo this import`. The test at `import-layout-commit.test.ts:254-269` asserts `port.requests` stays at 1, so the layout that Undo "took back" quietly comes back as the coach's suggestion.
- **Fix.**
  - Re-run `validateImportSpec(reused.spec, s.table, opts())` before adopting it. Key reuse on the file checksum plus the sample hash.
  - Limit reuse to the interrupted case that §9.3.3 describes: a request whose spec arrived but was never reviewed. Leave out specs from imports that were undone or cancelled.
  - Add `Read with the coach again`: a new operation that bypasses reuse.

### S2. The `refused` result says `No layout returned.` when nothing was sent

- **Where:** `apps/mobile/src/import/layout-views.ts:245-246`.
- **Scenario.** `sample_changed` and `not_found` are cases where nothing was sent, yet the screen shows `No layout returned.` with `Try again`. That reads as "the coach answered badly". It isn't honest about what happened (rule 1, honest status).
- **Fix.** Use `Choose the file again.` for `not_found`, the copy already used on the screen. For `sample_changed`, return to the consent screen with the current text. Add a views test for both.

### S3. Check 53's third clause, "a commit with a stale `layoutVersion` is refused", isn't implemented for coach layouts, and its test covers only confirm

- **Where:**
  - `apps/mobile/src/import/import-service.ts:941-945`: only a saved profile's version is compared.
  - `import-layout-commit.test.ts:246-252` tests `confirmImportLayout` only.
- **Impact.** It is low today, because a draft is an immutable snapshot of the rows Ben previewed. Still, the ADR (§6) and the build plan both claim the stamp gains `layoutRef`/`layoutVersion`/`specHash` and that a stale version is refused.
- **Fix.** Either compare `d.layout.layoutVersion` with the layout session's current version at commit and add the test, or correct the ADR and the build plan to say that drafts are snapshots and why that is enough.

### S4. A changed-columns layout records the old spec's hash against a different spec (provenance, rule 6)

- **Where:** `apps/mobile/src/import/layout-service.ts:431` (`specHash: profile.provenance.specHash` for a remapped spec) and `:331`.
- **Scenario.** A file with one extra column is remapped, so its column indexes move. The job's `layout.specHash` and the newly saved profile's `provenance.specHash` are the old spec's hash, not the hash of the spec that actually read the rows.
- **Fix.** Hash the remapped spec, or record both hashes (`fromSpecHash` and `specHash`).

### S5. `Stop` tapped while the request record is being written still sends the request

- **Where:** `apps/mobile/src/import/layout-service.ts:700-738`. `stopped()` is checked before `saveRequest`, but `s.inflight` is only set after it, so `stop()` has nothing to abort during that write.
- **Scenario.** Ben taps `Stop` straight after `Read with the coach`. The request still goes out, with his file sample, and the answer is then thrown away.
- **Fix.** Check `stopped()` again immediately before `requestImportLayout`, and mark the stored record `stopped` without sending.

## Nits

- **N1. Offline doesn't re-enable on reconnect.** In `ImportNewLayoutScreen.tsx:32-36` the coach state is read only on focus. §9.3.2 says the offline `Read with the coach` is "re-enabled when the connection returns". Today Ben has to leave and come back.
- **N2. Wrong reason for some coach states.** `importCoachStateOf` (`layout-service.ts:91-109`) maps `not_eligible` and `region` to `not connected`, while the account is connected. Consider `unavailable` or a reason that matches system-states §3.2.
- **N3. A rejected spec keeps the model's strings.** `import_layout_requests` stores the full rejected spec (`layout-service.ts:766`), and it travels in backups. The reasons alone are enough. §9.6.1 says "Model text is never stored as content". Store `spec: null` for `rejected`.
- **N4. `sampleJson` isn't kept.** §9.6.4 lists `sampleJson` ("the exact text sent") on the job. Only its hash is kept, so later there is no record of exactly what left the phone. Either store it on the request record or note the change in the ADR.
- **N5. A replay doesn't check the file.** `replay()` (`layout-service.ts:774-788`) adopts a stored spec without checking that `stored.sampleHash === s.sampleHash`. Operation IDs are per-tap UUIDs, so this can't happen in practice, but the guard costs one line.
- **N6. Conflicting dates on a saved layout can strand rows.** A saved layout with slash dates, used on a file whose dates conflict (both `21/11` and `11/21`), gives `conflict` from `dateOrderOf`, which ignores Ben's saved answer. Its rows stay `pending` with no question. This is the same silent-stuck shape as B1, but rare. Show those rows as unreadable instead.
- **N7. `seen.negativeNames` is only filled at commit.** It is never consulted on reuse. The analysis's own bodyweight and machine questions already cover check 55's negative-weight case, so the field is dead weight. Either drop it or use it.

## Spec issues (for the PM or designer, not the code)

1. **§9.5 copy conflicts with AI11.** `It names a column "<name>" that isn't in the file.` and `Its marker "<token>" isn't in the file.` would show model text. The build correctly drops the name (ADR 0026 Implementation item 7). The copy table should be updated to match.
2. **The AI6 storage decision is still open.** The build reads times with no zone in the phone's zone as an ordering anchor and keeps the raw cell. Check 52 says `zone: null`. The PM needs to choose and then update check 52 or the code.
3. **The `importLayouts` / spike S3 gate was dropped** (ADR 0026, "Built differently" item 2). `plan-model-port.ts` still says S3 "has to pass before anything here counts as working". The PM should confirm that ungated is acceptable before L6. Until then, a route that rejects the schema shows `No layout returned.`, which is honest but unhelpful.
4. **JEFIT multi-section files are out of v1,** but the research and §9 list them as a supported shape. The detection copy `Files with sections can't be read yet.` isn't in §9.5. Ben should know that JEFIT exports won't work yet.
5. **The §9.6.1 sample rule says "chosen deterministically from the file hash",** but the build chooses rows by position and distinct values. That is fine, but it is what makes S1's reuse-across-files possible. The spec should say what the reuse key is.
6. **API-key parts were removed** per Q3 and B10 (AI10, check 39's second half, the §9.3.2 rows). §9 should be edited so the acceptance list matches the decision.

## Acceptance checks: status

| Check | Status |
|---|---|
| 34 Coach unusable sends nothing; FitNotes and saved layout work offline | Met (`import-layout-offline.test.ts`) |
| 35 Limit mid-request | Met |
| 36 Byte-identical sample; hiding a column changes the hash | Met |
| 37 Notes markers never sent | Met |
| 38 No Your data; one forced tool | Met |
| 39 One-line send line | Met (API-key half dropped per Q3) |
| 40 Spec carries no values; traceability | Met (`import-layout-trace.test.ts`) |
| 41 Refusals with fixed reasons | Met |
| 42 Notes | Deferred (architecture half only) |
| 43 Checks stay pending | Met |
| 44 Unit asked with no unit word | **Not met for wide and packed-with-load layouts (B1)** |
| 45 Done or plan; Liftosaur | Met |
| 46 `3x8` and day/month | Met (but see B1 for `3x8 @ 100`) |
| 47 Strong and Hevy questions | Met |
| 48 Injection fixtures | Met |
| 49 Hostile spec text never shown | Met |
| 50 Role change and displacement, with Undo | Met |
| 51 Values to check | Met |
| 52 Two workouts on one date, duplicates, times | Met (zone storage per spec issue 2) |
| 53 Golden IDs, resume, stale version | Golden IDs and resume met; stale version only at confirm (S3) |
| 54 Undo | Met (but see S1 on reuse after Undo) |
| 55 Saved layout offline | Met |
| 56 Changed columns | Met |
| 57 Rule 10, damaged layouts | Met |
| 58 Blocked during a workout | Met |
| 59 Provenance | Met (S4 on the hash) |
| 60 Presentation | Device (L6) |
