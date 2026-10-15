# Review round 4: builder-v2

**Verdict: CHANGES NEEDED**

This round covers branch `claude/builder-v2` at d05ef63. The fix commit is d05ef63 ("checkBasis: last-time claims span arrows and pairs; loads must be real loads"). I checked it against round 3 (`docs/reviews/builder-v2-r3.md`), the round 2 bar ("no number Ben never lifted may appear as a past result in the row or behind `Why?` as fact"), `docs/design/workout-builder.md` §7, §8.2 and §8.5, and CLAUDE.md rules 3, 4, 6 and 9.

The reason line under each row is still always code's, and every probe gave an honest line. The deterministic load path holds:
- equipment max is respected at build time and when a draft is re-planned at a gym with a smaller rack;
- pain holds never go above the most recent load;
- the B4r and S1r re-checks give 95.

`checkBasis` is still the hole. It now catches the exact strings from round 3, but a comma, a bracket or a date next to the arrow gets the same claims through. It also accepts the estimated 1RM and load differences as loads Ben "did". About 30 of my probe wordings reached the `Coach's note` behind `Why?`, each saying Ben lifted a load he never lifted. This is the fourth round of patching the regex one string at a time (see B1t for an allowlist fix).

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --maxWorkers=2` | pass: 322 files, 6616 tests, 1 todo |
| Throwaway probes | `packages/domain/test/zz-r4-probe.test.ts`: about 75 `checkBasis` wordings through `checkProposedLoad`, and 22 `recheckDraftLoad` / `checkProposedLoad` load-path cases. Deleted before the test run; not committed |

## Earlier findings

| # | Status | Evidence |
|---|---|---|
| r2 B1r: the five named wordings | **Fixed** | Bench, last 100×7 @8, proposal 102.5. `8 reps at 102.5 last time`, `last: 102.5/8 @8`, `last 2: 102.5, 102.5`, `last 102.5 for 8` and `last: 102.5 for 8` all give `coachNote: null`, the text under `NOT USED`, and the line `last 3: 100×7 @8 → 102.5` |
| r3 B1s | **Fixed only for the exact strings tested. Open in general (B1t)** | The listed r3 forms (`→ 102.5×8 last time`, `last session → 102.5 for 8`, `did 12 each`, and others) fail as intended. Close variants still pass (B1t) |
| r2 B4r: two-session newest miss | **Fixed** | Unseen 102.5×8 @7, then 100×5 @10 → **95**, `last 100×5 @10 · capped → 95`, `capped at 95 · newer session 8 Oct`. With the newest miss logged as 100×4 and no RPE → 92.5. A miss alone → 92.5. With pain as well → 95 `held` |
| r2 S1r: changed older history | **Fixed** | Older session corrected plus a miss → 95 `· history changed`. The newest seen session corrected into a 100×5 @10 miss → 95. Newest session deleted plus a miss → 95. An older heavy FitNotes import (115×6) doesn't raise the load (102.5 stays) |
| r3 S1s: legacy `basisFromCoach` note unchecked | **Open** | Stored `{ basis: '→ 102.5×8 (last time)', basisFromCoach: true }` with no history change → `coachNote: '→ 102.5×8 (last time)'` (`builder-loads.ts:931-932`, used at `:1029`) |
| r3 S2s: pain hold clamps an easier assisted load harder, labelled `capped` | **Open** | Assisted pull-up, last 20 assist, shoulder flag, proposal 40 → **30 assist**, `last 20×8 @8 · capped → 30 assist` |
| r3 S3s: a light newest session re-bands a barbell lift | **Open** | Newest unseen 60×15 @7 → **62.5 kg** bench (also when an RPE 10 miss came before it) |
| r3 S4s: converted loads cited as logged sets | **Open** | FitNotes 225 lb ×8 at a kg gym → `last 102.06×8 @8 (FitNotes) → 102.5` |
| r3 N1s–N3s | Not re-checked in code. No change in this commit | |

---

## Blocking

### B1t. `checkBasis` still passes notes that state a past result Ben never lifted (rule 6, §7)

The gate is `packages/domain/src/session/builder-loads.ts:847-897` (`checkBasis`), with `pastNextToArrow` at `:818-828` and `basisAllowed` at `:734-766`.

Fixture: bench, last 100×7 @8 (and 97.5×8 / 97.5×7 earlier), estimated 1RM 130, proposal 102.5 unchanged. Ben has never lifted 102.5 or 130. Each note below passes, so it is stored as `coachNote` and shown quoted under `Coach's note` in `Why?`: the Why sheet `LOADS` (`apps/mobile/src/coach/build-view.ts:178`) and the set card (`packages/domain/src/session/target-why.ts:253`).

