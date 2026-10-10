VERDICT: CHANGES NEEDED

# Review: premium feel pass (claude/polish)

Reviewer: independent reviewer agent, 10 Oct 2026.
Scope: `git log claude/gracious-knuth-joxqpw..HEAD` (d49aa6b … 5ac6789, 19 commits), checked against
`docs/design/premium-feel.md`, the D-Today / D-ActiveSet / D-Rest mockups, CLAUDE.md, and the
existing rest-state, active-workout and workout-summary specs.

## Checks run

- `npm run check` (typecheck, lint, tests, catalogue validate, guide check, guide motion): **exit 0**.
  107 test files and 1445 tests pass. In the full run, `packages/catalogue/test/figure.test.ts` printed two `×`
  lines (guide checks, 5.5 to 7.4 s each under load), but the suite total was still all-pass, and the file passes
  on its own (31/31). This is load-related flakiness in a file this branch doesn't own (see N12).
- Worklet crash risk: **none added**. The branch adds no Reanimated or worklet code. All motion uses RN `Animated`
  with `useNativeDriver: true`, on opacity and transforms only, so ADR 0018's no-closure-defaults and no-throw rules
  don't apply. `haptic()` can't throw: the sync throw is caught and the promise rejection is swallowed.
- Reduce Motion: press scale, list enter, digit, finish and screen slides are each removed or turned into a fade.
  A live toggle snaps running animations to their end state. Tested as pure rules in `apps/mobile/test/motion.test.ts`.
- Durability and idempotency: routine save, rename, delete and restore are versioned with `lastOpId`. A routine's
  ID is derived from its save opId. `startRoutine` checks `findByStartOperation` before the single-active check.
  `rename_session` is versioned, and its supersede check is correct. The routines-flow test covers force-close
  recovery of a routine start. Backup round-trips the new routine fields.
- Product rules: completed sets are never modified by this pass. Loads in a routine start go through
  `fitLoadHere` / `pickEquipment`, which never go above a max and pick the easier side for assisted machines (tested).
  Pain feeds into `nextTargetsOf`. The record line is never computed from an estimate. Nothing needs network or AI.
  The coach slot renders nothing when it's empty (no canned card). No secrets, and no new logging of health data.

## Blocking

### B1. Rest ending while Ben edits the next set remounts the editor: the keyboard closes mid-entry and the editor flashes from opacity 0
`apps/mobile/src/screens/workout/WorkoutScreen.tsx:960-980`

Before this branch, the slot after the rest panel rendered the same `setEditor` element both during rest
(after `Edit next set`) and after rest, so React kept the editor mounted. Now the resting branch renders
`setEditor` bare, and the non-resting branch wraps it in `<SwapIn key={`ready:${setId}`}>` (a `FadeIn`
`Animated.View`). The element type at that slot changes when the rest ends, so the whole editor unmounts and
mounts again.

Failure scenario: Ben taps `Edit next set` during rest and starts typing `62.5` into Load. The timer reaches 0.
The `TextInput` remounts. The keyboard drops, focus is lost, and the local field text is rebuilt from the parsed
value, so a trailing `62.` becomes `62`. The editor he is looking at then fades in from opacity 0 with an 8 pt rise.
This is a regression in the logging loop, and it happens often: people adjust the load in the last seconds of rest.

Fix: render the editor through the same wrapper in both branches and keep the key stable while the set doesn't
change. For example, always use `<SwapIn swapKey={`ready:${setId}`} animate={drawn.current && !editorWasVisible}>`,
where `editorWasVisible` records whether the editor was already on screen (folded open) when the rest ended. Add a
render test, or at least a pure test of the key and animate decision, for "editor open during rest → rest ends → same key, no animation".

### B2. The finish moment replays on every `View summary` from Today (acceptance 18, §6 "once per workout")
`apps/mobile/src/screens/workout/SummaryScreen.tsx:72,83`; `apps/mobile/src/screens/TodayScreen.tsx:384,601`

`justFinished` is `!back`. Today's `View summary` (Done today hero, line 384) and the line-601 link both navigate
without `back: true`, so on every later visit from Today the check is revealed again, the title fades in again and
the facts stagger in again. The haptic is still guarded once per process by `firstTime` plus the 5-minute window, but
the animation isn't. The spec says the moment happens once per workout and later visits are static.

Fix: animate only when Summary was reached by `replaceWithSummary` after a real finish. Pass an explicit
`justFinished: true` route param from that path, and drop the `!back` inference. Alternatively, gate the animation
on the same `firstTime('summary-finish:'+id)` key as the haptic. Add a test that a Summary opened from Today doesn't animate.

