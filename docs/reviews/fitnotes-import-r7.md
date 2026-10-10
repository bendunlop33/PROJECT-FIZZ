VERDICT: CHANGES NEEDED

# Review round 7: FitNotes import (build step 3), adversarial check of the bar rule

**Verdict: CHANGES NEEDED.** Two blocking findings. Both are names where the import still adds the 20 kg / 45 lb Olympic bar although the name says a different bar.

Round 6.2's B1 is fixed for the names it listed. Every name with no bar word, or with only a specialty-bar word, is now asked on its own row under `Add new` → Barbell, with nothing selected. "Total" stores the value as entered. N1, N2 and N4 are fixed and tested in kg and lb.

The adversarial pass then found two classes of name that still get the Olympic bar:
- **B1:** names that say the hex or trap bar followed by `Barbell`.
- **B2:** names that say two bars (EZ and barbell, Olympic and EZ or hex) and are mapped with `Choose…` or `Use this`.

Under "Total" for the group, no stored load differed from the file in any probe.

Reviewed: `b75fb70..ead53b7` on `claude/fitnotes-import`, 4 commits (`0504cbd`, `16d76ad`, `01f871e`, `ead53b7`).

Specs read:
- CLAUDE.md, especially rules 4 and 6;
- the PM decision: a load-affecting property comes only from (a) an exact name or alias, (b) Ben's explicit answer, or (c) an explicit word in the name; anything else is asked with nothing selected, and the conversion is shown;
- review r6.2;
- ADR 0016.

## What I ran

| Check | Result |
|---|---|
| `npm run check` | Exit 0. Typecheck, lint and catalogue validation pass, and guides are 10/10 |
| `npx vitest run` | 91 files and 1,242 tests pass |
| Probe matrix (temporary vitest file through `AppServices` on SQLite, real catalogue; deleted, never committed) | About 80 specialty, odd and FitNotes-default names, plus 13 two-bar names. Each was tested in kg and lb, under group "Total" and group "Plates only", through every mapping path: no answer (exact or alias match), `Use this` on the suggestion, `Add new` → Barbell, and `Choose…` → Back squat / Barbell curl / EZ-bar curl / Trap-bar deadlift. EZ and trap bar weights were entered when asked. For each name the probe compared the stored or previewed value with the file's value, and recorded whether the name was read by the group answer or asked |
| Commit probe | `Hex Barbell Deadlift` (`Add new` → Barbell) and `EZ Barbell Curl` (`Choose…` → Barbell curl), group "Plates only", committed in kg and lb (results under B1 and B2) |
| Diff grep for `console.*`, secrets and `eval` | None found |

### Probe results that are correct

- **Group "Total":** zero differences from the file, in both units and on every path.
- **Group "Plates only", asked with nothing selected:** every name with no bar word, or with only a specialty word, on `Add new` and on `Choose…`. Examples: `E-Z Bar Curl`, `Curl Bar Curl`, `Hex Deadlift`, `Trap Deadlift`, `Safety Squat Bar Squat`, `SSB Squat`, `Cambered Bar Bench Press`, `Swiss/Football/Multi Grip/Buffalo/Duffalo/Tsunami/Bamboo/Technique/15kg Bar …`, `Axle Press`, `Fat Bar Deadlift`, `Log Press`, `Yoke Walk`, `Landmine Press`, `T-Bar Row`, `Viking Press`, `Straight Bar Curl`, `Stiff-Legged Deadlift`, `Jefferson Deadlift`, `Snatch Grip Deadlift`, and all `Smith …` names.
- **Group "Plates only", read with a bar:** only names that say the bar (`Barbell`, `BB`, `Olympic`, `EZ`, `EZ-Bar`, `EZBar`, `Hex Bar`, `Hexbar`, `Trapbar`) or are an exact catalogue name or alias. The alias cases are SP1, as before.
- **Weights added:** +20 kg / +45 lb for the Olympic bar. The EZ and trap bars got the weight Ben entered, never the Olympic bar's.
- **Second import:** the 15 asked names are asked again.

## Round 6.2 findings: status

