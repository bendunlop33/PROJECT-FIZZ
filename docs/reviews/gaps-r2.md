VERDICT: PASS

# Review round 2: Workout gaps (claude/gaps)

Reviewer: independent reviewer agent, 12 Oct 2026.
Scope: `git diff claude/gracious-knuth-joxqpw...claude/gaps` at `e963d27` (22 commits, 81 files). This round
checks the eight fix commits made after `docs/reviews/gaps.md` (round 1: B1, S1–S5, N1–N8) and looks for
regressions they could cause. The round-1 item checklist (the seven workout items, the five loose ends and
DX9 Keep 7/14/30/All) still holds. I re-read each one against the new code and found no regressions.

## Checks run

- `npm run typecheck`: exit 0.
- `npx eslint .`: exit 0.
- `npx vitest run --testTimeout=120000`: 204 files, 3930 passed, 3 failed, 1 skipped, 1 todo. The three
  failures are timing tests: `catalogue/test/definition.test.ts` D6, `domain/test/equipment.test.ts`
  "stepper taps … stay cheap" and `persistence/test/backup-perf.test.ts` "never block the JS thread". The
  machine's load average was 13–16 with other worktrees' suites running. This branch touches none of
  these files or the code they time. I reran them on their own: `equipment` and `backup-perf` pass, and
  D6 passes with a longer timeout. The skipped test is the release-only placeholder-migration guard (S5).
- **Mutation check (do the new tests fail without the fix?).** I made a scratch copy of the branch and
  reverted each fix in turn, then ran the relevant tests. Every reversion turned at least one test red:

  | Fix | Reversion | Result |
  |---|---|---|
  | B1 domain (`swapPainCarry`) | always "no pain" | 3 failed |
  | B1 service (`midSwapCtx` carry) | `sessionPain` ignores the carry | 1 failed (`mid-swap.test.ts`) |
  | S1 (`pendingSetsOf`) | companions included again | 3 failed |
  | S2 (`logLabel` on `start_work`) | `logLabel: null` | 4 failed |
  | S3 (work-timer alert) | branch disabled | 1 failed (`rest-alerts.test.ts`) |
  | S4 (distance `notCopied`) | push disabled | 2 failed |
  | N6 (draft kept on tombstone) | `draft: null` again | 2 failed |
  | N1 (distance `unsupported`) | branch disabled | 2 failed |

## Round-1 findings: status

