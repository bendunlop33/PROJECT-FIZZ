# Review: week flex around runs (claude/weekflex-20oct, 20 Oct)

**Verdict: CHANGES NEEDED**

Diff reviewed: `7f08a8c..0dae5c5` (7 commits). Spec: Ben's 20 Oct request as relayed in the task (activities, the leg rule in Up next, this-week proposals), CLAUDE.md rules 1–10, minimal copy.

## Checks run (by the reviewer)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| Targeted vitest (7 files, `--maxWorkers=2`) | 91/91 pass |
| Full suite (`--maxWorkers=2`) | 7387 pass, 1 fail, 1 todo |
| The one failure (`morning-reminder.test.ts`, "`Today: Pull` · Day 2 of 4…") | Also fails at the merge base `7f08a8c` in a throwaway checkout, so this branch didn't cause it. Ignored as instructed. |
| Probe of `activityWords` / `activityFieldsFrom` with mixed messages | Confirms B1 (see below) |

What's right: activities are versioned and idempotent, with tombstone Undo. The coach's Undo of a logged activity only applies while the activity hasn't changed. Activities and week plans are in `YOUR_DATA_TABLES` (backup, restore and delete) and in integrity checks. Migration 26 keeps 25's kinds. The leg filter compares local dates in Ben's zone and falls back to the first day with the Why? text. The weekly aim never counts runs (the test checks `consistency` and `Days this week`). The week override expires by `weekMonday` with no write, and the test crosses the DST change. Apply is stale when the factsKey or week changes, and a double tap is a duplicate. `propose_week` is always `proposed`, and only Ben's Apply writes. The facts for the week are only what Ben logged; there are no fatigue or readiness numbers. Copy is minimal.

## Blocking

### B1. The coach's `log_activity` reads the whole message for each call, so it misattributes or invents effort, distance, date and kind, and saves the result at once.
`packages/coach/src/activity-tools.ts:39-97` (`activityWords` and `activityFieldsFrom`: "Ben's words win"), and `:150-153`, where `asked` means it's logged without an offer.

`activityWords` parses the whole message once: the first kind, the first distance, the first time, the highest-priority effort word and the first day. `activityFieldsFrom` then puts those values over the model's arguments for every `log_activity` call in the turn. Reviewer probe, with today = Thu 22 Oct:

- "Had an easy 5k yesterday, long run Saturday". Both calls become `{run, done, 2026-10-21, 5000 m, effort: long}`. The easy 5 km is saved as a **long** run, which is an invented effort (rule 6). That wrongly keeps legs off Up next today ("Long run yesterday"). The Saturday planned run is then rejected as "already logged" (same date, kind and status), so the run Ben actually asked about is lost. Both happen without a tap, because `asksToLogActivity` is true.
- "Last session was hard, also did a 10k run" saves a **hard** 10 km run. "hard" was about the gym session, and it moves leg days.
- "I swam yesterday and have a long run Saturday" turns the swim into a run, because the run regex is checked first.
- "Legs feel heavy today": the model offered a run dated 21 Oct, and the unrelated "today" changes the offer to 22 Oct. The test at `apps/mobile/test/week-flex.test.ts:233-238` doesn't check the date, so it misses this.

Fix: parse per clause. Split on clause boundaries and only take values from the clause that names this activity, matching on the kind or date the model passed. Use Ben's words to **check** the model's values, not to override them. When they disagree, or the message names more than one activity, save it as an offer (`proposed`) instead of committing it. Never take `effort` from a clause that doesn't contain the activity noun. Add tests for each case above.

