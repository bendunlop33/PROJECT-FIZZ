# Review: Wave 2 merge wiring (claude/b3-merge-20oct, f92668c..c50e079)

**Verdict: CHANGES NEEDED** (2 blocking)

Reviewer: independent, 21 Oct 2026. Scope: the cross-stream wiring listed in the three streams' "Wire at merge" / "Interfaces to wire" notes, checked against `docs/design/workout-builder-v3.md`. I traced each path in the code: Today → Edit → builder → Start; Today and Set up ask bar → coach → `fill_setup`; Coach review → provider → Apply and notes; nudge Apply/Skip → day settled; Summary Undo after force-close. Nothing has run on an iPhone.

## Checks run

- `npm run typecheck`: exit 0.
- Targeted vitest (`today-v2-screen`, `builder-coach-merge`, `builder-screens`, `navigation`, `builder-coach`, `today-session`, `builder-review-fixes`), `--maxWorkers=2`: 7 files, 129 passed.
- `npm run lint`: 17 errors, all in `apps/mobile/test/zz-integrity-probe.test.ts`. That file is untracked and is not part of this branch; it was left by another agent. `packages/coach/test/zz-probe-heavier.test.ts` is also untracked. The committed tree lints clean. **Delete both files before running the full suite or lint again.**
- Two behaviours were confirmed with a throwaway probe test against the real services, deleted afterwards:
  - `builder.initialSetup({dayId:'full_body'})` and `{dayId:'upper'}` both return **Push**.
  - Offline, `askSetup({words:'left knee is sore, legs feel wrecked', from:'today'})` returns `filled` on **Legs**, with Back squat as the main lift.

## Wiring checklist

| Item | Status |
|---|---|
| Today Edit → `'BuilderWorkout' {draftId}` (via the codec, not `openTemplate`) | Wired (TodayScreen.tsx:497). Choosing commit over `openTemplate` is correct per §2.0.2 |
| Build your own → `'BuilderSetup' {dayId}` | Wired, but **wrong day for 2 of 3 Other sessions** (B1) |
| Summary `planChangeOf` / `undoPlanChange`, survives force-close | Wired and tested (SummaryScreen.tsx:79, 306; today-session.test.ts:251) |
| coach-draft: `plan` source, `recheckDraftSlot` skip, S4 same-gym/no-pain condition | Present (coach-draft.ts:799, 878–899) |
| Today drafts through the builder codec, `withSlotRevs`, rest level only on `BuilderSetup` | Wired (today-session.ts:780, 816–837) |
| `today-v2/info.ts`, `draft-plan.ts` deleted; single `builderInfoOf` / `builderUsable` / `checkedOnOf` | Done; no references left |
| `~N min` via `estimateBuilderMinutes` / `BUILDER_TIME` | Wired (today-session.ts:648, today-v2/session.ts:251) |
| `setBuilderReviewProvider` at app start; `'failed'` status; per-focus counts; `notSaved` | Wired (app-services.ts:1015; review.ts:19) |
| `UPDATE_PLAN_DAY_ACTION` → §2.8 sheet | Wired (BuilderWorkoutScreen.tsx `onApply` → `openPlanUpdate`) |
| `writer.applied`, `applySetup(...{openBuilder})`, `source.setup` | Wired (coach-ports.ts) |
| Coach apply keeps `origin:'builder'`, codec, `checkedHistoryVersion`, `rev` bumps | Wired (builder-service.ts:1379–1405) |
| `todayCoachWhy` / `mixCoachReason` / `applyNudge` / `skipNudge` | Wired (today-session.ts:677–706; TodayScreen.tsx:195) |
| Shared `CoachAskBar` on Today, Set up, Your workout | Wired; Today's routing has problems (B2, S1) |
| No "builder isn't in this build" placeholder | Gone (one dead "isn't available in this build" string remains: N2) |

## Blocking

