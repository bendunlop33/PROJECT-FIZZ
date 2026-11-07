VERDICT: PASS

# Review r3: merge of main into the Workouts library (claude/workout-library)

Reviewer: independent reviewer agent, 12 Oct 2026.
Scope: `claude/workout-library` at `197e04c` against `claude/gracious-knuth-joxqpw` (`c653dc6`). This round covers the two commits after review r2 (`bbb26c9`, [workout-library-merge-r2.md](workout-library-merge-r2.md)):

- `8c3b155`: a coach order keeps Ben's added exercise where he placed it (r2 S1)
- `197e04c`: a refused coach Apply that lands later says so once (r2 S2)

I also re-checked the whole scope: migration 12 numbering and in-place safety, feature parity, library ↔ picker, target RPE, coach structural proposals, workout gaps, Ben's decisions, rules 1–10 and minimal copy. Since r2, only 8 files changed (`git diff bbb26c9 HEAD --stat`). None of them is in persistence, the picker, target RPE or workout gaps, so those areas are as r2 found them.

## Checks run (in /home/user/wt-library)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (exit 0) |
| `npx vitest run --testTimeout=180000` | **262 files, 4865 passed, 1 todo, 0 failed** (441 s). That is 4 more tests than r2, which matches the 4 new tests. Nothing flaked, so no re-run was needed. |
| `npm run check:migrations` | `Migrations OK: 1 to 12, none reserved or empty.` |
| `git merge-base --is-ancestor claude/gracious-knuth-joxqpw HEAD` | true |
| `git diff --diff-filter=D claude/gracious-knuth-joxqpw HEAD` | empty: no file from main is deleted |
| Migration diff against main | Only `0012-today-fit.ts` and its line in `migration-list.ts`. 1–11 are byte-identical. 12's rebuilt `coach_actions` keeps all of 11's kinds, statuses, the four indexes and the no-delete trigger, and adds `fit_today`. There is no `[ios-build]` commit on the branch. |

## r2 findings: status

| r2 | Status | Evidence |
|---|---|---|
| S1: coach reorder moved Ben's added exercise to the end | **Fixed** | `withAddedPlaced` (`today-edits.ts:268-291`) puts each missing added slot back before the next slot it preceded in the live `order` it replaces. It works right to left, so a run of added slots keeps its order. If a placement would split a superset, or the slot was never placed or was last, it goes at the end. `applyDraftCommand` (`:364-367`) now reads `prev` before building the order. Domain tests (`today-edits-full.test.ts:257-286`) cover placement, Undo restoring Ben's order, a duplicate op ID, last stays last, never placed, a run of two, the superset fallback, and an order that already lists the slot. There is also a service test (`coach-structural-library.test.ts`, "keeps the exercise Ben added where he placed it"). The rule is in overview-today-edits §11.5. |
| S2: a refused Apply landed later unannounced | **Fixed, with a gap (S1 below)** | `applyCoachChanges` (`app-services.ts:548-579`) marks an Apply as `landedLate` when its batch writes, is not a duplicate, and the previous load refused it (`coach.wasStructuralRefused`, checked before `noteStructuralRefused` clears it). `pageToast` (`overview-edits.ts:209-214`) shows `Coach change applied` once per draft version. Tests: the late landing reads `coachLanded 1` and then `0` on the next load, a first-time landing reads `0`, and the toast key is once per version. The spec records this as the PM default for Ben to confirm (§11.5). |
| r2 N1–N4 | Open (nits, not touched this round) | `prune` only on step 0 (`workout-services.ts`). Repeat and Save disagree on distance + time sets. `isDistanceSet` ignores the measurement. No migration-12 pointer to the 10→12 dump test. No coach swap over Ben's `sets`/`reps` edit. |

## Blocking

None.

## Should fix

