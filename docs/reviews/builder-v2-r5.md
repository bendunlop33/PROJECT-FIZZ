# Review round 5: builder-v2

**Verdict: CHANGES NEEDED**

This round covers branch `claude/builder-v2` at 229c935. The fix commits are e0c71e0 (code) and 229c935 (spec). I checked them against round 4 (`docs/reviews/builder-v2-r4.md`) and the r5 decision:
- no digits in any displayed coach note;
- every load number comes from code;
- estimates carry `est.`;
- a pain-held assisted load stays easier;
- a light newest session doesn't raise the load;
- lb loads display in lb.

I also re-checked that the r2 and r3 fixes still hold.

The load-note gate is now closed. `checkBasis` (`packages/domain/src/session/builder-loads.ts:773`) rejects any digit in any script (`\p{N}`: fullwidth, superscript, Roman numeral and circled digits) and any number word. It runs at build time, at plan time on stored notes (including legacy `basisFromCoach` notes), and again when `Why?` and the set card read provenance. Every r2–r4 wording is under `NOT USED`.

The draft's other piece of coach text, the `message`/rationale, is shown on the build card and in `Why?` with no number check. It can state sets Ben never lifted, and the sentence splitter mangles decimals in it (B1u). That is the only blocking item.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --maxWorkers=2` | pass: 322 files, 6623 tests, 1 todo (run after the probes were deleted) |
| Throwaway probes | `packages/domain/test/zz-r5-probe.test.ts`: 24 `checkBasis` wordings, 8 light-newest-session re-checks, 13 pain-hold cases, 9 lb/kg display cases, and r2/r3 regressions. `packages/coach/test/zz-r5-probe.test.ts`: 7 `checkedRationale` messages. Both deleted; not committed |

## Earlier findings

| # | Status | Evidence |
|---|---|---|
| r4 B1t: `checkBasis` passes invented results | **Fixed** | Every r4 table wording (punctuation, dates, `again`/`repeat`, e1RM, differences) gives `coachNote: null`, the text under `NOT USED`, the line `last 3: 100×7 @8 → 102.5` and load 102.5 (test `B1t`). Probes `１０２.５ last time`, `last time ²`, `Ⅻ reps`, `①` and `IOO for seven` are all rejected |
| r4 B2t: legacy notes skip the check | **Fixed** | `storedCoachNote` → `shownCoachNote`. A legacy `→ 102.5×8 (last time)` gives `coachNote: null` and `notUsed` set. `loadWhyEntry` (`builder-reasons.ts:143`) and `target-why.ts:255` re-check when reading, so sessions planned before the rule never show it |
| r4 S1t: fallback to an estimate loses `est.` | **Fixed** | All history deleted → `source: 'coach_est'`, line `est. · first time …`. A stored estimate isn't promoted on unchanged history |
| r3 S2s: pain-held assisted clamped harder | **Fixed** | Last 20 assist with a shoulder flag. Proposals of 40 / 42 / 80 assist give 40 / 45 / 70 (machine max) `HELD`, and none is `capped`. A proposal of 5 is held at 20. A re-check of a stored 40 assist after a new flag → 40 `HELD`. Weighted pull-up +5 under pain → +5 `HELD` |
| r3 S3s: light newest session re-bands bench | **Fixed for no-1–12-rep sessions only** | 60×15 @7 newest → 102.5 is kept. No re-check raised a stored load (`noRaise`). Other light sessions still re-band (S1u) |
| r3 S4s: converted loads cited as logged | **Fixed in the reason line** | `last 225 lb×8 @8 (FitNotes) → 102.5 kg`, `last 3: 65 lb×10 @8.5 (FitNotes) → 27.5 kg each`, and for a kg set at an lb gym `last 100 kg×7 @8 (FitNotes) → … lb`. Other notes still show converted decimals (S2u) |
| r2 B1r, r3 B1s wordings | **Hold** | Covered by the new rule; tests pass |
| r2 B4r: newest miss | **Holds** | Unseen 102.5×8 @7, then 100×5 @10 → 95, line `last 100×5 @10 · capped → 95`, note `capped at 95 · newer session 8 Oct` |
| r2 S1r: older history changed | **Holds** | Older session corrected plus a newest miss → 95 `· history changed`; with pain as well → 95 `held` |
| Equipment max at re-plan | **Holds** | Incline 30 each re-planned at a hotel rack (max 20) → 20 each, `capped at machine max 20 kg` |
| r4 N1t–N3t | Not re-checked; no change | |