**1. A past-time word split off from the arrowed target by punctuation.** `pastNextToArrow` cuts the text into clauses at `[,;·()→]` (`:821`, `:823`), so a past-time word in a neighbouring clause is never seen. `LOAD_LAST_TIME` and `LAST_TIME_LOAD` allow only whitespace or `:` between the words and the number.

| Note | Reads as |
|---|---|
| `→ 102.5×8 (last time)` | Ben did 102.5×8 last time |
| `→ 102.5×8, last time` | same |
| `→ 102.5×8 · last time` | same |
| `→ 102.5×8; last session` | same |
| `last time (8 Oct) → 102.5×8` | same, with a date |
| `last time, → 102.5×8` / `last time; → 102.5×8` | same |

The spec forbids these by name: "a past-time word … next to an arrowed target fails" (§7).

**2. A date or day next to the arrowed target, with no past-time word.** None of these words are on the `PAST` list (`:802`). A digit before the arrow also turns the past-word check off (`:825`: `!/\d/.test(before…)`), so `hit 8 Oct` counts as "names its own load".

| Note | Why it passes |
|---|---|
| `→ 102.5×8 on 8 Oct`, `→ 102.5×8 on 6 Oct` | 8 and 6 are allowed numbers (reps or day) |
| `hit 8 Oct → 102.5×8`, `did 6 Oct → 102.5×8` | the day digit exempts `hit` and `did` |
| `same as 8 Oct → 102.5×8`, `8 Oct → 102.5×8`, `Tue → 102.5×8`, `Mon: → 102.5×8`, `yesterday → 102.5×8` | no `PAST` word |
| `→ 102.5×8 (Tue)`, `→ 102.5×8 like Tue`, `→ 102.5×8 as on Tue` | same |
| `→ 102.5×8 again`, `repeat → 102.5×8`, `→ 102.5 as last`, `→ 102.5 (same as last)` | `again`, `repeat` and bare `last` aren't past words |
| `logged → 102.5×8`, `completed → 102.5×8`, `→ 102.5×8 (logged)`, `→ 102.5×8 ✓`, `prev: → 102.5×8` | same |

**3. The estimated 1RM and load differences count as loads Ben lifted.** r3 added `loads` (`:737-765`), the set of numbers that may be "written as a load". It includes the e1RM (`:757`) and every proposal-minus-top difference (`:751`). The past-result verbs then attach to them freely:

| Note | Problem |
|---|---|
| `hit 130`, `did 130 kg`, `lifted 130`, `best 130 kg`, `top 130`, `last: 130` | 130 is the estimated 1RM. Ben never lifted it, and the `1RM`/`max` `est.` check (`:851`) only fires when those words are present |
| `did 5 kg`, `last 2.5 kg` | 5 and 2.5 are differences, not loads |
| lateral raise (1 kg rack, last 11 / 9 each, proposal 12): `did 3 each`, `was 3 each`, `hit 1 each` | 3 and 1 are differences, but read as dumbbells Ben used |

The spec text added in d05ef63 even allows "the estimated 1RM or a difference" to be written as a load. That is the spec half of the bug (Spec issue 1).

**Why the current approach keeps failing.** `checkBasis` is a denylist: it strips the forms it knows and accepts whatever is left. Every round has added forms, and every round a near-variant gets through. The 60-character limit doesn't help.

**Fix.** Pick one:
- **(a) Allowlist grammar (recommended).** Accept a note only when it parses as a closed form, for example `[last N: | last time: ]<ref set>(, <ref set>)* → <target>[×reps | for reps]`. Each `<ref set>` must be a reference set (`realSet`) and `<target>` must be the proposal or a signed difference (`+2.5`). The arrowed target must be the last token. Any letters outside a short list (`last`, `time`, `session`, `each`, `assist`, `kg`, `lb`, `reps`, `for`, `@`, `RPE`, `est.`, `≈`, `1RM`, `FitNotes`) send the note to `NOT USED`. The e1RM is allowed only as `est. 1RM N` / `≈ N`. A difference is allowed only with a sign (`+2.5`, `−5`).
- **(b) Drop free-text coach notes for loads.** Keep only code's line, and leave the coach's words under `NOT USED` or in chat. This is simpler, honest, and loses little, since the row and the Why sheet already show code's line.

