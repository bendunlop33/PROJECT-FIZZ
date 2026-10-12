# 0026: Import from any app with a coach-proposed layout

**Status:** Proposed, 12 Oct 2026 (developer, for the PM and Ben). Nothing is built yet; this records the plan before code. Design: [data-import-export.md](../design/data-import-export.md) §9 (AI1–AI16, checks 34–60). Research: [ai-import.md](../research/ai-import.md). Builds on [ADR 0016](0016-fitnotes-import.md) (FitNotes import) and [ADR 0020](0020-coach-v1.md) (coach route, structured function calls). Build plan: [ai-import-build-plan.md](../design/ai-import-build-plan.md).

## Context

Ben (12 Oct 2026): "I do think having a GPT ability to just import would make the data importation much more efficient". This reopens the any-app import that the 11 Oct backlog entry deferred (CHANGELOG 2026-10-11). His decisions:

- **Q1: build for any app, not app by app.** Tests use synthetic files shaped like the published Strong (old and new), Hevy, JEFIT and generic spreadsheet layouts. No real export file is committed.
- **Q2: approved** (11 Oct). The request may send column names and up to 30 sample rows to ChatGPT.
- **Q3: no API-key fallback.** The layout request uses the coach's ChatGPT-plan route. When that route can't be used, the file can't be read by AI now. FitNotes stays offline and deterministic.

## Decision

### 1. Route
- **The layout request uses the coach's ChatGPT-plan route.** It uses the same `CoachModelPort` (`apps/mobile/src/coach/plan-model-port.ts`) and the same availability check that `fitToday` uses. The request goes through the same Keychain tokens and refresher, and the adapter always sends `store: false`.
- **It is not a coach turn (AI9).** The request lives in `packages/coach/src/import-reader.ts`. It is not in the tool registry and has no context builder, memory, thread or chat. Neither the coach nor voice can start, answer or commit an import.
- **No other route.** The app has no API-key route (backlog B10, "not now"), and Q3 rules out a fallback. Several parts of §9 are therefore **dropped, not deferred**: the API-key send line, the cost estimate, `checkPersonalSpendCap`, the cap states, and the `Ready, API key` and `cap_reached` rows of §9.3.2.
- **When the coach can't be used**, the screen shows `⊘ Needs the coach · <reason>` and sends nothing. The reasons are offline, not connected, signed out, usage limit and model unavailable. Nothing switches route (rule 7).
- **Forced function.** The request has exactly one tool, `submit_import_layout`, with `tool_choice: 'required'` and `parallel_tool_calls: false`. With one tool, `required` forces that function. This is the shape the coach already sends on this route, so the adapter needs no change.

### 2. Layout schema (`packages/schemas/src/import-layout.ts`)
- **`ImportMappingSpecV1` follows §9.6.2 as a Zod schema.** Its strict JSON Schema comes from the existing `strictJsonSchema`.
  - Optional values are `null`, never absent.
  - An unknown field fails the parse, as `STRICT_TOOLS` does for `propose_workout`.
  - Strings have length bounds. `selfCheck` must hold 3–5 items, which Zod enforces after the parse because strict mode can't.
- **The spec can't carry history.** It has no field for a set, a load value, a load convention, a record kind (done or planned) or a unit conversion. A schema snapshot test pins this (check 40).
- **`ImportSampleV1`, `LayoutAnswers` and `ImportProfile`** sit in the same file.

### 3. What is sent
- **Exactly one user message:** `JSON.stringify(ImportSampleV1)`.
  - It holds the delimiter, the section markers, the header cells, and up to 30 rows chosen deterministically by code (§9.6.1).
  - Free-text columns are masked as `[text, n chars]`. Columns Ben switches off are masked as `[hidden]`.
- **The instructions are a fixed constant**, `IMPORT_LAYOUT_INSTRUCTIONS_V1`. Its hash is recorded on the request.
- **Nothing else is sent.** That includes no file name, no Your data, no Coaching knowledge, no developer message with context and no web search.
- **The message must match what Ben saw.** `proposeImportMapping` sends the stored `sampleJson` and refuses the request when its SHA-256 differs from the `sampleHash` shown in `What's sent` (AI8, check 36).

### 4. Validation (rule 8)
- **The answer must be one call.** It counts only as exactly one `submit_import_layout` call whose arguments parse with Zod. Anything else is `no_layout_returned`: text, a refusal, zero calls, several calls or another name.
- **Code checks the spec.** `validateImportSpec` (pure, `packages/domain/src/import/layout/`) runs the nine §9.2.4 checks over the whole file: columns, unit evidence, markers, dates, decimal comma, self-check, a 95% dry run and target columns. Any failure refuses the whole spec, with reasons from the fixed copy list.
- **Model text never reaches a screen (AI11).**
- **Only code makes rows.** `applyImportSpec` is the only path from a spec to `SourceSetRow[]`.
- **Coach suggestions wait for Ben (AI3).** A role, notation or marker meaning that the coach suggested and no header word names stays `Check`. Its rows stay `pending` until Ben confirms.
- **The unit comes only from evidence.** That is a header token, a column of unit words, or Ben's answer. It is never inferred.
- **The pipeline from `analyseImport` onwards is the FitNotes one**, generalised from `FitNotesRow` to `SourceSetRow`. Workouts are grouped by `workoutKey`; for FitNotes the key is the date, so FitNotes IDs stay the same. The dumbbell, bar, bodyweight and name questions are unchanged.