---

## Blocking

### B1u. The coach's draft `message` (rationale) is shown with any numbers, unchecked (r5 decision, rule 6)

**Where:**
- `packages/coach/src/build.ts:268-273` (`checkedRationale`) only removes change claims (`isChangeClaim`).
- The result is shown as plain body text on the build card in the coach thread (`apps/mobile/src/screens/coach/BuildCards.tsx:203-204`).
- It is also shown under `COACH` in `Why this workout` (`apps/mobile/src/coach/build-view.ts:185`), unquoted, directly above `LOADS`. The doc comment at `build-view.ts:173-175` says "nothing here is the model's number".
- The prompt asks for numbers. `CALL_RULES` (`build.ts:365`) and `SCOPED_BUILD_RULES` (`:387`) say "citing only facts given", and the load references are those facts.

**Probes (`checkedRationale` output = what Ben sees):**

| Coach `message` | Shown |
|---|---|
| `You did 105×8 on Tuesday, so bench leads.` | the same: an invented set, as fact |
| `Bench leads; last week you hit 110 for 6.` | the same |
| `Bench 102.5 since you hit 102.5 for 8 on Tuesday. Then incline.` | `Bench 102. 5 for 8 on Tuesday. Then incline.` The splitter at `:271` (`/[^.!?]+[.!?]*/`) cuts at the decimal point, drops the middle fragment and leaves a garbled claim |
| `Your est. max is 140, so bench at 110.` | `Your est.` (cut at `est.`) |

The decision was "no digits in any displayed coach note; all load numbers from code". The rationale is a displayed coach note. It can contradict code's target on the same card: the coach writes "110", code caps to 107.5, and both numbers appear. It can also state a past result Ben never lifted. That is the four-round B1 problem in another field.

