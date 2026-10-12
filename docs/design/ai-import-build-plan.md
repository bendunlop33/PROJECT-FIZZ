# Build plan: import from any app (AI)

Developer plan, 12 Oct 2026. Spec: [data-import-export.md](data-import-export.md) §9. Decisions: [ADR 0026](../decisions/0026-ai-import.md). Inputs from Ben:
- Q1: any app, built generically, with synthetic fixtures.
- Q2: approved.
- Q3: ChatGPT-plan route only, with no API-key fallback.

Every fixture is synthetic. Fixtures follow the published column layouts (research §6) and carry made-up values. No real export is committed. Fixture files are named `*.synthetic.csv`.

## Slices (each one committed, tested and reviewed in turn)

| # | Slice | Packages | Done when |
|---|---|---|---|
| L1 | Spec schema, detection, sampling, column kinds, `validateImportSpec`, `applyImportSpec`, date and notation readers, value checks, and `analyseImport`/`planImportRows` generalised to `SourceSetRow` | `schemas`, `domain` | Pure tests green. The FitNotes suite is unchanged and green, and the golden test shows FitNotes IDs unchanged |
| L2 | `import-reader.ts`: fixed instructions, tool definition, request builder, response parsing and error mapping | `coach` | Tests with a scripted port cover what's sent, injection and every failure state |
| L3 | Migration 15 (`import_profiles`, `import_layout_requests`, the `import_rows` rebuild), `SqliteImportProfiles`, data domains, backup, export and delete | `persistence` | Migration in place on a schema-14 database. Backup and restore round trip, and the Delete and Reset domains are right |
| L4 | `layout-service.ts` (`previewImport`, `getImportCoachStatus`, `buildImportSample`, `proposeImportMapping`, `getLayoutReview`, `updateImportLayout`, `confirmImportLayout`, profile calls), the commit extension, and view-models | `apps/mobile/src/import` | Service tests with the real SQLite store and a scripted port, offline tests and view-model tests |
| L5 | Screens: Import history, New file layout, What's sent, Reading, Check the layout, role sheet, questions, Changed columns, preview additions, results and provenance, Saved import layouts | `apps/mobile` | Screens only render view-models and call the service. The copy matches §9.5 |
| L6 | Device run on Ben's iPhone: a synthetic Strong file through the real plan route, airplane-mode reuse, backgrounding mid-request, AX3 | (device) | A dated result recorded in ADR 0026. Only then does anything say "working" |

## Code map

- **`packages/schemas/src/import-layout.ts`:**
  - `ColumnRef`, `UnitEvidence`, `DateFormat`, `CellNotation` and `Layout`;
  - `MarkerMeaning`, `ImportMappingSpecV1` and `ImportSampleV1`;
  - `LayoutAnswers`: record kind, unit, both-unit columns, date order, notation per column, marker meaning per token, role confirmations, and new-column answers;
  - `ImportProfile` and `ImportLayoutRequest`;
  - `ImportJob` gains `source: 'layout'`.
- **`packages/domain/src/import/layout/`:**
  - `detect.ts`: §9.3.1 detection, and profile fingerprint matching (exact, or changed columns);
  - `sample.ts`: the deterministic 30-row sample, masks and hidden columns, `sampleJson` and `sampleHash`;
  - `column-kinds.ts`: number, date, short text or notes;
  - `role-words.ts`: header words that name a role, and target words;
  - `dates.ts` and `notation.ts`: readers for the closed formats;
  - `validate-spec.ts`: the nine checks, `SpecCheckFailure`, the dry run and worked examples;
  - `apply-spec.ts`: the only producer of `SourceSetRow` from a spec;
  - `review.ts`: the pure `LayoutReview`, its questions and counts;
  - `value-checks.ts`: AI13 hard limits and the soft 2× check.
- **`packages/domain/src/import/plan.ts`, `session.ts` (changed):**
  - input becomes `{source, rows: SourceSetRow[]}`, with FitNotes rows converted one to one;
  - workouts are grouped by `workoutKey`;
  - set IDs become `(jobId, row, part)`. For `part = 0` the ID derivation equals today's, so FitNotes IDs don't change.
- **`packages/coach/src/import-reader.ts`:**
  - `IMPORT_LAYOUT_INSTRUCTIONS_V1`, `submitImportLayoutTool()`, `buildImportLayoutRequest(sampleJson, model)` and `requestImportLayout(port, request, opts)`;
  - it is exported from the package index, but **not** from the registry.
- **`packages/persistence`:**
  - `schema/0015-import-layouts.ts`, `import-profiles.ts`, and the `imports.ts` changes for `part` and the new results;
  - `data-domains.ts` adds `import_profiles` and `import_layout_requests` to `YOUR_DATA_TABLES`.
- **`apps/mobile/src/import/`:**
  - `layout-service.ts`: orchestration. It takes `availability()` and the model port from the same sources as the coach service;
  - `layout-views.ts`: view-models, copy from §9.5 only;
  - `import-service.ts`: commit and revert extended with the layout stamp and profile save or take-back.

