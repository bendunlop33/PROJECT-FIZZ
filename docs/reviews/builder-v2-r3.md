# Review round 3: builder-v2

**Verdict: CHANGES NEEDED**

This round covers branch `claude/builder-v2` at dd34dd5. The fix commits are 33b623d (code) and dd34dd5 (spec). I checked them against the round 2 findings in `docs/reviews/builder-v2-r2.md` and against `docs/design/workout-builder.md`: §7 (the reason line, the Coach's note and the basis rules), §8.2 `recheckDraftLoad` and §8.5.

The main fix holds. The reason line under each exercise is now always built by code, and every probe gave a line that cites only real sets and ends with the row's load. What's left is narrower. `checkBasis` still lets some notes that read like invented history through as a `Coach's note` behind `Why?`. In some cases it even breaks the rule its own doc comment states. Both gaps are small to fix.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --maxWorkers=2` | pass: 322 files, 6614 tests, 1 todo |
| Throwaway probes | `packages/domain/test/zz-r3-probe.test.ts`, about 45 cases through `checkProposedLoad`, `checkBasis` (via `coachNote`), `recheckDraftLoad` and `sessionsSinceCheck`. It was deleted and not committed |

## Round 2 findings

| # | Status | Evidence |
|---|---|---|
| B1r invented history as a past result | **Fixed for the row. Still open behind `Why?` for some forms (see B1s)** | Bench, last 100×7 @8, proposal 102.5. All five named wordings (`8 reps at 102.5 last time`, `last: 102.5/8 @8`, `last 2: 102.5, 102.5`, `last 102.5 for 8`, `last: 102.5 for 8`) give `coachNote: null`, the text under `NOT USED`, and the row line `last 3: 100×7 @8 → 102.5`. The same holds for `102,5 x 8`, `8 x 102.5`, `8×102.5 last time`, `102.5 ✕ 8`, `Last: 102.5 x8`, `last wk 102.5×8`, `did 102.5`, `previous: 102.5`, `hit 102.5 on 6 Oct`, `eight reps at 102.5`, `done → 102.5 for 8 @8` and `last 100×7 @8, 102.5 before`. The row (`draftReasonLine`) reads only `guardNotes[0]`, which is code's `basis`. The set card's `Why?` puts the coach's words under the label `Coach's note`, never `Reason` (`target-why.ts:252`) |
| B4r newest RPE 10 miss diluted | **Fixed** | Two unseen sessions (102.5×8 @7, then the newest 100×5 @10) give **95**, `last 100×5 @10 · capped → 95`, `capped at 95 · newer session 8 Oct`. With 3 unseen sessions: 95. With the miss started before the build and logged after it: 92.5. When the newest unseen session is the easy one, 102.5 stands, as §8.2 says |
| S1r changed older history | **Fixed** | Old session corrected plus a new miss: 95 (`· history changed`). Old FitNotes import plus a miss: 95. Newest session deleted plus a miss: 95. A FitNotes miss dated after the build: 95 via the "since" path. A correction alone: 102.5 kept |
| N1r long line drops `→ N` | **Fixed** | `fitKeepingTail` keeps `· capped → N`. It is tested |

---

## Blocking

### B1s. `checkBasis` still passes notes that state a past result Ben never lifted, and breaks its own "last time" rule (rule 6, §7)

These go through `packages/domain/src/session/builder-loads.ts:801-835` (`checkBasis`) and `:732-753` (`basisAllowed`). Each of the following becomes a `Coach's note`, shown quoted behind `Why?` (Why sheet `LOADS` and the set card), for bench 102.5 when Ben's last sets are 100×7 @8:

| Note | Why it passes |
|---|---|
| `→ 102.5×8 last time` | The arrowed pair is stripped first (`:809-818`). The "last time" checks (`:819-823`) then run on text with no number left. |
| `last time -> 102.5 for 8` | `LAST_TIME_LOAD` (`:778`) doesn't allow an arrow between `last time` and the number, and the arrowed `for` pair has already been accepted as a target. |
| `last session → 102.5 for 8` | Same as above. |
| `last 3 → 102.5×8 each time` | Arrowed target, with no past-time check. |

The doc comment at `:791-800` says "a load said to be `last time` is one of the most recent session's". The first three notes contradict that directly. A model writing "last session → 102.5 for 8" usually means "last session, then 102.5 for 8 today", but read on the sheet it says Ben did 102.5×8.

**Second hole: bare numbers that collide with a load.** `numbers` holds the slot's reps and RPE, day-of-month numbers and differences from the last top set. Any bare number matching one of them passes, even when it is written as a load. Probe: adjustable dumbbells in 1 kg steps, lateral raise, last 11 each ×15 @8, slot 12–15 @8, proposal 12 each. `did 12 each`, `previous: 12 each` and `was 12 each, keep` all pass as a `Coach's note`, because 12 is the slot's `repsMin`. Ben never used 12 kg. The same happens when the proposal equals a session's day-of-month (for example 28 each and a session on 28 Sep) or a difference.

**Fix:**
1. Run the "last time" forms before the pair strip, and let `LAST_TIME_LOAD` and `LOAD_LAST_TIME` span an arrow and a pair (`last (time|session|week)\s*:?\s*(→|->)?\s*A`, `A(×B)? (last time|previously|each time)`). Then the load must be in `lastLoads`.
2. Reject a past-time word (`last time|session|week`, `previously`, `each time`, `did`, `was`, `hit`) next to an arrowed target.
3. Track why each number is allowed. A number written as a load (followed by `kg`, `lb`, `each`, `assist` or `+`), or one equal to a proposal value, must match a reference load, the e1RM or a difference, not a rep, RPE or day number. Simplest version: any occurrence of a proposal value that isn't a real reference load is allowed only after an arrow, even if it collides with another allowed number.
4. Add the probes above to the B1r test in `builder-loads.test.ts:479` and to WB-L9.

This is blocking because this round's acceptance bar is that no number Ben never lifted reads as a past result, and `checkBasis` is the only gate on what reaches the `Coach's note`. The quoting and the label reduce the harm but don't remove it.

---

## Should fix

### S1s. Drafts written before this round still show their unchecked coach basis as a `Coach's note`

`builder-loads.ts:869-871` (`storedCoachNote`) and `:932` / `:969`. For a draft with `basisFromCoach: true`, `storedCoachNote` returns the old `basis` as the note. `recheckDraftLoad` keeps it whenever the load is unchanged. Those bases were checked by the round 2 `checkBasis`, which let proposal values pass as bare numbers.

**Probe:** stored `{ basis: '8 reps at 102.5 last time', basisFromCoach: true }` with no history change → `coachNote: '8 reps at 102.5 last time'`, shown on the set card as `Coach's note`.

**Fix:** for `basisFromCoach` drafts, either re-run the current `checkBasis` at plan time (the refs and slot are in hand), or move the text to `notUsed`. The second is simpler and honest.

### S2s. Under a pain hold, the easy-side step clamp makes the load harder than the coach proposed, and the line calls it `capped`

`builder-loads.ts:605-608` (the `clampEasy` branch) and `:630` (`capped = clamped`).

**Probe:** assisted pull-up, last 20 assist ×8 @8, shoulder flag active. The coach proposes 40 assist (a sensible back-off). The result is **30 assist**, `held: true`, with the line `last 20×8 @8 · capped → 30 assist` and the note `30 assist · two steps from last 20`.

Code overrides an easier choice made during pain to make the load harder. That isn't progression past last time, so rule 9 isn't strictly broken, but it is a guardrail working against the hold. `capped` also tells Ben the load was limited when it was actually raised. The same wording appears without pain.

**Fix:**
- When `ctx.pain !== null`, skip the easy-side clamp, since any easier load is acceptable under a hold.
- Use a different word for an upward clamp. The step note already says it, so the line could drop `· capped` when `v` moved harder.

The spec gap is under Spec issues.

### S3s. A newest unseen session with no set of 1–12 reps re-bands a barbell lift by plate steps

`builder-loads.ts:896-900` (`newestAloneRefs`) feeds `bandFor`'s step branch (`:528`), which also covers "no set in 1–12 reps".

**Probe:** a bench draft at 102.5. Ben then logs a light 60×15 @7 day. The plan becomes **62.5 kg** for 6–8 @8, with `last 60×15 @7 · capped → 62.5` and `62.5 · one step from last 60`. This is honest and not unsafe, but the target is far off: one high-rep session takes about 40% off the main lift.

**Fix:** in `recheckDraftLoad`, when the newest-alone reference has `e1rm === null` on an e1RM convention, don't band on it alone. Fall back to the full check over the unseen sessions (or keep the stored load with `bandsChecked`). Add a test.

### S4s. Converted loads read as logged sets

`builder-loads.ts:194` (`refSessionOf`) and `:641` (`setText`).

**Probe:** a FitNotes 225 lb ×8 @8 at a kg gym gives the line `last 102.06×8 @8 (FitNotes) → 102.5`. Ben lifted 225 lb, not 102.06 kg. A kg draft re-planned at a lb gym shows `220.46×7` the same way.

The number isn't invented, but the line presents a converted value as the set itself, which goes against the "kg/lb always explicit" convention and keeping original values as provenance.

**Fix:** when a cited set's original unit differs, cite it in its own unit (`last 225 lb×8 @8 (FitNotes)`), or round with `≈`.

## Nits

- **N1s.** At plan time with `bandsChecked`, the equipment fit uses `nearest` and skips the build-time guard at `:617` (re-round easier if the fit goes over `band.hardest`). On a different rack of the same kind (another gym, or an edited rack), a stored load at the cap can go up to half a step over it. That needs a load stored at the cap and an odd rack, so it is rare. Use `easier` when the item differs from `checkedOn.equipmentId`.
- **N2s.** On a changed older history, newest-alone can lower a load the coach set knowing about that same session (built after a miss, then any unrelated correction). This is conservative and per spec. Mention it in §8.2 so it isn't "fixed" later.
- **N3s.** `COACH` in `Why this workout` (`build-view.ts:184`) shows the coach's whole message (`checkedRationale`, which only removes change claims) unquoted. It has no number check, so "you did 102.5×8 last week" would show there. This predates this branch, and the chat thread shows the same text, but now the per-load notes are checked and the rationale isn't. At least quote it as the coach's words.
- Round 2 N2r (nearest snap may round harder within the band) is unchanged and allowed by the spec.

## Spec issues

1. **The §7 arrow exception is the hole in B1s.** "`→ 102.5×6` / `→ 102.5 for 6`" is allowed with no rule about past-time words around it, so `last session → 102.5 for 8` meets the letter of §7. Add this: "an arrowed target may not be preceded or followed by a past-time phrase (`last time/session/week`, `previously`, `each time`, `did`, `was`)". Also say that a number written as a load must be a reference load, even if it equals an allowed rep, RPE or date number.
2. **§8.5 step bounds under a pain hold.** The table says easier than 2 steps is clamped "to the limit" and BD10 says "no harder than the most recent". Neither says which wins when a pain-held proposal is far easier. Proposed wording: "under a hold, the easy-side bound doesn't apply".
3. **§8.2 newest alone needs a fallback** for a newest session with no set of 1–12 reps on an e1RM convention (S3s).
4. Round 1 and 2 items still stand: Ben needs to approve `BUILDER_LOAD_BOUNDS` (§8.5, §11.3) before coach loads are used in a real workout, and BD20 scope is deferred in §8.8.
