# Imported FitNotes history in progressions: findings and fixes

Ben, 12 Oct 2026 (build 131): "The imported data doesn't show up in progressions etc I don't think."

Branch `claude/import-progress`. Each finding below was checked against the code, then confirmed before and after the fix by a local probe that imported Ben's two real exports. The probe ran on this machine only and was deleted; it is not committed. This document contains no personal data.

## Verdict

The import wrote complete rows. Every imported session is `finished`, owner-scoped and date-only. Every set is `completed` and `working`, with an exercise ID, unit and load convention. So no migration or repair is needed. Progress, the calendar, exercise detail and the coach's read tools already showed the data.

The missing piece was a product decision that was approved but never built. Ben accepted **B7** on 11 Oct (CHANGELOG, "Backlog defaults accepted"): FitNotes history is shown as `Last (FitNotes, date)` and is repeatable. The code still enforced ADR 0016's interim P-I3 option (a), "imported history is never comparable", in about a dozen places. So every exercise that only had FitNotes history got no `Last`, no targets and no progression. Imported workouts also couldn't be repeated, start Up next or appear in Past workouts. This branch builds B7 and the session-picker Decision 1, which was approved the same day.

## Causes and fixes

| Where it showed | Cause | Fix |
|---|---|---|
| `Last` line, prefill, Today overview LAST/BEST and change markers | `lastComparableSession` and `isComparable` skipped `imported`. Imported rows also have `equipmentId: null`, so equality with today's item never matched | `matchesEquipment`: imported history matches any equipment, with unit and convention still required. The line reads `Last (FitNotes, 1 Oct)`, and LAST/BEST read `· FitNotes, 1 Oct` |
| Next targets / progression (Add exercise, Start next, Summary `Next time`, coach `get_progression_targets`) | `comparableSessions` filtered `!h.imported` and required the same equipment | Imported history counts, read through `comparableSetsOf` (see below). Loads are still fitted to today's item: rounded toward easier, never above a max. With no item here to check a FitNotes load on, the rule prescribes no load |
| Summary comparison and highlight | `Not compared · imported`; `summaryHighlight` skipped imports | Compared, with `why: FitNotes, working sets`. The highlight must beat FitNotes history too |
| `Why?` | `ruleBasis` skipped imports | The basis is recorded with `imported: true` (an optional schema field) and shown as `1 Oct · FitNotes` |
| Pain sheet Before/Since, substitute targets and ranking, Today lift highlight | Explicit `imported` filters | Included. Substitutes are planned on the item this gym maps the exercise to. The lift card says `FitNotes` |
| Repeat, Start from a past workout, Up next fallback, `resolveNext` | `imported_not_repeatable`; `source = 'manual'` in `listRepeatableIds` | Imported workouts are repeatable. Each exercise is pinned to an item that exists nowhere (`importPinId`), so `snapPlanToGym` maps one by kind and rounds toward easier, never above a max, or drops the load. Start next uses `fitLater`, so the rule's raw targets are fitted at build time |
| Past workouts list | `listPastWorkoutIds` used `source = 'manual'` | All workouts are listed. Imported ones show the existing `Imported` tag (DW-Q3). The "N imported workouts not listed" line is removed |
| Session picker | `groupImportsByCategory: false`; imported types `startable: false`; no Category reader | Decision 1 is on, with the new `imports.categoriesBySession` (owner-scoped, history-filtered). All types are startable |

**Reading FitNotes ramps (provisional, Ben to confirm; revised after review B2).** FitNotes has no warm-up flag, and most of Ben's sessions ramp up (lighter sets first). If every set counted as a working set, the rule would hold or progress from the warm-up load. `comparableSetsOf` therefore leaves out only the lighter sets **before** the workout's hardest set (per unit and convention). The hardest set and every set after it are kept: back-off sets and descending pyramids are working sets. The first version read every set lighter than the top as a warm-up, which hid back-offs in 38% of Ben's real exercise-sessions and planned 1 set (Add exercise) or every set at the top load (Start next). Stored data is unchanged, and the coach's history tools still see every set.

**Set count (review B1).** Start next, Up next and Add exercise take the number of working sets from the same reading as the load (`importedWorkingSetCount`), never fewer than the built-in default of 3 because of the reading, and never more than the FitNotes workout had. Ramp, top single, 3 back-offs: 4 sets at the back-off load. Ramp to a top single only: 3 sets. A 2-set workout: 2.