### B3. New UI copy breaks the minimal-copy rule now on the target branch's CLAUDE.md (Ben, 10 Oct)
The base branch moved on after this branch was cut. 5e42865 adds to CLAUDE.md: "No reassurance lines … no rule labels
in the main UI ('built-in rule', 'snapped to'), no paragraphs of lead text … put any explanation behind an optional
'Why?' or info tap". When this branch merges, these lines will break that rule:
- `TodayScreen.tsx:440`: "After your first workout you can save it as a routine and start it from here." (explanatory lead text)
- `TodayScreen.tsx:404`: "From 8 Oct, with next targets (built-in rule)" (a rule label; carried forward, but the line is now rebuilt in this branch)
- `RoutineSheet.tsx:115`: "Targets from the built-in rule." / "Targets as saved in the routine."
- `SummaryScreen.tsx:436` and `RepeatScreen.tsx:188`: "… sets. Targets start from what you did today/on <day>."
- `workout-services.ts:567`: "Couldn't work out next targets, so these are the routine's own numbers." This one is an honest
  status, so keep it, but shorten it to a word or icon with the reason behind "Why?".

Fix: rebase onto `claude/gracious-knuth-joxqpw`, then cut these lines to values and actions. Keep honest status as
the shortest word or icon (for example, a `Rule` SourceTag chip with the explanation behind an info tap). The spec
copy table that causes this is listed under Spec issues.

## Should fix (not blocking)

S1. **The log haptic now waits for several database reads.** `WorkoutScreen.tsx:374-378`. `haptic(logHaptic(...))`
fires only after `services.workout.setRecord()` has read the profile, the session, all history for the exercise
(`historyFor`) and the gym. On a phone with a long history, that can put 100 ms or more between the write and the
tactile "logged" signal, which is the main feel moment this pass is meant to improve. It also costs a full history
read on every log. Fix: work out the record threshold (the heaviest comparable load and the most reps at it, plus the
3-session gate) when the set is focused or rest starts, then decide `commit` vs `record` synchronously right after the write.

S2. **Rest end → `READY` hold not built** (§4.3). `RestPanel` returns null as soon as `rest.kind === 'ended'`
(`WorkoutScreen.tsx:1249`), so the screen jumps straight to the editor. The spec asks for `READY`, a digit fade to
`0:00`, then a swap after 600 ms. Either build it or record it as deferred in the spec.

S3. **The record line isn't on the Summary** (§5.1 "Summary: the same sentences in the Comparison region").
`findSetRecord` only feeds the Rest line. `motion.recordPulse` (exception 3) isn't built either. Build them, or mark them deferred.

S4. **±30 s has no `haptic.step`** (§5 table: "add to effort and ±30 s"). Effort has it. `onAdjust` at
`WorkoutScreen.tsx:654` doesn't.

S5. **`Rename workout` is hidden in `⋯` for an open-ended workout in progress** (`WorkoutScreen.tsx:469`, reducer
`handleRenameSession`). The spec's ⋯ menu always lists it. The developer's reason is sound (a name marks a planned
workout and would change how its last set rests, audit B1). But Ben mostly starts Empty workouts (his screenshot
shows `FULL BODY`), so in practice he can't rename mid-workout. It needs Ben's call and a spec note. See Spec issues.

S6. **`bell.slash` opens iOS Settings or the iOS prompt, not Profile → Voice & alerts** (`WorkoutScreen.tsx`,
`openAlertSettings`). The VoiceOver label says "Opens alert settings", and spec §3.5 and acceptance 9 say Voice &
alerts. The behaviour is arguably better, but the spec and the code should agree.

S7. **Routine targets are keyed by `exerciseId`** (`packages/domain/src/session/routines.ts:262`, `nextTargetsOf`
skips repeats). If a routine has the same exercise twice (for example a heavy and a light bench slot), both slots get
the first slot's targets. Key the targets by the routine exercise's position or session-exercise mapping, or skip
targets for duplicated exercises. Add a test.

S8. **The week line says "<title> in progress" for a stale workout from an earlier week** (`today.ts:207`). The hero
says Stale while the week section says "in progress" with no dot this week. Count it as `live` only when its local
date is in `weekDates` (or when `main.kind === 'resume'`).

## Nits

N1. `TimerNumeral` keys each glyph by `glyphs.length` (`ui/motion.tsx:145`). On `10:00 → 9:59` every glyph remounts
and appears at once instead of the "whole numeral cross-fades once" the pure rule returns. Use the place from the right as the key.

N2. In `FadeIn` (`ui/motion.tsx:65`), the Reduce Motion effect runs after the start effect and snaps progress to 1,
so the 150 ms reduced swap fade (`swapMotion(true)`) never plays. This is harmless (still RM-safe), but the
`reducedDurationMs` token is dead code.

N3. `createAfterDismiss` (existing code, now used by 5 more sheets): a fallback timer from an earlier `arm` can fire
a later `arm`'s callback early. Clear the earlier timer on `arm`.