**Fix:**
1. Apply the same rule to the message: drop any sentence containing `\p{N}` or a number word, and the max/record and praise words (reuse `checkBasis`'s regexes, without the 60-character limit).
2. Split sentences without breaking decimals or abbreviations. For example, split only on `[.!?]` followed by whitespace and a capital letter or the end of text, never between digits and not after `est.`. Or reject the whole message if any part fails.
3. Change both prompts to "a short reason in words, no numbers".
4. Add tests with the four probes above, and a mobile test that `draftWhyView` and the build card never show a digit from the coach.

---

## Should fix

### S1u. A light newest session with a set of 12 reps or fewer still re-bands the stored load, and can reject it to `Rule` (r3 S3s, partly open)

`newestAloneRefs` (`builder-loads.ts:871-877`) skips the newest session only when it has **no** 1–12 rep set on an e1RM convention. Probe: bench, stored 102.5, history 100×7 @8 and earlier, then one newer session:

| Newest unseen session | Re-check result |
|---|---|
| 60×15 @7 | 102.5 (fixed) |
| 60×12 @6 | **Rule**, `coach load 102.5 kg too far from last 60 × 12` |
| 60×10 @6 | **Rule**, same note |
| 60×10, no RPE | **Rule** |
| 80×8 @6 | **87.5**, `capped at 87.5 · newer session 8 Oct` |
| Weighted pull-up +5×15 @6 (stored +20, last +20×6 @8) | **+6.25**, `last +5×15 @6 · capped → +6.25` |
| Assisted pull-up 50×15 @6 (stored 20 assist) | **45 assist**, `capped` |

So a technique or deload day logged after the build replaces Ben's bench with a much lighter load, or with the rule fallback. Step conventions (`added`, `assistance`) aren't covered at all, because the `E1RM_CONVENTIONS` guard returns `alone`. These cuts make the load lighter, never heavier, so this isn't blocking. It is the same "light session re-bands the lift" bug as r3 S3s.

**Fix:** treat the newest session alone as a cap source only when it is a hard signal: a rep miss below `repsMin`, RPE ≥ 9.5, or a top set at or above the stored load's step. Otherwise use the unseen sessions together with the older references, as the full check already does. Apply the same rule to step conventions. Add the probe rows above as tests and clarify §8.2 (Spec issue 2).

### S2u. Notes still show converted or unit-less numbers next to lb history (r5 "lb display")

1. `builder-loads.ts:639`. A 225 lb proposal on a kg bar adds the note `102.058 → 102.5 (these plates)` under `lb → kg converted`. That is three converted decimals with no unit, shown as `ⓘ` in `Why?` `LOADS`. **Fix:** for a converted proposal, write `225 lb → 102.5 kg (these plates)`, using the proposal's own value and unit. Never format a converted value.
2. `builder-loads.ts:544-550` (step note). Assisted pull-up at a kg machine with a FitNotes 66 lb set gives `25 assist · one step from last 66 lb`. The kg target has no unit next to an lb reference. **Fix:** name the target's unit whenever the reference has `orig` (`25 kg assist · one step from last 66 lb`), as `reasonBasis` already does.
3. `fitKeepingTail` (`:740-752`). The same case's reason line becomes `last 66 lb×8 @8… · capped → 25 kg assist`, which drops `(FitNotes)`. The unit-bearing lines hit 48 characters sooner. **Fix:** shorten the `(FitNotes)` label to `(FN)`, or allow 56 characters when a unit is named. Add a test that no cited number is separated from its `lb`/`kg`.

### S3u. Words-only notes can still state a past result that isn't true (rule 6)

`checkBasis` blocks numbers but not claims in words. With bench last 100×7 and proposal 102.5, these pass and are shown quoted as `Coach's note`:
- `same weight as last time`, `you did this weight last time`, `you hit this for reps last week`, `smooth at this weight last time`, `you did it easily last week` (`PRAISE` has `easy`, not `easily`);
- `heaviest you have done`, `best set ever` (`MAX_WORDS` has `personal best`, not `best` or `heaviest`).

Code's line, just above the note, shows the real numbers, so the contradiction is visible. It is still an invented past result, shown behind `Why?`.

**Fix (pick with Ben, Spec issue 1):**
- (a) Also reject past-result phrasing: `last (time|session|week)`, `did`, `hit`, `lifted`, `same (weight|as)`, `again`, `before`, `ever`, `heaviest`, `best`, `easily`. This is a short list, because without numbers the claim space is small.
- (b) Drop free-text load notes entirely (r4 B1t option b).

## Nits

- **N1u.** `checkBasis` accepts `IOO×VII last time` (letters standing in for digits) and plural number words (`tens`, `hundreds`, `dozens`, `a couple of plates heavier`). This is unlikely from the model; `\b(?:one|…)s?\b` would close the plurals.
- **N2u.** Under a pain hold a 10 kg bench proposal becomes 20 kg (`HELD`, the bar), and 25 is accepted. That follows the new §8.5 text ("any easier load is kept"). A 75% drop that is really a typo now goes through silently. Consider a floor note (`well below last · check`) without blocking it.
- **N3u.** Typecheck and lint were run before the probe files were created. The full suite was run after deleting them.

## Spec issues

1. **§7 `checkBasis` now allows false past-result claims made in words** (S3u). Ben should choose (a) a short past-result word list or (b) no free-text load notes. The digits-only rule as written doesn't meet rule 6 by itself.
2. **§8.2 "light newest session"** is defined as "no set of 1–12 reps". It should be defined by signal, not rep count (S1u), and should cover the `added` and `assistance` conventions. Also still open from r4 Spec issue 3: whether an earlier unseen RPE 10 miss caps when the newest is borderline.
3. **§8.3 / §4.5: the `message` is "claim-checked" and "cites only facts given"** (B1u). Under the r5 decision it should be words only, with no numbers, the same as `basis`, and the `COACH` section should quote it as the coach's words. The post-build chat reply is ordinary chat (rule 3), but the spec should say whether it may name loads that differ from code's targets on the card just above it.
4. Still open: Ben must approve `BUILDER_LOAD_BOUNDS` (§8.5, §11.3) before coach loads are used in a real workout.
