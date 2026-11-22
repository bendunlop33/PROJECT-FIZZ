# Review: Progress slice A (home, Muscles, Calendar, Time sheet, ResumeBar)

Branch `claude/progress` (worktree `/home/user/wt-progress`), diff against `claude/gracious-knuth-joxqpw` (6 commits, 49 files).
Spec: `docs/design/progress.md` v1.0 §2.2–§2.5, §3.1–§3.3, §5, §6.2, §7.2, §8 slice A checks 1–25; mockup `docs/design/mockups/progress.html`; CLAUDE.md rules 1, 2, 5, 6 and 10, plus the minimal-copy rule.
Reviewer: independent reviewer agent, 11 Oct 2026.

## Verdict: **CHANGES NEEDED**

The domain layer is careful and well tested. Window maths, week bars, time in gym, the hard-set rule, body-part and PPL credits, and records (property-tested against `findSetRecord`) all match my own hand-worked cases. `Count it` is versioned, idempotent and survives a relaunch.

Three problems block the merge:
- The branch breaks `npm run check`, and with it the CI `.ipa` build.
- The `Count it` Undo is hidden behind the sheet it was triggered from.
- The window and grouping are not actually shared between home and Muscles (check 15).

## What I ran

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=120000` | pass: 199 files, 3870 tests, 1 todo |
| `npx vitest run apps/mobile/test/progress-perf.test.ts` | pass. First read 2610 ms total (longest block 36 ms); warm window switch worst 39 ms; calendar 5 ms |
| same, `--pool=forks --execArgv=--jitless` | pass. First read 3831 ms (longest block 81 ms); warm switch worst 29 ms |
| `npm run catalogue:validate`, `npm run guide:check -- --all`, `npm run guide:motion -- --all` | **fail**: `ERR_UNSUPPORTED_DIR_IMPORT … packages/domain/src/import` (see B1) |

**Hand-computed cases.** I ran these through the real domain functions in a throwaway test, which I have since deleted:
- **Window 30 days ending Sun 1 Nov 2026 (across the 25 Oct London DST change).** The window is 3 Oct – 1 Nov and the previous window is 3 Sep – 2 Oct. Workouts on 2, 3, 4, 5, 25 and 26 Oct and 1 Nov give 6 sessions and 1 previous. The bars are `3 Oct` (part week, 2) · `5 Oct` 1 · `12 Oct` 0 · `19 Oct` 1 · `26 Oct` 2, which sum to 6. Correct.
- **Local date across DST.** `2026-10-24T23:30Z` → 25 Oct (BST) and `2026-10-25T23:30Z` → 25 Oct (GMT). Correct.
- **Time over a 7-day window.** Inputs: one 1 h workout, one import, one with no end, one of 5 h 12 min (unconfirmed) and one of 5 h (confirmed). Result: total 6 h, average 3 h, 2 of 5 timed, imported 1, no end 1, over cap 1. Correct per PG25.
- **Body parts, 1 bench set + 1 OHP set.** Chest `1 · 1`, Shoulders `1 · 1½`, Triceps `1 · 1` (two half credits make a session). Defensible, but see Spec issue SP3.
- **Unilateral row.** 3 left (RPE 8) + 2 right (RPE 8) + 1 right (RPE 4) gives hard 3 and easy 1, so 4 "sets" for 3 pairs (see S6).

---

## Blocking

### B1. `@fizz/catalogue` now imports the whole `@fizz/domain`, which breaks `npm run check` and the CI `.ipa` build
`packages/catalogue/src/vocab.ts:14` (`import { MUSCLE_GROUPS, MUSCLE_TO_GROUP, type MuscleGroup } from '@fizz/domain';`)

- **What happens.** `catalogue:validate`, `guide:check`, `guide:motion` and `guide:render` run under Node with `packages/catalogue/scripts/ts-hooks.ts`. That loader only adds `.ts` and `/index.ts` to imports that start with `.`. On the base branch, `validate.ts → vocab.ts` imported only `zod`. Now `vocab.ts` pulls in `@fizz/domain/src/index.ts`, whose `export * from './import'` is a directory import. Node rejects it with `ERR_UNSUPPORTED_DIR_IMPORT`.
- **Failure scenario.** `.github/workflows/ios-ipa.yml:82` runs `npm run check`, so the GitHub Actions `.ipa` build fails and Ben gets no installable build. The exercise-guide-maker's `guide:render` tooling is also dead.
- **Fix.** Pick one:
  - Move `MUSCLE_GROUPS` / `MUSCLE_TO_GROUP` into a leaf module that both packages can import without the domain barrel (e.g. `@fizz/schemas`, or a dependency-free file imported by path).
  - Keep the table in the catalogue and have domain import that leaf.
  - Make `ts-hooks.ts` resolve directory specifiers. This is weaker, because the catalogue would still load the entire domain.
- **Also.** Add `npm run catalogue:validate` (or the whole `check`) to the developer's done-definition. Vitest alone did not catch this.

### B2. The `Count it` Undo toast renders behind the Time sheet's modal, so Undo is effectively unreachable
`apps/mobile/src/screens/progress/ProgressScreen.tsx:73-93` (`countIt`), `:198` (Toast in the screen tree), `:209-223` (TimeSheet). `BottomCard` is a RN `Modal` (`apps/mobile/src/ui/sheet.tsx:17`).

- **Failure scenario.**
  1. Ben opens `ⓘ Time from 8 of 9 sessions` and taps `Count it` on `Fri 2 Oct · Push A · 5 h 12 min`.
  2. The row disappears from the sheet, and the sheet stays open.
  3. `Counted Push A, 5 h 12 min [Undo]` is drawn under the modal scrim. The `undoToast` lasts 8 s, so it usually times out before Ben closes the sheet.
  4. Nothing else offers an un-count: the row is gone from the sheet, and the Summary has no such control.
- **Rules affected.** Check 6 ("with an Undo toast that removes it again"), §4.5, and CLAUDE.md rule 2's one-tap Undo.
- **Fix.** Close the sheet on a successful `Count it` before showing the toast, or render the toast inside the sheet. Add a component or service-level test that the Undo action is reachable after `Count it`.

### B3. Window and grouping are not one shared setting between home and Muscles (check 15)
`apps/mobile/src/screens/progress/ProgressScreen.tsx:35-36, 67-71`; `apps/mobile/src/screens/progress/MusclesScreen.tsx:23-32`

- **Cause.** Each screen keeps its own `req` state. Once `req.days` / `req.grouping` is set locally, it overrides the saved `profile.progress` on every reload.
- **Failure scenario.**
  1. On home, Ben picks `7 days`, so home's `req.days` is 7 and 7 is saved.
  2. He taps Chest. Muscles opens on 7 days.
  3. He switches Muscles to `60 days`, which saves 60, and goes back.
  4. Home reloads on focus with its own `req.days = 7` and still shows 7 days. The stored setting says 60.
  5. The two screens now disagree. The spec rule "changing either on one screen changes the other" fails, and the PG3 "one date context" principle is violated.
- **Fix.** Make the saved profile setting the single source:
  - Drop the local override after the save resolves, or keep the choice in a shared context or store that both screens read.
  - Await `saveSettings` before reloading.
  - Add a test that changes the window on Muscles and then reads home.

---

## Should fix

### S1. The Ask pill sits under the ResumeBar whenever a workout is unfinished
`apps/mobile/src/screens/progress/ProgressScreen.tsx:193-207`; `apps/mobile/src/screens/coach/AskPill.tsx:19-21`
- **Cause.** `AskPill` is absolutely positioned at `bottom: space4` (16 pt). The 60 pt `ResumeBar` is a later flex sibling at the bottom of the same container, so it draws over the pill. The trailing `Resume` button sits exactly where the pill is.
- **Effect.** While a workout is unfinished, which is when Ben is most likely to ask, Ask is hidden. Spec §2.1 says Ask floats above the ResumeBar.
- **Fix.** Pass a bottom offset to `AskPill` (and to `Toast`) when `resume !== null`.

### S2. The Ask pill opens the coach with Today's context, not Progress's
`apps/mobile/src/screens/progress/ProgressScreen.tsx:195` uses `navigation.navigate('Coach', { entry: { kind: 'today' } })`.
- Spec §2.1 and §4.4 say Ask attaches `Progress · last 30 days`, so "how many times did I train legs this month?" has the right frame.
- **Fix.** Add a `progress` entry kind carrying the window, or don't show Ask until it can carry that context.

### S3. Saving the window and grouping can lose an update
`apps/mobile/src/services/progress-service.ts:192-198`, together with `apps/mobile/src/services/app-services.ts:135-143`
- **Cause.** `saveSettings` builds the whole `progress` object from a profile read before the write. `updateProfile`'s retry re-reads the profile but still writes that stale object.
- **Failure scenario.** Ben taps `Push/Pull/Legs`, then quickly `60 days`. The two calls race, and the second either fails (ignored, `void`) or overwrites the first's field. The tab then reopens with a combination Ben never chose.
- **Fix.** Merge the patch inside `updateProfile`'s read-modify-write (pass a function of `current`), and serialise the writes.

### S4. Cold first read takes seconds, and the performance check doesn't measure the spec's case
`apps/mobile/test/progress-perf.test.ts:37-70`
- **Spec.** Check 25 is 4 years / ~600 sessions, under 100 ms per window switch on the phone.
- **What the test does.**
  - It uses 2 years / 416 sessions.
  - It asserts only `maxBlockMs < 1000` and `worstSwitch < first.totalMs`. It never asserts a switch budget.
  - The first projection (2.6 s JIT, 3.8 s jitless at 416 sessions; roughly 5–6 s at 600) happens on every cold launch, because the cache is memory-only. Ben sees grey blocks for several seconds each time he opens Progress after a relaunch.
- **Fix.**
  - Use a 600-session fixture.
  - Assert a warm-switch budget (e.g. < 100 ms in jitless Node as a proxy).
  - Either persist the per-session projection keyed by revision, or prewarm it after launch and after `Finish`.
  - Raise the cold-open cost with Ben, since the spec is silent on it (SP5).

### S5. Check 16 is not met: untagged exercises have no "set muscles" route and no Undo
`apps/mobile/src/screens/progress/MusclesScreen.tsx:115-119` (plain text, no `›`); `ProgressScreen.tsx:313-316` (`No muscles set on these exercises.` has no `Set muscles ›`).
- No muscle editor exists in the app (`grep primaryMuscles apps/mobile/src/screens` finds nothing). So with a FitNotes history full of custom exercises, Ben sees `N exercises have no muscles set` and has no way to fix it.
- **Fix.** Build the editor, or get Ben to move check 16 to a later slice. Either way, don't show a `›` affordance that implies a destination. See SP2.

### S6. Unilateral rows are tallied per category with an independent max, so counts don't add up
`packages/domain/src/progress/muscles.ts:133-148`; used by `calendar-view.ts:69-74`
- **Cause.** `hard`, `easy` and `warmup` each take `max(left, right)` separately.
- **Effect.** With 3 L hard, 2 R hard and 1 R easy:
  - the Calendar row reads `4 sets` for 3 pairs;
  - `Not counted` lists 1 easy set, although the left of that pair was hard.
- Check 14's happy path passes, but the mixed case is wrong.
- **Fix.** Pair sides first (as progression does), then classify each pair once, e.g. hard if either side is hard. Add a mixed-rating test.

### S7. The spec, mockup and research for this slice are not committed
`git status` in the worktree shows these as only in the working tree:
- `docs/design/progress.md` (v1.0 changes), modified
- `docs/design/design-system.md`, modified
- `docs/design/README.md`, modified
- `docs/design/mockups/progress.html`, untracked
- `docs/research/competitor-analytics.md`, untracked

The branch's committed spec is still v0.1, so the code has no committed spec to be reviewed against. Commit them, by the designer or PM, before merge. I did not commit them, per my instructions.

### S8. Test gaps
Tests cover checks 1–14 and 17–19 well in the domain, plus Count it end-to-end. Missing:
- A timezone or DST case through the service. Domain `progress.test.ts:483` covers `localDateOf` only.
- A shared-setting test (B3).
- Undo reachability (B2).
- Mixed-rating unilateral (S6).
- lb sessions in time and muscles (only records cover lb).
- The 600-session size (S4).
- A copy test for the sheets. The check-23 test (`progress.test.ts:429`) scans the view model only, not `HowCountedSheet`'s text (see SP1).

---

## Nits

- **N1.** `home.ts:307`: the marked line reads `3 sets you marked are counted here.`. Spec §5.3 is `3 sets you marked (spotted) are counted here.`, with the kind.
- **N2.** `MusclesScreen.tsx:52` passes `datesLine` raw as `datesWords`, so VoiceOver reads "12 Sep – 11 Oct" with an en dash and NBSPs. Home (`ProgressScreen.tsx:261`) replaces only the dash. Spec §5.6 wants "12 September to 11 October", and `dayMonthLong` exists for it.
- **N3.** `MusclesScreen.tsx:34-42`: the error state lacks `Restore from backup` (§3.1). In the null/empty state the screen is blank. `ProgressScreen.tsx:139-140` is also blank if `home()` returns null (no profile).
- **N4.** Muscles screen:
  - `Last trained …` for a group at 0 shows only when the row is expanded. The spec (§2.4 sketch, §3.2) shows it under the zero row.
  - "Scrolled into view" on opening with a group (§4.1) isn't done.
- **N5.** `ProgressScreen.tsx:358`: record row key is `${sessionId}:${exerciseId}`. The same exercise done twice in one workout (two rows, e.g. after a gym switch) gives duplicate React keys. Include the row's `sessionExerciseId` or its index.
- **N6.** `ProgressScreen.tsx:74`: each `Count it` press mints a new `opId`. A double tap sends two commands at the same `expectedVersion`, and the second shows `This workout changed…`, replacing the Undo toast. Disable the pill while the command is in flight, or derive the `opId` from `(sessionId, version)`.
- **N7.** `Edit times` opens the Summary rather than the time correction itself. That's one extra tap, and it doesn't "return here" after saving (§2.3).
- **N8.** `muscles.ts:119-126`: the primary muscle wins before the conditioning/carry rule. So conditioning moves with quad primaries (thrusters, burpees, rowers in the catalogue) go to Legs, and carries with `core` primary go to Core. The PG27 text says conditioning and carries "with no clear region go to Other". Probably fine, but confirm (SP4).
- **N9.** `home.ts:164-168`: VoiceOver `massWords` reads a `BW + 10 kg` record as "10 kilograms", dropping "body weight plus". Assisted is correctly excluded.
- **N10.** `CalendarView` unmounts on `Overview ⇄ Calendar`, so the selected day resets. §3.5 says each segment keeps its scroll position.

---

## Checks against product rules

| Rule | Status |
|---|---|
| 1 Offline / no AI | OK. All reads are local; nothing awaits network or coach. The Ask pill shows its own status |
| 2 Completed sets never silently modified; Undo | `Count it` changes no set (tested). Undo is unreachable in practice (B2) |
| 5 Idempotent, versioned writes | OK. `confirm_session_duration` has an opId, rejects a stale `expectedVersion`, handles supersede, and survives relaunch (tested). Settings write race (S3) |
| 6 No invented data | OK. No scores, rings or percentages; `—` instead of `0 min`; imported workouts never add time; Est. 1RM is labelled (`isEstimate: true`), not shown in slice A |
| 4 / units | OK. Records are per equipment + convention + unit; imported suppression converts kg/lb; per-dumbbell reads `each`; assisted, bodyweight and timed have no records |
| 10 Your data vs Coaching knowledge | OK. `durationConfirmedAt` and `profile.progress` are Your data and are in backups (migration 8, backup tests updated); `split` is catalogue knowledge |
| Minimal copy | Mostly OK. `HowCountedSheet` is the "Why?" location, as the spec allows. See SP1 |
| Secrets, logging | No secrets. No health-data logging outside the perf test's timing line |

## Spec issues (for the designer / Ben, not the developer)

- **SP1.** Check 23 says no "recovery" or "fatigue" may appear on any Progress screen. But §2.4's *How this is counted* text ends "This counts work done. It doesn't measure recovery or fatigue.", and it reads as a reassurance line, which the minimal-copy rule bans. Suggest dropping the sentence.
- **SP2.** Check 16 (set muscles from `Not counted`, with Undo) depends on an exercise-library muscle editor that doesn't exist. Either include the editor in slice A or move check 16 to the slice that builds it.
- **SP3.** PG26 says a session counts when the group got "≥ 1 counted set". With half credits, 1 bench set + 1 OHP set gives Triceps `1 session · 1 set` from two helper halves. Say explicitly whether that is intended. The implementation treats summed credit ≥ 1 as qualifying.
- **SP4.** PG27's "Conditioning and carries with no clear region go to Other" conflicts with step (2), primary muscle first. Clarify whether conditioning moves with leg primaries are Legs or Other.
- **SP5.** Check 25 covers only window switches. Cold first open on a large history (seconds today) has no target. Add one, e.g. first meaningful paint under 1 s with 600 sessions.