## Legitimately empty (not bugs)

- **Short windows.** Ben's data ends a few days before Mon 12 Oct, so the 7-, 14-, 30- and 60-day windows hold only his last few iPhone FitNotes workouts. The probe's counts matched the CSV dates.
- **Time in gym and average.** These show `—` with `No times for imported workouts`, because FitNotes CSVs have no start or end times (rule 6).
- **Today's week strip.** It shows 0 because the week starts Mon 12 Oct.
- **Bodyweight exercises.** No load is planned, by design.
- **Progress records (PG30).** Records still come only from workouts logged in the app; imported sets can only suppress a claim. This is the approved spec, unchanged here (see Open).
- **Custom exercises created by `Add new` during import.** These have no muscles, so they aren't counted in muscle frequency. The UI already says so.
- **No stale cache.** Progress re-reads `(id, revision)` on every focus. A new test reads Progress before the import and again right after, and gets the new numbers.

## Probe with Ben's files (counts only)

Before the fix, an exercise with dozens of FitNotes sessions had `previous: null` and rule decision `insufficient_data`. Repeat candidates, Past workouts, Up next and the picker were all empty, the lift highlight was null, and the coach's targets returned `not_available`.

After the fix:
- Every imported workout appears in Past workouts and Repeat. Up next has a plan with loads, and the picker lists Category types.
- The lift highlight is present and labelled FitNotes.
- Of the 10 most-used exercises added to a workout, all 10 show `Last (FitNotes, …)`. Nine have a planned load; the tenth is a bodyweight exercise.
- The coach's `get_progression_targets` returns targets.

## Tests

- `apps/mobile/test/import-progress.test.ts` uses a synthetic CSV (invented dates and numbers) on real SQLite, with the shapes Ben's data has: a leading ramp, and a ramp to one top set followed by back-offs. It covers:
  - Progress windows 7/14/30/60, time in gym, muscles, calendar, the exercise list and exercise detail, all fresh right after the commit;
  - Past workouts, the picker and the lift highlight;
  - Start next fitted to the stack (47.5 rounded toward easier to 45), 2 sets from a 2-set workout;
  - B1: Start next from ramp + top single + back-offs plans 4 sets at the back-off load, never 7 at the top load;
  - B1, S1: Up next is the longest gap, not the workout just done, and one-tap Start from it plans the back-off block;
  - Repeat of a FitNotes workout is the workout as done, each set at its own load;
  - B2: Add exercise shows the top set and back-offs as `Last (FitNotes)` and plans that many sets;
  - S2: pain from Today offers the last workout's movements when it is a FitNotes one;
  - the coach's overview, history and targets.
- Domain tests: `fitnotes-reading.test.ts` (leading ramp, ramp + top + back-offs, descending pyramid, up-and-down pyramid, assisted, lb, the set count and its floor, Add exercise counts); `history.test.ts` (FitNotes on any equipment, equipment max, no load without equipment, `fitLater`, other units, newest wins); `lift-highlight.test.ts` (S3: app workouts on different items never charted together when the newest point is FitNotes); `session-types.test.ts` (`longestGapSource`); `pain-flags.test.ts` (N1: a newest FitNotes workout still finds app workouts on their item).
- Persistence: `listFinishedRefs(…, { includeImported: true })`; the dead `countImportedFinished` is removed (N4).
- Further tests cover the overview, summary, pain sheet, target provenance, substitutes (a hotel rack never above its max), session types and persistence (`categoriesBySession`, `listPastWorkoutIds`).
- The session-picker and library tests now expect Decision 2's Up next (SP1: Legs, the longest gap), not D19's newest workout.

## Open (for Ben / PM)

