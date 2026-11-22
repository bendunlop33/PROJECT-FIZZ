# AI-interpreted history import (any format)

Researcher. All sources checked **2026-10-09**. No accounts, trials or credentials were used. This extends `fitnotes-export-format.md`, `ai-access-and-voice.md`, `data-import-export.md` (§2.5, §3.4, §4.3, DX5, DX6) and ADR 0016, and builds on the brief CHANGELOG entry of 2026-10-09 ("Item 4 changed by Ben"). **Fact-checked in a second pass the same day; corrections are applied in place and listed in §10.**

Labels: **[Doc]** official vendor documentation. **[Sample]** a real or example export file. **[Code]** open-source parser code or its README. **[Reports]** third-party sites, vendor marketing, forums and search snippets. **[User]** user or developer feedback. **[Inference]** my reasoning, not proven.

## Summary

1. The model should read the file's **structure**, not copy its numbers. It proposes a typed mapping from the header, local column statistics and about 20–30 sample rows. Code checks that mapping, applies it to every row, and feeds the existing FitNotes preview, questions, commit and Undo. Having the model rewrite every row is rejected: it is slower and costlier, and it can silently change digits or drop rows.
2. Free text (Notes, Markdown, pasted logs) can't be read that way, because the model has to transcribe it. That is a separate, opt-in path: Ben agrees to send the whole text, it goes in chunks, every set must cite its exact source text, and code rejects any number that isn't in that text.
3. The AI never decides unit, load convention, notation (`3x8`: sets × reps or reps × sets?), date order or whether a row was done or only planned. It may only point at a literal token, which code then checks; otherwise Ben is asked. Once Ben confirms a mapping, it is saved as a **learned import profile** (Your data). Files in that format then import offline with no AI.
4. The output channel should be one forced, strict function with no other tools, but **it is not proven that today's Responses adapter can send it**: the plan-route docs say to put function tools in namespaces or `additional_tools`, while the adapter sends top-level functions (ADR 0012, spike S3). The docs also don't mention `text.format`, how long OpenAI keeps plan-route data, or whether it trains on it. All of these need checking.
5. **Proposed brief changes are below.** Ben's idea that "we don't need import rules" holds only for per-app column rules. The rules for checking values and for units and load conventions stay.

## Recommendations

1. **Pipeline order.** Detect the file kind. Then try, in order:
   - the built-in profiles (FitNotes A1–C, ADR 0016);
   - a learned profile with an exact fingerprint match;
   - an AI mapping proposal. This only runs when Ben taps `Read with the coach`, the coach is connected and he is online.

   Every path then goes through the same checks, a review with worked examples, the existing questions, and commit and Undo. The AI only does the format-detection step.
2. **One canonical intermediate.** Generalise `FitNotesRow` into a source-neutral `SourceSetRow`, keeping the raw cells, the line and row number, and any evidence. `analyseImport`, `planImportRows`, matching, convention questions, staleness checks, operation IDs and `revertImport` then run unchanged for every format. Neither the AI nor a learned profile touches anything after row reading.
3. **Use a closed vocabulary for the mapping spec** (a discriminated union, §2.3), so code can apply it deterministically.
   - Columns are referenced by their exact header text and index.
   - Date formats, cell notations and set-type meanings come from fixed lists.
   - Anything outside the vocabulary becomes `unsupported`, with an honest message.
   - No free-form model prose is shown on the confirmation screen.
4. **Evidence rule (generalises ADR 0016).** A property that changes a stored value can come only from:
   - an exact catalogue or alias match;
   - Ben's explicit answer;
   - a literal token in the source that code has verified (a header `(kg)`, a unit column whose values are all in the unit vocabulary, a name word such as `Assisted`);
   - a built-in profile tested against real files;
   - a learned profile Ben confirmed.

   An AI judgement such as "these look like lb" is never evidence (rule 6). The **absence** of a name word is not evidence either: a Hevy custom exercise can be of the assisted type without `Assisted` in its name (§6).
5. **Deterministic checks before Ben sees anything** (§2.4):
   - the schema;
   - every column reference exists in the header;
   - every evidence token exists, and is consistent across the whole file;
   - the model's self-check readings of 3–5 sample rows match what code produces from its spec;
   - a dry run over the full file reads at least 95% of rows (Liftosaur stops above 50% failures);
   - Liftosaur-style sanity flags.

   If any check fails, the spec is refused with the reason. Nothing is half-applied.
6. **Free text: extract in chunks and check every value against its source.**
   - Chunks are split on date headings with line numbers kept; each response is a few thousand tokens at most.
   - Each extracted item carries a line number and an exact substring. Code rejects any number or exercise text that isn't in that substring, and lists lines that contain numbers but produced no set.
   - The extracted table is reviewed like a CSV. Each set is labelled `Read by the coach from your notes, line 212`.
7. **Output channel.**
   - Send a single strict function (`submit_import_mapping` or `submit_extracted_sets`), forced with `tool_choice`, and `parallel_tool_calls: false`. The app runs nothing on it: its arguments are just data for the validator.
   - If spike S3 shows the plan route needs namespaced tools, note that the docs show no `tool_choice` form for forcing a function inside a namespace. A possible fallback is one tool plus `tool_choice: "required"` [Inference; test it].
   - A completed response without exactly one `submit_*` call is a failure, never an empty result. Today's adapter silently drops refusals and any other output items (§3).
   - Expose no read or write tools during import, and never a hosted tool such as web search.
   - Put file content only in a user-role message, as a JSON-encoded string, never in `instructions` or a developer message. This limits its influence; it does not neutralise it (§4).
8. **Privacy by default.**
   - The mapping call sends the header, per-column statistics computed on the phone, and at most 30 rows. Free-text cells are replaced by shape markers (`[text, 42 chars]`), and at most 15 example exercise names are included.
   - Apply the same masking to the statistics: a column classified as free text sends no "distinct values", otherwise short notes would reach the model that way.
   - The full history is sent only on the free-text path, after a consent screen. It names the route, the size and the number of requests.
   - No other Your data (history, memories, pain flags) goes into any import request.
   - Chunk results are cached on the phone, so a retry doesn't send the text again.
9. **Learned import profiles** (§7):
   - **Storage:** owner-scoped Your data. Each profile holds a fingerprint, the validated spec, Ben's confirmations and provenance.
   - **Matching:** only on an exact fingerprint. Changes in the data (new set-type tokens, new unit strings, negative weights for an exercise that had none) are asked about, never absorbed.
   - **Backup and delete:** profiles are backed up, exported and deleted with Your data.
10. **Offline and rule 7.**
    - **Offline:** built-in and learned formats work offline. A new format says `Reading a new format needs the coach connection` and stops. There is no fake parse and no queue.
    - **Usage limit:** `subscription_sharing_usage_limit_exceeded` (HTTP 429, and it can arrive as `response.failed` mid-stream) pauses the import, keeps its progress, never infers a reset time, and never switches to the API key. `subscription_sharing_usage_unavailable` (503) retries later with bounded backoff.
    - **Credits:** OpenAI can spend ChatGPT credits after plan limits if Ben has allowed apps to use credits, and the app can't see that setting. The free-text consent screen (many requests) says so in one line.
    - **API key route:** the consent screen shows the estimated spend and runs `checkPersonalSpendCap` first.
