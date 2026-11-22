# Build B pre-build review: `claude/b3-wave3-21oct` (21 Oct 2026)

Scope: everything going into Build B on top of Build A (`493e80c..6ed968d`). That covers:
- the Build A R1 fix (`f9cf566`, `09b009a`);
- workout v3 §7 "same editing" and its review fixes;
- the weekly review and the Progress v3 rework, with the fixes for both Progress v3 reviews (`023599c`, `a9f4150`, `6ed968d`);
- the merge of `claude/gracious-knuth-joxqpw` (`578c7cf`).

## Verdict: **NO-GO** (1 blocker), now fixed in `39d5b76`. See "Fix and re-run" below.

The data layer, Undo/Redo, the stale refusal, offline honesty and force-close recovery all hold, but only on the test fixtures. With a **real applied plan**, the review's own automatic change makes every later open a new review (B1). That brings back another coach call, `NEW` after Got it, dropped asks, and one more automatic plan change per open. The fix is two lines plus a test, and with it this is GO.

## Checks run by the reviewer (on `6ed968d`, before the fix)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `eslint .` (6 GB heap) | clean |
| `npm run check:migrations` | `Migrations OK: 1 to 32, none reserved or empty.` |
| `vitest run --maxWorkers=2` (full suite) | 452 files, 8458 passed, 1 todo |
| `expo prebuild --platform ios --no-install`, then `npm run check:entitlements` | `Entitlement check: OK (no forbidden keys)`. `apps/mobile/ios` deleted afterwards; `git status` clean. |
| Native config diff `493e80c..HEAD` | No change to `app.config.ts`, `app-identity.mts`, `plugins/`, `modules/`, `patches/` or any `package.json`. The Skia Lifts canvas loads behind the guarded loader (`9f72c3d`). ADR 0004 holds. |
| Merge | `578c7cf` brings in `claude/gracious-knuth-joxqpw` up to `b822f69`. That branch has since gained 2 docs-only commits (`6d81458`, `784ea91`: the training-blocks prototype), which are not in this build. Nothing native or code. |

Earlier reviews on this branch were all CHANGES NEEDED. Each has fix commits:
- Build A R1: `f9cf566`, `09b009a`.
- wo-v3b parity and integrity: `d33a04e`, `74b6d9d`, `e4a52de`.
- b3-wave3 UX and truth: `52ce937`, `e4872ba`.
- Progress v3 design and data: `023599c`, `a9f4150`, `6ed968d`.

I spot-checked the Progress v3 fixes in code and in the trace below: B1 per-exercise apply and undo, B2 restart-safe Redo, B3 no reason means no auto-apply, `Not applied`, and the Summary's `n of m planned reps` (`plan-tracker.ts:243`).

## Traces (temporary test over the real app services and SQLite, deleted afterwards)

Setup: a commercial gym. Ben logs Bench, the coach builds a 3-day plan (Push / Pull / Legs) and Ben applies it. He does all three days on 13–15 Oct. The app opens on Mon 19 Oct, and the coach's `weekly_review` makes two tweaks on Pull:
- `Lat pulldown 3 → 4` with a reason;
- `Barbell row 3 → 4` with a wrong number in its reason, which is hidden, so the change is asked rather than applied.

1. **Run on open → Progress with real data.** `reviewed`. Lat pulldown is applied before the page is told; Pull's working sets are `[4, 3]`.
   - **This week:** `19–25 Oct`, `0 of 3`, chips `Push/Pull/Legs – to do`. Past week `12 Oct` shows `3 of 3` and links to its review.
   - **Lifts:** Bench `× 6 (plan)`, `100` real; Lat pulldown `× 8`, `25 kg stack`; Squat `97.5`; Row `70`. There is no `On track` or eta with a single point.
   - **Muscles:** Chest `5 of 3`, Back `6 of 6`. That is the stored plan, not the live 7.
   - **Coach's changes:** `NEW`, `for next week`, note `3 of 3 sessions done.`, row `Lat pulldown 3 sets → 4 sets · next Pull · Back volume is light.` with Undo. The ask reads `Barbell row … Not applied` with Apply.
   - Result: correct.
2. **Second open, nothing new logged.** It should be `cached`. It was **not** (B1).
3. **Undo of the automatic change.** `{ ok: true, status: 'undone' }`; Pull goes back to `[3, 3]`, and the row shows `kept 3 sets / Undone` with Redo. The next open doesn't re-apply it. Correct, but the open after Undo was again a new review with a coach call (B1).
4. **Asked change Apply, and stale refusal.**
   - On an untouched exercise, Apply writes `[3, 4]`, and a double tap writes once.
   - After Ben changes Barbell row himself through `routines.update` (3 → 2), Apply returns `{ ok: false, reason: 'out_of_date', message: 'Out of date' }`, and the template stays `[3, 2]`.
   - Result: correct. Note that the ask had already vanished on the unfixed build after the second open (B1), so this step only ran with the fix in place.
5. **Offline.**
   - With the connection offline, the run returns `not_reviewed / offline` with no model call. Progress reads `Not reviewed · Offline` with no note.
   - A plan day logged offline completes normally.
   - Back online, the coach answers once, and the next open is `cached`.
6. **Force-close.**
   - Relaunch after Undo: same rows and asks, no new coach call.
   - Force-close while the coach call is pending: the relaunch's open finishes the review once.
   - The write-then-lost-mark cases for the automatic apply, Redo and Undo are covered by `weekly-review-service.test.ts:512-549`. With a real plan they depend on the next open being `cached`, which is true only after the B1 fix.

