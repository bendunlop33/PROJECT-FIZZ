# Minimal-copy audit

Written by the designer on 11 Oct 2026. It applies CLAUDE.md "UI copy is minimal" (Ben, 10 Oct 2026). Ben's words: "I don't like how the app says in it explaining the rules etc."

**Scope:** every user-visible string in `apps/mobile/src` (screens, ui, import views, alerts, notifications, services that return on-screen text) and the `packages/domain` functions that produce on-screen text. The base branch was read on 11 Oct at `30555a4`; every `file:line` below was re-checked against that commit. Source strings use curly apostrophes (`’`), so search for a distinctive fragment rather than the whole sentence. §10 covers the two worktrees that are still being built.

**Out of scope:** Profile › Developer, Capability probe and ChatGPT sign-in test. These are diagnostic screens for device spikes and aren't part of the product UI. VoiceOver `accessibilityLabel` and `accessibilityHint` strings are also out of scope unless they repeat a rule. Apple's `accessibilityHint` guidance is that a hint briefly describes the result of the action, so they stay.

## 1. How to read this

Each row gives the file and line on the base branch, the current text, the replacement and the kind of fix:

| Fix | Meaning |
|---|---|
| **Delete** | Remove the string. Nothing replaces it. |
| **Shorten** | Use the shorter text given. Values and actions stay. |
| **Word/icon** | Replace it with one word or an SF Symbol (plus an a11y label). |
| **Why?/ⓘ** | Move the text behind the existing `Why?` or a new `ⓘ` tap. The main UI shows only the value. |

Rules applied throughout:

1. **"Couldn't X." already means nothing happened.** Drop `Nothing changed.`, `Nothing was lost.`, `Your entry is still here.` and similar tails. Only say what happened when something *partly* happened, for example an import that stopped at workout 40 of 120. **Exception:** failures where Ben would reasonably fear for his data (the database won't open, a restore or migration fails) keep two words, `Data unchanged`, because "Couldn't open" does not by itself say nothing was lost.
2. **Keep honesty items as the shortest word or icon:** offline (`wifi.slash` + `Offline`), coach not connected, estimate (`About` / `≈`), target versus actual (`Target`), not checked, damaged records.
3. **No standing reassurance:** `Nothing changes unless you say so`, `Changing it never changes your sets`, `Logged sets are kept`, `Your workouts stay`.
4. **No rule labels in the main UI:** `built-in rule`, `(built-in, not logged)`, `Rounded down to the nearest load here`, `GymSmarter won't change or guess…`. Where a label is required (see §2), use one `Tag` word and put the wording behind `Why?`.
5. **Confirmation alerts are a title plus buttons.** Drop a message line that explains the consequence when Undo exists or the title already says it.
6. **No lead paragraphs** on sheets, empty states or import steps. The question or title is enough.

## 2. Conflicts for Ben to decide

| # | Conflict | Proposal |
|---|---|---|
| D1 | **Rule 3 vs minimal copy.** Rule 3 says the no-AI fallback is "the labelled fallback (ADR 0006)". The convention bans "built-in rule" in the main UI. | Main UI shows only `Target …`. A one-word `Tag` (`Rule`) appears where a *next-session* plan is presented: Summary `Next time`, the routine sheet and the Overview. `Why?` → `Set by: Built-in rule · after 8 Oct`. This keeps the label one tap away and costs one word on screen. **Ben decides** whether a `Rule` tag satisfies rule 3. |
| D2 | **Pain safety text vs minimal copy.** The check-in pain step shows two paragraphs, one of which is the red-flag line `Stop and get medical help now if…`. | Keep the red-flag line visible (safety, not a rule), shortened. Shorten the physio line, and drop `The coach can't diagnose` (rule 9 governs coach behaviour, so the UI doesn't need to say it). **Ben confirms.** |
| D3 | **Data-loss warning (SideStore re-sign).** `Copies on this phone are lost if GymSmarter is deleted or re-signed…` explains how things work, but losing data is a real risk on free signing. | Keep it as one line, once on Setup step 3 and once on Data & backup: `Lost if the app is deleted or signed with another Apple ID. Save a copy to Files.` Keep "another Apple ID": the weekly SideStore refresh also re-signs the app and loses nothing, so a bare "re-signed" would be false and alarming. |
| D4 | **Deleting a logged set has no Undo.** §1 rule 5 drops alert messages only where Undo exists. Today `Delete set 2?` is followed by a plain `Set 2 deleted` toast, so its `The edit log keeps a record.` line is the only sign the set is recoverable (rule 2). | Add `Undo` to the `Set N deleted` toast (a versioned correction, rule 5), then drop the message (A8). If Ben would rather not add Undo now, keep `Kept in the edit log.` **Ben decides.** |

## 3. Today (priority)

`apps/mobile/src/screens/TodayScreen.tsx` unless noted.

| # | File:line | Current | Replacement | Fix |
|---|---|---|---|---|
| T1 | :441 | `Pick an exercise and log your first set. Common lifts are at the top.` | *(none)*: hero is `TODAY` / `First workout` / `[Start workout]` | Delete |
| T2 | :445 | `Uses a typical gym (barbell, dumbbells, cables, machines) until you check its equipment in Profile.` | *(none)*. The gym pill already says `Set up gym ▾`. After Start, the pill reads `Typical gym ▾` and its equipment rows carry the existing `Not checked` tag | Delete |
| T3 | :505 | `Check-in saved at 14:05: 3 of 5 · Tired. It'll be used when you start.` | `Check-in 14:05 · 3 of 5 · Tired ›` | Shorten |
| T4 | :482 | `A restore was interrupted. Your data is as it was before.` | `Restore didn't finish · data unchanged` (+ `OK`) | Shorten (the state matters, so it stays) |
| T5 | :302–303 | `Couldn't open your training data.` (or `Your unfinished workout couldn't be read.`) + `Nothing was deleted. {message}` | Same title + `Data unchanged`, with `{message}` behind `ⓘ` (§1 rule 1 exception) | Shorten |
| T6 | :327 | `Rest over · ready for next set` | `Rest over` | Shorten |
| T7 | :165 | `A workout is already in progress. Resume it above.` | `A workout is already in progress.` (Resume is the hero above) | Shorten |
| T8 | :175 (also `RepeatScreen.tsx:123`) | `Using your check-in from 14:05 · 3 of 5` | `Check-in 14:05 · 3 of 5` | Shorten |
| T9 | :248 | Alert `Delete Push A?` / `Past workouts keep their name.` | Title and buttons only (Undo toast follows) | Delete message |
| T10 | `status/system-status.ts:54` | `No gym yet. Add one to start a workout.` | `No gym yet` + `[Add gym]`. The old text is also false: Start now works without a gym and uses a typical one (`TodayScreen.tsx:138`) | Shorten |
| T11 | `domain/session/snap-text.ts:99–121` (`repeatNoteText`, shown in the routine sheet and Repeat) | `Rounded down to what Hotel has. Last time 32.5 kg each.` / `Capped: the most here is 30 kg each. Last time …` / `Rounded from 225 lb to 100 kg to match this gym.` / `No load target: last time was …, and there's no equipment here to check a kg load on.` | `Rounded · last time 32.5 kg each` / `Max here 30 kg each · last time 32.5` / `Converted from 225 lb` / `No load target · no kg equipment here` (each `No load target · {reason in ≤4 words}`) | Shorten |
| T12 | `screens/routines/RoutineSheet.tsx:118–120` | `Rule` tag + `Why?` → `Next targets from the built-in rule` | Keep (already follows D1) | Fine |
| T13 | `domain/target-provenance.ts:198–225` (`startWarningNote`; shown in Repeat notes, routine `Next targets` and the `Why?` guard notes) | `Capped at 30 kg: the most this rack makes. Plan was 32.5 kg.` / `Set to …: the least … this machine gives. …` / `Rounded from 225 lb to 100 kg to match this barbell.` / `Rounded to 30 kg, the nearest easier load this rack makes. …` / `No load target: plan was …, a different kind of load, so it isn't converted.` and four more `No load target: …` sentences | `Max here 30 kg · plan 32.5` / `Min here … · plan …` / `Converted from 225 lb` / `Rounded · plan 32.5 kg` / `No load target · {reason in ≤4 words}`, same pattern as T11. Inside `Why?` the full sentence may stay | Shorten |
| T14 | `domain/session/routines.ts:360–400` (`routineStartNotes`, routine Start) | `Rounded from … to … to match Hotel.` / `Set to …: the least assistance Hotel gives. Plan was ….` / `Rounded down from …: Hotel stops at ….` / `No Barbell at Hotel: no load target.` / `No load target: the lightest at Hotel is heavier than ….` / `No load target: … is in another unit.` | Same pattern as T11 and T13 | Shorten |

Already short (no change): `In progress · started 14:05`, `2 of 12 sets done`, `Unfinished · 8 Oct`, `Finish (ended about 18:40)`, `Discard (nothing logged)`, `Up next`, `Your only routine`, `After Push A on 8 Oct`, `Still hurts? Bench press · flagged 14 days ago`, `No workouts yet this week.`

## 4. Check-in (priority)

`apps/mobile/src/screens/workout/CheckInScreen.tsx` unless noted.

| # | File:line | Current | Replacement | Fix |
|---|---|---|---|---|
| C1 | :353 | lead `Before your workout. Saved with it. Nothing changes unless you say so.` | *(none)*: title `How are you feeling today?` | Delete |
| C2 | :374 | lead `Pick any that apply. Optional.` | *(none)*. `Skip` says it's optional | Delete |
| C3 | :177 | `Next you'll choose which movements hurt.` | *(none)*. The next step shows it | Delete |
| C4 | :405 | lead `No increases on these until you clear the flag. This isn't a diagnosis.` | *(none)*, plus `ⓘ` by the title → `Flagged movements don't go up until you clear the flag.` | Why?/ⓘ |
| C5 | :450 (duplicates `domain/pain-flags.ts:35` `PAIN_PROFESSIONAL_TEXT`) | `If pain is sharp, keeps coming back or doesn't settle, see a physio or doctor. The coach can't diagnose.` | `Sharp or lasting pain: see a physio or doctor.` Use the constant, not a copy | Shorten (D2) |
| C6 | :453 | `Stop and get medical help now if you have chest pain, feel faint or have sudden severe pain.` | `Chest pain, faintness or sudden severe pain: stop and get medical help now.` (keep "medical") | Shorten, keep visible (D2) |
| C7 | :462–463 | title `Rest might be the better call today.` + lead `You picked Feeling ill. It's your call. Nothing changes either way.` | title `Rest today?`, no lead; `[Skip workout]` `[Train anyway]` | Shorten + Delete |
| C8 | :533 | lead `Changing it never changes your sets or next-time targets.` | *(none)* | Delete |
| C9 | :279 and `services/workout-services.ts:137` | `Check-in wasn't saved. Your workout started as normal.` / `…can start as normal.` | `Check-in not saved` | Shorten |
| C10 | :336 | toast `No workout started. Your check-in is saved.` | `Check-in saved · no workout` | Shorten |
| C11 | `domain/checkin.ts:182` | `Check-in saved. Coach offline, so today's plan is unchanged.` | `wifi.slash` + `Coach offline` | Word/icon |

Fine: `1 = rough`, `5 = great` (scale anchors), `Note (optional)`, `Where? (optional)`, `Which movements hurt?`, `Pain noted for Bench press`, `Check-in saved · 3 of 5`.

## 5. Active set (priority)

`apps/mobile/src/screens/workout/WorkoutScreen.tsx` unless noted.

| # | File:line | Current | Replacement | Fix |
|---|---|---|---|---|
| A1 | `domain/display.ts:148` (`targetText`) | `Target (built-in rule) 100 kg · 6–8 reps` / `Target (as last time) …` | `Target 100 kg · 6–8 reps`. The source is behind `Why?` (`Set by`), as it already is | Why?/ⓘ (D1) |
| A2 | :1075 | `Warm-up (built-in, not logged): 20 kg × 10 · 40 × 5 …` | `Warm-up · 20 kg × 10 · 40 × 5 …` + `Hide` | Shorten |
| A3 | `domain/session/active-view.ts:442` (`offProfileWarning`) | `102.5 kg isn't on Barbell at Home (max 140 kg). Log it anyway if that's what you lifted, or update the gym.` | ⚠ `Not on Barbell at Home (max 140 kg)`. Log still works, and the line opens the gym | Shorten |
| A4 | `domain/session/snap-text.ts:149–169` (`setSnapNote`) | `Capped: the most here is 30 kg each. Plan was 32.5 kg each.` / `Rounded from 225 lb to 100 kg to match this gym.` / `No load target: this is a different kind of machine. Plan was …` / `… can't make any load as set up.` / `No load target: nothing here can check it in kg.` / `No load target while the pain flag is on.` | `Max here · plan 32.5 kg each` / `Converted from 225 lb` / `No load target · different machine` / `No load target · no loads set up` / `No load target · no kg equipment` / `No load target · pain flag`. The full sentence moves to the `Equipment` row in `Why?` | Shorten + Why? |
| A5 | :1302 | empty workout `Common lifts are at the top. Each one starts with 3 sets; add or remove sets as you go.` | *(none)*: `EMPTY WORKOUT` / `Add your first exercise` | Delete |
| A6 | :230 | banner `Workout restored. Nothing was lost.` | `Workout restored` | Shorten |
| A7 | :498 | `Couldn't save this set. Your entry is still here.` | `Set not saved. Try again.` | Shorten |
| A8 | :584 and `EditSetScreen.tsx:93` | Alert message `It's removed from this workout. The edit log keeps a record.` / `It's removed from this workout's totals and history. The edit log keeps a record.` | Title and buttons only, **and** the `Set 2 deleted` toast gets `Undo`. Today that toast has no Undo, so §1 rule 5 doesn't yet apply. If Undo isn't built in the same change, keep `Kept in the edit log.` (D4) | Delete message (with Undo) |
| A9 | :599 | Alert message `Logged sets are kept.` | Title and buttons only | Delete message |
| A10 | :312, :659, :661 | `Couldn't check that gym. Nothing changed.` | `Couldn't check that gym.` | Shorten |
| A11 | :566 | `Can't undo: set 2 changed. Tap it to edit or delete.` | `Can't undo: set 2 changed` | Shorten |
| A12 | :1840 (`StartTimeSheet`) | `The start can't move after the first logged set or into the future. The end time can be changed after Finish.` | *(none)*. The steppers stop at the bounds (chips disabled) | Delete |
| A13 | :1778 (`RestAfterSheet`) | `A rest that's running now isn't changed.` | *(none)* | Delete |
| A14 | :1191 | `Side: Left side` | `Left side` | Shorten |
| A15 | `workout/target-why.ts:48` | `Couldn't read where this target came from. Your workout isn't affected.` | `Couldn't load.` | Shorten |
| A16 | `domain/session/target-why.ts:225` (inside `Why?`) | `What you did last time is today's target. No progression is applied.` | `Same as last time` | Shorten (already behind Why?) |
| A17 | `domain/session/target-why.ts:310, 312` (inside `Why?`) | `Flag on since 6 Oct (shoulder). Loads, reps and sets can't go up.` / `Flagged after this target was set, so the target wasn't changed.` | `Since 6 Oct (shoulder) · no increases` / `Flagged after this target was set` | Shorten |
| A18 | `TimeLeftSheet.tsx:137` | `Today only. It changes only how the line reads.` | *(none)* | Delete. Review `active-set-r2` B1.3 (`f425a15`) removed a different footnote on this sheet; this one was missed |
| A19 | `domain/session/gym-switch.ts:463` | `2 logged sets stay as they are.` | *(none)*. Rule 2 already guarantees it | Delete |
| A20 | `domain/session/gym-switch.ts:498, 500` | `No sets left to update. Anything you add uses Hotel's equipment.` / `Hotel has everything for your 6 remaining sets. Targets stay as they are.` | `No sets left to update` / `No target changes` | Shorten |
| A21 | `domain/session/gym-switch.ts:472–473` | `Bench set 2 is running. It stays as it is.` / `Left side of Row set 2 stays on Home's equipment, to match its right side.` | `Bench set 2 running · unchanged` / `Row set 2 left · stays on Home (matches right)` | Shorten |
| A22 | `domain/session/gym-switch.ts:505` | `Hotel has no equipment set up yet, so remaining load targets are removed.` | ⚠ `No equipment set up · load targets removed` | Shorten (honesty kept) |
| A23 | `workout/gym-switch-card.ts:55, 82` | `Out of date. Your workout changed since this was checked.` / `Couldn't switch gym. Nothing changed.` | `Out of date` / `Couldn't switch gym.` | Shorten |
| A24 | `workout/picker-empty.ts:12` | `No exercise matches "x". Try a shorter word, like "press" or "row".` | `No match for "x"` | Shorten |
| A25 | `domain/pain-flags.ts:197` (`mayHurtConfirm`) | `You flagged shoulder pain on it on 6 Oct. Loads won't go up while the flag is on.` | `Shoulder pain flagged 6 Oct.` | Shorten |
| A26 | `domain/session/snap-text.ts:49–80` (`cardNoteText`, change lines on the gym-switch card, always visible) | `Rounded down to the nearest load here.` / `Capped: the most here is 30 kg each.` / `{Loads here are in kg.} Rounded down.` / `Back to the planned load.` / `No Barbell here. Enter your own load, or skip it after switching.` / `This is a different kind of machine, so … isn't converted.` / `The lightest here is …, heavier than planned.` / `… can't make any load as set up.` / `Plan says …. Nothing here can check it in kg.` | `Rounded` / `Max here 30 kg each` / `Converted · rounded` / `Back to plan` / ⚠ `No barbell here` / ⚠ `No load target · different machine` / ⚠ `Lightest here is heavier` / ⚠ `No load target · no loads set up` / ⚠ `No load target · no kg equipment`. `Pain flag on Bench: no increases.` stays as `Pain flag · no increases` | Shorten |

Borderline, keep: `More assistance is easier` (:1100, under an assisted load field; the direction is inverted, so a wrong entry is easy), `Pain flag: no increases · check due` (`pain-flags.ts:160`, the shortest honest form), `From: Standard (default)` (:1776, a fact), `Unsaved edit restored`, `Copied from 1 Oct`, `All values are targets.` (`GymSwitch.tsx:259` and `RepeatScreen.tsx:153`, the target-vs-actual rule).

## 6. Rest (priority)

| # | File:line | Current | Replacement | Fix |
|---|---|---|---|---|
| R1 | `WorkoutScreen.tsx:963` | up-next `Then add a set or your next exercise` | `Next · add exercise` | Shorten |
| R2 | `alerts/rest-alerts.ts:29` (notification body) | `Ready when you are.` | `Next set` | Shorten |
| R3 | `alerts/AlertsAskSheet.tsx:74` | `Get an alert when rest ends while your phone is locked?` | `Alert when rest ends?` | Shorten |

Fine: `REST`, `REST · PAUSED`, `READY`, `Next · Set 3 · 100 kg × 6–8`, `−30 s` / `+30 s` / `Skip`, `Rest over · rested 3:02`, `Rest ended at 14:05`, `Bench press: still hurting?` / `Still hurts` / `Better…`.

## 7. Summary and Finish (priority)

`apps/mobile/src/screens/workout/SummaryScreen.tsx` unless noted.

| # | File:line | Current | Replacement | Fix |
|---|---|---|---|---|
| S1 | `domain/session/summary.ts:29` | tag `Built-in rule (coach not connected)` | tag `Rule`. Coach status per S3 | Word (D1) |
| S2 | `domain/progression.ts:574, 487` (row summary under each `Next time` target) | `Add a rep: aim for 9 at 100 kg, because {reason}.` / `Progression for Bench is paused because pain was reported on 6 Oct. Targets are not increased.` | `+1 rep` / `Held · pain flag`. Reasons go behind the row's `Why?` | Shorten + Why? |
| S3 | :421 | `Coach not connected. Your workout is saved; a note can be added later.` | `Coach not connected` (one line under `Coach note`) | Shorten |
| S4 | :271–272 | `You mentioned pain before this workout. Flag the movements that hurt so their loads don't go up.` + `Until you do, no exercise in this workout is increased next time.` | ⚠ `Pain mentioned · which movements?` + `[Choose movements]`. Each held `Next time` row already says `Held · pain flag` (S2) | Shorten + Delete |
| S5 | :675 | `Flagged movements won't go up until you clear the flag in Profile › Pain flags.` | *(none)* | Delete |
| S6 | :635 | `Active time counts from start to end, minus pauses inside that window. The original times are kept in the edit history.` | *(none)*, `ⓘ` optional | Delete |
| S7 | :190 | `Last backup on this phone didn't save. Open Data & backup ›` | ⚠ `Backup didn't save ›` | Shorten |
| S8 | :318, `workout/pain-actions.ts:47, 79` | `The pain flag changed since, so it wasn't put back. Check Profile › Pain flags.` / `…so the answer wasn't undone.` | `Couldn't undo: flag changed` | Shorten |
| S9 | `domain/session/summary.ts:296, 298, 299` | `Last Bench was with different equipment or units. Not compared.` / `Earlier Bench sets were imported from FitNotes. Not compared.` / `First time logging Bench with Barbell at Home. Nothing to compare yet.` | `Not compared · different equipment` / `Not compared · imported` / `First time` | Shorten |
| S10 | `domain/session/summary.ts:376` | `No target changes. Same targets next time.` | `Same targets next time` | Shorten |
| S11 | `domain/pain-flags.ts:212` (`painClearConfirm`) | `Loads, reps and sets can go up again, starting from your recent sets. Your sets from before 6 Oct stay in your history as the reference.` | Title `Clear the pain flag on Bench?` and buttons only (Undo follows) | Delete message |
| S12 | `domain/session/first-run.ts:79` | `Starting plan: 3 sets of 8–12 reps. You choose the load.` | `3 × 8–12 · load: your choice` | Shorten |
| S13 | `domain/default-rule.ts:73` (`Rule:` behind `Why?`) | `Double progression, 3–6 reps up to RPE 8.5 (built-in default for a main barbell lift, provisional)` | `3–6 reps, up to RPE 8.5` | Shorten (already behind Why?) |
| S14 | `backup/status.ts:95, 102, 105, 107` | `… Your workouts are still saved on this phone.` / `… GymSmarter won't change or guess damaged records.` / `A backup on this phone runs next.` / `The first backup runs after your first workout.` | drop each tail; `N damaged records` stays | Delete |
| F1 | `FinishSheet.tsx:140` | `Only times between the last logged set and now.` | *(none)*. The steppers stop at the bounds | Delete |
| F2 | `FinishSheet.tsx:85` | `Couldn't finish the workout. Nothing was lost; try again.` | `Couldn't finish. Try again.` | Shorten |
| F3 | `FinishSheet.tsx:123` | `19:42 (last set + 3 min)` | `19:42 (estimated)` | Shorten (an estimate stays labelled) |

Fine: `Workout saved on this phone` (built on `Saved on this phone`, one of the three durability phrases in `docs/design/README.md`), `Pain flag: Bench · no increases` + `Clear`, `How you said you felt: 3 of 5`, `(end time edited)`, `date only`, `3 not done will be marked skipped.` (the consequence of Finish).

## 8. FitNotes import (priority)

`apps/mobile/src/import/views.ts` unless noted.

| # | File:line | Current | Replacement | Fix |
|---|---|---|---|---|
| I1 | :104–107 (`INTRO_COPY`) | `Bring in your FitNotes history from a CSV export.` / `1 In FitNotes, export a CSV and save it to Files.` / `2 Choose it here. You'll see what will be imported before anything is saved.` / `Works with FitNotes (Android) and FitNotes 2 (iPhone) CSV files.` | One line: `Export a CSV from FitNotes to Files, then choose it.` The rest goes behind `ⓘ` (`FitNotes or FitNotes 2`) | Delete + Shorten |
| I2 | `ImportIntroScreen.tsx:86` | detail `Importing adds history your workout is using.` | *(none)* | Delete |
| I3 | :122 | `…; Continue import finishes it.` | drop the tail (the button says it) | Delete |
| I4 | :131 | `N workouts imported from FitNotes aren't listed: imported workouts can't be repeated yet. They're in Data & backup, under Past imports.` | `N imported workouts not listed ›` (opens Past imports) | Shorten |
| I5 | :140 | `… Each workout saves whole or not at all; Try again checks and carries on.` | drop the last sentence | Delete |
| I6 | :168, :343 | `… Nothing was guessed.` | drop `Nothing was guessed.` | Delete |
| I7 | :350 | detail `GymSmarter's version always wins, including sets you corrected since.` | *(none)* | Delete |
| I8 | :357 | `FitNotes files have no times. These workouts show the date only.` | `Date only (no times)` | Shorten |
| I9 | :364 | `Warm-ups aren't marked in FitNotes files, so every set comes in as a working set.` | `All sets as working sets` | Shorten |
| I10 | :361 | `Machines: imported as stack readings, plates added or assistance, by exercise` | `Machines: by exercise` (the detail list stays) | Shorten |
| I11 | :390 | `You imported this file on 6 Oct. Workouts from it that are still in GymSmarter are skipped; dates that aren't in GymSmarter now are offered again, with your answers from then filled in.` | `Imported before on 6 Oct · new dates only` | Shorten |
| I12 | :653, :668 | leads `FitNotes doesn't record whether a dumbbell weight is one dumbbell or both together.` / `GymSmarter doesn't know whether … one dumbbell or two. Choose for each.` | *(none)* / `Choose for each` | Delete + Shorten |
| I13 | :864, :871 | leads `FitNotes doesn't record whether a barbell weight includes the bar. Weights are imported as written unless you choose "Plates only"…` / `Choose "Plates only" for any exercise whose weights don't include the bar. Check the bar: its weight is added.` | *(none)* / option detail `Bar weight is added` | Delete + Shorten |
| I14 | :857 | `Enter your {bar}'s weight in kg. Plates-only sets on it can't be imported without it.` | `{Bar} weight needed (kg)` | Shorten |
| I15 | `ImportQuestionScreen.tsx:229` | `Imported sets aren't linked to a particular machine or bar. For now they're kept and listed under Data & backup → Past imports, but aren't used as "Last" values or targets, and imported workouts can't be repeated.` | *(none)*, `ⓘ` optional | Delete |
| I16 | `ImportQuestionScreen.tsx:179` | `The other column is kept with each row as the original.` | *(none)* | Delete |
| I17 | `ImportQuestionScreen.tsx:191, 216, 224` | subtitles `Only the rows you tick get an RPE. The comment is kept either way.` / `Same as FitNotes 2 does` / `Don't assume a gym` | `Ticked rows only` / *(none)* / *(none)* | Shorten + Delete |
| I18 | `ImportChooseScreen.tsx:48` | `The equipment decides how its weights are read (for example plates added on a plate-loaded machine).` | *(none)* | Delete |
| I19 | `ImportRunScreen.tsx:140, 143` | `Importing adds N workouts to your history. GymSmarter backs up on this phone first, and you can undo the import afterwards.` / `Importing adds N workouts. Save a copy to Files first?` | `Adds N workouts.` / `Save a copy to Files first?` | Shorten |
| I20 | `ImportRunScreen.tsx:187, 200` | `Backing up on this phone before import…` / `Keep GymSmarter open. If it closes, you can carry on from here.` | `Backing up…` / `Keep GymSmarter open.` | Shorten |
| I21 | `ImportRunScreen.tsx:80` | `This import was paused by an earlier version of GymSmarter that added a bar weight to every barbell exercise from one answer. It won't be continued. N workouts are in; undo it in Past imports, then import the file again.` | `This import can't continue (older version). N workouts are in. Undo it, then import again.` | Shorten |
| I22 | `ImportRunScreen.tsx:86, 122` | `Something changed since the preview (an answer, a workout or another import). Check the preview again before importing.` / `… Anything already in is complete; continue from Past imports.` | `Check the preview again.` / `N workouts are in. Continue from Past imports.` | Shorten |
| I23 | `ImportResultsScreen.tsx:178` | `Undo is available after you finish or discard your workout (Push A).` | *(none)*, and show the existing `Finish or discard your workout first (Push A).` line (:122) whenever a workout blocks the import, not only when `canContinue`. Today :122 is hidden when only Undo is blocked, so deleting :178 alone would leave a disabled button with no reason | Delete + move |
| I24 | `ImportPreviewScreen.tsx:43` | Alert message `Nothing has been saved.` | Title and buttons only | Delete |

Fine: the question titles (`Weight unit: kg or lb?`, `Dumbbell weights: each or both?`), `Imported as 22.5 kg each`, `Example from your file (…)`, the row-level `Original: …` provenance (rule: keep original values), `Finish or discard your workout first (Push A, started 14:05).`, file-type errors (`This is a FitNotes backup, not a CSV…`; it tells Ben what to do).

## 9. Other screens (lower priority)

| # | File:line | Current | Replacement | Fix |
|---|---|---|---|---|
| O1 | `setup/SetupScreen.tsx:133, 143, 173, 179, 199`, `setup/GymSetupFlow.tsx:182` | `Coach, goals and history import are optional and can come later.` / `You can change these any time in Profile.` / `Picked from your phone's region. Each piece of equipment keeps its own unit…` / `Starting points, not advice.` / `You can edit it later in the gym editor.` / `Barbell, dumbbells, cables and machines with typical weights, marked "not checked". Edit it any time in Profile.` | *(none)* each, except the last: `Typical weights · not checked` (an honesty item) | Delete / Shorten |
| O2 | `setup/SetupScreen.tsx:270`, `data/DataBackupScreen.tsx:112, 154`, `data/RestoreScreen.tsx:345` | `Copies on the phone are lost if the app is deleted or re-signed with a different Apple ID. You can save a copy to Files any time.` and variants | Setup :270 and DataBackup :112: `Lost if the app is deleted or signed with another Apple ID. Save a copy to Files.` DataBackup :154 repeats :112 on the same screen: delete. Restore :345: keep only the pointer to Files copies (`Copies in Files: Choose a file`) | Shorten / Delete (D3) |
| O3 | `setup/GymSetupFlow.tsx:114` | `Nothing ticked. Logging still works, but loads won't be checked.` | `Nothing ticked · loads not checked` | Shorten |
| O4 | `gym/GymDetailScreen.tsx:66` | `No equipment yet. Add what this gym has so targets match it.` | `No equipment yet` | Shorten |
| O5 | `gym/EquipmentEditorScreen.tsx:184, 236, 244` | `Logged as plates added. The machine's own resistance isn't counted or estimated.` / `Numbers are as printed on the stack. They're never converted to free-weight equivalents.` / `Logged as bodyweight (BW). Adding weight with a belt isn't supported yet.` | `Logged as plates added` / `As printed on the stack` / `Logged as bodyweight` (the load convention stays explicit) | Shorten |
| O6 | `services/gym-services.ts:108` (also `gym/EquipmentEditorScreen.tsx:149, 158`), `services/app-services.ts:200` | `This item has sets logged in kg. To use lb, add it as new equipment so history stays comparable.` / `A gym is already saved. You can edit it later in the gym editor.` | `Has kg sets. Add new equipment for lb.` / `A gym is already saved.` | Shorten |
| O7 | `data/SaveCopyToFiles.tsx:51` | `Backups are plain files with your training data and coaching knowledge. They never contain your coach sign-in or API keys.` | behind `ⓘ` | Why?/ⓘ |
| O8 | `data/RestoreScreen.tsx:197, 320, 326`, `data/DataBackupScreen.tsx:183`, `data/BlockingCover.tsx:32` | `Done reopens GymSmarter's data. Your previous data is kept until the next restore.` / `Checking rebuilds the backup in a test copy… Nothing on this phone changes.` / `…The first one is made after your first workout.` / `Rebuilds it in a test copy. Changes nothing.` / `…If it closes now, your current data stays as it is.` | *(none)* / `ⓘ` / `No backups on this phone yet` / *(none)* / `Keep GymSmarter open.` | Delete / Shorten |
| O9 | `ProgressScreen.tsx:33, 57` | `No finished workouts yet. They'll show here, newest first.` / `Trends and records come in a later build.` | `No finished workouts yet` / *(none)* | Shorten + Delete |
| O10 | `repeat/RepeatScreen.tsx:150` | `Targets are what you did on 6 Oct. Nothing is marked done. Progression isn't applied.` | `Targets: as on 6 Oct` | Shorten |
| O11 | `repeat/PastWorkoutsScreen.tsx:41` | `Your other workouts are fine. Check all data in Data & backup for details.` | `Check data ›` | Shorten |
| O12 | `profile/AppStatusScreen.tsx:91, 135` | `. GymSmarter won't change or guess damaged records.` / `Errors the app catches are recorded here. If the app closed and nothing is here, it was a native or animation-thread crash: try …` | drop the first; the second goes behind `ⓘ` | Delete / Why?/ⓘ |
| O13 | `workout/PainFlagSheet.tsx:69`, `domain/pain-flags.ts:34` | detail `Nothing was changed.` / effect `No increases in load, reps or sets.` | *(none)* / `No increases` | Delete / Shorten |
| O14 | `shell/Root.tsx:109, 116, 123`, `backup/restore-view.ts:144–157`, `screens/data/RestoreScreen.tsx:86, 109`, `backup/backup-service.ts:122` | startup and restore failures ending `Nothing has been changed.` / `Nothing was changed.`; Root :123 adds `Your backups on this phone and in Files are untouched; restoring one needs the data to open first, so try again or contact the developer.` | Keep the cause and the action; replace each tail with `Data unchanged` (§1 rule 1 exception). Root :123 becomes `Data unchanged · backups untouched` + `[Try again]` | Shorten |
| O15 | `services/app-services.ts:78`, `services/workout-services.ts:1382`, `screens/workout/WorkoutScreen.tsx:429` | `Couldn't save this. Nothing was changed; try again.` / `Couldn't undo. Nothing changed.` / `Couldn't open this workout.` + `Nothing was changed. {error}` | `Couldn't save. Try again.` / `Couldn't undo.` / title + `{error}` behind `ⓘ` | Shorten |

Fine: signing lines (`Refresh weekly in SideStore.`, actionable), `Not checked` tags, `Typical values, not checked` (`GymDetailScreen.tsx:75`) and `Hotel's dumbbells are typical values, not checked.` on the gym switch card (`gym-switch.ts:510`), both honesty items, `Weights are per dumbbell.` (load convention).

## 10. Worktrees still being built

These strings were read from the working trees, not from a diff, at `claude/coach` `598be58` and `claude/workout-overview` `3aaa481`. Both branches are still moving, so find each string by its text, not its line. Fix them before each branch is merged, so the base branch doesn't regress.

**`claude/coach` (`/home/user/wt-coach`)**

| # | File:line | Current | Replacement | Fix |
|---|---|---|---|---|
| W1 | `apps/mobile/src/coach/sheet-view.ts:43, 45, 47, 56` (`why`) | `The coach needs the internet. Your workout is saved on this phone.` / `Logging, targets and rest timers work without the coach.` / `ChatGPT usage limit reached. Logging and built-in targets still work.` / `This ChatGPT account can't run the coach here. Details are in Profile → Coach connection.` | Main UI shows only `word` + icon (`Offline`, `Not connected`, `Paused`, `Unavailable`) + action. `why`, if kept, goes behind `Why?` and drops the reassurance halves | Word/icon |
| W2 | `apps/mobile/src/coach/sheet-view.ts:186`, `packages/coach/src/turn.ts:326, 575` | `… Anything applied is shown above.` / `Stopped. Anything applied is shown above.` / `Interrupted. Anything applied is shown above.` | drop the tail; the cards show it (`Stopped`, `Interrupted`) | Delete |
| W3 | `apps/mobile/src/coach/slot-view.ts:73, 54` | `Sets unchanged.` / `Your workout moved on. Nothing changed.` | *(none)* (caption `Not connected` is enough) / `Out of date` | Delete / Shorten |
| W4 | `apps/mobile/src/ai/coach-connection-view.ts:57, 111` | `Logging, targets, rest timers and built-in progression work without the coach.` / `The coach is paused. Logging and built-in targets still work.` | *(none)* / `Coach paused` | Delete / Shorten |
| W5 | `apps/mobile/src/ai/coach-connection-view.ts:180, 223, 225, 235, 240, 248` | `Nothing is used from your plan yet.` / `… Nothing was connected.` / `Nothing was stored.` / `… Nothing was changed.` | drop each reassurance tail | Delete |
| W6 | `apps/mobile/src/screens/profile/CoachConnectionScreen.tsx:155` | `The coach stops until you connect again. Your workouts stay.` | Title `Disconnect ChatGPT?` and buttons only | Delete message |
| W7 | `apps/mobile/src/screens/workout/WorkoutCoach.tsx:86`, `apps/mobile/src/coach/sheet-view.ts:208` | `Couldn't reach the coach. Nothing changed.` | `Couldn't reach the coach.` | Shorten |
| W8 | `packages/coach/src/render.ts:318` | `Couldn't set next targets. The built-in rule's are used.` | `Couldn't set next targets · using Rule` | Shorten (honest fallback, D1) |

Keep in the coach worktree: `Nothing changed.` after a failed **action** in `render.ts:310, 331, 339` (the coach may already have applied part of a change, so saying none was applied is an outcome, not reassurance), and `The coach's replies now count toward your ChatGPT plan…` (`coach-connection-view.ts:197`, rule 7 cost honesty). `Built-in rule would be …` (`next-time-view.ts:53`) is fine because it is behind `Why?`.

**`claude/workout-overview` (`/home/user/wt-overview`)**

No string breaks the convention. `OVERVIEW_COPY` (`apps/mobile/src/workout/overview.ts:109–132`) is all labels and actions. The `Rounded` / `Gym` / `Flag` facts (`packages/domain/src/session/overview.ts:660–675`) sit in the row panel that opens on tap, which counts as an info tap. Estimates carry `≈`. One borderline item: `Delete {routine}?` / `Past workouts keep their name.` (`WorkoutOverviewScreen.tsx:274`) should drop the message, the same as T9.

## 11. Developer notes

- Most strings live in one place each. The domain ones (`display.ts`, `snap-text.ts`, `summary.ts`, `pain-flags.ts`, `progression.ts`, `gym-switch.ts`) feed several screens, so fix them there and not in the screens.
- `CheckInScreen.tsx:450` copies `PAIN_PROFESSIONAL_TEXT` by hand. Import the constant.
- Unit tests assert many of these strings (search `*.test.ts` for the old text). Update the expected strings in the same commit.
- Removing a lead never removes a control. Any step that loses its explanation keeps its title, its buttons and (where noted) a `ⓘ` or `Why?`.
- After Ben approves, the designer updates the Copy sections of `today.md`, `check-in.md`, `active-workout.md`, `rest-state.md`, `workout-summary.md`, `gym-switch.md`, `system-states.md` and `data-import-export.md` to match. `data-import-export.md` §3.3 currently requires every backup error to say nothing changed (quoted in `restore-view.ts:141`); O14 replaces that with `Data unchanged`. Until the specs are updated, this file wins where they disagree.
- Snap and fit wording lives in three places that drifted apart: `snap-text.ts` (T11, A4, A26), `target-provenance.ts` (T13) and `routines.ts` (T14). One shared short-form helper would keep them consistent.

## 12. Acceptance checks

1. No main-UI string (excluding a11y labels and hints, Developer, Capability probe, and text shown only after a `Why?` or `ⓘ` tap such as `RoutineSheet.tsx:120` and the S13 rule line) contains `built-in rule`, `snapped`, `unless you say so`, `never changes`, `Nothing was lost`, `Nothing changes`, `Nothing was changed`, `Nothing has been changed`, `isn't a diagnosis` or `can't diagnose`. Grep `apps/mobile/src` and `packages/domain/src` with `[’']` in place of each apostrophe, excluding tests and comments.
2. On a real iPhone at default text size, these show no line of `text.secondary` lead text above their first control: the check-in score sheet, `What's up?`, the pain step, the feeling-ill step, `Change check-in`, the empty workout and the first-workout hero.
3. The set card target line reads `Target 100 kg · 6–8 reps` for built-in, routine and repeat targets alike. `Why?` → `Set by` still names the source (D1).
4. Summary `Next time` shows a `Rule` tag (or whatever Ben chooses in D1) and no sentence beginning `Built-in rule`.
5. Every delete or skip confirmation alert has a title and buttons, and no message line, except where no Undo follows: discarding a workout with logged sets (`N logged sets will be discarded. This can't be undone.`) and, until it gets an Undo, deleting a set (A8).
6. Offline, coach not connected, estimate, not checked and damaged-records states are each still visible as a word or icon, and data-at-risk failures still say `Data unchanged`. Nothing honest was removed.
7. The red-flag pain line (C6) is still visible on the pain step without a tap.