### B2. Editing or deleting an activity from Progress › Calendar has no Undo.
`apps/mobile/src/screens/progress/CalendarView.tsx:183-188`. `onSaved` closes the sheet and reloads, and ignores the `ActivitySaved` event. The sheet's Delete (`ActivitySheet.tsx:145`) has no confirmation either. So one tap on Delete in the calendar removes the activity with no way back in the UI. The spec says "edit/delete versioned with Undo". The Undo exists in the domain and service (`activities.undo`) but is only connected to Today's toast. Fix: show the same toast with Undo as `TodayScreen.activitySaved`, for example by lifting it into a shared hook, and add an app test for calendar delete followed by Undo.

## Should fix

### S1. The coach can offer to reshape the week on every general turn.
`apps/mobile/src/coach/coach-service.ts` (`weekOpen: weekView.needsReshape`) and `packages/coach/src/registry.ts:592`. `needsReshape` stays true until a change is applied, so `propose_week` is opened for the model on every general turn that week, whatever the topic. That holds even after Ben ignored or declined an earlier proposal, or while one is still open. Rule 3 says the coach "never adjusts constantly or unprompted", and offers only when something changed. Fix: open on `weekOpen` only when there is no open (`proposed`, not stale) `propose_week` this week and none was offered since the last change to the week's facts. Compare the factsKey with the last offer's. Add a test with two turns where the second doesn't reopen the tool.

### S2. A merged day can put a leg day with an upper day, and the name is free text from the model.
`packages/domain/src/session/week-plan.ts:176-201`. `checkWeekProposal` accepts any two remaining days. Only the tool description says "never merge a leg day with an upper day". The model can propose Legs + Chest and name it "Push". Deterministic code is meant to be the guardrail (rule 3). Fix: reject merges where `mergedName(a, b) === null`, which covers leg days and parts outside the families. Either use code's name or reject a name that contradicts the families. Add tests.

### S3. A merged day can lose one of its two days without anyone knowing.
`apps/mobile/src/services/week-services.ts:418-423` and `:266-293`. When `dayExercises` returns `[]` for one day, for example a split day with no workout of that name and none in the window, the merged "Push" is built from the other day only. Apply still succeeds; it's refused only when both are empty. That week, Shoulders silently disappears. Fix: return `invalid` (no write) when either day has no exercises, or make the card show what is actually merged.

### S4. Trimming to session length uses its own time estimate, not the one Today shows.
`week-plan.ts:225-284`, which assumes 40 s of work and 120 s of rest per set. Up next's "about N min" comes from `estimateRemainingDuration` with Ben's recent pace (`workout-services.ts:1471`). A merged day trimmed to "fit 60 min" can show as "about 75 min" on Today. If the floors stop the trim (main lifts keep 2 sets, others 1), it goes over with nothing said. Fix: trim with the same estimator Up next uses, or the domain one it wraps, and test the merged day's `aboutMinutes` against `sessionMinutes` in the app flow.

### S5. Telling the coach a planned run is done creates a duplicate.
`activity-tools.ts:123-125`. Ben logs "long run Saturday" as planned. On Sunday he tells the coach "did my 21 km long run yesterday". The status differs, so the same-day check passes and a second, done, activity is added. Saturday then shows a planned and a done run in Recent, the calendar and Your plan ("Run · Sat · long" twice). The coach can't mark the planned one done. Fix: when a planned activity of the same kind exists on that date, the coach edits it to done (versioned, with Undo) instead of adding one. Test it.

### S6. Ben's routine rotation skips the leg rule.
`apps/mobile/src/services/workout-services.ts:1952-1955`. When `training?.split === undefined`, the rotation is checked before `splitUpNext`, with no `avoidLegDays`. The fallbacks after `splitUpNext` (the "days just done" path) also ignore `near`. Ben with no explicit split but a rotation of routines gets Legs the day before a long run. Fix: apply the run filter (classify routines through `planDayBodyParts`) in the rotation path too, or document it as out of scope in the CHANGELOG's PM decisions. Test it either way.