## Blocking

### B1. With an applied plan, every automatic change (and every Undo/Redo) makes the next open a new review
- **Where:**
  - `apps/mobile/src/reviews/weekly-review-service.ts:364-366` (`inputsHashOf`, before the fix) hashes every fact except `template_edit`.
  - `packages/domain/src/review/weekly.ts:557-562` fills `group_sets.planned` from the **live** plan templates.
  - `packages/persistence/src/plan-days.ts:156` treats a different hash as new inputs.

  So `Lat pulldown 3 → 4` changes Back's `planned` from 6 to 7, and the next open writes a new review that supersedes the first. The existing tests seed routines outside any applied plan (`templates` is empty and `planned` is null), so they never see it.
- **Failure (reproduced):**
  - **Second open:** a new review and a second coach call (`weeklyCalls 2`). Ben's `Got it` is lost, so `NEW` shows again with a new note. The asked `Barbell row` change disappears, because `carried` (`:415`) drops open proposals and the coach didn't repeat it.
  - **Cascade:** four opens with nothing logged gave four coach calls and three automatic plan changes (Pull, then Push, then Legs). Each new look may add one more change, because the previous ones changed the hash.
  - **After Undo:** another new review and coach call.
  - **Stored plan overwritten:** the re-run stores the reviewed week's plan from the changed templates, which undoes the "past weeks keep their stored plan" fix (progress-v3 S2/S4).
  - **Force-close:** a force-close between the automatic write and its mark is recovered only on a `cached` open. With a plan, the next open is a new review instead, the open proposal is not carried, and the plan change is left with no Undo row.
- **Why it blocks:** rule 3 says the coach "never adjusts constantly or unprompted", and here the plan drifts on every app open. It also spends Ben's ChatGPT-plan allowance on every open, drops a change he was asked about without his answer, and undoes his `Got it`. The function's own comment says Apply must not re-run the review.
- **Fix (done, `39d5b76`):** the hash keeps only whether a muscle has a plan line (`planned: null | 'plan'`), not the count. The reviewed week keeps the plan it was reviewed against. A workout logged into the week, a pain flag or a goal change still re-run it.
- **Tests:** `apps/mobile/test/weekly-review-plan.test.ts` runs over a real applied plan through the app services. The first test covers:
  - one coach call over three more opens, `cached`;
  - the ask and `Got it` kept, and no second automatic change;
  - Muscles `6 of 6` kept;
  - Undo, then still `cached`;
  - a force-close that keeps the state;
  - Ben's own edit, then Apply refused.

  The second test confirms a workout logged into the reviewed week still makes a new review. Mutation check: with the old hash, the first test fails (`expected 'reviewed' to be 'cached'`).

## Should fix
- **S1. An open ask is dropped whenever a review is re-run on genuinely new inputs.** `weekly-review-service.ts:415` carries only answered proposals. If that re-run is offline, or the coach doesn't repeat the change, the ask is gone without Ben answering it. After B1 this only happens on real new inputs (a late import or a pain flag; a pain flag rightly drops it). Carry the coach's open asks, and let the claim check and staleness decide.
- **S2. `Not reviewed · Offline` stays on while the coach is actually being asked.** After an offline open, the next online open shows the stored `Offline` tag for the whole call. The view type already lists a `Reviewing…` tag (`progress-page.ts:717`), but the service never shows it. This is honest about the last result, but out of date for the duration of the call.
- **S3. A pain-flagged change is marked `stale` and reads `Out of date`** (`weekly-review-service.ts:521`). The pain flag's own state isn't named. This is acceptable under minimal copy, but `Why?` should say pain, not "changed".

## Carried for Ben (from the developer's list; none block a device-test build)
1. The newer Progress design (Week | Month calendar, `cardio`, PB rings, Overview | Lifts | Training tabs) is not in this slice. Ben should decide whether Build B ships the older layout.
2. CLAUDE.md rule 3 vs Ben's 21 Oct decision that small changes are applied automatically: the wording or an ADR needs updating.
3. No structural changes exist yet: reviews only change set counts.
4. `Thu – missed` needs plan days to have weekdays.
5. The Lifts table and chart don't show the load convention (per dumbbell, stack or barbell total). CLAUDE.md says it must be explicit. I'd treat this as the next fix after this build.
6. Open choices:
   - muscle counting (primary only vs half for helpers);
   - the Muscles window ends last week, while Lifts includes this week;
   - the estimate band, 3–12 vs 10;
   - an 8–12 planned set counts as 8;
   - chosen lifts are drawn when there is no plan.

## Needs a real iPhone
- The ChatGPT-plan `weekly_review` call on Ben's account (not yet run end to end).
- Progress v3 on screen: chips, the Skia Lifts canvas behind the guarded loader, Muscles bars at large text sizes, Coach's changes Undo/Redo/Apply and `Got it`.
- Open → force-close mid-review → relaunch, on device.
- Everything in the Build A device list still applies.

---

## Fix and re-run (21 Oct, after `39d5b76`)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `eslint .` (6 GB heap) | clean |
| `npm run check:migrations` | `Migrations OK: 1 to 32, none reserved or empty.` |
| `vitest run --maxWorkers=2` (full suite) | **453 files, 8460 passed, 1 todo** (2 new tests) |
| Trace re-run with the fix | All of traces 1–6 correct. Later opens are `cached` with 1 coach call in total. The cascade is gone (4 opens: 1 call, 1 change). |

**Verdict after the fix: GO** for the device-test build. S1–S3 and the items for Ben remain open.
