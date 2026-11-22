# Review r3: session picker (`claude/session-picker`)

**Verdict: PASS.**

Scope: `git diff claude/gracious-knuth-joxqpw...claude/session-picker`, with a focus on the r2 fix commits `4df11db`..`16a3b4b`:

- persistence: the N3 count
- domain: the S4 marker
- overview: the S1, N1, N2, N4 and N5 changes
- services: the B1 fix
- tests: S2 and S3

I checked it against `docs/design/session-picker.md` v0.1 and its mockup, `workout-overview.md`, `today.md`, ADR 0022, D19, D21, CLAUDE.md rules 1–10, and the minimal-copy rule.

Checks run in `/home/user/wt-picker`:

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npx vitest run --testTimeout=120000`: pass. 194 files, 3866 tests passed, 1 todo, on the first run.

## r2 findings

| r2 | Status | Notes |
|---|---|---|
| B1: the Up next row opened a different plan, and the routine was unreachable | **Fixed** | `workout-services.ts:2307-2320`: a type is recommended only when its row opens Up next's exact plan. That means the same routine, or a named type whose newest workout is Up next's source. `isEdited` now reads the basis of the row's actual target (`:2329-2338`). The SQLite test `Up next only where the row opens it` uses r2's fixture and covers the routine row's target, `✓` on its page and not on Up next's, Today's `SESSIONS` reaching the routine, and `Edited` on each basis. A second test covers the case where a routine is Up next. |
| S1: a failed switch left Ben stuck | **Fixed** | `switchSession` reads first, and `show` runs only on success. A failure leaves the page up and shows `Couldn't load that session.` The failure branch now renders the picker and a `Change session` button (one `SessionPickerSheet` instance, with `shown` null there). It is tested on SQLite with a routine deleted while the picker is open. |
| S2: SP6 didn't compare loads | **Fixed** | `matchesSession` asserts the working-set count, the load value and unit (through `loadCell` with the exercise's convention) and the reps, against the pending sets Start created. |
| S3: missing acceptance tests | **Fixed** | Added: SP7 (a stored D21 target shows `Coach`, the target equals the started set, and opening it makes no model call); SP7 with no target or the coach unreachable (no coach UI, built-in loads unchanged); SP9 and SP11 (source checks for what `switchTo` resets and keeps, plus a SQLite check that the tapped check-in and the gym reach the new page); the order of the `Done today` rows. |
| S4: the `longestGapFallback` flag did nothing | **Fixed** | It is typed `false`, so turning it on fails to compile until the resolver reads it. The doc comment now says it's a marker. |
| N1: row actions could run during a switch | **Fixed** | `switching` guards Why?, Coach, Swap, Skip and edits. I confirmed with `useScreenData` (`shell/context.tsx:89`) that `data` keeps its identity until the new read lands, so the flag covers the whole target≠page window. |
| N2: Undo switched back after a failed delete | **Fixed** | |
| N3: the exercise count included exercises with no completed set | **Fixed** | It now counts only exercises with a completed set. |
| N4: `Change` had the wrong VoiceOver label | **Fixed** | Its label is now "Change session". |
| N5: `otherRoutine` copy unused | **Fixed** | Removed. |
| N6: the eyebrow on a picked recommendation | Open | Expected while Decision 2 is open (see SI2 in r2). |

## Re-check of the slice

**Every start path still works.** I traced each one again after the B1 change:

- **Up next:** `{kind:'next'}`, unchanged.
- **A `SESSIONS` row:**
  - a routine row has the `{kind:'routine'}` target;
  - a history row has the `{kind:'session'}` target;
  - the recommended row has the `{kind:'next'}` target, and only when it opens the same plan.
- **`Change` and `All sessions`:** they open the same sheet, with the same rows.
- **The overview title:** switches in place through `switchSession`.
- **The failure page:** now has `Change session`, `Try again` and `Empty workout`.
- **The picker:** `Empty workout` and `Past workouts` are deferred with `pickerAfter`.
- **Done today:** Up next is listed first.

When there is no gym, `sessions.list` and `overview.load` both resolve against the typical gym (`app-services.ts:504-507`). So the picker on the failure page also works without a gym.