N4. `resumeOn` (`TodayScreen.tsx:190`) sends `set_active_set` with the version Today loaded. If the session moved on
(a tick, the timer), the command is refused without any message and Workout opens on the current exercise. Re-read
the session first, or show a short note.

N5. In `findSetRecord`, when `equipmentId` is null the comparison runs across gyms, but the text still says "at <gym>"
(`records.ts:75`). Drop the gym from the text when there's no equipment instance.

N6. The week dot for a day that is both trained and in progress shows only the filled dot. The words say both, so
this is fine, but §2.5 implies a combined state.

N7. `motion.tsx` header and design-system.md say "no app worklets (ADR 0018)". ADR 0018 doesn't forbid worklets; it
requires a try/catch in each one. Reword it as "chosen to avoid worklet risk on the logging screen", or record the choice in an ADR.

N8. The `Rest ring` developer toggle (§4.4) isn't built. That's acceptable because it's off by default, but say so in the spec's open items.

N9. The spoken `Workout saved.` cue (§6.2) isn't built.

N10. The first-set target only shows on preview rows for top or back-off schemes (`targetSummaryLines`). With a top
set plus back-offs, the line shows only the top set.

N11. `SummaryScreen.tsx` rename pencil still uses `opacity: pressed ? 0.6 : 1` instead of `TEXT_PRESSED_OPACITY`.
`RoutineSheet.tsx` `⋯` does too.

N12. `figure.test.ts` guide checks run 5 to 7 s under full-suite load. They're out of this branch's scope, but they
are likely to flake in CI.

## Acceptance checks (premium-feel.md §12)

| # | Status |
|---|---|
| 1 week line in progress | Met (domain tests); stale edge S8 |
| 2 Resume list + lift | Met |
| 3 Up next `Target` rows match Start | Met (same `routineStart` / preview path) |
| 4 Save as routine + Undo, workout unchanged | Met (routines-flow test) |
| 5 Routine start uses next targets; added exercise not kept | Met (tests); duplicate-exercise edge S7 |
| 6 Rotation | Met (tests) |
| 7 Rename workout, undoable, routine untouched | Met after Finish; hidden mid-workout for open-ended (S5) |
| 8 Alerts sheet once on first Start, before check-in | Met (Today, Repeat, routine sheet via Today) |
| 9 `bell.slash` when off | Shown; target differs from spec (S6) |
| 10 One link, no paused banner, Pause in ⋯ | Met |
| 11 Next line includes target load | Met |
| 12 52 pt pills/chips, 60 pt Log | Met (tokens) |
| 13 Press scale 0.97 / none under RM | Met |
| 14 Per-glyph digit fade, tabular | Met; length change N1 |
| 15 Ring off by default | Met (not built, N8) |
| 16 Haptics after write; record instead of commit; finish once | Met, but delayed (S1); finish animation replays (B2) |
| 17 Record rules | Met (unit tests for each rule) |
| 18 Done tappable at once; check draws once | **Not met**: replays from Today (B2) |
| 19 No animation delays a write | Met |
| 20 No blank sheet | Met: RN Modal bottom cards with placeholder rows |
| 21 check passes, tokens listed | Met (tokens marked "Proposed; Ben to approve") |

## Spec issues

1. **§10 copy predates the CLAUDE.md minimal-copy rule.** The rule was added on the base branch on 10 Oct. The first
   workout hint, "Targets from the built-in rule.", "Targets start from what you did today." and the "(built-in rule)"
   basis line all conflict with it. The designer should cut them to values, actions and short status words before the developer fixes B3.
2. **§4 says motion is "driven by react-native-reanimated on the UI thread"** and §4.3 names `LinearTransition`. The
   build uses RN `Animated` with the native driver to avoid worklet crash risk (after the build-83 How-to crash). That
   is a sound choice, but the spec should say so, ideally in a short ADR.
3. **§2.6 says rename is allowed while active**, which conflicts with the open-ended rest rule (audit B1: a name marks
   a planned workout). Ben needs to decide: either allow renaming an open-ended workout without changing how it rests
   (store the display name separately from the planned/open-ended marker), or accept "named after Finish".
4. **§3.5 / acceptance 9 send `bell.slash` to Voice & alerts**, which can't re-prompt iOS once it's denied. The spec
   should say what the tap does in each permission state.
5. **§5 says each haptic has its own switch in Profile → Voice & alerts.** Those switches don't exist yet. Either list
   them as a dependency or drop the claim.
6. **Open items §13 (motion exceptions, permission timing, Pause in ⋯, the record rule) are still awaiting Ben.** The
   code ships them as "Proposed" tokens. That's fine for a test build, but they should be approved before this merges
   to the main branch.
