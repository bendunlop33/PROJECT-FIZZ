VERDICT: CHANGES NEEDED

# Review: Minimal copy (claude/minimal-copy)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `git diff claude/gracious-knuth-joxqpw...claude/minimal-copy` (10 commits, 131 files), checked against
`docs/design/minimal-copy-audit.md` (D1–D4, T/C/A/R/S/F/I/O/W/V rows, §12 acceptance checks), the CLAUDE.md
"UI copy is minimal" convention, rules 1, 3 (ADR 0006 labelled fallback), 6 and 9.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=120000`: exit 0. 172 files, 3535 passed, 1 todo.
- Grepped `apps/mobile/src`, `packages/domain/src` and `packages/coach/src` for the §12 check 1 phrases. The only
  hits are comments, model-only text (`registry.ts`), the `snapped` guard-note *kind* identifier, and the two
  Why?-only strings the new test allow-lists (`target-why.ts:162`, `executors.ts:450`). Check 1 holds.

## What holds

- **Nothing functional changed, apart from what's listed below.** The source diff is copy, plus three small
  additions: the `StatusLine` `info` prop and `InfoLine` (`ui/layout.tsx`), the `fit-words.ts` helper, and the
  overview `rule` panel line. `snapLoad` and `routineStartNotes`/`repeatNoteText` lost their unused `gymName`
  parameter. Loads, snapping, bounds, versions and op IDs are untouched. I23's block line now shows whenever the
  import's Undo or Continue is blocked, so no disabled button is left without a reason.
- **Rule 1 / 6 honesty survives where the audit asked.** `Offline` + `wifi.slash`, `Not connected`, `Paused`,
  `Unavailable` (sheet, slot caption, Summary `Coach note`), `≈`/`(estimated)` on Finish (F3), `Not checked` /
  `Typical weights · not checked`, `Suggested` / `Not applied.`, `N damaged record(s)`, and `Data unchanged` on
  every startup, restore and backup failure (O14, T4, T5) are all still visible.
- **Rule 3 / ADR 0006 (D1).** Summary `Next time` built-in rows carry the `Rule` tag in every coach state, and
  coach status moved to the `Coach note` line (`summaryCoachView`). `Why?` keeps `Set by: Built-in rule · …`. The
  overview panel gains a `Rule` line. `Coach target` stays on the set card.
- **Pain safety (D2, rule 9).** `PAIN_PROFESSIONAL_TEXT` is now the one constant (`Sharp or lasting pain: see a
  physio or doctor.`) and is imported by the check-in pain step. `PAIN_RED_FLAG_TEXT` is visible without a tap, and
  `can't diagnose` is gone. The ⓘ on `Which movements hurt?` still explains flags. The second `Still hurts`
  nudge (`pain-flags.ts:191`) is unchanged.
- **Tests.** `apps/mobile/test/minimal-copy.test.ts` parses every source file, ignoring comments, for the banned
  phrases, and asserts checks 3–8 directly. Updated string expectations are in the matching domain and coach tests.

## Blocking

### B1. Slot banner says "Pain flag" when no pain flag exists
`apps/mobile/src/coach/slot-view.ts:38` maps every `pain_blocked` guard note to `Pain flag · no increases`. But
`pain_blocked` is also what `messagePainBlock` returns (`packages/domain/src/coach/adjust.ts:256`) when Ben only
*mentions* pain in this turn, or says something unclear such as "knee feels off". In those cases no flag is written.
The new test codifies the bug: `minimal-copy.test.ts:241` feeds the note `Not increasing Bench press: you mentioned
shoulder pain.` and expects `Pain flag · no increases`.

