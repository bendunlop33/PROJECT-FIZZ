VERDICT: CHANGES NEEDED

# Review r8: FitNotes import, barbell "plates only" per exercise (PM decision after review r7)

Branch `claude/fitnotes-import`, commits `43991f0`, `cea370a`, `710b1d2`. Reviewer: independent reviewer, 10 Oct 2026.

## What was checked

- `npm run check`, run by the reviewer: exit 0. Typecheck, lint, 92 test files / 1253 tests, catalogue validate, and 10/10 guides all pass.
- The PM decision on every path: no answer, `Use this`, `Choose…`, `Add new` → Barbell, group answer, per-exercise answer, chosen bar, remembered answers, re-import of the same file, Undo import, and old jobs with a group `plates_only`.
- The invariant this round was asked to prove: **no stored value differs from the file without a per-exercise answer from Ben, or an exact remembered answer from an import that is still in effect.** Checked in kg and lb.
- Probes run through the real service on SQLite with the bundled catalogue. They were a throwaway test file, deleted afterwards and not committed. Results are quoted below.

## What holds

- **The group answer cannot add a bar.**
  - `totalReading` reads the group answer only as `total`.
  - `groupTotal` turns an old group `plates_only` into "unanswered" in both the analysis and `startingAnswers`.
  - The service refuses `{ kind: 'total', answer: 'plates_only' }`. The probe returned `ok: false`.
- **No bar is read from a name.** `barNamed`, `barWordsIn` and `newBarFromName` are removed. `Add new` → Barbell gets the Olympic bar, or the bar Ben chose.
- **The r6.1, r6.2 and r7 names and the FitNotes default names are stored as written** in kg and lb with only the group answer. The tests prove this through `Add new`, `Choose…` and `Use this`.
- **A plates-only row whose bar isn't recorded stays pending** (`reason: 'total'`) until Ben picks a bar. It is no longer marked unreadable.
- **Undo import takes back remembered barbell answers.** In the probe, after undoing A, import B started with `totalOverrides: {}` and `totalBars: {}`.
- **Clearing works.** When a later import's per-exercise answer is set back to the group "Total as written", the next import starts unanswered.

## Blocking

### B1. A remembered "plates only" is filled in with a bar weight Ben never gave, and the import is ready with no tap

Where: `packages/domain/src/import/plan.ts:1158-1159` (`aliasesToSave`), `:1184-1214` (`startingAnswers`), `packages/schemas/src/import.ts` (`AliasUseSchema.total`).

The remembered answer stores only `{ reading, bar? }`. It does not store the bar weight that answer was read with. A new file's preview starts from `DEFAULT_ANSWERS.barWeight` (20 kg / 45 lb). The only exception is when the earlier job is the *same* file.

Probe:
1. Import A (`a.csv`): "Thing" → `Choose…` Bench press, `Plates only`, Olympic bar weight set to 15 kg. 60 kg is stored as **75 kg**.
2. Import B (`b.csv`, a later export): it opens with `totalOverrides: { thing: 'plates_only' }`, `barWeight: { kg: 20 }` and `analysis.ready: true`. The row says "Your answer last time". On commit, 60 kg is stored as **80 kg**.

So with no tap in this import, B stores a value that differs from both the file and Ben's remembered answer.

The same happens across units. A plates-only answer given in a kg import is applied to an lb file with the 45 lb default, which Ben never confirmed. EZ and trap bars are not affected, because their weights start empty and are asked.

This is not an "exact remembered answer".

Fix:
- Remember the bar weight with the answer: `total: { reading, bar, barWeight: { value, unit } }`. Fill in a remembered `plates_only` only when the bar weight in effect for that bar and unit equals the remembered one.
- Otherwise show the row as `Your answer last time: plates only + 15 kg bar` with nothing selected, or mark the bar weight as "confirm".
- Test it in kg, in lb, and for kg → lb.

### B2. A remembered "plates only" follows the name to a different exercise and adds a different bar, labelled "Your answer last time"

Where: `packages/domain/src/import/remembered.ts:48`, `packages/domain/src/import/plan.ts:1205-1212`, `apps/mobile/src/import/views.ts:800`.

`rememberedAnswer` takes the newest use that said anything about `total`, whatever that use's `target` was. `startingAnswers` applies it by name key only. `aliasesToSave` stores `bar` only when Ben *changed* it (`barChosen`). As a result, the bar a remembered answer adds is re-derived from whatever exercise the name maps to now.

Probe:
1. Import A: "Thing" → Bench press (Olympic bar), `Plates only`.
2. Import B: "Thing" → `Choose…` Trap-bar deadlift, trap-bar weight 25 kg.
3. The row reads `Bar: Trap bar (from Trap-bar deadlift)`, `Now: 60 kg → 85 kg total (plates + 25 kg trap bar)`, `Your answer last time`, and `ready: true`. 85 kg is stored.