11. **Build order.**
    1. Finish and validate the FitNotes importer on Ben's real file (unchanged).
    2. **Ask Ben which other histories he actually has** (other apps, spreadsheets, Notes).
    3. Refactor to `SourceSetRow` and add profiles.
    4. Add the AI mapping path, after spike S3 has settled tool shape on the plan route.
    5. Add the free-text path only if he has such data.

    Record the architecture in a new ADR when it is built.
12. **Test fixtures** (synthetic, written by us):
    - Strong old and new layouts, Hevy kg and lb, Liftosaur, a JEFIT multi-section file, a wide spreadsheet, a programme template, and a Notes log.
    - Injection fixtures (§4).
    - Golden tests showing that applying a confirmed spec is deterministic, and that the same file plus the same profile gives the same operation IDs.

---

## 1. How others handle it (product research)

| Product | What it does | Evidence |
|---|---|---|
| Hevy | Imports **only** Strong CSVs, which must be in English (switch Strong to English before exporting). For other sources support can send a sample Strong-format CSV, but won't troubleshoot such files. By implication it can't import its own export [Inference]. | [Reports: Hevy help article seen as search snippets (the page returned 403 to the fetcher); Gript's Hevy page] |
| Liftosaur | Imports Hevy CSVs, its own CSV, and its JSON backups and programme files. Preview, with "Nothing is saved yet" before confirmation. Unreadable rows are listed, and the import stops if more than half fail. Sanity flags: more than 3,000 lb, more than 1,000 reps, a date before 2000, or a date more than a day in the future. Duplicates are workouts starting within 1 minute. Undo covers the last 5 imports. Unknown names become custom exercises. | [Doc: liftosaur.com/features/import-export] |
| FitNotes 2 | Imports the FitNotes Android database and CSV, plus CSVs from seven other apps. v14 (Sep 2026) "improved workout CSV import/export for Hevy, FitBod and Strong". | [Doc: changelog and App Store, via `fitnotes-export-format.md` and `competitor-landscape.md`; not re-checked in this pass] |
| Surpass (jacked.coach) | Ben picks the source app (Hevy, Strong **English exports**, or FitNotes). It then reviews exercise matches and a summary, and "nothing is saved until you confirm". No AI is mentioned. | [Doc: jacked.coach/import-workout-history] |
| Gript | Claims to read CSVs from "Hevy, Strong, JEFIT, Fitbod, and 15 more apps" (another section of the same page says "+ 10 more"), plus "AI import" of photos of paper logbooks, pasted notes and PDFs, "with a preview". It doesn't say what is sent to the AI. | [Reports: vendor marketing, griptapp.com] |
| SayLift | AI turns pasted text into **routines** (plans), not logged history: "Import does not write fake past workouts into your history". | [Reports: saylift.app] |
| Train Libre (open source) | A 1 Oct 2026 issue says its "generic imports are not reliable enough" and proposes to "Start with tested import profiles for Hevy and Strong". | [User: GitHub issue #691] |

**Recurring problems** [User/Reports; qualitative, not a survey]:
- **Format drift breaks fixed importers.**
  - Strong moved from a comma-separated, unitless layout to a semicolon-separated, quoted layout with `Weight (kg)`. On 5 Oct 2026 one open-source importer rejected a Strong export with that header ("File columns are not recognised", openGym #394).
  - FitNotes Android changed its header in 2023 (`fitnotes-export-format.md` §2).
- **Units are the commonest silent error.**
  - On intervals.icu, lb values uploaded through its own CSV upload were read as kg "because the field was just 'weight'" (Feb 2024).
  - Gript's Hevy page says weights "out by roughly 2.2x" mean a spreadsheet re-saved the file. Its Strong page says the same symptom "is the unit and not lost data".
  - Strong's older CSV and JEFIT's export don't contain the unit at all.
- **Spreadsheet re-saves damage exports.** They break JEFIT's multi-section file and reorder or reinterpret dates (Gript's JEFIT, Hevy and Strong pages).
- **Many apps can't take in logged history from text.** SayLift's comparison table (vendor marketing) marks HevyGPT, Boostcamp, Strong, JEFIT and Fitbod "No" for transferring logged history [Reports]. That table is about importing into those apps; Strong's own CSV can still be exported and read by others.

Reddit couldn't be searched usefully: web searches returned no Reddit threads, and direct Reddit fetches were blocked in earlier research. **This file has no Reddit evidence.**

**Design implication.**
- Ben wants "any format". Competitors fall short in two ways: they hard-code per-app layouts that drift, or they push files through AI with no stated checks.
- GymSmarter should handle drift and unknown layouts through AI-proposed, Ben-confirmed mappings. It should keep the deterministic checks and questions that guard against the unit and convention errors users actually report. [Inference]

---

## 2. Architecture options

### 2.1 Options

| | A. Model transforms every row | B. Model proposes a mapping spec; code applies it | C. Chunked extraction checked against source text (free text) | D. Hybrid for semi-structured text |
|---|---|---|---|---|
| What the model does | Reads every row and writes every set | Reads header, statistics and samples; returns a typed spec | Reads each chunk; returns sets, each citing a line and an exact substring | Proposes a line grammar from a closed pattern list (`{load}x{reps}`, `{sets}x{reps}@{load}`, `{reps}/{reps}/{reps}`). Code applies it; lines it can't read go to C |
| Numbers touched by the model | All of them | **None** | All of them, but each is checked against its source substring | None for lines the grammar reads |
| Typical failure | Silent digit errors, dropped or invented rows. LLMs make errors "incorrectly citing or omitting table values" "despite understanding the table structure" (arXiv 2606.32029, 30 Jun 2026) | A **whole column** misread (e.g. reps and sets swapped). It is systematic, so it shows up in worked examples and sanity flags | Wrong exercise or date attached; a set missed. Invented numbers are blocked by the substring check | Same as B for the grammar; same as C for the rest |
| Data sent | The whole file | Header, statistics, ≤ 30 redacted rows | The whole text (explicit OK) | A sample to propose the grammar, then only lines it can't read |
| Calls for ~4,200 sets | ~40–50 | 1 (plus one retry) | ~20–60 | 1 plus a few |
| Est. cost on an API key [Inference, below] | ~$2–2.50 + reasoning | ~$0.02–0.03 + reasoning | ~$1–3 + reasoning | Under $1 + reasoning |
| Est. time [Inference] | Tens of minutes | Seconds to tens of seconds | Minutes to tens of minutes | Seconds to minutes |
| Run again | Different each run | Spec frozen once confirmed; then **deterministic and offline** | The extracted table is frozen; a re-run creates a new table, never new commits | Grammar frozen into the profile |
| Verdict | **Reject** | **Use for every tabular file** | **Use only for free text, opt-in** | **Use first for Notes-style logs**; C handles what's left |

Estimates [Inference]:
- **Pricing:** the API list price of `gpt-6.1-sol`, $2 input, $0.10 cached and $10 output per 1M tokens [Doc, model page]. On the ChatGPT-plan route there is no dollar cost, but the work comes out of Ben's unpublished weekly allowance ([ai-access-and-voice.md](ai-access-and-voice.md) §1).
- **Token assumptions:** about 25 input tokens per CSV row, about 45 output tokens per set as JSON, and about 3k tokens of instructions plus schema per call.
- **Mapping call:** about 5k tokens in and 1.5k out.
- **Reasoning tokens are not included.** `gpt-6.1-sol` is a reasoning model (default effort `medium`; `none` and `minimal` unsupported) [Doc, model page], and reasoning tokens "are billed as output tokens" and take context [Doc, reasoning guide]. The figures above are therefore **lower bounds** for cost and time. The adapter can't set `reasoning.effort`, and the plan docs don't say what effort is used.
- **Output speed:** assumed 50–150 tokens a second. This is not documented: measure it.

### 2.2 Recommended architecture

```text
file / pasted text
  └─ detectFile (code): binary? SQLite? zip? delimiter, section markers, encoding
       ├─ built-in profile (FitNotes A1–C) ──────────────────────────────┐
       ├─ learned profile, exact fingerprint ────────────────────────────┤
       ├─ tabular, unknown → [Read with the coach] → mapping spec (B) ───┤
       │                                       → validateSpec (code) ────┤
       └─ free text → [consent] → line grammar (D) + chunked extraction (C)
                                          → verifySpans (code) ──────────┤
                                                                         ▼
                        SourceSetRow[]  (raw cells/line, evidence, provenance)
                                                                         ▼
          existing pipeline (ADR 0016): analyseImport → questions (names, units,
          dumbbells, bars, bodyweight, RPE-in-comments, dates) → preview with every
          per-exercise conversion → commitImport (per workout, idempotent) → Undo
                                                                         ▼
                        on commit: save/confirm learned profile (Your data)
```

The AI parts are a **proposal stage**. Every step after `SourceSetRow` is code that already exists and has been reviewed. This is the shape the 2026-10-09 CHANGELOG entry asks for ("the model proposes the mapping and code applies and validates it").

### 2.3 The mapping spec (sketch for the developer)

Strict structured outputs require every field to be `required`, optional fields to be unions with `null`, `additionalProperties: false` on every object, and a root object with no `anyOf` [Doc, structured outputs]. Maps are therefore arrays of pairs. String-length keywords (`minLength`, `maxLength`) are not in the documented supported list, so length caps go in a `pattern` or, more simply, in our own validator [Doc; Inference].

```ts
type ColumnRef = { header: string; index: number };   // must equal the header cell at that index
type UnitEvidence =
  | { kind: 'header_token'; column: ColumnRef; token: 'kg' | 'kgs' | 'lb' | 'lbs' }
  | { kind: 'unit_column'; column: ColumnRef; values: { cell: string; unit: 'kg' | 'lb' }[] }
  | { kind: 'ask' };
type DateFormat = 'YYYY-MM-DD' | 'YYYY-MM-DD HH:mm:ss' | 'D MMM YYYY, HH:mm' | 'unix_seconds'
  | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'day_month_order_unknown';
  // add an ISO 8601 'T' form if Ben's Hevy file uses one (openweight reports ISO in some Hevy exports)
type CellNotation = 'load_x_reps' | 'reps_x_load' | 'sets_x_reps_at_load' | 'reps_only' | 'unknown';
type Layout =
  | { kind: 'row_per_set'; setOrder: ColumnRef | null }
  | { kind: 'row_per_exercise_packed'; sets: ColumnRef; notation: CellNotation }       // JEFIT "100x5,100x5"
  | { kind: 'wide_set_columns'; setColumns: ColumnRef[]; notation: CellNotation }      // spreadsheets
  | { kind: 'sections_joined'; sessionsMarker: string; logsMarker: string;
      joinKey: { sessions: ColumnRef; logs: ColumnRef } };                             // JEFIT

interface ImportMappingSpecV1 {
  specVersion: 1;
  file: { delimiter: ',' | ';' | '\t'; headerLine: number; decimal: '.' | ',' };
  layout: Layout;
  workoutKey: ColumnRef[];           // Strong "Workout #"; Hevy title+start_time+end_time; FitNotes Date
  date: { column: ColumnRef; format: DateFormat };
  exercise: ColumnRef;
  load: { column: ColumnRef; unit: UnitEvidence } | null;
  reps: ColumnRef | null;
  setType: { column: ColumnRef; values: { cell: string; meaning: 'warmup' | 'working' | 'drop' | 'failure' | 'not_a_set' }[] } | null;
  rpe: ColumnRef | null;
  notes: ColumnRef[];
  durationSeconds: { column: ColumnRef; format: 'seconds' | 'h_m_text' | 'hh_mm_ss' } | null;
  recordKind: 'performed_log' | 'plan_or_template' | 'unknown';   // never assumed: Ben confirms
  unmapped: ColumnRef[];
  selfCheck: { line: number; date: string; exercise: string; load: number | null; reps: number | null }[]; // 3–5 rows
  unsupported: null | 'no_set_rows' | 'layout_outside_vocabulary';
}
```

The spec has **no load-convention fields at all**. Dumbbell each, pair or one, bar total or plates only, and added weight or assistance come from the existing ADR 0016 sources: the catalogue's `implements` and equipment, aliases, a closed list of name words computed by code, or Ben's answer.

### 2.4 Checks before review (all deterministic)

1. **Schema:** the same validator as `packages/schemas`. Strict mode on the wire is a second guard, not the only one; the plan docs don't say whether strict is enforced there, and OpenAI says "Structured Outputs can still contain mistakes".
2. **References:** each `ColumnRef` equals the header cell at that index. A column has only one role, apart from notes.
3. **Evidence:**
   - `header_token`: the token is a whole word in the header cell.
   - `unit_column`: every non-empty value in that column, across the **whole file**, is one of the listed cells.
   - `setType.values`: each cell exists among the column's observed values.
   - `D MMM YYYY` month names must be English (otherwise unreadable).
   - Day/month order is settled only when code finds a first field above 12. Otherwise it is asked.
4. **Self-check:** apply the spec to the `selfCheck` lines. Any difference from the model's own reading rejects the spec. Those readings are used only for this check and are never imported.
5. **Dry run** over the full file:
   - at least 95% of rows must read;
   - sanity flags: more than 1,000 reps, more than 1,500 kg or 3,000 lb, dates before 2000 or in the future;
   - unit plausibility is shown as statistics, never as a decision.
6. **Questions:** `recordKind` is always a question unless a built-in or learned profile settles it. Columns named like `Target`, `Planned`, `%1RM` or `Goal` are listed in that question.

---

## 3. Structured outputs on GymSmarter's Responses route

### Documented facts

| Topic | Fact | Source |
|---|---|---|
| Plan-route request rules | "Set `store: false` and `stream: true`." Send `input` as an array; explicit system-role items are rejected (use `instructions` or developer messages). Omit `background`, `conversation`, `max_output_tokens`, `max_tool_calls`, `metadata`, `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`, `safety_identifier`, `temperature`, `top_logprobs`, `top_p`, `truncation` and `user`, and `previous_response_id` over HTTP. Tools: "Group function/custom tools in namespaces or supply them through `additional_tools` input items." "Web search remains subject to model and account/workspace policy." Unsupported: image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors and Responses `tool_search`. "Text, images, and files are supported when the selected model accepts them"; the Files upload API is not. | [Doc] preview-limitations |
| `text.format`, `tool_choice`, `parallel_tool_calls`, `reasoning` on the plan route | **Not mentioned**, either as allowed or as forbidden. | [Doc] preview-limitations, models-and-inference |
| Plan-route usage errors | A usage-limit error "can arrive as `response.failed` with `subscription_sharing_usage_limit_exceeded` or `subscription_sharing_usage_unavailable` after streaming has begun". Limit exceeded (429): "Pause new requests that use the user's ChatGPT plan"; "Do not assume the entire plan is empty or infer a reset time from this code alone." Unavailable (503): retry later with bounded backoff. | [Doc] models-and-inference, errors-and-recovery |
| Structured outputs (API) | `text: { format: { type: "json_schema", name, strict: true, schema } }`. Limits: 5,000 object properties and 10 nesting levels; 120,000 characters across property names, definition names, enum values and consts; 1,000 enum values; a single string enum with more than 250 values is capped at 15,000 characters. `allOf`, `not`, `dependentRequired`, `dependentSchemas` and `if/then/else` are unsupported. Supported keywords include string `pattern` and `format`, number `minimum`/`maximum` and array `minItems`/`maxItems`. Check `refusal` and `status: "incomplete"` before parsing. "The first request you make with any schema will have additional latency." **"Structured Outputs can still contain mistakes."** | [Doc] structured-outputs guide |
| Strict function tools | "Under the hood, strict mode works by leveraging our structured outputs feature." Every object needs `additionalProperties: false` and every property `required`. If `strict` is omitted, Responses "will attempt to normalize your schema into strict mode when possible". `tool_choice: {"type":"function","name":…}` forces one function; `parallel_tool_calls: false` "ensures exactly zero or one tool is called". Namespaces are `{type: "namespace", name, description, tools}`; the guide shows **no `tool_choice` form for a function inside a namespace**. | [Doc] function-calling guide |
| Model limits | `gpt-6.1-sol` on the API: 1,050,000-token context, 128,000 max output, structured outputs and function calling supported, reasoning tokens supported (`reasoning.effort` `low`, `medium` default, `high`, `xhigh`, `max`). Reasoning tokens "are billed as output tokens". **Plan-route context, output limits and reasoning effort are not published.** Models are discovered at runtime. | [Doc] model page; reasoning guide; models-and-inference |

### Fit with `packages/providers` [Code: read in the repo]

- `PlanResponsesRequest` accepts only `model`, `input`, `instructions`, `tools`, `tool_choice` and `parallel_tool_calls`. A runtime guard rejects any other field, including `text` and `reasoning`. Tools must be top-level `type: "function"`, and `ToolChoice` has no namespace form.
- So the import can **probably** use today's adapter with one forced strict function whose arguments are the spec. **Not proven:** the plan docs say function tools go in namespaces or `additional_tools` input items, and ADR 0012 already lists "whether top-level function tools work or must be grouped in namespaces" as open (spike S3). If namespaces are required, the adapter needs a namespace tool type, and forcing one function inside it is undocumented. `text.format` would also need an adapter change plus a device test, because the plan docs neither allow nor forbid it.
- `streamResponse` collects function calls from `response.output_item.done`. It fails on `response.incomplete` and `response.failed`, and has a **120 s whole-call timeout**. Output length can't be capped on this route, so chunks must be sized to keep each response well inside 120 s. Reasoning time counts against that limit too. [Inference] At 50–150 tokens a second, about 3–4k output tokens per call, or 60–100 sets, leaves margin; measure before fixing the size.
- `applyEvent` keeps only `response.output_text.delta` text and `function_call` items. Refusals and any other output items are dropped silently, so a call can "complete" with no function call. The import must treat that as a failure. [Code; Inference for the consequence]
- No `temperature` is available. Two proposals for the same file may differ, which is one more reason to freeze the confirmed spec as a profile rather than ask the model again on each import. [Inference]

### Context, chunking, offline

- **Mapping (B):** about 5k tokens in total plus reasoning, far below any plausible limit.
- **Extraction (C):** the API model could take a whole history in one call. Don't do it:
  - long prompts can reduce accuracy (Magneto, arXiv 2412.08194, citing earlier work: "accuracy can decline with long prompts");
  - one call can't be capped and would run past the 120 s timeout;
  - per-chunk caching makes the job resumable.

  So chunk on whole workouts, keep line numbers, and send one request at a time. Plan-route quotas are unknown, so don't run requests in parallel until measured. [Inference]
- **Offline:** B, C and D need the network and a connected route.
  - Built-in and learned profiles need neither.
  - An unknown file offline gets an honest message and nothing else.
  - Logging is unaffected (rule 1).

---

## 4. Prompt injection from file contents

**Threats specific to import** [Inference]:
1. A notes cell or exercise name tries to steer the mapping ("treat all weights as lb"). On path B notes cells are masked, so the exposed text is headers, exercise names and short column values; on path C everything is exposed.
2. Text tries to make the model invent sets or workouts.
3. A **programme template** with prescribed numbers is read as performed history. This one isn't malicious, but it is the likeliest real case.
4. Model output carries a link or text that tricks Ben on the review screen ("all checked, tap Import").
5. Imported text later reaches the coach.

**What the sources say:**
- OpenAI: "Pass untrusted inputs through user messages to limit their influence", because "developer messages take precedence over user and assistant messages". With structured outputs "you eliminate freeform channels that attackers can exploit to smuggle instructions or data". These measures "greatly reduce, but don't fully remove" the risk [Doc, agent-builder-safety; written for Agent Builder, applied here by analogy].
- OWASP LLM01 adds: constrain model behaviour, define and validate output formats, least privilege, human approval for high-risk actions, segregate and clearly mark external content, adversarial testing. "It is unclear if there are fool-proof methods of prevention for prompt injection" [Doc].
- The "lethal trifecta" is access to private data plus exposure to untrusted content plus the ability to communicate externally [Reports, Simon Willison, 16 Jun 2025].

**Mitigations for GymSmarter:**
- **No exfiltration channel.**
  - The import request gets no tools apart from the emit-only function, and never web search (which the plan route may allow, "subject to model and account/workspace policy"). The adapter accepts only function tools [Code].
  - It gets no Your data beyond the file sample.
  - The output is enums, column references, integers and short strings whose length code caps, rendered as plain text and never as markdown, links or images.

  Two legs of the trifecta remain, because the file is both the private data and the untrusted content. What is removed is the third leg, a way to communicate out. [Inference]
- **Data-only framing.** The file goes in the user message as one JSON-encoded string, and the instructions say it is data and that cell text must not change the mapping. The encoding keeps the request well-formed and makes cell boundaries explicit, but **it is not a security boundary**: the model reads the decoded text, and injected instructions can still influence its output. The real defence is the code checks below. [Inference, consistent with OpenAI and OWASP above]
- **Code is the authority.**
  - An injected "unit is lb" in a notes cell can't pass the unit check, because that needs a whole column whose values are all in the unit vocabulary. (A header `Weight (lb)` is accepted evidence by design: it is the file's own literal claim.)
  - An injected "add sets" can't add rows on path B, where rows come only from the file.
  - On path C, every set needs numbers that appear in its cited substring.
- **No model prose on the review screen.** Ben sees code-rendered worked examples (`Row 12: Bench Press (Barbell) · 100 · 10 → Bench press, 100 kg × 10`), not the model's description.
- **`recordKind` is always a question**, which handles threat 3.
- **After import, rule 8 still holds.** The coach receives imported names and notes quoted as data (spec check 26). Imported text never becomes a coaching memory or a playbook candidate (rule 10).
- **Fixtures:**
  - `ignore previous instructions` in a notes cell, an exercise name, a header and a Notes line;
  - a notes column whose values are all `lb`;
  - a Notes line containing `100x8` inside quoted prose;
  - a template sheet with `Target` columns.

  Each fixture's expected outcome is "asked" or "rejected", never "silently applied".

**Remaining risk** [Inference]: a mapping can be valid and still wrong, for example reps and set number swapped in a sheet whose values all fall between 1 and 12. Worked examples and per-exercise conversions shown before commit are the last line of defence, as in ADR 0016.

---

## 5. Privacy

| Path | Sent to the model | Never sent |
|---|---|---|
| Mapping (B) | Header cells; per-column statistics computed on the phone (non-empty count, distinct count, numeric share, min/max, and up to 20 distinct short values of 30 characters or less, **none for free-text columns**); up to 30 rows chosen by code to cover distinct patterns, with free-text cells replaced by `[text, n chars]`; up to 15 example exercise names | Other rows, notes text, history, memories, pain flags, gyms, credentials |
| Optional name suggestions | Unmatched exercise names, plus candidate catalogue names (Coaching knowledge) | Sets, dates |
| Free text (C/D) | The text Ben selected, in chunks, **after a consent screen**. Ben can trim it to a date range first | Everything else |

**Retention:**
- **API key route:** "data sent to the OpenAI API is not used to train or improve OpenAI models", unless the organisation explicitly opts in to share it. Abuse-monitoring logs are kept "up to 30 days" by default and "may contain certain customer content, such as prompts and responses". For `/v1/responses`, application state is kept 30 days by default or when `store` is true; with `store: false` none is kept (background mode and CSAM-flagged images aside) [Doc, your-data]. The adapter always sends `store: false` on both routes [Code].
- **ChatGPT-plan route:** the developer pages say nothing about retention or training. The overview says plan usage "does not grant access to their ChatGPT conversations or other account context" [Doc, token-sharing overview]; memories aren't named. The Help Center adds per-app weekly limits and credit use after limits only when explicitly allowed [Reports: search snippet; the page returned 403 to the fetcher]. **Whether ChatGPT data controls or API terms apply to plan-route requests is unknown.**
- The app's copy must not claim "not used for training" on the plan route. The Delete my data screen already says "Anything OpenAI keeps under your own account" is not removed (`data-import-export.md` §2.7).

**On the phone:** cached chunk results and the sample sent are stored with the import job (Your data). They are deleted with `Delete my data` and covered by backups like import rows (ADR 0016).

An optional future alternative is Apple Foundation Models on the phone, with guided generation and a 4,096-token context ([ai-access-and-voice.md](ai-access-and-voice.md)). It could do the mapping step offline with no data leaving the phone, but it needs a Swift module and its accuracy is unknown. Not for v1. [Inference]

---

## 6. Real export formats the AI path should handle

| Source | Exact header / structure | Unit | Dates and times | Quirks the import must ask about or handle | Evidence |
|---|---|---|---|---|---|
| **Strong (old)** | `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE` (comma) | **Not in the file** (app setting) → ask | `YYYY-MM-DD HH:mm:ss` start time; `Duration` as text `42m` / `1h 8m` | `Set Order` holds numbers or `W`/`D`/`F` markers, and `Rest Timer` rows aren't sets (Gript; it doesn't say which layout, so handle both). Hevy and Surpass accept only English Strong files, which suggests headers are translated in other languages [Inference, not seen] | [Code] StrongCSVVisualizer README (comma, columns, duration text); [User] intervals.icu post, 14 Dec 2021 (same columns, delimiter not shown); [Reports] Gript (markers, Rest Timer, missing unit); [Reports] Hevy's English-only rule (snippet); [Doc] jacked.coach |
| **Strong (new)** | `"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"` (semicolon, all quoted) | Header token `(kg)`; the lb form is `Weight (lb)` per one README only, **not seen in a real file** | `YYYY-MM-DD HH:mm:ss`; `Duration (sec)` as seconds (`600`) | `Workout #` is the workout key; multiple workouts per day are possible. Gript's "no unit in Strong's CSV" can't describe this layout, so its page probably predates it [Inference] | [User] openGym #394 (header from a Strong export, 5 Oct 2026); [Sample] gymruntohevy `strong.csv`; [Code] StrongCSVVisualizer |
| **Hevy** | `title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe` (strings quoted). Imperial: `weight_lbs`, `distance_miles` | Header token. **Three-way conflict:** Gript says Hevy writes either `weight_kg` or `weight_lbs` by account setting; Taper says weights are "always in the weight_lbs column regardless of your display unit"; openweight says the CSV has both kg and lbs columns. The one sample has `weight_kg` only → confirm on a real file | `"22 Dec 2025, 08:00"` (English month, comma inside quotes; Taper shows the same form); openweight reports ISO timestamps in some exports | `set_type` is `normal`/`warmup`/`dropset`/`failure`. For **assisted** exercises the weight is assistance [Reports: Hevy help seen via search results]. The `Assisted` name word (`Pull Up (Assisted)`) is evidence when present, but custom exercises can be of the assisted type under any name and the CSV has no exercise-type column, so an unmarked name proves nothing [Inference]. Workout key is title + start + end | [Sample] workout-data-sync `hevy_export_sample.csv`; [Reports] Taper, openweight, Gript; [Code] hito parser (local wall time, drops what it can't read; via search results) |
| **Liftosaur** | `Workout DateTime, Program, Day Name, Exercise, Is Warmup Set?, Required Reps, Completed Reps, Is AMRAP?, Required RPE, Completed RPE, Log RPE?, Required Weight Value, Required Weight Unit, Completed Weight Value, Completed Weight Unit, Ask Weight?, Completed Reps Time, Target Muscles, Synergist Muscles, Notes` | Per row (`Completed Weight Unit`) | `Workout DateTime` (format not shown) | **`Required …` columns are targets and `Completed …` columns are results**: never import targets as performed. Warm-up flag is explicit | [Doc] liftosaur.com/features/import-export (exact separators and quoting not shown) |
| **JEFIT** | Multi-section: `### WORKOUT SESSIONS ###` with `_id,mydate,starttime,starttimie,total_time`, then `### EXERCISE LOGS ###` with `belongsession,ename,logs`; `logs` = `"100x5,100x5,100x3"` | **Not in the file** ("depends on your in-app setting", openweight) → ask | Unix `starttime` (or misspelled `starttimie`), else `mydate` | Export path differs by source: Gript says the website (My Jefit → Settings → Data Controls → Export Data), openweight says the app's account settings. A spreadsheet re-save breaks the sections. Bodyweight sets are `0` | [Reports] openweight JEFIT guide; Gript JEFIT page. No official format doc found |
| **Boostcamp** | **No official export found.** A third-party Chrome extension (49 users, not security-scanned) writes a CSV (columns not published); an unofficial API wrapper exists | Unknown | Unknown | Format unknown → path B if Ben has a file | [Reports] Chrome extension listing; boostcamp-mcp |
| **Alpha Progression** | CSV export by email, download or clipboard. The 7.7 notes describe these options, but the same text also appears under 7.6.2, 7.6 and 6.2, so **when it was added is unclear**. **Columns not published** | Unknown | Unknown | Clipboard → a paste path is useful | [Doc] App Store listing |
| **FitNotes** (Android ≤1.23 / v24+ / FitNotes 2) | A1/A2: `Date,Exercise,Category,Weight (kgs|lbs),Reps,Distance,Distance Unit,Time[,Comment]`; B: `…,Weight,Weight Unit,Reps,…[,Comment]`; C: `Date,Exercise,Category,Weight (kg),Weight (lbs),Reps,Distance,Distance Unit,Time,Notes,Kind` | Header, unit cell or filled column | Date only | Already built-in (ADR 0016). **FitNotes 2 v14 may export Strong/Hevy-style CSVs**, which B or a Strong/Hevy profile would cover | `fitnotes-export-format.md` (2026-10-09) |
| **Google Sheets / Excel / Numbers** | No standard. Common shapes [Inference]: (a) long, one row per set; (b) one row per exercise with `Set 1`, `Set 2`… cells such as `100x8`; (c) summary `3x8 @ 100`; (d) programme templates with `Target`, `%1RM`, `Week` | Usually unstated → ask | Locale dates (`03/04/2025` is ambiguous) | Export one tab at a time as CSV (Google Sheets: File → Download → "Comma-separated values (.csv, current sheet)"). `.xlsx` is not read in v1: it would need a new dependency | [Reports] Google Sheets CSV guide; [Inference] shapes |
| **Apple Notes / text** | Free text, often `Bench 3x5@100`, `Squat 100x5, 105x5, 110x3`, `12/10/8`, `bench 225lbs - 8,8,6`, date headings | Usually unstated → ask | Headings in many formats | Notation is ambiguous (`3x12` vs `12x3`): ask once per notation with worked examples. iOS 26 Notes can **Export as Markdown** from the share sheet, one note at a time on iPhone, or Ben can paste text | [Doc] App Store listings of GymNote ("3x12, 12x3, 12/10/8", "Bench 170lbs 5x5") and Gym Note Plus ("bench 225lbs - 8,8,6"); [Reports] tip sites on Notes Markdown export (AppleInsider returned 403; 9to5Mac, Gadget Hacks and others agree) |

**No source format records dumbbell each, pair or one, or whether a bar is included** in any document reviewed here or in `fitnotes-export-format.md`. Those questions stay for every format.

---

## 7. Learned import profiles

| Aspect | Recommendation [Inference] |
|---|---|
| What is stored | `import_profiles` row: `id`, `version`, a name Ben can edit (`Strong export (semicolon)`), `fingerprint` (exact trimmed header cells, delimiter, section markers), the validated `ImportMappingSpecV1`, Ben's confirmations (unit, `recordKind`, notation readings, set-type map, date order) and provenance (`fromJobId`, file SHA-256, `proposedBy: 'ai' \| 'ben'`, model slug, proposed-at and confirmed-at times). |
| Domain (rule 10) | **Your data**, owner-scoped: it holds Ben's answers and was made from his file, like `exercise_aliases` (ADR 0016). Backed up in the Your data section, exported with My data, deleted by `Delete my data`. Built-in profiles are app code, not data. |
| Matching | Apply automatically only on an **exact** fingerprint match. A near match (an extra column) offers `Looks like your Strong profile, plus a new column "RPE"`, with deterministic reuse for the known columns and a question for the new one. AI is optional here. |
| Changes in the data | Each profile records what it has seen: set-type tokens, unit strings, date patterns, sign of weights per exercise. Anything new is asked, never absorbed. New exercise names go through normal matching; conventions for them never come from the profile. |
| Idempotency (rule 5) | The import job records `profileId@version` and the spec hash. The same file with the same profile gives the same `SourceSetRow`s and the same operation IDs. Workout keys come from `workoutKey` (Strong/Hevy can have several workouts a day), so ADR 0016's one-workout-per-date assumption becomes a per-format property. |
| Trust | Loaded profiles are checked against the same schema. One that fails (a damaged or edited backup) isn't used, and Ben is told. Profiles are data, never instructions. |
| Promotion | A profile proven on Ben's real files can later become a built-in format with his file's first line as a fixture. This is a developer task. |

---

## 8. Design implications (for the designer; no screens are specified here)

- The intro screen becomes `Import history`. FitNotes stays named, and `Other apps, spreadsheets or notes` is added.
- **Unknown header (replaces the DX5 dead end).**
  - When the coach is connected: `GymSmarter doesn't know this file's layout yet. The coach can read the first rows and suggest how to import it.` The screen shows what is sent (`Column names, a summary, and 30 rows with notes hidden`), the route line (`Using ChatGPT plan`) and `[Read with the coach]`.
  - Offline or not connected, it says so honestly and stops.
- **Review of the mapping:** worked examples only. Three or four source rows, each with its reading beside it, followed by the existing questions (units, record kind, notation, set types, names, conventions) and the per-exercise conversions.
  - Ben can reject a column role and pick another column from the file. This is a constrained choice, not a free mapping grid (DX5's concern).
  - Saving the profile happens at commit: `Remember this layout for next time` (on by default, visible).
- **Free-text consent:** `This sends the text you selected (about 38,000 characters, ~14 requests) to ChatGPT using your plan.` It also says that OpenAI may keep it under the account's terms, that OpenAI may use ChatGPT credits after plan limits if Ben has allowed that in ChatGPT settings, and offers `Send` and `Cancel`. Progress, Stop and Continue reuse the import progress pattern.
- **Provenance line per set:** `Imported from Strong export · row 1,204` or `Read by the coach from your notes · line 212: "Bench 3x5 @ 100"`.

---

## 9. Unknowns only an end-to-end test can settle

1. Whether the plan route accepts top-level function tools or needs namespaces or `additional_tools`; how to force one function if it needs a namespace; whether `strict: true` is enforced there; and whether `text.format` json_schema is accepted. This goes with spike S3 in ADR 0012.
2. The plan route's context limit, reasoning effort, output speed and per-call latency for a 5k-token mapping call and a 3k-token extraction chunk. Also whether chunks finish inside the adapter's 120 s timeout.
3. How fast a 40-chunk extraction uses Ben's weekly plan allowance, and how `subscription_sharing_usage_limit_exceeded` mid-job behaves on pause and resume.
4. Whether plan-route requests fall under ChatGPT data controls or API retention terms.
5. Mapping accuracy on real files Ben owns. Measure it as the share of fields correct before any edits, on each fixture and on his files.
6. Real Hevy and Strong exports from Ben's accounts, if he has any: which Hevy unit column(s) appear, Strong's lb header text, translated headers, and how dates are written in his locale.
7. Hermes speed when applying a spec to 10,000 rows on the iPhone (ADR 0016 check 27 applies).
8. What the model returns when it refuses under a forced `tool_choice`, and how that looks in the stream the adapter reads.

---

## 10. Fact-check (2026-10-09, second pass)

Every claim below was re-checked against its source on 2026-10-09. Items not listed were confirmed as written.

| # | Claim in the first draft | Finding | Status |
|---|---|---|---|
| F1 | Today's adapter can send the forced strict function (Summary 4, §3) | The plan docs say "Group function/custom tools in namespaces or supply them through `additional_tools` input items". The adapter sends top-level functions only, and ADR 0012 lists this as open (S3). The function-calling guide shows no `tool_choice` form for a namespaced function | **Corrected:** now "probably, not proven" |
| F2 | Plan route: "Hosted tools are unsupported" | Web search "remains subject to model and account/workspace policy"; the other hosted tools are listed as unsupported | **Corrected**, and "never send web search" added |
| F3 | OpenAI quote "Developer messages carry the most authority" | Not verbatim. The page says "developer messages take precedence over user and assistant messages" and "Pass untrusted inputs through user messages to limit their influence" | **Corrected** |
| F4 | JSON-encoding the file means "its content can't escape the quoting" | Overstated. The encoding protects the request structure, not the model, which reads the decoded text. OpenAI ("don't fully remove") and OWASP ("unclear if there are fool-proof methods") both say the risk stays | **Corrected** (§4) |
| F5 | Removing tools "leaves only one leg of the trifecta" | Two legs remain (the file is both private data and untrusted content); the external-communication leg is the one removed | **Corrected** |
| F6 | Magneto "notes it 'can significantly decrease with long prompts'" | That wording isn't in the paper (v2). It says "accuracy can decline with long prompts", citing earlier work | **Corrected** |
| F7 | Plan-route access statement came from a Help Center snippet and covered "memories" | The developer overview [Doc] says plan usage "does not grant access to their ChatGPT conversations or other account context". Memories aren't named | **Corrected** |
| F8 | API retention summary | Confirmed, but incomplete: abuse logs "may contain certain customer content, such as prompts and responses"; no-training has an opt-in exception; Responses keeps application state 30 days unless `store: false` | **Expanded** |
| F9 | Usage limit called `usage_limit` | Documented codes are `subscription_sharing_usage_limit_exceeded` (429) and `subscription_sharing_usage_unavailable` (503), possibly mid-stream; don't infer a reset time. Credits after limits are spent only if Ben allowed it, which the app can't see | **Corrected** |
| F10 | Cost and time estimates | `gpt-6.1-sol` is a reasoning model (default `medium`), and reasoning tokens are billed as output. The estimates leave them out | **Marked as lower bounds** |
| F11 | Structured-output limits and strict rules | All confirmed verbatim. `minLength`/`maxLength` aren't in the supported list, so "short capped strings" are capped by code | **Confirmed; note added** |
| F12 | Adapter handles the response safely | It drops refusals and any non-`function_call` items, so "completed with no call" is possible | **Note added** (§3, Rec 7) |
| F13 | Hevy unit: two conflicting guides | Three sources disagree: per-setting (Gript), always `weight_lbs` (Taper), both columns (openweight); the sample shows `weight_kg` | **Corrected** |
| F14 | Hevy `Assisted` name word is the assisted evidence | True when present. But Hevy custom exercises can be assisted under any name and the CSV has no type column, so a missing word proves nothing | **Caveat added** |
| F15 | Strong `W`/`D`/`F` markers and `Rest Timer` rows belong to the old layout; headers are translated | Gript doesn't say which layout. Translated headers are inferred from Hevy's and Surpass's English-only rules, not seen | **Re-labelled** |
| F16 | Strong lb header `Weight (lb)` | Only StrongCSVVisualizer's README says so; no real lb export seen | **Kept as unverified** |
| F17 | Alpha Progression CSV export "since v7.7" | The same text appears under 7.6.2, 7.6 and 6.2 | **Corrected** |
| F18 | Gym Note Plus example "squat 3x5@135" | Not on the listing; its example is "bench 225lbs - 8,8,6" | **Corrected** |
| F19 | JEFIT exported "from the website" | Gript says the website; openweight says the app's account settings | **Both noted** |
| F20 | Hevy "can't import its own export" | Not stated; implied by "only Strong CSVs" | **Re-labelled as inference** |
| F21 | SayLift: these apps "don't move logged history between apps" | The table is about importing into those apps (vendor marketing); Strong's CSV can still be read elsewhere | **Re-worded** |
| F22 | Liftosaur imports Hevy CSV and its own CSV | Also JSON backups and programme files | **Expanded** |
| F23 | Privacy: notes are masked on path B | Column statistics would still send short notes as "distinct values" | **Fix added** (Rec 8, §5) |

Confirmed unchanged: the Strong new header (openGym #394 and the gymruntohevy sample, verbatim), the Strong old header and duration text, the Hevy header and date form, Hevy `set_type` values, the Liftosaur header and import rules, the JEFIT sections and columns, the FitNotes headers (from `fitnotes-export-format.md`), the plan-route `store`/`stream` and omitted fields, every structured-output limit, the `gpt-6.1-sol` context, output and price, the 120 s timeout and request guard in `responses.ts`, arXiv 2606.32029, OWASP LLM01, the lethal-trifecta post, Train Libre #691 and openGym #394.

**Still uncertain after this pass:** the plan route's tool shape, strict enforcement, `text.format`, reasoning effort, limits and retention (§9 items 1–4); which Hevy unit columns a real export has; Strong's lb and translated headers; Liftosaur's delimiter and date format; Alpha Progression and Boostcamp columns; and whether the Hevy and OpenAI Help Center wording seen only in search snippets matches the live pages.

---

## Evidence classes

- **Documented fact:** OpenAI docs (preview limitations, models and inference, errors and recovery, the token-sharing overview, structured outputs, function calling, reasoning, your data, agent-builder safety, the `gpt-6.1-sol` model page), OWASP LLM01, the Liftosaur import/export page, the Strong export help page, the Alpha Progression App Store listing, the GymNote and Gym Note Plus listings, and the jacked.coach import page.
- **Samples and code:** the Hevy sample in workout-data-sync, the Strong sample in gymruntohevy, the StrongCSVVisualizer README, the hito parser description, and GymSmarter's own `packages/providers` and `packages/domain/src/import`.
- **Reports and user evidence:** Gript help pages and marketing, openweight guides, Taper, intervals.icu threads, openGym #394, Train Libre #691, the SayLift comparison, the Boostcamp extension and MCP, Notes Markdown tip sites, the Google Sheets guide, and Hevy and OpenAI Help Center wording seen only as search snippets.
- **Inference:** the architecture choice, the cost and time estimates, the spec vocabulary, the profile design, the chunk sizes, the threat list and the spreadsheet and Notes shapes.

---

## Proposed brief changes (for Ben to approve; nothing has been applied)

1. **§5 Data foundation**: replace "Import FitNotes CSV using a real export…" with:

   > "Import training history from FitNotes (built-in), from files whose layout Ben has confirmed before (learned import profiles, offline), and from new layouts read by the coach. The coach proposes a typed mapping from the column names and a small redacted sample; code checks it and applies it; Ben confirms worked examples. Free-text logs are read in chunks only after Ben agrees to send the text, and every number must appear in its cited line. Units, load conventions, notation, date order and planned-versus-done are never decided by AI."

   **This partly contradicts Ben's "we don't need import rules".** AI removes the per-app column rules. It doesn't remove the rules that check values or the convention questions (rule 6).
2. **§7 functions:**
   - rename `previewFitNotesImport(file)` to `previewImport(file | text)`;
   - add `proposeImportMapping(jobId, route)`, `validateImportSpec(spec, file)`, `extractFromText(jobId, chunkIds, route)`, `saveImportProfile(jobId, expectedVersion)` and `listImportProfiles(ownerId)`;
   - `commitImport` gains the `profileId@version` / spec hash in its staleness stamp.
3. **§8 tools:** state that import model calls are **outside** the coach's tool registry. They have no tools apart from one emit-only output function, and no Your data context. The coach still can't start an import (DX10).
4. **§11 dependencies:** add "Retention and training terms for ChatGPT-plan requests (undocumented)", "Tool shape on the plan route (top-level vs namespaced functions; spike S3)" and "Ben's list of history sources beyond FitNotes".
5. **CHANGELOG 2026-10-09 item 4:** refine "AI interprets any format" to "any **text-based** format (CSV/TSV, multi-section CSV, pasted or Markdown notes)". Binary backups, `.xlsx`, PDFs and photos are out of v1. Photos would need on-device OCR, and their numbers can't be checked against source text.
6. **Architecture:** when built, record the generic import pipeline (`SourceSetRow`, profiles, AI proposal stage) as a new ADR (the stack is unchanged; no new dependency).

## Proposed spec changes (designer / product manager; `data-import-export.md` and ADR 0016)

| # | Change | Why |
|---|---|---|
| AI1 | Replace DX5 ("unknown header stops; no manual mapping") with "unknown header offers `Read with the coach` when connected; otherwise stops as today". The review allows only constrained column-role corrections, shown as worked examples | Ben's 2026-10-09 direction. Keeps DX5's protection against kg/lb misreads, because unit stays a separate question |
| AI2 | New question `What is this file?` with answers `Workouts I did` / `A plan or template`, never pre-selected. Templates are not imported as history | Rule 6. Liftosaur `Required …` columns and spreadsheet templates |
| AI3 | New question for each cell notation (`"3x8 @ 100" means: 3 sets of 8 / 8 sets of 3`) with examples from the file | Notation changes stored values |
| AI4 | Workout identity per format (`workoutKey`). Times without a zone are stored as local wall time with `zone not recorded`, or Ben picks the zone. **Domain decision needed** | Strong and Hevy carry start times with no zone; CLAUDE.md asks for UTC plus zone |
| AI5 | Duplicate detection for timed formats: same workout key or a start within 1 minute (Liftosaur) besides the date rule | Strong/Hevy can have several workouts a day |
| AI6 | Provenance line for AI-read sets (§8) and a `Past imports` line naming the profile used | Rule 6 labelling |

## Sources (all checked 2026-10-09)

OpenAI and security:
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/your-data
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/guides/agent-builder-safety
- https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites (search snippet only; direct fetch returned 403)
- https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- https://arxiv.org/abs/2606.32029 (data referencing errors in tables, 30 Jun 2026)
- https://arxiv.org/abs/2412.08194 · https://arxiv.org/html/2412.08194 (Magneto schema matching, v2)

Formats and competitors:
- https://help.strongapp.io/article/235-export-workout-data (no column details; last updated 27 Apr 2021)
- https://forum.intervals.icu/t/import-strong-data-weightlifting-app/5531
- https://forum.intervals.icu/t/incorrect-weights-after-csv-upload-and-fix/60595
- https://github.com/Neyu703/StrongCSVVisualizer
- https://github.com/DuarteSantos8/openGym/issues/394
- https://github.com/aimarchirico/gymruntohevy · https://raw.githubusercontent.com/aimarchirico/gymruntohevy/main/strong.csv
- https://raw.githubusercontent.com/matanabudy/workout-data-sync/main/examples/hevy_export_sample.csv
- https://openweight.dev/migrate/hevy.html · https://openweight.dev/migrate/strong.html · https://openweight.dev/migrate/jefit.html
- https://thetaperapp.com/articles/how-to-export-hevy-data/
- https://griptapp.com/ · https://griptapp.com/help/import-from-strong · https://griptapp.com/help/import-from-hevy · https://griptapp.com/help/import-from-jefit
- https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy (search snippet only; 403)
- https://help.hevyapp.com/hc/en-us/articles/38386262243223-Bodyweight-Exercises-in-Hevy-Bodyweight-vs-Assisted-vs-Weighted (via search results)
- https://git.mlnp.fr/hito.git/file/lib/web/hevy_csv.mli (via search results; direct fetch 404)
- https://www.liftosaur.com/features/import-export
- https://apps.apple.com/app/id1462277793 (Alpha Progression)
- https://chromeboard.com/extension/boostcamp-history-→-csv-ndldfeicfhokabalcjmjhhdhinjilllo · https://glama.ai/mcp/servers/dcaslin/boostcamp-mcp
- https://jacked.coach/import-workout-history/
- https://saylift.app/best/workout-app-that-imports-your-routine
- https://github.com/rfivesix/train-libre/issues/691
- https://apps.apple.com/app/id6757185498 (GymNote) · https://apps.apple.com/app/id6746699616 (Gym Note Plus)
- https://appleinsider.com/inside/ios-26/tips/how-to-import-and-export-markdown-with-apple-notes-in-ios-26 (403 to the fetcher in this pass) · https://9to5mac.com/?p=1016130 · https://apple.gadgethacks.com/how-to/how-to-import-and-export-markdown-in-apple-notes-on-ios-26/ (via search results)
- https://spreadsheetclass.com/google-sheets-export-csv/
- FitNotes headers: sources listed in `docs/research/fitnotes-export-format.md` (checked 2026-10-09)

Repository (read 2026-10-09): `packages/providers/src/openai/responses.ts`, `constants.ts`; `packages/domain/src/import/*`; ADR 0012, ADR 0016; `docs/design/data-import-export.md`; `docs/brief/CHANGELOG.md`.
