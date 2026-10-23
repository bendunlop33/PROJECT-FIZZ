# Review: v3summary — D1 Keep for next time? and D8 coach next-time changes (batch 23 Oct)

Branch `claude/v3summary-23oct`, commits `0d573be..7d507a7` (5 commits on top of `9261625`). Checked against Ben's decisions D1–D9 (22–23 Oct), CLAUDE.md rules 1–10, the committed `workout-builder-v3.md`, and the design track's uncommitted §2.8 draft (main tree, `docs/design/workout-builder-v3.md` §2.8 and the D8 row at line 342). Nothing has run on a real iPhone.

## Verdict: CHANGES NEEDED

The plumbing is good. Start no longer prompts anywhere. Keep's Apply, Skip and Undo are versioned, idempotent, and written in one SQLite transaction with the draft's answer, so they survive a force-close. D8's chat Apply is version-fenced, and the gym, pain and rule-3 gates hold.

But the row's content is wrong on the main flow. Keep diffs the workout's state at Start against the stored template. It doesn't separate Ben's own structure edits, so whenever Your workout was touched at all, everything Today, Time, the gym or the coach did turns up as "Ben's change". Ben opens Today's card, taps Edit, then:

- changes only a load, after setting Time 20: the Summary offers to delete four exercises from his plan day;
- swaps one accessory: the Summary also offers `Bench press: 3 → 4 sets`, and Apply writes it.

The design track's review (`batch23-design.md` B1) found the same root cause in the prototype.

## Checks run by the reviewer