Ben's remembered answer was "plates only + Olympic bar" for the bench press. He never gave a trap-bar answer. The same happens without a re-map if the matched exercise's equipment changes, for example after a catalogue update.

The view's "Your answer last time" check (`views.ts:800`) compares only `reading` and the chosen bar. When `r.bar` is undefined it accepts any `exerciseBar`.

Fix:
- Always store the bar the answer actually added (`bar: e.bar` whenever `reading === 'plates_only'` and the bar is not `unknown`), together with the target exercise ID.
- Fill it in only when the name resolves to the same exercise and the same bar. Otherwise leave the row unanswered and optionally show "Last time: plates only on Bench press" as information only.
- Add tests for re-mapping to a different bar and for the matched exercise's bar changing.

## Should fix (not blocking)

### S1. Re-mapping a name in the same preview keeps its "plates only" and silently changes the bar

Where: `apps/mobile/src/import/import-service.ts:542-554`.

Ben answers `Plates only` for "Thing" → Bench press (Olympic), then goes back to the names step and picks `Choose…` Trap-bar deadlift. The override stays, the trap bar is added, and the preview is `ready: true`. In the probe, 85 kg was stored, while the answer was given when 80 kg was shown.

The r6.2 N4 rule already clears a bodyweight answer whose meaning changed on a re-map. The barbell answer should follow the same rule: when the resolved `bar` changes, clear `total_override` (and `total_bar`, unless Ben chose it) as a recorded change. The barbell question then reopens.

### S2. `Add new` makes the exercise with the chosen bar even when the answer is "Total as written", and the custom exercise ID ignores the bar

Where: `packages/domain/src/import/plan.ts:498`, `apps/mobile/src/import/views.ts:798` and the screen.

The bar buttons are active on every row, including rows answered `Total as written`. A remembered `bar` is also applied with a `total` reading. Choosing a bar there changes the equipment of the exercise `Add new` makes, which goes against the doc's statement that changing the bar affects only this import's numbers.

`customExerciseIdFor(owner, name, 'barbell')` is the same ID for every bar. If an earlier import already made "Thing" with the Olympic bar, this import computes with the EZ bar it shows, but the stored exercise stays Olympic, because exercises are never changed. The next import then shows `exerciseBar: barbell`.

Fix: apply the chosen bar to the made exercise only when the row is `plates_only`, or keep made equipment independent of `totalBars`. Disable or hide the bar buttons until `Plates only` is selected.

### S3. Paused jobs from earlier builds still write group "plates only" values

Where: `apps/mobile/src/import/import-service.ts:383`.

`Continue import` writes the rows stored at commit, so a job that an r7 build paused with a group `plates_only` still writes bar-added values. No real data has been imported yet, so the impact is small. Either note it in ADR 0016, or refuse to resume jobs whose stored answers have a group `plates_only` and offer Undo instead.

## Nits

- **N1.** A per-exercise answer can't be removed in the UI, only switched between `Total as written` and `Plates only`. The "forget" path (`total: null` in `aliasesToSave`) can't be reached from the screen.
- **N2.** Tests cover only the happy path for remembered answers (`fitnotes-import-r6-1.test.ts:110`): same unit, same bar weights, same target. Nothing covers a changed bar weight, a kg → lb remembered answer, a re-map after an answer, a change of the matched exercise's bar, or the bar buttons on `Total as written` rows.
- **N3.** The bar row repeats three buttons per exercise even where the exercise's own bar is clear. This is the long-list issue the developer already flagged.

## Spec issues (for the PM / designer)

- **SP1. The invariant is wider than ADR 0016.** This round's acceptance check ("no stored value differs from the file without a per-exercise answer") also covers dumbbells. There, the group answer `Both together` still halves values for exercises whose count is known from their own name (`perHandReading` with `count === 2`). The PM should confirm whether the invariant is about bar weight only, or whether the dumbbell group answer needs the same treatment.
- **SP2. Specialty bars have no bar choice.** Only Olympic, EZ and Trap are offered. For a safety-squat bar, log, cambered, Swiss/football bar or axle, `Plates only` adds 20 kg (or 45 lb), or Ben has to edit the single Olympic bar weight, which changes every Olympic exercise in the file. Suggest an "Other bar" choice with its own weight per exercise, or a bar weight per exercise.
- **SP3. "Total as written" still needs a tap** because of DX6, even though it is the do-nothing answer. Ben should decide.
- **SP4. Long-list layout.** A file with many barbell exercises gives a long list. The designer needs to propose a compact layout, since a bar-wide plates-only shortcut is ruled out.
- **SP5. All new copy is still unconfirmed by the designer** (`data-import-export.md` §2.5 step 3b note, ADR 0016 difference 36). The app has not been run on an iPhone.