Whichever you choose, add every wording in the three tables above to the B1s test (`packages/domain/test/builder-loads.test.ts`, "B1s (r3)") and to WB-L9.

### B2t. Legacy coach notes skip `checkBasis` entirely (r3 S1s, now blocking)

`builder-loads.ts:931-932` (`storedCoachNote`) returns the stored `basis` for any `basisFromCoach: true` draft, and `recheckDraftLoad` keeps it when the load is unchanged (`:1029`).

**Probe:** stored `{ load: 102.5, basis: '→ 102.5×8 (last time)', basisFromCoach: true }`, same history → `coachNote: '→ 102.5×8 (last time)'`.

Drafts built before r3 were checked by the r1/r2 gate, which let `8 reps at 102.5 last time` through (r2 B1r). Once B1t is fixed, this becomes the only remaining path for an invented past result to reach `Why?`. That is why it is now blocking.

**Fix:** in `storedCoachNote`, return `null` for `basisFromCoach` and move the text to `notUsed`. Alternatively, re-run the current `checkBasis` with `basisAllowed(refsNow, slot, [stored value])` at plan time. Add a test with a legacy draft whose basis is an invented set.

---

## Should fix

### S1t. A draft whose references are all deleted becomes an estimate but loses its `est.` label (rule 6)

`builder-loads.ts:1027`: `source = since !== null && since.length > 0 ? r.source : stored.source`. When older history changed, `since` is `null`, so the stored `coach` source is kept even when the re-check fell back to an estimate.

**Probe:** stored bench 102.5 (`coach`), all bench history deleted → load **62.5**, `source: 'coach'`, line `est. · first time · capped → 62.5`. `coach-draft.ts:842` sets `estimate: true` only for `coach_est`, so the overview and set card show 62.5 without the `est.` mark, even though the reason line calls it an estimate.

**Fix:** use `r.source` whenever it is `coach_est` (an estimate always shows as one). Keep `stored.source` only to stop a stored estimate being promoted with no new own session. Add a test.

### S2t–S5t. Round 3 S2s, S3s and S4s are unchanged

Probes and fixes are as written in `builder-v2-r3.md`:
- **S2s:** a pain-held assisted load is clamped harder and labelled `capped`.
- **S3s:** a light 60×15 newest session takes bench to 62.5.
- **S4s:** a lb set is shown as `102.06×8`.

S2s goes against the intent of the rule 9 hold, and S4s against the "kg/lb always explicit" convention. They don't block this round only because they aren't invented results.

## Nits

- **N1t.** When the load is unchanged, a stored coach note is kept even though code's line now cites newer sessions. Probe: newest 105×6 @8 (with or without pain) → line `last 105×6 @8 → 102.5`, note `last 3: 100×7 @8 → 102.5`. Both are real sets, so it's honest, but `last 3` no longer describes the same three sessions. Consider dropping the note whenever `since` isn't empty.
- **N2t.** Newest-alone ignores a worse miss just before the newest session. Probe: unseen 100×4 @10, then 100×6 @9.5 → 100 (the miss alone would give 92.5). This follows §8.2, so it isn't a code bug (Spec issue 3).
- **N3t.** Lint and typecheck were run with the probe file present, and the full test suite after deleting it. All passed.

## Spec issues

1. **§7 (as amended in d05ef63) allows the estimated 1RM and differences to be "written as a load".** That is what makes `did 130 kg` and `did 3 each` legitimate under the spec. Proposed wording: "A number written as a load next to a past-result word must be a reference set's load. The estimated 1RM appears only as `est. 1RM N` or `≈ N`. A difference appears only signed (`+2.5`)."
2. **§7 should define the coach note as an allowlist grammar, not a list of forbidden forms** (B1t fix (a)). Or, if Ben prefers, it should drop free-text load notes entirely (fix (b)). Four rounds of adding forbidden forms haven't closed the gap, and Ben should choose between the two.
3. **§8.2 newest-alone:** say whether an RPE 10 miss in an earlier unseen session should still cap the load when the newest unseen session is only borderline (N2t). Also add the light-session fallback from r3 Spec issue 3.
4. Still open from earlier rounds: Ben needs to approve `BUILDER_LOAD_BOUNDS` (§8.5, §11.3) before coach loads are used in a real workout. Under a pain hold, the easy-side bound needs a ruling (r3 Spec issue 2).
