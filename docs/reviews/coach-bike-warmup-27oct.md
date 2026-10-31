# Coach: "Add 8 min bike warm up" — root causes and fixes (27 Oct)

Branch `claude/coachcardio-27oct`. Ben's report from build 403 (iPhone, 26 Oct, 18:19–18:21), in Your workout's
Coach sheet (`Sees: Legs · Back squat (draft)`), on wifi:

1. "Add 8 min bike warm up" → `ⓘ Offline`, no reply.
2. "Again" → "What would you like me to repeat or change in today's workout?"
3. "Add 8 minute bike warm up before legs" → "Bike warm-up isn't available in your exercise list, so I can't add it."

He also said that searching "exercise bike" in the Add picker found nothing, but "add new exercise" with that name
found it as a duplicate. Then: "check others too".

Exercise bike is in the catalogue (`exercise-bike.json`: cardio, `erg`). By design an `erg` exercise needs no gym
item (`isMachineCardio`, `needsNoEquipment`, 19 Oct), so every gym has it. The gym was not the problem.

## Root causes

| # | Where | Cause |
|---|---|---|
| R1 | Your workout (builder) | The builder knew only exercises with a builder muscle group (`builder-env` `info()` → null for `measurement: cardio` and `movementPattern: conditioning/carry`). So the coach's `usable` list (8 per strength group) never held the bike, and the `add` op refused it with a misleading note: `Not changed: … isn't at this gym`. The model reported that as "not in your exercise list". |
| R2 | Builder coach `add` op | No way to give a time or a position: no `workSeconds`, no "first". Even with the bike allowed, "8 min warm-up before legs" couldn't be expressed. |
| R3 | Add picker on Your workout | `inPickerScope({ kind: 'builder' })` = strength exercises with a builder group only, so **every** cardio machine, timed hold and conditioning exercise was missing from the search (this was Ben's "searched exercise bike, didn't come up"). The workout-in-progress and editor pickers were fine. |
| R4 | Mid-workout coach `find_exercises` | Every query word had to match a name or alias, so "bike warm up" or "8 min bike before legs" found nothing. It also searched only what the gym can do now, so an exercise the gym profile lacks came back as nothing and the coach said it wasn't available. |
| R5 | Builder coach status | `timeout` (no first event in 20 s, which includes a sign-in refresh on the first call after a while) was mapped to `offline`. A transient failure (a stale connection on the first call) was never retried, as coach turns already do. One network error held `Offline` for 60 s with no Retry. |
| R6 | Builder coach sheet | Each ask is independent: "Again" was sent to the coach as the word "Again", with no memory of the failed ask. |

Which exercises were hidden, and where (from the exhaustive test, before the fixes):

- **Your workout Add picker and builder coach**: all cardio machines (Exercise bike, Air bike, Rowing machine, Ski erg,
  Treadmill run, Incline walk, Cross-trainer, Stair climber), timed conditioning (Battle ropes, Bear crawl, Mountain
  climber, Jump rope, Wall drive), and rep-measured plyometric / conditioning work (Box jump, Broad jump, Burpee,
  Lateral bound, Pogo jumps, Squat jump, Dumbbell thruster, Wall ball, Medicine ball slam, Medicine ball rotational
  throw). Cause: no builder muscle group (R1, R3).
- **Mid-workout coach**: anything named with extra words ("bike warm up") (R4); anything the gym profile lacks reads as
  missing rather than "not at this gym" (R4).
- The workout-in-progress Add picker and the workout editor found everything they take.

## Fixes

- **Domain** (`packages/domain/src/builder`): `BuilderContext.extra` / `builderExtraOf` / `makeExtraSlot`. Your
  workout holds an exercise with no builder group: cardio and timed work as a work-time slot (no reps, load, RPE or
  warm-ups; the 22 Oct timed slot that library rides already use), plyometric and med-ball reps as reps with no
  planned load. Never picked by the builder itself. Advice skips slots with no builder info (no false "isolation before
  compound" on a bike). Manual Add takes them (end of the workout).
- **Coach** (`packages/coach/src/builder`): the `add` op has optional `first` and `workSeconds`. "Add 8 min bike warm
  up" → `Add Exercise bike · 8:00 · first`, a proposal with Apply/Skip, re-checked on Apply (rule 5), Undo as any
  builder apply. A cardio machine never replaces a lift (`… can't replace a lift`). The coach sees `otherWork` (cardio
  first) in YOUR DATA and timed slots as `8:00`, and is told never to say "not in your list" when `usable` or
  `otherWork` has a fit. An unknown ID reads `Not changed: unknown exercise`.
- **Picker**: `inPickerScope({ kind: 'builder', add: true })` includes the same exercises; Swap stays strength for
  strength. Search covers name, aliases, part of a name and word order.
- **`find_exercises`**: searches the name words first (`bike` of `bike warm up`), then the whole query; also returns
  `inListNotAddableHere` with code's reason (`Main Gym has no barbell in its profile`, `measured by distance`, `pain
  flagged`) so the coach names the reason and asks one short question (e.g. add the item with `update_gym`).
- **Status** (rule 1): a timeout is `Couldn't reach the coach`, not `Offline`; a transient failure is retried once; a
  network failure after that is `Offline`. Every unanswered ask has **Retry** (same words and ID; tried even inside
  the offline hold). "Again" / "Try again" right after an unanswered ask resends it.

## Tests

- `packages/domain/test/find-exercises.test.ts`: "bike warm up", "8 min bike warm up", "bike warm-up before legs",
  "10 minute rower cool down" (failed before the fix).
- `packages/coach/test/builder-coach-cardio-27oct.test.ts`: refusal repro, bike first at 8:00, proposal, recheck,
  codec round trip, default and clamped times, box jump reps, swap refusal, schema compatibility.
- `apps/mobile/test/coach-bike-warmup-27oct.test.ts` (SQLite, bundled catalogue): coach world lists cardio; proposal,
  Apply, Undo, Start plans an 8:00 ride first; Add picker finds bike, air bike, rower, treadmill, ski, stationary;
  manual add.
- `apps/mobile/test/exercise-search-every-27oct.test.ts`: every catalogue exercise plus one of Ben's own, at a full
  gym, a dumbbell-only home gym and an empty gym: exact name, each alias, a lowercase part of the name and the words
  in reverse order find it in all three Add pickers, and `find_exercises` resolves it (by name, alias, and wrapped in
  "10 min … warm up"). Failed on the 10 plyometric/conditioning exercises before the last fix.
- `apps/mobile/test/builder-coach-offline-27oct.test.ts`: timeout is not Offline (failed before), transient retry,
  Offline hold with Retry, Retry/"Again" in the sheet.

## Open (for Ben)

- **Distance-only work** (Farmers carry, Suitcase carry, Front-rack carry, Sled push, Sled pull, Sandbag lunge, Burpee
  broad jump) is still left out of Your workout, the workout editor and the coach's add, by the earlier decision that
  a saved workout has no distance target (EL-B13). They are found by search in the workout in progress, and the coach
  now says why it can't add them. Should Your workout hold a distance target (e.g. 40 m)?
- **Default times**: a cardio add with no time is 10:00 (as mid-workout), a timed hold 0:30; plyometric reps use the
  built-in rule's range with no planned load.
- **The real cause of `Offline` on the phone** isn't proven: the fixes cover both a timeout and a dropped connection.
  The provider failure is recorded in connection settings; the next time it happens, `Why?` there shows which.
- Not run on Ben's iPhone yet.