### S7. "Gym days left" doesn't follow the spec, and the CHANGELOG lists this as approved by Ben.
`week-plan.ts:76-79`. The spec says the gym days left are "aim − done, minus days blocked by planned long runs". The code uses `min(aim − done, open dates)`, so a planned long run only matters once the calendar runs short. Example: Thu 22 Oct, aim 4, Back done, Chest, Shoulders and Legs left, long run Sat. The spec gives 4 − 1 − 1 = 2 against 3 days, so it offers. The code gives min(3, 3) = 3, so it doesn't offer until Friday. That may be a sensible reading, but it's a silent change. `docs/brief/CHANGELOG.md` records it under "Ben approved 20 Oct". Fix: implement the spec's formula, or move this line to "PM decisions, pending Ben" with the example. See the spec issues below.

## Nits

- N1. `apps/mobile/src/activity/activity-form.ts:254`: any schema failure shows "Add a time, a distance or an effort.", including more than 1,440 minutes (the keypad allows 9999) and less than 10 m. Use "Check the time." or "Check the distance." instead.
- N2. `ActivitySheet.tsx:30-31` and `week-services.ts:308`: the sheet's `today` and the activity's `tz` come from the device zone (`services.now().tz`). The leg rule and week facts use `profile.timezone`. When they differ, for example when travelling, "today" and "Done/Planned" can disagree with Up next.
- N3. `week-services.ts:262`: `factsKey` leaves out the weekly aim and the split's days. If Ben changes `daysPerWeek` or his split after a proposal, Apply still goes through.
- N4. When Ben says "long run Saturday, plan my week around it", the result depends on the order of the tool calls. If the model calls `propose_week` before `log_activity`, the proposal is stale straight away because the activity changes the factsKey. Run `log_activity` executors first within a turn, or recompute the factsKey after the turn's writes.
- N5. `workout-services.ts` `planDue`: a pinned (`Make next`) leg day stays first the day before a long run. That's defensible as Ben's explicit choice, and the Why? shows, but the CHANGELOG doesn't mention it.
- N6. `TodayScreen.tsx`: `whyOpen` stays open when Up next changes to another day. Reset it when `next.title` changes.
- N7. `registry.ts:592`: any structural request also opens `propose_week`, for example "swap squats in my plan". That's harmless because it's a proposal, but it's noise for the model.
- N8. Without a plan (split basis), the only Undo for an applied week change is on the coach card in the thread. Your plan isn't shown, and Today gives no sign that the week was changed.

## Tests: gaps

- Mixed-message `activityWords` cases (B1), and a date assertion on the offered activity in `week-flex.test.ts:233-238`.
- Calendar delete followed by Undo (B2).
- Not reopening `propose_week` on a second turn (S1). Rejecting a leg + upper merge (S2). A merge with one empty day (S3). Merged-day minutes against `sessionMinutes` in the app flow (S4). A planned run then "did it" through the coach (S5). The leg rule on the rotation path (S6).

## Spec issues (for Ben / PM, not the code)

1. **Planned runs past their date** (PM decision in the CHANGELOG). Unless Ben marks the run done, the "day after a long run" rule never fires for a run he planned. That's probably the usual case. Options: treat yesterday's planned long or hard run as the trigger (Why? "Long run yesterday"), or show a one-tap "Done?" on Today the day after. Ben to decide.
2. **"Gym days left" formula** (S7). The spec says aim − done − blocked days; the build uses min(aim − done, open dates). Ben should pick one. Either way, the CHANGELOG should not file the developer's reading under "Ben approved".
3. **Legs on the run day itself.** The spec only covers the day before and the day after. Up next on the day of a planned long run can be Legs. Decide whether the run day should block legs too.
4. **"Keep it next week"** isn't built; the plan proposal is the way to keep a change. That's a reasonable deferral, but Ben's request mentioned it. Confirm with him.
5. **Migration 26** may collide with parallel branches (quickgym, lift-targets, prog-measure, mergegate). Its `coach_actions` rebuild has to come last and include every kind added by the other branches. Check this at merge time.