| # | Status | Evidence |
|---|---|---|
| B1 `Add new` → Barbell gives the Olympic bar to names that say another bar | **Fixed for every name with no bar word, or only a specialty word.** Still open for `Hex/Trap Barbell …` (B1 below) | `newBarFromName` (`plan.ts:446`), `fitnotes-import-r6-2.test.ts` in kg and lb |
| N1 Split label for a stack exercise | Fixed | `views.ts:859-866`, tested |
| N2 All-zero assisted name stored as a 0 stack load | Fixed: stored as bodyweight with no load | `plan.ts:904-906`. This affects only `loadAs` names, because others were already stored this way |
| N3 Dropped replay answers not explained | Not addressed (noted in ADR) | |
| N4 Re-mapped name keeps a bodyweight answer whose meaning changed | Fixed. The clear is recorded as a change, so a replay does the same | `import-service.ts:537-549`, tested |
| N5 | Recorded in ADR only | |

## Blocking

### B1. `Hex Barbell …` / `Trap Barbell …` names get the Olympic bar

**Where:**
- `packages/domain/src/import/match.ts:198`: `/ (trap|hex) ?bar /` needs the word `bar`, so `hex barbell` doesn't match it.
- `packages/domain/src/import/match.ts:196`: `barbells?` matches `barbell`, so the name reads as `{barbell}` only.
- `newBarFromName` (`plan.ts:446`) and `barNamed` (`match.ts:448-451`) both then treat it as naming the Olympic bar.

**Failure (commit probe, real SQLite):**
1. The file has `Hex Barbell Deadlift 100`.
2. Ben answers `Add new` → Barbell, then "Plates only" for the group.
3. The preview is `ready: true`, with nothing asked.
4. The stored load is `{"value":120,"unit":"kg","convention":"total"}` in kg, and `{"value":145,"unit":"lb"}` in lb.
5. The new exercise is saved with `['barbell']` equipment, so later logging also assumes the Olympic bar.

**Other paths with the same result:**
- `Use this` on the suggestion (`Deadlift`): +20 kg / +45 lb.
- `Choose…` → Barbell curl: +20 kg / +45 lb.
- `Trap Barbell Shrug` and `Hex Barbell Shrug` behave the same way.

**Why it blocks:**
- The name explicitly says the hex/trap bar, and the matcher already treats `Hex`/`Trap` as the trap bar.
- `Barbell` is the generic noun in this name, not a claim about the 20 kg bar.
- So the 20 kg / 45 lb has no source. This is the same class as r6.2 B1 (`E-Z Bar Curl`): a recognised bar under another spelling.
- The only way out is the "Different for some?" row, which Ben would have to notice. It shows `100 kg → 120 kg (plates + 20 kg bar)`.

**Fix:**
- Let the EZ and trap entries also match when `barbell` follows the bar word: `/ (trap|hex) ?bar(bells?)? /` and `/ (ez ?bar(bells?)?|ez) /`.
- Strip `(ez|trap|hex) ?barbells?` before testing the barbell entry, the way `smith (machine)?` is stripped. Then `Hex Barbell Deadlift` names `{trap_bar}` only.
- This doesn't add a new spelling list: it stops `barbell` hiding a bar word the matcher already knows.
- Add tests in kg and lb on `Add new`, `Use this` and `Choose…`.

### B2. `barNamed` ignores a second bar word, so `Choose…`/`Use this` and `Add new` disagree on two-bar names

**Where:** `packages/domain/src/import/match.ts:448-451`, `return named !== null && !named.has('smith') && named.has(bar)`.
- `newBarFromName` (`plan.ts:449-450`) returns `{ bar: 'unknown', known: false }` when the name says two bar kinds.
- `barNamed` returns `true` if any one of them is the chosen exercise's bar.
- The fix report and the `newBarFromName` doc comment say the two use "the same rule". They don't.

**Failure (probe):** with group "Plates only", these names mapped to a barbell exercise are read by the group answer with the **Olympic** bar:
- `EZ Barbell Curl` → `Choose…` Barbell curl. Commit probe: `{"value":50,"unit":"kg"}` from 30 kg, and `{"value":75,"unit":"lb"}` from 30 lb. `ready: true`, nothing asked.
- `Close Grip EZ Barbell Bench` → `Use this` on the suggested Close-grip bench press: +20 kg / +45 lb. Under the PM decision, a word suggestion accepted with `Use this` gives the exercise only, so here the Olympic bar has no source at all.
- `Barbell EZ Curl`, `EZ Barbell Skullcrusher`, `EZ Barbell Preacher Curl`, `Lying EZ Barbell Triceps Extension` → `Choose…` Barbell curl: +20 kg / +45 lb.
- `Olympic EZ Bar Curl`, `Olympic Hex Bar Deadlift`, `Barbell Hex Bar Deadlift`, `Barbell Trap Bar Deadlift` → `Choose…` Barbell curl: +20 kg / +45 lb.