**S1. The `Coach change applied` notice can be lost because the overview shows only one page toast per load. When that happens, the landing is silent again.**
- Code: `apps/mobile/src/workout/overview-edits.ts:207-214` returns the first matching toast only. `WorkoutOverviewScreen.tsx:285-291` asks once per `page` change. `app-services.ts:575-579` clears the in-memory refusal on the same load, so the next load reports `coachLanded 0`.
- Failure scenario: Ben applied two coach changes for next Push A. Change X (a swap) was refused at the hotel gym. He goes back to the main gym. On that load X lands, but change Y (a newly applied swap the main gym can't do) is refused. `pageToast` returns `Coach change didn't fit here` and drops `Coach change applied`. On the next load `coachLanded` is 0, so X's swap appears in today's plan with no word. The same happens when the page is `cleared` (`Earlier edits cleared` wins). This contradicts the spec line "It never lands without a word" (overview-today-edits §11.5). It isn't blocking: the coach card flips back to `Applied` with its Undo, the swap row shows with the page's own Undo, and this needs two coach Applies on one workout.
- Fix: let the screen show the remaining page toasts in turn (call `pageToast` again after a toast is dismissed, against the updated `shown` set), or merge the two coach notices into one line when both counts are above 0. Add a `pageToast` test with `coachRefused: 1, coachLanded: 1`.

## Nits

**N1.** `app-services.ts:561-567`: a batch that fails with `stale` (Ben's own edit lands between the load's read and the coach write) is neither refused nor landed. `noteStructuralRefused` then clears its refusal because it is in `checked`, so when it lands on the next load there is no `Coach change applied`. This is rare. Fix: carry the earlier refusal forward for applies whose batch didn't reach a verdict (pass only the applies that got `ok` or `invalid` as `checked`).

**N2.** The refusal is kept in memory only (`coach-service.ts:372-380`). After a force-close, the card reads `Applied` for a change that isn't in the plan until the next overview load, and a late landing after that gets no toast. The spec states this limit honestly (§11.5, "Limit"), and it predates this round (coach-tools r2 N1). If Ben confirms the PM default, consider persisting the refusal (for example a `refusedAt` on the apply's record) so the card and the toast survive a restart.

**N3.** `withAddedPlaced` anchors an added slot to the slot that followed it, not to its absolute position. Example: Ben puts Face pull first, and the coach moves Incline to the top. Face pull ends up second, ahead of Bench press, not first. This matches the written rule ("ahead of the slot it preceded") and the test pins it down. Mention the example in §11.5 so it reads as intended.

**N4.** r2 N1–N4 are still open (see the table above).

## Feature parity (no feature lost on either side)

Unchanged since r2. Main is an ancestor, nothing is deleted, and main's Table view files and tests are present and pass. The library side keeps everything r2 listed: picker sections, the `⋯` save entry points, edit before start, fit to time, target RPE (WL7, coach RPE only), and coach structural changes through the change-review card. This round only changes the draft's `order` handling for coach writes and adds one toast.

## Rules 1–10 and minimal copy

- **Rule 1:** no network path was added. The toast comes from local state.
- **Rule 2:** completed sets are untouched. Ben's own placement now survives a coach reorder, and the coach card's Undo restores his earlier order (tested). A late landing is announced, apart from the S1 edge.
- **Rule 3:** no change.
- **Rules 4 and 9:** no change. A late landing still goes through `editBatch`, which re-runs the swap and pain checks.
- **Rule 5:** op IDs are unchanged. A duplicate batch never counts as landed. A coach order whose rebuilt list is invalid is refused as `bad_order` and never written partially. Whether retrying an Apply against a newer plan is consistent with "stale proposals are rejected" is a product question (see Spec issues).
- **Rules 6, 7, 8 and 10:** not affected.
- **Minimal copy:** one new string, `Coach change applied` (3 words, no rule explanation). `minimal-copy.test.ts` passes.

## Ben's decisions recorded

WL7, FT6 and N6 are in `docs/brief/CHANGELOG.md` and ADR 0006/0022, as in r2. The S2 behaviour is correctly labelled in the spec as "PM default; Ben to confirm" and is not presented as Ben's decision. It isn't in the CHANGELOG yet, which is right until he confirms.

## Spec issues

1. **A refused coach Apply retried on later loads needs Ben's decision** (overview-today-edits §11.5). The build retries and announces. The stricter reading of rule 5 ("never applied to newer state") and rule 2 (Apply was given for the plan as it was) suggests that refused should stay refused until Ben taps Apply again. Ben should pick one. If he picks retry-and-announce, record it in the CHANGELOG and fix S1 and N2 so the announcement is reliable.
2. Carried from r2: brief §7 still says `shortenSession` "proposes" (FT6 is resolved only in the CHANGELOG). Design-system numbers are still assigned per branch, so a reserved block per branch or named anchors would avoid a fourth renumber.
