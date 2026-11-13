VERDICT: PASS

# Review: Minimal copy, round 2 (claude/minimal-copy)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: the full branch diff `claude/gracious-knuth-joxqpw...claude/minimal-copy` (133 files), with the focus on the six
fix commits since round 1 (`476eef1..3e439ba`: B1, S1–S4, N1, N3, N5, N6). Checked against
`docs/design/minimal-copy-audit.md`, the CLAUDE.md "UI copy is minimal" convention, rules 1, 3 (ADR 0006 labelled
fallback), 6 and 9, and the round 1 review (`docs/reviews/minimal-copy.md`).

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=120000`: exit 0. 172 files, 3542 passed, 1 todo. That is 7 more tests than round 1.
- Grepped `apps/mobile/src` for long visible strings and rule or reassurance phrases (`never`, `until you`,
  `unless you`, lines over 70 characters). The only hits are behind an ⓘ (`info=`), actionable (`Finish or discard
  your workout first…`), progress text, or listed under N3 below.

## Round 1 findings: status

| R1 | Status | Evidence |
|---|---|---|
| B1 slot says `Pain flag` with no flag | **Fixed** | New `pain_mentioned` guard-note kind (`schemas/src/coach.ts:239`). `messagePainBlock` returns it for a named-movement mention (`domain/src/coach/adjust.ts:256`). Saved flags still return `pain_blocked` (`:308`, `next-session.ts:177`). `slot-view.ts:40–41` shows `Pain flag · no increases` only for `pain_blocked`, and `Pain mentioned · no increases` for `pain_mentioned` and `pain_unspecified`. Covered by a domain test (`coach-guardrails.test.ts:946–948`) and both slot cases (`minimal-copy.test.ts:251–261`). No other consumer switches on `pain_blocked`; `sheet-view.ts` `NOT_CHANGED_KINDS` is unaffected. |
| S1 assisted caps read `Max here` | **Fixed** | `cappedWords` (`snap-text.ts:62–65`) and `setSnapNote` (`:119`) now read `Least assistance here` for `assistance` loads at all three sites. There is one test per site (`fit-words.test.ts:44–55`). |
| S2 off-profile line lost its way to the fix | **Partly fixed**, see S1 below | The line is now a `LinkLine` with a warning icon and a11y hint (`WorkoutScreen.tsx:1259–1277`). The typed draft is saved before leaving (`:598–612`). |
| S3 D3 data-loss line hidden after first Files copy | **Fixed** | The line is unconditional under `Backups on this phone` (`DataBackupScreen.tsx:147–150`), with a source-level test (`minimal-copy.test.ts:195–203`). The audit row O2 is corrected. |
| S4 missed strings | **Fixed / recorded** | `gym-services.ts:46` → `Couldn’t save. Try again.`; Progress uses `importedNotListedLine` + `LinkLine` to Past imports (`ProgressScreen.tsx:54–65`); routine `left out` is counted and short (`routines.ts:317–318`, tested); C11 is recorded in the audit as having no consumer yet. |
| N1 bare `Info` a11y labels | **Fixed** | `StatusLine`/`InfoLine` take `infoLabel` (default `Details`). Every current `info=` caller passes a contextual label (`Error details`, `About errors`, `About FitNotes files`, `About backup files`, `About checking`). The check-in sheet uses `About ${title}` (see N2). |
| N3 lower-cased custom names | **Fixed** | `nameInLine` keeps the casing of a name with its own capitals, and `No load target · not here` is the fallback (tested). |
| N5 stale comments, N6 check-in a11y | **Fixed** | `TodayScreen.tsx:326, 524` reads out the visible time and score. |
| N2, N4, N7 | Open (acceptable) | N2 needs a device check. N4 (old provenance strings in the overview `Rule` line) and N7 (trial-run paragraph) are unchanged and remain nits. |

## What holds

- **Nothing functional changed beyond the reviewed fixes.** The source diff since round 1 is copy, one additive
  guard-note kind, the `offProfileEquipment` view field and its navigation, and a11y labels. Snapping, bounds,
  versions, operation IDs and set order are untouched. `pain_mentioned` still blocks increases exactly as
  `pain_blocked` did; only its kind changed.
- **Rules 1 and 6 survive.** `Offline`, `Not connected`, `Unavailable`, `≈`/`(estimated)`, `Not checked`,
  `Suggested` / `Not applied.`, damaged-record counts and `Data unchanged` are all still visible. The D3 data-loss
  line now shows in every state.
- **Rule 3 / ADR 0006.** Summary `Next time` built-in rows keep the `Rule` tag, the overview keeps its `Rule` line,
  and `Why?` keeps `Set by: Built-in rule · …`. Nothing in round 2 touched these.
- **Rule 9 / pain safety.** `PAIN_PROFESSIONAL_TEXT` and the red-flag line still show without a tap, and the slot
  banner no longer claims a flag that doesn't exist.

## Blocking

None.

## Should fix

### S1. The off-profile line opens an editor that can't fix today's workout, then strands Ben on Profile
`apps/mobile/src/screens/workout/WorkoutScreen.tsx:598–612` navigates with `popToTabs` to `Profile ›
EquipmentEditor` (`initial: false`). Two problems follow.

1. **The edit doesn't change today's workout.** The active view checks loads against the session's frozen
   `equipmentSnapshot` (`packages/domain/src/session/active-view.ts:309`). The editor's own toast says so: `Saved.
   Future workouts use the new setup.` (`EquipmentEditorScreen.tsx:102`).
2. **Ben is left outside the workout.** After saving, `navigation.goBack()` (`:115`) lands on the Profile root,
   because `initial: false` puts Profile under the editor. The way to bring changes into today, `Use changes
   today` on Gym detail (`GymDetailScreen.tsx:44–57`), is never on that path.

**Scenario.** Mid-set, Ben types 102.5 kg on the Home barbell and sees `Not on Barbell at Home (max 140 kg) ›`.
He taps it, fixes the plates, and saves. He lands on Profile, goes to Today, taps Resume, and the same warning is
still there for the load he just made valid. The audit asked that the line "opens the gym" (A3), and Gym detail
is the screen with the in-workout path. Log still works, so this is not blocking.

**Fix.** Do one of these:
- Open `GymDetail` for `eq.gymId` (the A3 wording), stacked on the gym list rather than the Profile root. Its
  `Use changes today` then gives the route back into the workout.
- Keep `EquipmentEditor`, but pass a `fromWorkout` flag. On save, dispatch `openWorkoutToCheckGym(gymId, nonce)`
  instead of `goBack()`, so the workout opens `Use updated …`.

Either way, add a test that the navigation target matches the A3 intent.

## Nits

- **N1.** `packages/domain/src/session/routines.ts:318`: the shortened `N exercises left out (not in your list)`
  note has no consumer. `routines.preview(...).notes` isn't rendered anywhere in `apps/mobile/src` (this predates
  the branch). If it gets rendered in Repeat's `${exerciseName}: ${text}` format, the placeholder `exerciseName:
  'Exercise'` will read `Exercise: 1 exercise left out…`. Use an empty name or a separate note kind when wiring it.
- **N2.** `CheckInScreen.tsx:94`: `About ${title}` gives the VoiceOver label `About Which movements hurt?`. Pass an
  explicit label instead (`About pain flags`).
- **N3.** These rule-explaining strings remain, and the audit doesn't list them:
  - `EquipmentEditorScreen.tsx:102`, toast `Saved. Future workouts use the new setup.`. `Saved` alone, or `Saved ·
    next workout`, would do.
  - `GymDetailScreen.tsx:48`, `Your workout in progress uses this gym as it was when you started.`. `In use today`
    plus the existing `Use changes today` action would do.

  Both are true and useful, so they're not blocking, but they are the kind of sentence the convention targets. Add
  them to the audit's next pass.
- **N4.** `WorkoutScreen.tsx:609–610`: if `save_draft` fails, `.catch(() => null).then(go)` still navigates away,
  and the unmount cancels the debounced save, so the typed draft is lost. Only an uncommitted draft is at risk, not
  a completed set. Consider staying on screen if the save fails.
- **N5.** Action records written before this build with a message-based `pain_blocked` note will still read `Pain
  flag` if Ben reopens an old slot banner. This affects only historical records, so no migration is needed. It's
  noted for completeness.

## Spec issues

1. **§12 check 4** still says the overview panel shows `Rule` or `Coach` "for every row with a target"
   (`minimal-copy-audit.md:252`). Routine-template and Repeat targets correctly show neither. Round 1 raised this
   (spec issue 3) and the wording hasn't changed. Reword it to "every built-in or coach target".
2. **A3** says "the line opens the gym", but `EquipmentEditor` saves only apply to future workouts. The audit should
   say where the line lands and how a fix reaches today's workout (see S1).
3. **D1, D2 and D4 are still PM defaults that Ben hasn't confirmed** (carried over from round 1). In particular,
   under D1 the set card shows a built-in target as plain `Target`, with its source only behind `Why?`. Rule 3 says
   the fallback is "labelled". Ben should confirm that the Summary `Rule` tag and the overview line are enough.