1. **Ramp reading** (above, reading (a)): confirm, or choose (b) the load with the most sets, or (c) every set as stored. Record the answer in the CHANGELOG and ADR 0016.
2. **The set-count floor.** A FitNotes workout with 2 sets at the top load after a ramp (4 sets in all) plans 3 sets at that load. That is what review B1 asked for (never below the default because of the reading), but it is one set more than Ben did at that load. The alternative is no floor (plan 2).
3. **Records from FitNotes (PG30).** Should all-time bests from imported history appear as `FitNotes` records? Today an imported-only exercise shows `Records start after 3 logged sessions.`
4. **Exercise detail.** The chart opens on the default `6 mo` range, and on Est. 1RM even when no set qualifies (review N2). Proposal: widen the range when the series has fewer than 2 points, and open on `Top set` when e1RM has no eligible sets.
5. **Decision 2 copy.** Up next now picks the longest gap, but its basis line is still `From <date>` (true of the source). §2.3's `UP NEXT · LAST DONE …` / `Last done Mon 5 Oct · 6 days ago` is not built. Routines outside the D19 rotation are not considered by the longest-gap pick.
6. **`Add new` exercises.** These could take muscles from the FitNotes Category. Not done: the category isn't stored on the exercise, and mapping Ben's labels to muscles is a product call.
7. **Device check.** Untested on the iPhone: the `Last (FitNotes, …)` header, the `Imported` rows in Past workouts, and Up next after an import.
8. **Top set and back-offs (review r2 B1, Spec issue 1).** Built provisionally as option (i): in a FitNotes session the rule judges reps, misses and effort only on the sets at the load it plans from (the back-offs); heavier top sets are context, and `Why?` says so. Alternatives for Ben: (ii) read the session as `top_set_backoff` and progress the top set separately; (iii) one block (the old behaviour, which stalled). Probe with Ben's files after the fix (Start next from all 167 workouts, counts only): `increase_load` 69, `hold` 135, `hold_after_miss` 7 (all 7 with a miss at the planned load), `reduce_load` 0; no fitted set says `Not checked`.
9. **The working load (review r3 B1, S1; Spec issues 1, 2).** Built provisionally as the review proposed: the kept load with the most sets, ties to the easiest; harder sets are context only when fewer than the sets there; lighter trailing sets are never judged or planned; only judged sets make up the rule's sets and the planned count. Two consequences Ben should see before confirming:
   - The up-and-down pyramid (`10 × 12, 16 × 8, 20 × 6, 16 × 8, 10 × 12`) reads, after the ramp is left out, exactly like a descending pyramid (`20, 16, 10`, one set each), so the tie goes to 10. It is no longer *increased* from the tail (every kept set is judged, and the 6-rep set holds it), but it is still *planned* at 10. No rule on the kept sets alone can tell the two shapes apart; telling them apart would need the ramp (e.g. "a trailing set at a ramp load is a cool-down"). The review's test as written ("not planned from its lightest tail set") is therefore tested as "not increased from its tail, and never reduced".
   - A descending pyramid whose lightest set alone reached the top (`22.5 × 8, 20 × 9, 17.5 × 10`) now holds; it increases only when every set reaches the top.
   - Probe with Ben's files after the fix (Start next from all 167 workouts, counts only): 47 distinct current targets, `hold` 28, `increase_load` 16, `hold_after_miss` 2, `increase_reps` 1. No current target is planned below its most-sets load except where the test gym's equipment rounded it down. 5 of the 16 increases rest on one set: each is a FitNotes session with one set in total, so the plan is one set (Open 2), not a context set making up the count.
10. **Ties, finishers and a heavier last set (review r4 B1, S1, N1; Spec issue 1).** Built:
   - Ties go to the easier load only when the tied loads have one set each (r2 B1); a tie of 2 or more goes to the harder load, so equal-count finishers, burnouts and drop-set triplets are never the working load. When harder sets are judged (a pyramid) and every judged set reached the top, the increase starts from the hardest judged load. A lighter finisher never lifts the planned count (2 working + 2 finishers plan 2; triplets plan 3).
   - 2 or more sets in a row at one load just before a single heavier set are working sets when they outnumber the sets at the heavier load, have at least the heavier set's reps, and (resistance) are at least 80% of its load. A ramp with repeated empty-bar or low-rep warm-ups still reads as a ramp. The review's "at or above the rep floor" was not used: display readers have no rule, and it would read a miss at the working load as a ramp.
   - `Why?` says "judged" for every imported session, names how many sets were read as warm-ups, and words the pyramid fact from the counts.
   - Still for Ben: **S2 / Open 2.** A top single plus 2 back-offs holds ("Only 2 of 3 working sets were judged") and plans 3 at the back-off load. Options: require `min(rule sets, judged sets)` to progress, or drop the floor. Not changed here (a product call).
   - Local probe with Ben's two files (domain only, counts only; throwaway test deleted): 0 increases planned below a load done at the top of the range in the same session, 0 "logged" facts on imported sessions, 0 planned counts above the sets done.