The same names under `Add new` → Barbell are asked (`bar: unknown`), so the result depends on which button Ben pressed.

**Regression:**
- `Olympic EZ Bar Curl` and `Olympic Hex Bar Deadlift` chosen as a barbell exercise were asked before this round.
- `olympic` (`match.ts:196`) now makes `barNamed` true for them.
- `EZ Barbell Curl` is older, but it is a very common way to write the EZ-bar curl.

**Fix:**
- In `barNamed`, require the name to say exactly one bar kind, and that kind to be `bar`. That means `BAR_KINDS.filter((b) => named.has(b))` has length 1 and equals `bar`, which mirrors `newBarFromName`.
- With B1's stripping, `EZ Barbell Curl` names `{ez_bar}`: it is known on the EZ-bar curl, and asked on the Barbell curl.
- `Olympic EZ Bar Curl` stays two kinds and is asked, unless the PM rules that `Olympic EZ` is the EZ bar.
- Add these names to a test in kg and lb on `Choose…` and `Use this`.

## Should fix

None beyond B1 and B2.

## Nits

- **N1.** `apps/mobile/test/fitnotes-import-defaults.test.ts:41`: the test's own `BAR_WORD.barbell` lacks `olympic`. No FitNotes default contains it today, but if one did, the test would now disagree with the importer. Add it, or note why it's left out.
- **N2.** `Barbell Landmine Press` via `Add new` → Barbell becomes a `total` exercise and gets +20 kg under "Plates only". The catalogue's landmine press is `added`. The name says Barbell, so this passes rule (c), but the reading is probably wrong for a landmine. Consider SP2's "Other bar (weight asked)".
- **N3 (r6.2 N3, still open).** A dropped replay answer still reopens its question with no reason given.
- **N4.** The `newBarFromName` doc comment (`plan.ts:432-444`) says it applies "the same rule `Choose…` uses". Fix B2, or correct the comment.

## Tests

**Good:**
- r6.2 B1, N1, N2 and N4 have end-to-end SQLite tests in kg and lb.
- The 15 asked names are tested to be asked again on a second import.

**Missing:**
- `Hex/Trap Barbell …` names on any path (B1).
- Two-bar names (`EZ Barbell Curl`, `Olympic EZ Bar Curl`, `Barbell Hex Bar Deadlift`) via `Choose…` and `Use this` → a barbell exercise (B2).
- The r6-2 test covers only `Add new`. It doesn't check that the same names give the same reading via `Choose…`.

## Spec issues

- **SP4 (new, for the PM). A specialty modifier on `Barbell`.**
  - These names say `Barbell` and are read with the 20 kg / 45 lb bar under group "Plates only", on every path: `Safety Squat Barbell Squat`, `Cambered Barbell Bench Press`, `Swiss Barbell Press`, `Axle Barbell Deadlift`. So is `Women's Olympic Bar Squat`, whose bar is usually 15 kg / 35 lb.
  - The literal rule (c) allows this: the name has an explicit bar word. But the modifier says the bar isn't the standard one.
  - Catching it means either a word list (`safety`, `ssb`, `cambered`, `swiss`, `axle`, `women`…), which the PM rejected, or SP2's "Other bar (weight asked)".
  - I don't block on it. The PM should decide whether `Barbell` with any other word before it counts as naming the Olympic bar.
- **SP1, SP2 and SP3 (still open).**
  - SP1: catalogue aliases such as `Skullcrusher`, `Bent Over Row` and `Lying Triceps Extension` decide the bar (EZ for the last one). That is visible in this probe too.
  - SP2: `Add new` offers one bar kind. Because of it, an exercise created from `Hex Barbell Deadlift` or `Log Press` is saved with Olympic-bar equipment.
- **Still open from earlier rounds:**
  - ADR 0016 is still "Proposed";
  - the Smith bar weight;
  - nothing has run on Ben's iPhone or on his real export (checks 16 and 27).
