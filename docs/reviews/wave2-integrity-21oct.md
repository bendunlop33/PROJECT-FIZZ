# Review: Wave 2 merge integrity (claude/b3-merge-20oct, f92668c..c50e079)

**Verdict: CHANGES NEEDED** (2 blocking)

Reviewer lens: the three streams (builder, Today v2, builder coach) share one draft model. That covers origin, version, per-slot `rev`, refusing stale proposals and idempotent op IDs. Loads must be snapped, with gym and pain re-checks at Start, and must keep their load source. Also checked: plan-day provenance, review records, CLAUDE.md rules 1–10, and surviving a force-close. Nothing here has run on an iPhone.

## Checks run by the reviewer

- `npm run typecheck`: exit 0.
- `NODE_OPTIONS=--max-old-space-size=6144 npm run lint`: exit 0.
- `npm run check:migrations`: "Migrations OK: 1 to 30, none reserved or empty."
- Targeted vitest runs (`--maxWorkers=2`):
  - `apps/mobile` (today-session, today-v2-screen, builder-coach-merge, builder-screens, builder-coach, builder-review-fixes, workout-builder): 7 files, 189 passed.
  - `packages/domain` (coach-draft, coach-draft-loads, builder-v3-life, today-v2): 4 files, 79 passed.
  - `packages/coach` (all): 37 files, 2175 passed.
- I did not re-run the full suite. The integrator reports 430 files, 8142 passed.
- Temporary probe tests were written and then deleted; the tree is clean. What they showed:
  - **P1 (holds, rule 4):** Today commits Push, then the same gym's bar plates are cut to 2 × 10 kg. At Start, bench's committed 100 kg is planned at 40 kg. A builder draft's pinned loads still go through the gym snap, even though `sameGym` only compares gym IDs and not the equipment version.
  - **P2 (holds):**
    - `applyCoachWorkout` on a Today draft keeps `origin: 'builder'` and `checkedHistoryVersion`, and bumps `rev` only on the slot it changed (2, 1, 1).
    - A retry with the same op ID writes once.
    - A Today Start with the earlier version is refused.
    - A later Today commit returns the edited draft unchanged.
  - **P2 (problem):** after `builder.undo` of that apply, the card still reads `Push · edited` and the revs go back to 1 (see B2 and N1).
  - **P3 (holds):** with a pain flag and no new history, bench at Start is never above the last top set.
  - **P4 (problem, see B1):** in the coach load guard, a load Ben asked to make heavier that is accepted at ask time can never be applied.

## Blocking

**B1. Apply drops "Ben asked heavier", so those proposals always read `Out of date. Ask again.`**
`apps/mobile/src/coach/builder-coach-service.ts:401` (apply), `:295` (askEdit), `packages/coach/src/builder/proposal.ts:66`

- **Cause:**
  - `askEdit` builds the proposal with `askedHeavier` parsed from Ben's words.
  - `apply` re-checks it with `{ ...world.env, askedHeavier: false }`.
  - The guard allows `stepsHarderAsked` (2 steps) only when Ben asked, otherwise `stepsHarder` (1 step) (`packages/domain/src/session/builder-loads.ts:572`).
  - The re-check therefore produces different lines from the ones Ben saw, and `recheckBuilderProposal` refuses the apply.
- **Reproduced:** stack slot, last session 90 × 15. Ben says "heavier on the fly, 100".
  - The proposal is `Cable fly: … → 100 kg`.
  - Apply's re-check gives a different result, so the sheet says `Out of date. Ask again.`
  - Asking again gives the same proposal and the same refusal.
  - Spec §5 says the guard uses `stepsHarderAsked` when Ben asked heavier. The integrator wired this sheet in 1294536, so the path is now live.
- **Fix:**
  - Store `askedHeavier` (or the parsed request) on `BuilderProposal` when `makeBuilderProposal` runs.
  - In `apply`, use `{ ...world.env, askedHeavier: proposal.askedHeavier }`.
  - Add a test: a proposal asked heavier applies, and the same proposal with no heavier request is refused as before.