**B1. `Build your own` and the Today ask bar open the wrong day for Full body and Upper.**
- Where: TodayScreen.tsx:513–516 passes `splitDayId` (`'full_body'`, `'upper'`) to `BuilderSetup`. builder-service.ts:753 (`initialSetup`) does `all.find((d) => d.id === req.dayId) ?? days.split[0] ?? days.ppl[0]`. The builder's day list is the split plus the PPL presets, which has no `full_body` or `upper`. The same fallback hits coach-ports.ts:67, where the Set up context for words asked from Today uses `todayDayId`.
- Failure: Ben picks `⋯ → Full body` (or it's the day control with no plan, §2.0.4 `No plan`), then taps `Build your own`. Set up opens on **Push** with no word about it. Spec §2.0 (rows 235 and 285) says "Set up, Day = the card's day". Words said on Today while Full body is on the card ("make it 45 min") produce a Set up for Push. I confirmed this with the probe.
- Fix: give the builder the Other sessions as day options. Either add `TODAY_OTHER_SESSIONS` to `dayOptions()` with their groups as parts, or have `initialSetup` accept `{dayId, dayName, groups}` from Today. Never fall back silently: an unknown `dayId` should return `CUSTOM_DAY_ID` with the card's groups rather than `split[0]`. Add a test: `initialSetup({dayId:'full_body'})` keeps Full body, and Build your own from each Other session opens on that session.

**B2. Words on Today's bar are forced through the Set up parser, so pain words can open a workout for the painful area and never reach the coach (rule 9, rule 1).**
- Where: TodayScreen.tsx:181–191 (`askToday`) and 806–811. Every heard utterance goes to `builderCoach.askSetup({from:'today'})` first. Offline or not connected, code's `parseSetupWords` reads any day or lift word as a fill.
- Failure: offline, Ben says "left knee is sore, legs feel wrecked". The result is `filled`, and Set up opens on **Legs** with Back squat as the main lift and a `Legs · Undo` toast (probe-confirmed).
  - Connected, the only tool offered is `fill_setup`. The reply comes back as a 4-second toast (line 188) instead of opening the coach, which owns pain flags. The pain mention is never recorded, so progression on that movement isn't stopped (rule 9).
  - For anything not understood, line 191 opens the Coach sheet **without the words** (`draft` param unused), so Ben has to say it again.
- Fix:
  - Before `askSetup`, run `classifyPainMention(words)` (`@fizz/domain` coach/pain-words). For anything other than `'none'`, open `Coach` with `{entry:{kind:'today'}, draft: words}` (or send the words) and never fill Set up.
  - Treat `kind:'reply'` the same way: open the coach with the words rather than a toast.
  - Always pass the heard words as `draft` on the fallback.
  - Add tests for pain words offline and connected (no fill, coach opened with the words) and for the fallback keeping the words.

## Should fix

**S1. Nudge Apply can silently undo Ben's control changes on the card.**
- Where: TodayScreen.tsx:159. The nudge commits and reviews the draft built from `session.initial[dayKey]`, but the card shows `selection.controls`. Lines 128 and 230 key the nudge only on day + main lift (`cardKey`).
- Failure: Ben sets Length to 45 min (or turns Abs off), and the offer appears. He taps Apply. The offer is written onto the **60-min initial** draft, which is now "edited", and the card switches to it: `Chest · edited`, 60 min. His control change is gone with no word.
- Fix: either commit and review the draft for `selection.controls`, or hide the offer (or show `Out of date`) once `selection.controls` differs from the controls it was built on. Add a test.

**S2. Two counting rules and two status sources on one review sheet.**
- Where: BuilderWorkoutScreen.tsx:113 and 354; review.ts:110 (`reviewFacts`).
- Failure: `runReview` first shows code's per-group counts (`✓ Chest 6`, direct working sets), then replaces them with the provider's per-focus counts, which use full credit for the main muscle and half for others. Ben sees the numbers change under him: two copies of one rule.
  - The start status comes from `services.coach.availability()`, while the bar on the same page uses `builderCoach.status()`. These can disagree, for example `● Coach` on the bar and `Offline` in the header for a moment.
- Fix: drop the code-only first paint, or have it call the same counting function as the provider. Use the `reach` state for `runReview` and delete the `coach` / `coachStatusOf` state. The counting rule itself is SP3 below.

**S3. Your workout's ask has no waiting state and no guard against a second ask.**
- Where: BuilderWorkoutScreen.tsx:196–216.
- Failure: a model call takes seconds with nothing on screen (rule 1: honest status). Ben asks again and gets two proposals, and the second replaces the first's sheet. If he edits rows meanwhile, Apply returns `Out of date`. A non-proposal coach reply is a timed toast (`showToast`), so with VoiceOver off the coach's answer vanishes after the undo timeout.
- Fix: add an `asking` state that disables the bar and shows a one-word `Asking…` (copy for Ben). Ignore a second submit while one is in flight, or abort it with an `AbortSignal`. Show replies in the proposal sheet with no actions, not in a toast.

**S4. Missing tests for the merge's own paths.**
- No test for any of these:
  - Today's nudge Undo (`builder.undo(draftId, builderApplyOpId(offer.proposal.id))`, TodayScreen.tsx:218) restoring the draft.
  - `askToday` routing: filled → Set up; reply, not understood, or pain → coach.
  - Build your own from each Other session.
  - The nudge offer after a control change (S1).
- The screen test at today-v2-screen.test.ts:114 is still titled "both guarded until the builder ships" although it now asserts the opposite.
- Fix: add service-level tests for the first, third and fourth items. Pull `askToday`'s decision into a pure function (like `editAskView`) and test it. Rename the stale test.

## Nits

- **N1.** Equipment version is hashed two ways: Today's at today-session.ts:553 is unsorted and unprefixed; the builder's at builder-env.ts:284 is sorted and prefixed `builder-equipment:`. Drafts from Today and from the builder therefore store different `equipmentVersion` and `contextHash` values for the same gym. Nothing compares them yet, but the next feature that does will see every Today draft as "gym changed". Use one exported helper.
- **N2.** `REVIEW_WHY.unavailable` ('Coach review isn't available in this build.', review.ts:23) is now unreachable in the app because the provider is always registered. Delete it, or keep it test-only.
- **N3.** Your workout's bar stays disabled after one `offline` reply until the page is refocused (reach is only re-read in `reload`). Re-read `status()` on AppState `active`, or poll while the bar is disabled.
- **N4.** After Today's nudge Undo, the nudge stays `settled · applied` and the card still reads `edited` (the Undo bumped the version, so `isEdited` is true). This is consistent with the version-ownership rule, but the card then offers `Back to plan day` for a workout that is back to the plan. Consider treating an Undo back to Today's own version as not edited.
- **N5.** ProposalSheet's header is the bar label (`Ask the coach to change it`), not the §2.6 chat-header status word (`● Coach` / `Offline`).
- **N6.** `coach-ports.ts` holds module-level mutable state (`page`, `todayDayId`, `pending`, `asked`). If Set up is already mounted under another screen when Today hands over a fill, the `[draftId, params.dayId]` effect may not re-run and the pending fill waits until the next fresh Set up. This is an edge case; consuming `takePendingSetupFill()` on focus would close it.

## Spec issues (for Ben)

- **SP1 (acceptance, spec line 803).** "Edit opens `Chest · bench` (or its last-used variation)" can't be met. Today has no variation concept, and Ben's 20 Oct note says the controls replace saved variations on Today. Either drop "or its last-used variation" from the acceptance or define how Today picks one.
- **SP2 (§2.6).** The spec describes a chat sheet with a status header. The build uses an iOS `Alert.prompt` and toasts on Set up and Your workout. That needs approval, or a chat sheet.
- **SP3 (§2.9 counts).** Sets per muscle are counted three ways: builder per group, coach per focus with half credit, and the stored record. Ben needs to pick one (also raised by the coach stream as its SP3), which then fixes S2.
- **SP4 (§2.0.5 vs rule 9).** The spec says Today's bar "opens the builder Set up filled" for set-up words, but says nothing about words that mix pain and set-up ("legs are sore, short session"). It should say that pain mentions always go to the coach first (B2).
- **SP5 (§2.0.4 Other sessions vs §2.1 Day list).** The spec adds Full body and Upper as Today sessions but doesn't add them to Set up's Day options (B1).
- **New copy to approve:** `No answer. Try again.`, `Not applied`, and (if S3 is taken) `Asking…`.