**Preview = Start.** Start still sends the page's own `startOf`, `previewKey` and draft (`overview-start.ts:65-81`). A Start tapped while a switch is loading uses the old page, which is consistent with itself. If that Start then hits a stale re-read, the fresh page is for the new target, and `samePage` refuses it. So nothing is ever started on a page that wasn't shown. SP6 and SP7 now compare loads and reps against the created sets.

**Today's edits.** Drafts stay per basis. `Edited` reads the basis the row opens. Save as routine is still hidden while there are today's edits. A switch never writes.

**Rules check:**

- **Rule 1:** everything here is local, and the tests assert there are no model requests.
- **Rule 2:** nothing touches completed sets.
- **Rule 3 / D21:** the stored coach target flows through `nextTargetsOf` on the picked path, with the `Coach` tag and its reason. When there is no target or the coach is offline, there is no coach UI. Tested.
- **Rule 4:** the same dry run and `snapPlanToGym` as Start, with loads compared per convention.
- **Rule 5:** Start keeps its `opId`, `previewKey` and draft fence. A switch clears the Start op ID. Undo is versioned.
- **Rule 6:** `N days ago`, dates and exercise counts are actuals. The count now matches the plan (N3).
- **Rules 8 and 10:** unchanged from r2 (pass).
- **Minimal copy:** the new strings are `Couldn't load that session.` and `Change session`. There are no explanations.

---

## Blocking

None.

## Should fix

None.

## Nits

- **N1. A switch reads the new session twice.** `WorkoutOverviewScreen.tsx:462-481`: `switchSession` loads the target, then `show` calls `reload()`, which loads it again, and the page that's shown comes from the second read. If the source changes between the two reads, the first check passes and the second read can land on the plain `Couldn't load this workout.` page. That page now has the picker, so Ben isn't stuck. Still, consider seeding `useScreenData` with the page that was already read, or accept the double read and say so in the comment.
- **N2. Two quick picks can race.** `switchTo` isn't serialised. Ben could pick A and then B (by reopening the picker) before A's read lands. If A's read resolves last, A is shown even though B was picked last. Reads are local and fast, so this is unlikely. A sequence number in `switchTo` (show only the latest) closes the race.
- **N3. `switching` is set even before `show`.** During that phase the target and the page still match, so the guard isn't needed there. It also suppresses Why? and Swap for one extra local read. That's harmless and needs no change unless it shows on device.
- **N4. Several new checks are regexes over source text.** `workout-overview-screen.test.ts:658-689` and the `Change` label test in `session-picker.test.ts`. They break on formatting changes and don't prove behaviour. The SQLite `switchSession` test covers the logic, so these are just guards. Prefer exporting small pure helpers over matching JSX text when it's next touched.
- **N5. Today can show two `Legs` that open different plans.** In the B1 fixture, the Up next hero is `Legs` (the named workout's next session: Leg press) and the `SESSIONS` row is `Legs` (the routine: Back squat). The behaviour is now correct and reachable, but the two labels are the same on one screen. This depends on SI1 below.

---

## Spec issues (for the designer and PM; not code defects)

- **SI1 (r2 SI4, still open).** §3.1.1 lets a named workout join a routine by name, but D19's rotation (`isFromRoutine`) doesn't count it. The build now treats Up next as separate from the routine in that case, which is safe, but the spec should still say:
  - which behaviour it wants;
  - how Today labels the two (N5);
  - whether SP-D8 naming (`routineName = 'Legs'` on Start) should set `routineId` when a routine of that name exists.
- **SI2 (r2 SI1, SI2, SI3 and SI5, still open).** Decision 1, Decision 2 and P-I3 need putting to Ben together. Until then the picker mostly offers routines and named workouts. That is a partial answer to "choose what day/type of session I am hitting".

  The rest is spec housekeeping:
  - §8 still describes the post-decision behaviour (SP1, SP2) as current;
  - the "1 type" rule and the failure page's `Change session` button should be recorded in §2.1 and §5;
  - the PM follow-ups in §9 (today.md, workout-overview §2.1, design-system, CHANGELOG) are still outstanding.