**B2. Applying the coach's pre-session nudge marks Today's card `· edited`. Start then offers to write the nudge into the plan, and Undo never hands the card back to Today.**
`apps/mobile/src/services/today-session.ts:753–757` (`isEdited`), `apps/mobile/src/builder/builder-service.ts:1397` (coach apply `actionId`), `apps/mobile/src/screens/TodayScreen.tsx:206–222`

- **Cause:**
  - `applyNudge` → `writer.applyWorkout` → `applyCoachWorkout` writes a version whose `actionId` is `builder-coach-action:…`.
  - `isEdited` treats any version that isn't Today's as Ben's builder edit.
- **Effect:**
  - After the nudge offer ("one set fewer", "a step lighter") is applied:
    - The card title becomes `Push · edited`.
    - Today's controls stop driving the card.
    - Start goes through `startEdited` → the §2.8 prompt, `Use these changes for … Triceps pushdown: 3 → 2 sets`, with `Update … in your plan` offered.
  - A fatigue-day cut the coach suggested can then be written into the plan template. That breaks:
    - acceptance §2.0.8 #2 (Start is one tap);
    - #4 (a coach line with Undo that restores the code draft);
    - rule 3 provenance (a coach change is shown as Ben's edit).
  - Probe P2: after Undo, the content is back to Today's draft but the card still reads `· edited` (Undo writes a new draft version with the builder's `actionId`).
- **Fix:**
  - Make Today's ownership content-based, not authorship-based. Record the plan hash Today last wrote (for example `request.todayPlanHash`, or a `todayPlan` digest on the draft), and treat the draft as edited only when the current plan differs from it *and* the change wasn't a coach nudge.
  - Tag nudge applies, for example `rebuild.actionId = deriveId('today-nudge:'+opId)` or a `coachNudge: true` marker. Then `isEdited` ignores them and the card shows the coach line with Undo.
  - Make `startPrompt` skip changes that came only from a nudge.
  - Tests:
    - nudge Apply → card not `· edited`, and Start takes one tap with no prompt;
    - Undo → the card is Today's again and its controls drive it.

## Should fix

**S1. Today's Start doesn't pin the draft version inside the write. The check-in route doesn't pass a version at all.**
`apps/mobile/src/services/today-session.ts:871–876`, `apps/mobile/src/screens/TodayScreen.tsx:475`, `apps/mobile/src/screens/workout/CheckInScreen.tsx:323`

- `todaySession.start` compares `d.version` outside the transaction, then calls `port.start` with no `builder: { expectedVersion }`. The builder's Start does fence it (`workout-services.ts`: the `workout_drafts` row is added to the fence).
- When the check-in is due, Today navigates to `CheckIn` with only `coachDraftOf`, and `workout.start` starts whatever version is current at that moment.
- **Scenario:** a late nudge Apply, or a builder edit from a second navigation path, lands between the read and the write (or while the check-in sheet is open). The workout starts from a draft Ben never saw (rule 5).
- **Fix:**
  - Pass `builder: { expectedVersion: req.expectedVersion }` from `todaySession.start`.
  - Add `expectedVersion` to the `CheckIn` route params for `coachDraftOf`, and forward it.
  - Test: bump the draft between commit and start, and check that nothing is created.

**S2. The nudge commits and reviews the draft for the day's *initial* controls, not the ones Ben has set.**
`apps/mobile/src/screens/TodayScreen.tsx:159`

- The effect calls `todaySession.review(session, { controls: session.initial[dayKey] … })`, and only once `reach` resolves (asynchronously).
- **Scenario:** Ben changes Length or Abs, or taps Mix it up, before the coach status returns.
  - The nudge commits a draft built from the initial controls and makes its offer against that draft.
  - Apply then writes the offer onto the initial-control draft (which becomes `· edited`, see B2), and Ben's control changes are silently gone from the card.
- **Fix:** either review the current `selection.controls`, or include the controls in the nudge key and drop an offer whose controls no longer match the card. Add a test.

**S3. Tests for the cross-stream risks.** None of these is covered yet:

- Apply after an "asked heavier" proposal (B1).
- Nudge Apply and Undo → card state and Start prompt (B2).
- Today Start fence and the check-in route (S1).
- A same-gym equipment edit between commit and Start. P1 shows the snap holds; keep it as a regression test, because `sameGym` doesn't check `equipmentVersion` and a future "stand as built" shortcut could skip the snap.

## Nits

- **N1.** `builderDraftUndo` restores the earlier plan with its old revs, so revs go 2 → 1 (P2). This is harmless now, because Undo only runs when nothing changed since and the content is identical. Spec §4.4 implies revs only ever go up: run the restored plan through `withSlotRevs(currentPlan, restored)`.
- **N2.** The nudge commit's op ID is deterministic (`nudge:<date>|<card>|<gym>:commit` → `deriveId('today-draft:…')`). After `Back to plan day` discards that draft, a relaunch the same day finds the ID already taken. `createBuilderDraft` returns `replayed` with the discarded draft, and the nudge runs against a closed draft. Fix: treat a `replayed` draft that isn't open as "commit again under a fresh ID".
- **N3.** `coachApplied` (`builder-service.ts`) looks for the op ID in `opIds`, which is trimmed to `MAX_WORKOUT_DRAFT_OPS`. After many manual edits, a retried Apply isn't recognised. That retry is in-session only, because proposals aren't persisted.
- **N4.** When a pain flag doesn't need to lower anything (P3), the Start's sets carry no `held` and no pain note, while Today's card says `pain flag · held`. Add the pain note to `guardNotes` for a pain-flagged builder slot even when no load moved, so the session's Why? matches the card.
- **N5.** Plan-day provenance is worked out in two ways:
  - `builder.start` re-reads the plan day and keeps `templateVersion` only when the template still matches (`sameTemplate`, builder-service.ts:1170).
  - Today's Start uses `planDayOfBuilderDraft` (coach-draft.ts:826), which copies `setup.templateVersion` unchecked.

  A template updated between commit and Start is recorded as the older version on Today's path. Use one helper for both.

## Confirmed as wired (checked against code)

- Edit opens `BuilderWorkout {draftId}` after a codec commit, and Build your own opens `BuilderSetup {dayId}`. No placeholder remains.
- Summary uses `planChangeOf` / `undoPlanChange` and survives a force-close (stored on `session.planDay.planChange`).
- `coach-draft.ts` covers:
  - the `plan` source skip in `recheckDraftSlot` (line 801);
  - the S4 same-gym and no-pain condition (lines 878–899);
  - re-planning when history moved (via `checkedHistoryVersion`).
- `today-v2/info.ts` and `draft-plan.ts` are gone. There is one `checkedOnOf` (domain) and one `builderInfoOf`, and Today's `~N min` comes from `estimateBuilderMinutes`.
- `setBuilderReviewProvider` is called at app start (app-services.ts). Builder review statuses include `failed`. Session review records store `failed` / `offline` / `not_connected` without coach text (rule 1, rule 6).
- Coach applies are version-checked and idempotent on `builderApplyOpId`, re-checked per slot (`preconditionsHold`), and write through the codec with `origin: 'builder'`.

## Spec issues (for Ben)

- **SP1.** §2.0.3 step 2 says the coach's small change on Today is "applied and shown with its reason and Undo". The coach stream made it an offer (Apply/Skip, its SP5). §2.0.4 doesn't say whether a coach change counts as "Edited in builder" or triggers §2.8. B2 needs that decided: proposed rule, "coach changes are never `· edited` and never prompt §2.8".
- **SP2.** §2.0.3 step 1 and line 803 say "with the variation last used". Today has no variation concept and always commits `variationId: null`, so the chips and Edit never open a variation. Either add variations to Today or amend the spec.
- **SP3.** The builder stream's handoff said "Edit calls `builder.openTemplate`", but §2.0.2 says the card's workout *is* the draft. The integrator followed the spec, and I agree. Record this so the handoff note isn't re-applied later.
- **SP4.** §2.6 describes a chat sheet. Set up and Your workout use an iOS `Alert.prompt` for typed words, and there is no waiting indicator. Needs Ben's OK, along with the new copy `No answer. Try again.`.
