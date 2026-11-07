# Review round 2: builder-v2

**Verdict: CHANGES NEEDED**

This round covers branch `claude/builder-v2` at 135f449, diffed against `claude/gracious-knuth-joxqpw`. The fix commits are 4662f6a, f603dbf and 135f449. I checked them against the round 1 findings in `docs/reviews/builder-v2.md` and against `docs/design/workout-builder.md`, mainly §7 basis rules, §8.2 `recheckDraftLoad` and WB-L12.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --maxWorkers=2` | pass: 322 files, 6604 tests, 1 todo |
| Throwaway probes | I reran the round 1 probes and added variants of my own. They ran at two levels: domain (`checkProposedLoad`, `recheckDraftLoad`) and end to end (`checkWorkoutProposal` → `planCoachDraft` → `draftReasonLine`). The probes are deleted and not committed |

## Round 1 blocking findings

| # | Status | Evidence |
|---|---|---|
| B1 invented `load×reps` basis | **Fixed for the `×` form; still open for other forms (see B1r)** | `last 110×6 @8` at a 110 proposal now shows `last 100×7 @8 · capped → 107.5`, with the coach's text under NOT USED. `last 104×8 @7` is rejected. Wrong RPE, `kg×`, `X`, `*` and the comma decimal are all rejected |
| B2 final value in the reason line | **Fixed** | Clamp: `last 100×7 @8 · capped → 107.5`. Pain hold: `held · last 100×7 @8 → 100`. Snap (101): `last 100×7 @8 → 100`. A lb proposal gets code's basis in kg. A plan-time re-check that changes the load replaces the basis, and back-offs take the top set's basis. In every case the line's number equals the row target |
| B3 step bounds read as HELD | **Fixed** | 5 kg assist goes to 25 with `held: false` and the note `25 assist · one step from last 30`. +35 added goes to +21.25 with the same result. `provenance.held` is set only from the check's pain flag. No UI or domain code still prefix-matches `held` |
| B4 mid-workout draft not re-checked | **Fixed for the reported case; the fix changed the WB-L12 semantics (see B4r)** | The original probe: a session started 1 h before the build, logged after it, with 100×5 @10. The draft now plans 95 kg on all 4 sets, with `last 100×5 @10 · capped → 95` and `capped at 95 · newer session …` |

Spot checks:
- **S2: fixed.** `coach-service.ts:902` falls back to `training.profile.sessionMinutes` through `resolveBuildMinutes`. It is tested (`workout-builder.test.ts:1243`).
- **S3: fixed.** The set card target line and its VoiceOver label use `targetLineText` and `targetLineLabel` (`WorkoutScreen.tsx:1649,1655`, `WorkoutTable.tsx:1002-1003`), giving `· est.` and `, estimate`. The panel `LOAD` line is wired (`workout-services.ts:1726`). It is tested (`target-why.test.ts:373-383`).

---

## Blocking

### B1r. The proposal's value still passes as a bare history number, so invented history shows as fact (rule 6, §7 basis rules)

`packages/domain/src/session/builder-loads.ts:623` and `:665`. `basisAllowed` puts the proposal values (`p.value`, `final`) into `numbers`, and `:724` accepts them anywhere in the text. The tightened §7 says the proposal's values are allowed "**on their own only** (`→ 102.5` …), never as a cited set". Only the `×` pair form enforces that.

**Probe, end to end:** WB-L1 bench, last 100×7 @8. The coach proposes 102.5 kg (in band, so code keeps the coach's basis). The row reads 102.5 kg and the reason line shows each of these verbatim:
- `8 reps at 102.5 last time`
- `last: 102.5/8 @8`
- `last 2: 102.5, 102.5`

Ben never lifted 102.5. These are the same invented-set failure as B1. `8 reps at …` is a very natural way for a model to word a basis.

Two forms are rejected only by accident. `last 102.5 for 8` and `last 102.5 @8` fail because the `lastN` regex reads `last 102` as "last 102 sessions". That is not a real guard: add a colon or reorder the words and the check passes.

**Fix:**
- Keep the proposal values out of `numbers`. Accept them only when they follow `→` or `->` (a target), as §7 says.
- Treat `A/B` (and `A for B`, `B reps at A`) as a pair that must match a reference set, or reject any basis containing `/` between numbers.
- Add tests for the three probes above, plus `last 102.5 for 8` with a colon (`last: 102.5 for 8`).

### B4r. The plan-time re-check pools every unseen session, so a newest RPE 10 rep miss is diluted (WB-L12, §8.2 `recheckDraftLoad`)

`packages/domain/src/session/builder-loads.ts:817`: `ownReferenceOf(since, …)`. §8.2 says that when a comparable session is newer than the draft, the bands are computed from **"that newest session alone"**. The fix now computes them from all sessions logged since the check, up to 3 within the window.

**Probe, end to end:** a draft has bench at 102.5. After the build, Ben logs two bench sessions:
1. 102.5×8 @7
2. then the newest, 100×5 @10

The overview and Start both plan **102.5 kg** on all 4 sets, with the coach's original line `last 3: 100×7 @8 → 102.5` and no note. Before this round's change, and per WB-L12, the result would be 95 with `capped at 95 · newer session …`. A draft that sits for a few days while Ben trains is the normal case, so this is the WB-L12 failure coming back by a different route.

**Fix:** keep the version-based detection, but band on the newest one only: `ownReferenceOf([since[0]], …)`. Alternatively, cap by the stricter of "newest alone" and "all unseen". Add a test with two unseen sessions where the newest is the miss.

---

## Should fix

### S1r. A changed older history falls back to a full check that ignores the newer session (B4 edge)

`builder-loads.ts:812-813`. When older history changes between build and plan (a FitNotes import, or a correction to an older set), `sessionsSinceCheck` returns `null`. The re-check then runs `checkProposedLoad` against the whole history with `capReason: 'history changed'`.

**Probe:** an older bench session was corrected, and 100×5 @10 was logged after the build. The plan stays 102.5 with no note, because the last-3 bands still support it.

This is less common than B4r, because it needs an import or correction in the same window, but the result is the same miss. **Fix:** in the `null` branch, also band on the newest session by start time (or on any session whose ID wasn't in the checked set) and take the stricter result. Storing the checked session IDs, rather than only a hash, would make this exact.

## Nits

- **N1r. The reason line can drop the final value of a kept coach basis.** `builder-reasons.ts:34` (`cut`). A coach basis can be up to 60 characters. When it is kept unchanged, `held · ` or `est. · ` is added in front, and the line can then exceed `REASON_LINE_MAX` (64). `cut` then truncates the end, which is where `→ N` sits. Code's own basis is capped at 48 for this reason, but the coach's isn't. Either cap a kept coach basis at 64 minus the prefix length (fall back to code's basis when it's longer), or truncate in the middle.
- **N2r. A plain snap goes to the nearest load, including the harder one.** A proposal of 104 kg (in band) snaps to 105, and the basis honestly says `→ 105`, so this isn't an honesty problem. It is round 1's N6, still open, and the spec allows it.
- Round 1 nits N2–N5 were not re-verified this round.

## Spec issues

1. **The §8.2 `recheckDraftLoad` wording and the B4 fix pull in different directions.** The spec's "a comparable session newer than the draft" is time-based. That is what made B4 possible, since a session's time is its start. "That newest session alone" doesn't say what to do when several sessions are unseen. Reword it as: "the sessions not seen at build time (by history version); bands from the newest of them alone; on a changed older history, the full check **and** the newest alone, whichever is stricter". Then B4r and S1r have one clear target.
2. **The §7 basis rule should list the forms it rejects.** It says pairs must be reference sets, but not that `A/B`, `A for B` and `B reps at A` are pairs. Name them so the code and the tests check the same list.
3. Round 1 spec items 4 (BD20 scope) and 5 (the §8.5 bounds are still awaiting Ben's approval) are still open. The deferrals in §8.8 now record them, which is the right shape. Ben still needs to approve `BUILDER_LOAD_BOUNDS` before a real workout uses coach loads.