| # | Status | Notes |
|---|---|---|
| B1 Swap after pain | **Fixed** | `swapPainCarry` (`mid-swap.ts:41`) follows the `swappedFrom` chain. It is active for an active flag on any row in the chain or a done set marked `pain`. The service plans the substitute with that as `sessionPain` (`workout-services.ts:1259-1264`), so `nextTargetsFor` returns `halted_pain` with the load held. The pre-Start overview passes `carryFrom` too (`:2803`). The sheet shows `Pain flag · no increases`. Tested at domain level (flag, cleared flag, other exercise's flag, marked set, swap chain) and at app level (bench marked pain → DB bench held at 30 kg each; no pain → goes up). |
| S1 Half-logged unilateral pair | **Fixed**, with one follow-on gap (S1 below) | `pendingSetsOf` leaves `pairedWithSetId` companions on the original row. The reducer uses the same helper, so the sheet and the command agree. |
| S2 Log a timed set without the timer | **Fixed** | `Log 0:45` text button under the fields while idle, `Start` stays primary. Spec §2.7 "As built" updated. |
| S3 Cue at 0 when locked | **Fixed** (needs a device check, as noted) | `planRestAlert` plans a `Time` notification at the work deadline with the rest alert's identifier. It is reconciled after every command (`app-services.ts:355`) and on foreground, and cancelled on Stop, pause or a passed deadline. Starting a work timer ends any rest (`reducer.ts:718`), so the two can't collide. Auto-save and the spoken cue are now their own backlog row. |
| S4 Repeat drops distance | **Fixed** | `NotCopied` is a discriminated union. `Not copied: 1 distance set (Sled push)`. |
| S5 Placeholder migrations 8/9 | **Fixed** | `emptyMigrations` plus `release-migrations.test.ts`, run with `FIZZ_RELEASE_CHECK=1` in the `check` job that `build` needs (`ios-ipa.yml`). It is the only workflow that builds an `.ipa`. |
| N1–N4, N6–N8 | **Fixed** | Distance is `unsupported` in the rule. The coach context carries `durationS`/`distanceM`. The built-in rule is `version: 2`. The Keep failure line is shown. Drafts survive Delete/Swap/Remove → Undo. The correction toast is kept with `· note not saved`. The doc comment order is fixed. |
| N5 Remove on planned rows | Open (nit, unchanged) | See N1 below. |

## Blocking

None.

## Should fix

### S1. `Swap exercise` shows a false "Couldn't load this workout." when only the other side of a pair is left

`apps/mobile/src/screens/workout/WorkoutScreen.tsx:721-722`; `packages/domain/src/session/mid-swap.ts:31`;
`apps/mobile/src/services/workout-services.ts:1905-1908`; `apps/mobile/src/screens/workout/MidSwapSheet.tsx:63-66`.

The round-1 S1 fix taught `pendingSetsOf` (and therefore `midSwapSlot`) to skip a half-logged pair's
pending companion. The menu wasn't updated: `canSwap` is still `pendingHere > 0`, and `pendingSets` from
`buildActiveSetView` counts every pending set, companions included.

Failure scenario: Bulgarian split squat, 3 sets. Ben logs sets 1–2, then set 3 Left only. The only
pending set left is set 3's Right companion. Exercise `⋯` still shows `Swap exercise`. When he taps it,
`swapCandidates` gets `midSwapSlot(...) === null` and returns `null`, and the sheet then shows
`Couldn't load this workout.`. That is a false error: nothing failed to load, and nothing can be swapped.
It's an honesty problem (rule 1 spirit) on a sheet Ben reaches mainly when something hurts. No test covers
it.

Fix: derive `canSwap` from the same rule as the command. For example, expose `swappable` on the focus or
exercise view (`midSwapSlot(state, id) !== null`) and use it in `openExerciseMenu`. Add a test
(`exercise-menu` or `workout-gaps`): after a Left-only log on the last set, the menu has no `Swap
exercise`, and `swapCandidates` returns null.

## Nits

- **N1** (round-1 N5, still open). `active-view.ts:641` `isRemovable` offers `Remove exercise` for a
  planned routine exercise too, not only one added in this workout. Removing it hides it from the
  Summary, where `Skip` would have shown it as skipped. exercise-library §4.6 says "added by mistake".
  Either limit it to rows added in this workout, or have the designer confirm the wider use.
- **N2.** `apps/mobile/test/mid-swap.test.ts:80-136`: the app-level B5 test covers only the "set marked
  Pain" route. The "active flag on the original" route is tested only in the domain (`swapPainCarry`), and
  not through `midSwapCtx` → `substituteTargets`. Add a variant that sets a pain flag on Bench via the
  pain-flag service before swapping.
- **N3.** `apps/mobile/src/services/workout-services.ts:1958`: `buildSwapExerciseCommand` gets
  `painFlagged` from the flags' exercise IDs. That set never contains the substitute, and the fit runs in
  `start` mode, where `fitSet` ignores pain anyway. It's harmless today but misleading. Either drop it or
  pass the substitute's ID when `painCarried`, so a later change to the fit mode keeps the hold.
- **N4.** `active-view.ts:723`: the idle `Log 0:45` text button logs the planned time when Ben hasn't
  typed one. That matches how reps are pre-filled and is fast, but one stray tap logs a plank that wasn't
  done. Undo exists (`undo_log`), so this is acceptable. Worth a device-test note.

## Spec issues

1. **(Carried from round 1, still open.) 7-F's ~10% limit permanently stops load progression on light
   loads.** With 2–2.5 kg dumbbell or stack steps, every load under about 20–25 kg has its next step over
   10%. So the built-in rule progresses reps to the cap and then holds indefinitely (for example, 10 kg
   lateral raises stuck at the top of the range). The code follows playbook 7-F as written ("progresses
   reps up to the cap, then holds"). The playbook should say what happens at the cap, for example "take
   the smallest achievable jump once reps reach the cap and reset to the range bottom". That's Ben's or the
   training-researcher's call (see also equipment-aware-progression D3).
2. Round-1 spec issue 2 (B5 recorded only in §7) is resolved: exercise-library §2.5 "As built" now states
   it. active-workout §2.14 still doesn't mention it. A one-line cross-reference would help the next
   build.