### 5. Saved layouts (`import_profiles`, Your data)
- **One row per layout**, owner-scoped. It holds:
  - the fingerprint: exact header cells, delimiter and section markers;
  - the validated spec, Ben's confirmations and answers, and the values seen (markers, unit words, weight signs);
  - `uses[]`, a version, and provenance (route, model, `specHash`, times in UTC with the zone).
- **A layout is saved at commit**, in the same transaction as the job.
- **It is in use** only while one of its `uses` is an import still in effect. `Undo this import` takes it back (AI12).
- **Matching:** exact columns import offline. Added or removed optional columns are asked about, offline. A missing date, exercise, load or reps column makes the file a new layout.
- **A row that fails the schema is never used.** For example, a restored backup that was edited by hand.
- **Rule 10:** layouts are in the backup's Your data section and the full JSON export, are removed by `Delete my data`, and are absent from `Coaching knowledge only`.

### 6. Failure states and idempotency
- **Each request is stored** in `import_layout_requests` (Your data) under its `operationId` and `sampleHash`, with its state and the validated spec.
  - A repeat with the same operation ID returns the stored result and sends nothing.
  - Reopening the same file after an interruption reuses a spec that had already arrived.
- **Failure mapping:**

  | Cause | State |
  |---|---|
  | `usage_limit` | `limit` |
  | `auth_expired` | `signed_out` |
  | `model_gone` | `model_unavailable` |
  | `network` | `offline` |
  | `unavailable` | `try later` |
  | 120 s with no answer | `timeout` |
  | `Stop` | `stopped`; a late answer is thrown away |
  | App left mid-request | `interrupted` |
  | `unsupported` | `No sets found in this file.` |

- **`Try again` is always Ben's tap.** Nothing retries on its own.
- **Commits follow ADR 0016.**
  - Writes are `<operationId>:<workoutKey>`, with deterministic session and set IDs.
  - The staleness stamp gains `layoutRef`, `layoutVersion` and `specHash`.
  - A stale `layoutVersion` is refused.
  - A force-close resumes through `Continue import`.

### 7. Storage changes (migration 15)
- **New tables:** `import_profiles` and `import_layout_requests`.
- **`import_rows` is rebuilt**, because of the CHECK constraint and append-only triggers:
  - a `part` column lets one packed or wide row (`3x8`, `100x5,100x5`, `Set 1…Set 4`) give several sets. The key becomes `(job_id, row_number, part)`, and FitNotes rows use `part = 0`;
  - `result` gains `skipped_value_to_check`, `skipped_not_a_set` and `not_read`.
- **`ImportJob.source`** becomes `'fitnotes' | 'layout'`. Layout jobs carry `layoutRef`, `layoutVersion`, `specHash`, `sampleHash`, `instructionsHash`, `route`, `model`, `requestsSent` and `charsSent`.

## Built differently from the spec (needs the PM's or Ben's OK)

1. **API-key route parts are dropped** (Q3, B10): the AI10 estimate and cap, the `api_key` route state, and check 39's second half. Check 35's "no request on the API-key route" holds trivially, and a test checks that only the plan port is called.
2. **No separate `importLayouts` capability flag.** The design gates the import on spike S3. The coach already sends strict, forced function calls on this route, so the import uses the same coach status. If the route refuses the larger schema, Ben sees `No layout returned.` or the error state, and nothing is imported.
   - The App status row (X6) and this ADR say "working" only after a dated run on Ben's iPhone.
   - Alternative: keep the flag and add a developer-screen test, as for S3.
3. **Times with no zone (AI6, PM domain decision).**
   - **Recommended:** read them in the phone's zone at import, as FitNotes dates already are (`ImportJob.timezone`, ADR 0016). Keep the raw cell as provenance, and show `18:02 (as in the file)` from it.
   - This avoids a new `zone: null` session shape that every reader of `sessions` would have to handle.
   - Alternative: the design's `startLocal` with `zone: null`, which is a wider sessions change.
4. **Deferred to later slices** (see the build plan for why):
   - notes and pasted text (§9.2.8, `NotesPatternSpecV1`, check 42);
   - `Ask the coach to suggest matches` (AI14);
   - renaming saved layouts and editing their answers (§9.2.9). The list, detail and `Delete` with Undo are built;
   - the usage line (X4) and the App status row (X6).

## Consequences

- **Any CSV, TSV or semicolon file, or a JEFIT multi-section file, can be read once.** It then imports offline next time, with every value traceable to its cell and to Ben's answers.
- **FitNotes stays offline and deterministic.** The FitNotes suite must stay green after the `SourceSetRow` change. A golden test checks that FitNotes session and set IDs are unchanged.
- **Without the coach, a new layout stops honestly.** There is no manual column setup offline (AI16); `Share first line` is offered.
- **Needs a real iPhone:**
  - the forced-function round trip with this schema on the plan route;
  - latency against the 120 s timeout;
  - backgrounding during a request;
  - the file picker;
  - layout at AX3.
- **Still open:** real exports from Ben, if he has any beyond FitNotes. These include Strong's lb header and Hevy's unit columns (research §9 item 6).