**Failure scenario.** Mid-workout, Ben types "bench is fine but my shoulder's a bit sore, make the last set
lighter". The coach lowers set 3. The banner, the one always-visible line on the set screen, says `Pain flag · no
increases`. Ben opens Profile › Pain flags and finds nothing. Next session Bench progresses normally, even though
the screen told him a flag was holding it. The app is stating a safety state that isn't true (rules 6 and 9).

**Fix.** Tell flag-based blocks apart from message-based ones. Either give the note its own kind
(`pain_flagged` vs `pain_blocked`), or have `validateTodayAdjustment` pass a `fromFlag` bit. Then show `Pain flag ·
no increases` only for a real flag and `Pain mentioned · no increases` otherwise. Add a test for each case.

## Should fix

### S1. Assisted machines: a capped load reads `Max here` when it's the *least* assistance
`packages/domain/src/session/snap-text.ts:41` (gym-switch card), `:74` (Repeat notes) and `:110` (set card)
always call `boundWords('max', …, false)` or the literal `Max here`. In `snap.ts:259–263`, `capped` on an assistance
load is the `min` bound, the least assistance the machine gives (the same mapping as
`target-provenance.ts:311`). `routines.ts` handles this correctly with `boundWords('min', …, true)`, and the new
helper supports it, so the three snap-text call sites are inconsistent with it.

**Scenario.** Plan: assisted pull-up with 10 kg assistance. The Hotel machine's least assistance is 20 kg. The set
card says `Max here · plan 10 kg`. On an assisted machine "max" naturally reads as the most assistance, which is the
opposite of what happened. CLAUDE.md requires the assisted convention to be explicit.

**Fix.** Use `boundWords(assisted ? 'min' : 'max', …, assisted)` in all three places, taking the convention from
`top.load` or `load`, and add one assisted test per site.

### S2. Off-profile load warning lost its way to fix the gym
`packages/domain/src/session/active-view.ts:447` now says `Not on Barbell at Home (max 140 kg)`. The old text ended
"Log it anyway…, or update the gym", which was the only pointer to the fix. Audit A3 says "Log still works, **and
the line opens the gym**", but `WorkoutScreen.tsx:1237` still renders a plain `StatusLine` with no action. The
explanation is gone and its replacement wasn't built.

**Fix.** Make the line a `LinkLine` (or add a `TextButton` action) that opens the equipment editor for `eq`,
with an a11y hint such as "Opens this equipment".

### S3. The data-loss line (D3) disappears after the first Files copy
`DataBackupScreen.tsx:110` shows `Lost if the app is deleted or signed with another Apple ID…` only while
`offPhone.state === 'none'`. The deleted line at old `:154` was unconditional. The Restore screen's equivalent
(`RestoreScreen.tsx:340`) is now only `Copies in Files: Choose another file`. So after one copy to Files, no
screen says that on-phone backups are lost on re-sign. Phone backups made after that copy are still at risk. This
is data-at-risk honesty, which the brief asks to keep as a short word or line. The audit's own reasoning ("repeats
:112 on the same screen") assumed :112 always showed. See Spec issues.

**Fix.** Show the one D3 line unconditionally under `Backups on this phone`, and keep the `none`-state copy above.
Or make :112 unconditional and leave the rest as it is.

### S4. Remaining rule or reassurance strings the pass missed
- `apps/mobile/src/services/gym-services.ts:46`: `Couldn't save this. Your changes are still here.` is a §1 rule 1
  reassurance tail. Use `Couldn't save. Try again.` (as O15).
- `apps/mobile/src/screens/ProgressScreen.tsx:54`: `N workouts imported from FitNotes aren't listed here yet.
  They're in Data & backup, under Past imports.` This is I4's long form, which `PastWorkoutsScreen` already
  replaced. Reuse `importedNotListedLine` + `LinkLine` to Past imports.
- `packages/domain/src/session/routines.ts:318`: `An exercise in this routine is no longer in your list, so it was
  left out.` Shorten to `1 exercise left out (not in your list)`.
- `packages/domain/src/checkin.ts:182`: C11's `Coach offline` has no consumer in `apps/` (`offline_line` is never
  rendered), so the audit row can't be seen on screen. Either render it with `wifi.slash` on the check-in toast as
  C11 specifies, or drop the dead branch and note it in the audit.

## Nits

- **N1.** VoiceOver: the new ⓘ buttons are labelled just `Info` (`ui/layout.tsx:224` in `StatusLine`, and the
  default on `ImportIntroScreen`'s `InfoLine`). Out of context that is "Info, button". Pass a contextual label
  (`Error details`, `About FitNotes files`), as `RestoreScreen` and `SaveCopyToFiles` already do.
- **N2.** `StatusLine` sets `accessible={!hasInfo}`, so with `info` its `accessibilityLabel` is ignored and text,
  detail and button are read as separate stops. That's acceptable, but check on a device that the icon isn't
  announced on its own.
- **N3.** `fit-words.ts:60` lower-cases the equipment name (`No rogue ohio bar here`). With no name it reads `No
  load target · no equipment for this here`. Keep the user's casing for custom names, and use `No load target ·
  not here` as the fallback.
- **N4.** The overview `Rule` line's value comes from stored provenance
  (`overview.ts:761`). A session planned before this build still shows the old `Double progression, … (built-in
  default for …, provisional)` string in the panel. `RULES[].label` in `default-rule.ts` is now unused.
- **N5.** Stale comments: `coach/next-time-view.ts:26` (`Built-in rule (…)`) and `workout-services.ts:1549`
  (`labelled Target (built-in rule)`).
- **N6.** This predates the branch: Today's check-in `LinkLine` has the a11y label `Edit your saved check-in`, which
  hides the new `Check-in 14:05 · 3 of 5` text from VoiceOver. Fold the time and score into the label.
- **N7.** `DataBackupScreen.tsx` still has the long trial-run paragraph. It is actionable data-safety text, so
  keeping it is defensible, but it is the longest lead left in the main UI. Consider putting it behind an ⓘ in a
  later pass.

## Spec issues

1. **O2/D3** assumes `DataBackupScreen` :112 and :154 are duplicates. :112 is conditional on there being no Files
   copy, so deleting :154 removes the data-loss line for the common case (S3). The audit should say the D3 line
   is shown once, unconditionally.
2. **W13** prescribes `Pain flag · no increases` as the one visible slot warning, but coach pain blocks also come
   from what Ben says, with no flag (B1). The audit should give two wordings.
3. **§12 check 4** says the overview panel shows `Rule` or `Coach` "for every row with a target". Routine-template
   and Repeat targets are neither, and the implementation (and its test) correctly shows no source line for them.
   Reword to "every built-in or coach target".
4. **D1, D2 and D4 remain PM defaults that Ben hasn't confirmed.** In particular, under D1 the set card no longer
   labels a built-in target at all (it shows `Target`, with the source only behind `Why?`). Rule 3 says the
   fallback is "labelled". The Summary tag and overview line meet that, but Ben should confirm the set card is
   allowed to be unlabelled.