## Acceptance checks → code and tests

Test paths are relative to each package's `test/`. "Device" means a check that only a real iPhone can close (L6).

| Check | What | Code | Tests |
|---|---|---|---|
| 34 | Coach unusable: `Needs the coach · <reason>`, and no request. In airplane mode, FitNotes and saved-layout files still import | `getImportCoachStatus`, `layout-views.ts` | mobile `import-layout-offline.test.ts`: a spy port records zero calls in each state (not connected, offline, signed out, limit, model unavailable). Airplane-mode end-to-end on the device |
| 35 | Usage limit mid-request: nothing imported, no reset time, route setting unchanged | `requestImportLayout` error mapping, `proposeImportMapping` | coach `import-reader.test.ts` (limit → `limit`). Mobile service test: the connection settings are unchanged and the job has no rows. Only the plan port exists, so no other route can be called |
| 36 | The user message is byte-identical to `Exactly as sent` (SHA-256), and hiding a column changes both | `buildImportSample`, `proposeImportMapping` hash guard | domain `import-layout-sample.test.ts`. Coach test: the captured `input[0].content === sampleJson`. Service test: a hash mismatch is refused |
| 37 | Unique strings in notes columns never appear in the request | `column-kinds.ts`, `sample.ts` | domain sample test with a marker-string fixture: search the whole serialised request |
| 38 | No Your data in the request. One tool, forced, no parallel calls, no web search | `buildImportLayoutRequest` | Coach test: seeded memory, pain-flag, gym and history strings are absent. Tool count, `toolChoice: 'required'`, `parallelToolCalls: false` |
| 39 | The send line is one line | `layout-views.ts` | views test: one line. The API-key half is dropped (ADR 0026) |
| 40 | The spec can't carry sets, loads, conventions or record kind. Every stored value is traceable to a cell or to Ben's answer | schemas `import-layout.ts`, `apply-spec.ts` | schemas `schemas.test.ts` (JSON Schema snapshot and a forbidden-key scan). Domain `import-layout-trace.test.ts`: for each fixture, every stored load and reps equals a number in the raw cells, or follows from it only by Ben's answers |
| 41 | A self-check mismatch, an unknown column or under 95% read is refused with a reason from the fixed list | `validate-spec.ts` | domain `import-layout-validate.test.ts`, one case per check (1–9) |
| 42 | Notes: an unread line gives no set | Deferred (notes slice) | Only the "no other producer" half holds now: an architecture test checks that `SourceSetRow` is built only in `apply-spec.ts` and `fitnotes.ts` |
| 43 | A coach-suggested role, marker or notation stays `Check`, and its rows stay `pending` until `Use this` | `review.ts`, `apply-spec.ts` | domain `import-layout-review.test.ts` |
| 44 | No unit word: `Weight unit` is asked whatever the spec says. A bad `header_token` or `unit_column` is refused | `validate-spec.ts` check 3, `review.ts` | domain validate and review tests: a Strong-old fixture (no unit) and lying-spec fixtures |
| 45 | `What is this file?` has nothing selected. A plan imports nothing. Liftosaur-like `Required …` columns are never stored | `role-words.ts` target words, check 9, `review.ts` | domain `import-layout-review.test.ts` with `liftosaur-like.synthetic.csv` |
| 46 | `3x8` gets a notation question that changes the set count. Dates whose first field is never above 12 ask the day/month order | `notation.ts`, `dates.ts` | domain `import-layout-apply.test.ts` with `spreadsheet-sets-x-reps.synthetic.csv` (only dates ≤ 12) |
| 47 | Strong and Hevy: dumbbell, bar and bodyweight questions as in checks 17–18. `Pull Up (Assisted)` is assistance. An unmarked custom name is asked | unchanged `analyseImport` on `SourceSetRow` | domain `import-layout-analysis.test.ts` with `strong-new-kg`, `hevy-kg`, `hevy-lbs` and `hevy-assisted` fixtures |
| 48 | Injection fixtures end "asked" or "refused", never applied | `validate-spec.ts`, `review.ts` | domain `import-layout-injection.test.ts`: `ignore previous instructions` in a notes cell, an exercise name, a header and a cell; an all-`lb` notes column; a `Target` template |
| 49 | Link and "all checked, tap Import" text in spec strings never shows | `layout-views.ts` builds strings only from copy, file text and code readings | mobile `import-layout-views.test.ts`: a hostile spec. Every rendered string is in the copy table or the file text |
| 50 | A role change re-runs the checks. A second column taking a role moves the first to `Not imported`, with Undo | `updateImportLayout`, `review.ts` | mobile service test and domain review test |
| 51 | Hard limits make rows unreadable. 100 → 225 goes to `Values to check` and blocks the primary | `value-checks.ts`, preview view | domain `import-layout-values.test.ts`, mobile views test |
| 52 | Two Strong workouts on one date give two workouts. Dates from an earlier import are skipped. A time with no zone is shown `(as in the file)` | `workoutKey` grouping, the existing duplicate rules | domain analysis test. Mobile commit test (the zone storage follows the PM's AI6 decision, ADR 0026) |
| 53 | Golden IDs. Killing the app at 180 of 412 and continuing gives exactly 412. A stale `layoutVersion` is refused | `importIds`, commit stamp | domain `import-layout-golden.test.ts`. Mobile `import-layout-commit.test.ts` (interrupted writes, then `Continue import`, as in the existing FitNotes test). Plus the FitNotes ID golden test |
| 54 | Undo reverts every workout and deletes nothing. A layout used only by that import becomes `Not in use`, and the next file goes to New file layout | `revertImport`, `import-profiles.ts` | mobile commit test and persistence `import-profiles.test.ts` |
| 55 | A saved layout imports in airplane mode with no request. It shows `Your answer last time`, and asks about new markers, names and negative weights | `detect.ts` fingerprint, `review.ts` | mobile offline test (spy port: zero calls) and domain detect test |
| 56 | One extra column asks only about that column, offline. A missing load column makes a new layout | `detect.ts` changed-columns rule | domain `import-layout-detect.test.ts` |
| 57 | Layouts in the backup's Your data section and the JSON export, removed by Delete, absent from Coaching knowledge only. A damaged layout isn't used | `data-domains.ts`, profile decode | persistence `data-domains.test.ts`, `backup.test.ts` and `import-profiles.test.ts` (damaged row) |
| 58 | No import, and no coach request, while a workout is unfinished | the existing `block()` | mobile service test: `proposeImportMapping` is refused with a spy port |
| 59 | Every set shows its file, row or line, original text and `SourceTag` | `provenanceOf` extended | mobile views test |
| 60 | Presentation: tabular numerals, 16 pt, icons with text, AX3, wrapping, no lead paragraphs | screens | Views test for the copy. AX3 and wrapping on the device |

Regression: §7 checks 16–33 (FitNotes) keep their existing tests. `npm run check:migrations` must pass with migration 15.

## Fixtures (`packages/domain/test/fixtures/layouts/`, all synthetic)

- `strong-new-kg.synthetic.csv`: semicolon, quoted, `Weight (kg)`, `Workout #`, two workouts on one date, an RPE column.
- `strong-old.synthetic.csv`: comma, no unit, `W`/`D`/`F` markers, `Rest Timer` rows.
- `hevy-kg.synthetic.csv` and `hevy-lbs.synthetic.csv`: `set_type`, dates like `"22 Dec 2025, 08:00"`.
- `hevy-assisted.synthetic.csv`: `Pull Up (Assisted)` and an unmarked custom assisted name.
- `jefit-sections.synthetic.csv`: `### WORKOUT SESSIONS ###` / `### EXERCISE LOGS ###`, packed `logs`, unix `starttime`, no unit.
- `spreadsheet-sets-x-reps.synthetic.csv`: `Date,Exercise,Weight,Sets x Reps,Notes`, every day ≤ 12.
- `spreadsheet-wide.synthetic.csv`: `Set 1 … Set 4` columns, `100x8` cells.
- `liftosaur-like.synthetic.csv`: `Required …` and `Completed …` columns.
- `injection-*.synthetic.csv` and hostile `*.spec.json`: the check 48 and 49 cases.
- `*.spec.json`: the scripted coach answer for each fixture, including deliberately wrong specs for check 41.

## Deferred (and why)

| Part | Why | When |
|---|---|---|
| Notes and pasted text (§9.2.8, `NotesPatternSpecV1`, `applyNotesPatterns`, Paste editor, `Find more patterns`, Notes layouts; checks 42 and half of 55) | A separate pattern engine and editor. The designer recommends tables first, and no known source of Ben's is a notes log | A later slice, if Ben has notes to bring in |
| `Ask the coach to suggest matches` (AI14) | A second request type. The existing names screen already resolves every name without it | After L6 |
| Renaming saved layouts and editing their answers (§9.2.9) | Not needed for reuse. The list, detail and `Delete` with Undo are built | Later polish |
| API-key send line, estimate, cap, `checkPersonalSpendCap` (AI10, check 39 second half, §9.3.2 rows) | **Dropped:** Q3 "no API-key fallback" and B10 "not now" | Only if Ben adds an API-key route |
| `importLayouts` capability flag (spike S3 gate) | The route's forced function calls are already the coach's shape. Failures are honest states. Needs the PM's OK (ADR 0026) | Kept as an alternative |
| Usage line counting import requests (X4) and the App status row (X6) | Needs a device-proven route first | After L6 |
| `.xlsx`, PDF, photos | Out of scope for v1 (§9). Detection says so in one line | No plan |

## Open (for the PM or Ben)

1. AI6: how times with no zone are stored (ADR 0026, "Built differently" item 3).
2. Dropping the `importLayouts` gate (ADR 0026, item 2).
3. Ben: any real non-FitNotes exports to test against at L6. They would stay on the phone and are never committed.
