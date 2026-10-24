VERDICT: PASS

# Review round 3: Workout gaps (claude/gaps)

Reviewer: independent reviewer agent, 12 Oct 2026.
Scope: `git diff claude/gracious-knuth-joxqpw...claude/gaps` at `347aefc` (26 commits, 82 files). This round
checks the two fix commits made after `docs/reviews/gaps-r2.md` (`b480ffa` for r2 S1, `347aefc` for r2
N2–N4 and spec issue 2) and looks for regressions they could cause. The round-1 and round-2 checklists
(the seven workout items, the five loose ends, DX9 Keep 7/14/30/All and the backup wording) still hold.
Neither fix commit touches code those items depend on, apart from the swap menu and the substitute's fit,
which I re-checked below.

## Checks run

- `npm run typecheck`: exit 0.
- `npx eslint .`: exit 0.
- `npx vitest run --testTimeout=120000`: 204 files, 3933 passed, 2 failed, 1 skipped, 1 todo. The two
  failures are timing tests: `catalogue/test/definition.test.ts` D6 and `persistence/test/backup-perf.test.ts`
  "hold the store queue only for the export". The machine's load average was 14–24, with other worktrees'
  suites running. This branch doesn't touch either file or the code they time. Run on their own, both
  files pass (42/42). The skipped test is the release-only placeholder-migration guard (round-1 S5).
- **Mutation check.** I reverted each round-3 fix in a scratch copy of the branch, not in the worktree:

  | Fix | Reversion | Result |
  |---|---|---|
  | r2 S1 (`FocusView.swappable`) | back to "any pending set on the row" | 2 failed (`workout-gaps.test.ts`, `mid-swap.test.ts`) |
  | r2 N2 (app-level flag route) | `swapPainCarry` ignores active flags | 1 failed (the new "active flag on Bench" test) |
  | r2 N3 (substitute in `painFlagged`) | flags' IDs only | 0 failed (see N2 below) |

## Round-2 findings: status

| # | Status | Notes |
|---|---|---|
| S1 False "Couldn't load this workout." on Swap | **Fixed** | `FocusView.swappable = midSwapSlot(state, ex.id) !== null` (`active-view.ts:570`). `openExerciseMenu` uses it (`WorkoutScreen.tsx:721`), so the menu and the command now use the same rule. The menu only opens from the focus card (`:1282`), so there is no other caller left on the old count. Tested in the domain and the app: after a Left-only log on the last set, `pendingSets` is 1, `swappable` is false, there is no `Swap exercise`, and `swapCandidates` returns null. |
| N1 Remove on planned rows | Open (nit, unchanged) | See N1 below. |
| N2 App-level flag route | **Fixed** | `benchThenSwap('flag')` flags Bench through `s.pain.flagMovement`, swaps, and expects `painHeld`, `30 kg each` and every moved set held at 30 kg per hand. |
| N3 `painFlagged` excludes the substitute | **Fixed** | The substitute's ID is added when `painCarried` (`workout-services.ts:1957`). It has no effect in today's `start` fit mode (see N2). |
| N4 `Log 0:45` stray tap | **Noted** | A device-check note was added to the spec. Undo covers it. |
| Spec issue 2 (§2.14 cross-reference) | **Fixed** | active-workout §2.14 now points to B5. |

## Rules check (round-3 changes only)

- Rule 2 (completed sets never silently modified): no change. Swap still moves only `pendingSetsOf`, and
  half-logged pairs stay on the original row.
- Rules 3, 4 and 9: the substitute's targets stay held after pain through both routes (marked set and
  active flag), snapped to the gym's achievable loads (`isLoadAchievable` asserted in `mid-swap.test.ts`).
- Rule 5: no new write paths.
- Minimal copy: no new UI text.

## Blocking

None.

## Should fix

None.

## Nits

- **N1** (round-1 N5 and round-2 N1, still open). `packages/domain/src/session/active-view.ts:645-649`
  `isRemovable` also offers `Remove exercise` for a planned routine exercise with nothing logged, not only
  for one added in this workout. Removing it hides it from the Summary, where `Skip` would have shown it as
  skipped. exercise-library §4.6 says "added by mistake". Either limit it to rows added in this workout, or
  have the designer confirm the wider use and update §4.6.
- **N2.** `apps/mobile/src/services/workout-services.ts:1957`: the r2 N3 change has no test that fails
  without it, because `fitSet` ignores `painFlagged` in `start` mode. That's fine as defence in depth. If
  the fit mode for a swap ever changes, add a test that the substitute's planned load isn't raised by the
  fit when `painCarried` is true.

## Spec issues

1. **(Carried from rounds 1 and 2, still open.) Playbook 7-F's ~10% limit permanently stops load
   progression on light loads.** With 2–2.5 kg dumbbell or stack steps, the next step from any load under
   about 20–25 kg is more than 10%. So the built-in rule progresses reps to the cap and then holds
   indefinitely (for example, 10 kg lateral raises stuck at the top of the range). The code follows 7-F as
   written. The playbook should say what happens at the cap, for example "take the smallest achievable
   jump once reps reach the cap, and reset to the bottom of the range". That's for Ben or the
   training-researcher to decide (see also equipment-aware-progression D3).