- `npm run typecheck`: exit 0. `npm run lint`: exit 0.
- `npm run test`: 475 files, 8816 passed, 2 todo, 0 failed (matches the builder's report).
- I wrote a temporary scenario file against the real SQLite harness (`apps/mobile/test/zz-reviewer-scratch.test.ts`) and deleted it after the run. It is not committed. The results below quote its output.

| # | Scenario | `keepNextTimeOf` result |
|---|---|---|
| R-A | Plan Push day (Bench, Incline DB, Cable fly, Lateral raise, Triceps pushdown). Today Time 20 min, Edit, **a load-only edit** on Bench, Start, finish | `Delete Incline dumbbell press`, `Delete Lateral raise`, `Delete Triceps pushdown`, `Delete Cable fly`, `Bench press: 3 → 4 sets` |
| R-G | Today at its own length, Edit, Ben swaps Triceps pushdown, Start, finish, Apply | `Add Close-grip bench press`, `Delete Triceps pushdown`, `Bench press: 3 → 4 sets`. After Apply the template's bench has 4 working sets (was 3); `source` `coach` → `ben` |
| R-H | Today, Edit, Ben swaps the main lift (Bench → Incline bench), Start, finish, Apply | `Add Incline bench press`, `Delete Bench press`. After Apply the `Push · bench press` template has no bench press, and Incline bench has no `main` flag |
| R-B | D8: the coach's "swap triceps pushdown next time" applied in chat, lands on Today's Push card, Start (no edits by Ben), finish | `Add Rope triceps pushdown`, `Delete Triceps pushdown`, `Bench press: 3 → 4 sets` |
| R-D | Plan day on Your workout, `Gym changed` to a dumbbell-only gym (the gym's automatic swaps only), Start, finish | `Bench press → Dip`, `Triceps pushdown → Diamond push-up`, `Cable fly → Dumbbell bench press` |
| R-E | D8 change landed on Today's card, `Back to plan day`, reload; then the next day | Gone that day. Back the next day (`Push · edited`), and the chat card still reads Applied |
| R-I | No plan; Up next's saved workout opened on Your workout with **no edits**; Today reloaded | `upNext.edited` is set, so Up next reads `Push A · edited` |
| R-F | Your workout at Time 40, then a D8 remove lands, then Time 75 | The removed exercise stays removed (correct) |
| R-C | Saved workout listing Bench twice, opened and started with no edits | No row (correct) |

## Rule check

- **Rule 1 (offline, honest AI):** met. Keep makes no coach call. D8 lands from local records.
  - R-I's `· edited` with no edit is a small honesty slip (S3).
- **Rule 2 (no silent change; proposals with Undo):** completed sets are never touched.
  - Keep is a real proposal, but its lines and its Apply include changes Ben never made (B1–B3).
  - D8's Undo can leave the card and the draft disagreeing after a force-close (S2).
- **Rule 3 (coach offers; structural changes are proposals):** the chat card waits for Apply, and the tool is gated as before.
  - Coach-landed changes are then offered as permanent plan changes on the Summary (B2), which the §2.8 draft forbids.
- **Rule 4 (achievable loads, equipment):** D8 refuses a swap that isn't doable at the draft's gym. Keep writes new exercises' loads as automatic (`targetLoad: null`).
  - The gym's own substitutions can be written into the home plan day (B2).
- **Rule 5 (idempotent, versioned, stale rejected):** met for Keep and for D8's chat Apply.
  - D8's landing matches by exercise onto drafts Ben edited since. The §2.8 draft says refuse (SP5).
- **Rule 6, 7, 8, 10:** no change. No new logging, network, secrets or migration (`keepNextTime` is an optional JSON field).
- **Rule 9 (pain):** a pain-flagged swap target never lands (tested).
- **Minimal copy:** short. It drifts from the §2.8 draft's copy (S6).

---

## Blocking

### B1. Keep lists Today's own derivations (Time cuts, the main lift's top/back-off count) as Ben's changes

**Where:**
- `apps/mobile/src/builder/builder-service.ts:1142` passes any `edited` draft, a load-only edit included.
- `:1151` `untimed(...)` only puts back a fit stored as `setup.timeFit`. Today's commit never stores one: `apps/mobile/src/services/today-session.ts:895-922` stores the fitted workout with `minutes` and no `timeFit`.
- `:1156-1160` compares that against the raw template (`routine.exercises`). But Today drafts through `assembleTodayDraft`, with its own fit (`packages/domain/src/today-v2/session.ts:261`, `grow: true`) and the main lift as a top set plus back-offs.

**Failure:**
- R-A. Ben sets Time 20 on Today, taps Edit, nudges the bench load and starts. The Summary asks `Keep for next time?` with four `Delete …` lines and `Bench press: 3 → 4 sets`. One Apply cuts his plan day to one exercise.
  - This breaks D1 twice: "Time changes never ask" and "ONLY when Ben changed the structure" (a load isn't structure).
  - The builder's assumption 4 acknowledges the Today-controls leak but not that it also fires on a load-only edit, or that Time is included.
- R-G. Any Edit from Today's card also lists `Bench press: 3 → 4 sets`. Apply writes 4 working sets into the template. Next time Today builds the main lift from 4, so each Keep can ratchet the main lift's volume.

**Fix:**
- List only Ben-authored structure edits, measured against what the workout opened as for those controls, un-fitted.
  - Either take `base` as the draft's own first version (Today's or the builder's opening plan, with Today's Time fit undone), not the stored template.
  - Or record structure edits by author on the draft (as `TodayEdit` does for the fit) and list only Ben's.
- Compare set counts like with like. The template's stored count against Today's drafted count for the same slot is not a change.
- Store Today's Time fit in the same `timeFit` form the builder uses (or an equivalent), so `untimed` works for Today drafts.
- Regression tests (exact `toEqual` on `lines`):
  - Today Time short + load-only edit → no row;
  - Today default length + one swap → exactly one swap line;
  - Today Time short + one swap → exactly that line;
  - Apply leaves every other exercise's working-set count unchanged.

### B2. Keep lists changes Ben didn't make: the coach's D8 landing and the gym's automatic swaps

**Where:**
- `builder-service.ts:1142`: the only filter is Today's mark (`today` / `nudge`).
- D8 landings (`landOne`, `:1085`), Coach review applies, and `changeGym`'s `swapIn` (`:1400-1420`) are all ordinary draft edits, so the draft reads `edited` and their changes enter the diff.

**Failure:**
- R-B. Ben applies the coach's "swap triceps pushdown next time" in chat. It lands on Today's card and he starts with no edits of his own. The Summary then offers to make the coach's one-off swap permanent (plus B1's phantom set).
  - The §2.8 draft says never: "Never for: … a coach edit (D2 offers, D8 next-time changes)". Line 342 says "the Summary's `Keep for next time?` doesn't list coach edits (only Ben's own)".
  - D1 says "only when Ben changed the workout's structure".
- R-D. At a hotel gym, `Gym changed` swaps Bench → Dip, Triceps pushdown → Diamond push-up and Cable fly → Dumbbell bench press. The Summary offers all three for the home plan day. Apply would make Dip the `Push · bench press` day's main lift.
  - A forced substitution is the same kind of thing as a Time cut: today's circumstances, not a new plan.

**Fix:**
- Exclude edits not authored by Ben from the diff: D8 landings (op ID `coach-land:*`), builder-coach / review / nudge applies, and the gym's swaps (`changeGym`).
- Either track author per slot change, or compute Keep from Ben's own edit log (same mechanism as B1).
- Tests:
  - R-B → no row;
  - D8 landing + Ben's own swap of another exercise → exactly Ben's line;
  - gym change alone → no row.

### B3. A swap on a Today-made draft reads as Add + Delete, and a main-lift swap removes the template's main lift

**Where:**
- Today's drafted slots carry no `origin`: R-G prints `origin: null` for every slot.
- So `keepDiff` (`packages/domain/src/builder/keep.ts:62-67`) can't pair a swap and emits `add` + `delete`.
- `keptExercises` then deletes the old entry and inserts a fresh one (`keep.ts:186`, `entryFor` at `builder-service.ts:2126`) with no `main` flag and no place or superset of the old one.

**Failure:**
- R-H. Ben swaps the bench for incline bench on Your workout (from Today's Edit) and taps Apply. `Push · bench press` now has no bench press and no main lift (the Incline entry has `main: null`).
  - Main-lift choice also drives the template key and Today's Main lift row, so the plan day's identity breaks.
- R-G shows the same pairing loss for an accessory: the line reads `Add … / Delete …`, not `Triceps pushdown → …`.

**Fix:**
- Give Today's drafted slots their template `origin` (as `workoutFromTemplate` does, `packages/domain/src/builder/scope.ts:34`).
- Or match current to base by the slot's template ref, not by exercise.
- Decide how a main-lift swap is treated (SP7). At minimum, never delete the template's main exercise through Keep; carry `main` to its replacement.
- Tests: a swap from Today's Edit gives one `A → B` line; a main-lift swap keeps a main lift in the template.

---

## Should fix (non-blocking)

### S1. D8 on Today: the landed change hides Today's controls, has no Undo on the card, and comes back after `Back to plan day`

**Where:**
- `apps/mobile/src/services/app-services.ts:951-972` (`landCoachOnToday`) commits and lands a Today draft for every plan day with a waiting change, so that card becomes `edited`.
- `apps/mobile/src/screens/today/TodaySession.tsx:519`: an edited card shows only `Back to plan day`. Time, Accessories, Abs and Supersets are hidden.

**Failure:**
- After the coach's change lands, Ben can't use Today's Time on that day. That cuts against D3 (inline Time on Today) and D9.
- The §2.8 draft (line 342) wants the change "shown there and on Today's card … with Undo". Today shows only `· edited`.
- R-E. `Back to plan day` discards the draft, and with it the change, for today only. The next day it lands again while the chat card still reads Applied.

**Fix:**
- Show the landed line with Undo on Today's card, and keep Today's Time control working on that draft (refit on top of it).
- Make `Back to plan day` on a draft holding a landing also undo the coach's Apply (as Your workout's Undo does), or never re-land after a discard.
- Coordinate with the todaylean track (D3).

### S2. D8 Undo isn't crash-safe: the card and the draft can disagree

**Where:**
- Chat Undo, `apps/mobile/src/coach/coach-service.ts:1759-1760`: the coach record is undone first, then the drafts are reverted (`.catch(() => false)`).
- Your workout Undo, `builder-service.ts:1671`: the draft is reverted first, then the record (`.catch(() => undefined)`).

**Failure:**
- A force-close or a failed second write after a chat Undo leaves the card `Undone` while Your workout still holds the swap, now with no `✦ … · Undo` (the toast is gone).
- In the other order, the card stays `Applied`, and the change lands again on another day's draft. That contradicts the report's "it never lands again on a later day".

**Fix:**
- Reconcile on every `landCoachChanges` open:
  - if the Apply is undone and the draft's last change is its landing, revert it;
  - if the draft holds `coach-land-undo:<id>` and the Apply isn't undone, undo it.
- Add a force-close test between the two writes.

### S3. Up next reads `· edited` for a draft Ben only opened

- **Where:** `apps/mobile/src/services/today-session.ts:663-669`. A draft opened on Your workout from the Library has no Today mark, so `todayDraftState` is always `edited`.
- **Failure:** R-I. After merely opening Push A, Today shows `Push A · edited`. The same happens when `landCoachOnToday` opens Up next's draft (`app-services.ts:969`) and the landing is then refused (pain flag, not doable).
- **Fix:** require a real change: a landing op, or any undoable builder edit on the draft.

### S4. Keep's Apply rewrites `Routine.source`, and Undo doesn't put it back

- **Where:** `builder-service.ts:2132` (`source: 'ben'`) and `:2155` (Undo keeps it).
- **Failure:**
  - For a legacy routine (`source` undefined), the stored loads are last time's actuals that next targets replace (`packages/domain/src/session/routines.ts:463`, `library.ts:290`). After Apply they read as Ben's Fixed pins, so progression silently stops on every exercise Ben didn't touch, and Undo doesn't reverse it.
  - For plan templates (`source: 'coach'`), the Library's `Coach` tag disappears for good (R-G).
- **Fix:**
  - Keep the routine's own `source`, or for a legacy routine null the untouched loads as `editableExercises` does.
  - Store and restore `source` in the Undo.

### S5. Several D8 changes on one draft: only the last can be undone

- **Where:** `landCoachChanges` loop (`builder-service.ts:1680-1700`). Each `landOne` replaces the draft's single-level `undo`.
- **Failure:** with two applied changes, Your workout shows only the last toast. The first one's chat Undo is refused as `changed_since` (`revertCoachLanding`, `:1707`), so it can't be undone from either place. The §2.8 draft says "each with Undo".
- **Fix:** land all waiting applies as one undoable edit with one combined line, or keep a per-apply inverse.

### S6. Copy and layout drift from the §2.8 draft (align when the design track commits it)

| What | Built | §2.8 draft |
|---|---|---|
| Kept line | `<Push · bench press> updated` | `Kept for next Chest` |
| Change lines | `Delete X`, `Add X`, `X: 3 → 4 sets` | `− X`, `+ X · 3 sets`, `X 3 → 2 sets` |
| Skip | no toast | toast `Plan unchanged` |
| Row position | `SummaryScreen.tsx:588`, before `Next time` | after `Next time`, above `Edit` / `Done` |
| Apply control | TextButton | outline pill |

### S7. Tests hide B1–B3

- `apps/mobile/test/today-session.test.ts:284` asserts `keep.lines` with `toContain`, so the phantom `Bench press: 3 → 4 sets` passes.
- No test covers:
  - Today's Time plus any Your workout edit;
  - a D8 landing reaching the Summary;
  - a gym change reaching the Summary;
  - a main-lift swap through Keep.
- `builder-service.test.ts:467`'s title says "Ben's own change under Time is the only line", but the body only tests Time alone.
- Use exact `toEqual` on lines and add the scenarios in B1–B3.

---

## Nits

- **N1.** `keep.ts:104`: `withWorkingSets` turns a copied top set into a back-off with the top set's reps, RPE and any pinned load. That contradicts D4 (back-offs worked out from their own reps and effort, below the top). Copy an existing back-off, or null the load and use back-off reps.
- **N2.** The Start-time plan write (`StartAlongside`, `packages/persistence/src/sessions.ts:575`) is now dead in the app. Remove it, or note why it stays.
- **N3.** `withCoachLanded` returns the landing's toast in place of the open's own (`N left out`, `Reloaded`), so that information is lost on that open.
- **N4.** With the 200-op cap (`MAX_WORKOUT_DRAFT_OPS`), an old `coach-land:*` op can fall out of `opIds`. A later open would then try to land again (a `reorder` would undo Ben's order). Unlikely; a draft-level `landed` set would be sturdier.
- **N5.** A Skip that turns out stale shows `Changed since · not kept`, which reads oddly for a Skip.

---

## Spec issues (for Ben and the designer)

- **SP1. What Keep compares against.**
  - The §2.8 draft defines `base` as "the plan day as drafted for today, Time cuts included", which conflicts with D1's "Time changes never ask". The builder (rightly) un-fits.
  - The spec should define `base` as what the workout opened as, un-fitted, and list only Ben-authored structure edits.
  - It should name what doesn't count: Today's controls and Time, the gym's swaps, coach edits. This is the same point as `batch23-design.md` SP1.
- **SP2. Undo → "offer again" against rule 5.**
  - The draft says Undo brings the offer back. After Undo the template has moved two versions past the one the workout opened, so a second Apply would need re-basing.
  - The builder made Undo final (assumption 7). Ben to choose.
- **SP3. Mid-workout structure changes.** The draft counts them ("on Your workout, or mid-workout"). The builder counts only changes before Start (assumption 1); a busy-machine swap is today's circumstance. Ben to choose.
- **SP4. Leaving the Summary = Skip.** The draft says so. The builder keeps the row until the next workout from that plan day starts, which `batch23-design.md` N4 recommends. Ben to choose.
- **SP5. D8 landing on a draft changed since.**
  - The draft says refuse (`Out of date. Ask again.`). The builder lands by exercise matching onto drafts Ben edited since.
  - The spec should also say where a waiting change is held, when it expires, and whether Today should create drafts for plan days Ben didn't pick (the builder does, assumption 6). See `batch23-design.md` SP5.
- **SP6. D8 against D3 (lean Today).** If a landed coach change makes Today's card `edited`, the spec must say whether Today's inline Time still works on it (S1).
- **SP7. Main lift and Keep.** Is a main-lift swap on Your workout a structure change to `Chest · bench`, or a different template? It currently corrupts the template (B3). See `batch23-design.md` SP7.
- **SP8. Variations after D1.** Nothing creates a variation now, and a workout opened from one never gets the Keep row (assumption 3). See `batch23-design.md` SP6.

## What's done well

- One SQLite transaction for the draft's answer and the routine write, with a rollback when the routine is stale. Op IDs per session and tap. Undo fenced to the version Apply wrote. All proven across a force-close on real SQLite.
- Apply writes only that plan day or saved workout, and leaves untouched exercises' set templates as stored (plan-day length kept).
- D8's chat Apply re-checks the template version inside the transaction (`commitStructuralTap`). Pain-flag and not-doable refusals hold. Pre-D8 cards stay `Out of date` and never land.
- The Start prompt, `Update plan day` and the CheckIn `builderStart` route are removed cleanly, with no dangling references.
