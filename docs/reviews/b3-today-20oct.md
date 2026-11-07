# Review: Today (v2), branch `claude/b3-today-20oct` (93130e4..dba562f)

Reviewer: independent reviewer agent, 20 Oct 2026
Spec: `docs/design/workout-builder-v3.md` §2.0 (with the 20 Oct additions), §3, §4.2, §4.4, §7; `docs/design/prototypes/today-v2.html`; CLAUDE.md rules 1–10.

## Verdict: **CHANGES NEEDED**

There are two blocking issues. The first breaks the card's ownership check on a real clock, so Today's own drafts show as `· edited`. The second lets workouts include exercises this gym can't load, or ones under a pain flag.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| Targeted tests (today-v2, today-session, today-v2-screen and the 4 updated older tests) | 7 files, 133 passed |
| `npx vitest run --maxWorkers=2` (full suite) | 419 files, 7967 passed, 1 todo |
| Probe test (written and run, then deleted; not committed) | **Failed**: with a clock that moves forward on each `now()` call, a draft Today has just committed reads back as `edited` (B1) |

---

## Blocking

### B1. Today's own drafts read back as `edited` in production (two clock reads)
- **Where:** `apps/mobile/src/services/today-session.ts:636-640` (`isEdited`), `:698` (`const at = deps.now()`), `:709` / `:731` (`updatedAtUtc: at.utc`), `:647` / `:678` (`versionOf` reads `deps.now()` again for `createdAt`).
- **Failure:** `isEdited` treats a draft as Today's only when `d.updatedAtUtc === v.createdAt.utc`. `commit` writes `updatedAtUtc` from one `now()` read. `versionOf` writes `createdAt` from a second read, taken after an `await openBuilderDraft(...)`. On the phone (`nowZoned`, `Date.now()`) the two values differ by at least 1 ms almost every time. The test harness clock is frozen (`h.clockMs`), which is why this passes in tests. I confirmed it with a probe that makes `clockMs` tick on each read: `card(...).edited` came back non-null straight after a Today commit.
- **Scenario:** Ben taps Start, the check-in sheet is due, and he backs out. Or a Start fails as stale, or (after the builder merge) he taps Edit and then comes back. Today now shows `Chest · edited`, hides the five controls and shows `Back to plan day`. Every later `commit` returns that old draft unchanged, so control changes are ignored. Once the builder merges, Start will also raise the §2.8 `Use these changes for` prompt when nothing was changed. The only way out is to discard.
- **Fix:** read the clock once in `commit` and pass `at` into `versionOf`, so `createdAt` and `updatedAtUtc` are the same value. Better still, don't infer ownership from timestamps at all. Compare `d.version` with the version Today wrote, which can be recorded on the version (for example `request.setup.writtenBy: 'today'` together with the draft `version` at write time), or check `v.actionId === todayActionId(...)` and that no in-place edit has bumped `version` since. Add a service test with a ticking clock: commit, reload, and the card is not edited.

### B2. Template exercises (and the main lift) skip the gym and pain filters
- **Where:** `apps/mobile/src/services/today-session.ts:531-534` (`poolFor` puts `t.exerciseIds` in front of the pool without `here()` or `pained()`). `buildFromSetup` also adds the main lift unconditionally (`packages/domain/src/builder/build.ts:228-230`). The `BuilderPool` contract says the service filters (`build.ts:156-160`), and so does spec §3.7 ("only exercises this gym has, not pain-flagged").
- **Failure 1 (gym):** at a dumbbell-only hotel gym, the Chest template's Cable fly stays on the card. It shows `—`, still counts toward `5 exercises · ~52 min`, and one-tap Start creates it with its target dropped. The ordinary pool would have given a dumbbell fly instead.
- **Failure 2 (pain, rule 9):** a pain-flagged accessory that's in the template stays in the workout. With history it is held at the last top set (`painCap`, `:283`). With no history `painCap` is `null`, so it gets an uncapped start-light or e1RM-based load. Under §3.7 it should not be picked at all. A pain-flagged main lift should at least be held and marked, never progressed.
- **Fix:** filter the template's IDs through `here(id) && !pained(id)` in `poolFor`, so a missing exercise falls through to the next pool candidate. For the main lift, when it isn't doable here, use the next `mainLiftOptions` choice or show the gap. When it's pain-flagged, keep it held at the last comparable load (or `Start light` when there's no history) and label it. Add service tests: a gym without a cable stack, and a pain flag on a template accessory, with and without history.

---

## Should fix (S)

### S1. The Today screen, including Resume, waits for the heavy `todaySession.load()` on every focus
- **Where:** `apps/mobile/src/screens/TodayScreen.tsx:80-91` (`Promise.all` includes `todaySession.load()`). `today-session.ts:407-412` runs a dry run of every template and reads history for every candidate exercise (around 8 per group plus the templates' exercises, so about 60–80 reads).
- **Failure:** mid-workout, the Resume card (the primary action) is blank until all of that finishes, even though the session card is hidden. Spec §2.0.4 Loading says "the card shows at once". This hasn't been timed on a phone (the developer's open item 8).
- **Fix:** load `todaySession` separately from the rest of the screen data, so Resume, stale and banners render first. Skip it entirely while a workout is active. Cache it by data version instead of reloading on every focus.

### S2. An edited card hides the Main lift chips, so Ben can't switch main lift without discarding his edits
- **Where:** `apps/mobile/src/screens/today/TodaySession.tsx:486-513`.
- **Failure:** with `Chest · edited` (Bench), there's no Incline chip. §2.0.4 "Edited in builder" says picking another type keeps the edited draft for when he comes back. Here the only route to Incline is `Back to plan day`, which discards the edits.
- **Fix:** keep the Main lift row (and the day control) on an edited card, and hide only the other four controls. The edited draft is already keyed per main lift (`edited[dayKey|main]`), so switching chips works as is.

### S3. No-plan state is a dead end after picking an Other session
- **Where:** `TodayScreen.tsx:543-566` (the No plan block renders only while `view === null`) and `:686` (Build your own is hidden when `no_plan`).
- **Failure:** with no plan, Ben taps `Upper`. The list, `Empty workout`, `Build your own` and `Set up a plan` all disappear, and nothing lets him pick `Push` instead or go back.
- **Fix:** in the no-plan state keep a picker (the Other sessions as segments, or a `⋯`) above the card, and keep the `Build your own` / `＋ Activity` row.

### S4. Pinned builder loads skip the pain hold at Start
- **Where:** `packages/domain/src/session/coach-draft.ts:843-847` and `:869-876` (the `builderPinned` path `continue`s past `recheckDraftSlot`).
- **Failure:** a draft is committed by Edit, or is an edited builder draft. Later Ben records a pain flag on that movement, or switches gym. Start uses the loads frozen at commit. `create.ts:317-323` still fits targets to this gym's items, so rule 4 holds, but the rule 9 hold is never re-applied, and the `checkedOn` equipment ID can belong to the other gym.
- **Fix:** at Start, re-apply the pain hold to pinned loads using flags newer than `version.createdAt`. Ignore `checkedOn` when `version.request.gymId !== req.gymId` (or the `equipmentVersion` differs), or refuse as stale so the card re-commits. The builder branch has the same code (`75e6305`), so fix it once, at the merge.

### S5. Airplane mode doesn't show `Offline` (acceptance check 1)
- **Where:** `today-session.ts:310-314` and `:503`, which rely on `coach.availability()`. That reports `offline` only after a coach call has failed with a network error (`coach-service.ts:537`).
- **Failure:** on a cold open in airplane mode with a connected account, Why? ends `Not reviewed` and the header reads `Coach`. §2.0.4 and §2.0.8 check 1 expect `Not reviewed · Offline` and a coach bar showing `Offline`. Nothing false is claimed (rule 1 holds), but the spec isn't met.
- **Fix:** add a cheap reachability signal for the status, or record this as a known limitation in the spec. Add a test for the offline path through the service (the domain test only covers `todayWhy`).

### S6. Edit's operation ID is never cleared, so later Edits can open an old draft
- **Where:** `TodayScreen.tsx:350` (`edit:` key in `startOps`, never deleted) together with `today-session.ts:702` (`existing.opIds.includes(opId)` returns the existing draft).
- **Failure:** Ben taps Edit, goes back, changes gym (the data reloads and the loads change), then taps Edit again with the same controls. The same operation ID returns the earlier version with the other gym's loads.
- **Fix:** include a hash of the card's plan (or the data load's version) in the commit key, or delete the key once the commit succeeds. The commit is idempotent on content anyway (`:704`).

### S7. Collisions with the builder stream (`claude/b3-builder-20oct`)
- Both branches edit the same lines of `planCoachDraft` (`coach-draft.ts`), so there will be a textual conflict. The builder version also adds the `plan` load source and skips `plan` in `recheckDraftSlot`.
- Both add `BuilderSetup` and `BuilderWorkout` to `navigation/types.ts` with different shapes (the builder's has `draftId?` and `toast?`). Today's calls fit the builder's shape, but the merge must keep only the builder's types.
- Today's drafts don't carry the builder's `DraftSlot.builder` state (`repRange`, `source`, `anchorE1rm`, `autoPair`, `restS`) or `restLevel`. The builder treats slots without it as coach slots, so opening Today's draft in Your workout will lose the source labels and the recalculation from reps and RPE.
- There are duplicate adapters and codecs: `today-v2/info.ts` against the builder's `builder/info.ts`, and `today-v2/draft-plan.ts` against `builder/codec.ts`.
- **Fix at merge:** Today should write its drafts through the builder's codec, using the `plan` source and the `builder` slot state. Delete `info.ts`/`draft-plan.ts`, keep the builder's `planCoachDraft` and `planDayOf…`, and re-run today-session.test against the merged code. The coach branch has no file overlap.

### S8. Test gaps
- The screen tests (`today-v2-screen.test.ts`) are pure-reducer tests and checks on source strings. Nothing renders the screen, so scroll retention, the fit on one screen, tap areas and VoiceOver are untested.
- Missing service and end-to-end cases:
  - a ticking clock (B1);
  - a gym lacking a template exercise, and pain flags on template exercises (B2);
  - an lb profile end to end (kg and lb are only tested in the domain);
  - a Start with check-in due (`CheckIn` with `coachDraftOf`, then back out, then Start again);
  - the paused, no-plan-with-routines and done-today states through `load()`;
  - offline status (S5);
  - force-close between commit and Start (the draft survives and Start resumes it);
  - `movedLine` output.
- **Fix:** add these. At least one render test (React Native Testing Library or the repo's existing renderer setup, if one exists) for the collapsed card and the Start → Workout navigation.

### S9. Switch tap areas
- **Where:** `TodaySession.tsx:325-330`. The `hitSlop` sits on a plain `View` around the `Switch`, which doesn't extend the Switch's own touch area on iOS. The Switch is about 31 pt tall inside a 38 pt row. Spec: "each control keeps a 44 pt tap area".
- Chip `hitSlop` (34 + 6 + 6) also overlaps the neighbouring 38 pt rows, which are only 2 pt apart.
- **Fix:** make the whole Abs and Supersets row a `Pressable` with `accessibilityRole="switch"`, and give it `accessibilityState={{ checked }}`. Check the chip slop for overlaps on the device.

---

## Nits (N)

1. `TodaySession.tsx:488`: the Main lift row shows even when there's only one chip. Spec §2.0.4 "One type only: No chips" (see Spec issues SP3).
2. `view.ts` `todayMixLine`: with a shortlist of one, `Another (1/1)` swaps to itself. Hide `Another` when `n === 1`.
3. `session.ts` `applyMix`: the mix index survives Time, Abs and Supersets changes, but the target is recomputed. The swap line can quietly start pointing at a different accessory. Reset `mix` when the target slot changes.
4. `today-session.ts:588`: when there's no run clash, the clash line falls back to the first builder advice reason. Advice on a code-built draft points to a builder bug and isn't a week clash. Drop the fallback or show it as advice with its fix.
5. `TodayScreen.tsx:374`: when `Back to plan day` fails, it says "Couldn’t start the workout: it changed since…". Use something like `Changed since. Try again.`
6. `TodaySession.tsx:537`: the Why? lines use their text as the React key, so two identical lines would collide.
7. The strip uses hard-coded 11 and 12 pt text with `numberOfLines={1}`. Check legibility and Dynamic Type below the accessibility sizes.
8. `TodayHeader`: with no coach connected, the bar reads `Coach` and its VoiceOver label doesn't mention it (§5: `Coach not connected`).
9. `today-session.ts:484`: strip dates use the profile's time zone rather than the session's stored `startedAt.tz`.
10. Today drafts nobody touched (committed, then Start abandoned) stay open for 14 days and could show up in the builder as `Edits from …`. Expire them at the end of the day, or skip them in the builder.
11. Day sheet: no `Move or change (coach)` for planned days and no `Mark done` for planned runs (§2.0.5). Low priority until dated plan days exist.
12. The Time stepper has no disabled state at 15 and 180 min.

---

## Rule check (CLAUDE.md)

| Rule | Status |
|---|---|
| 1 Offline / honest AI | Makes no AI call and writes no canned coach text. Why? says `Not reviewed…`. Offline isn't detected without a failed call (S5). |
| 2 Completed sets / proposals | Nothing on Today touches completed sets. Mix it up is today only, with Undo. `Back to plan day` discards with Undo through versioned restore. |
| 3 Coach changes | Not in scope. The hooks (`coachReason`) are in place. |
| 4 Achievable loads | The builder rounds down on the item, and Start re-fits to the gym. Exercises the gym can't do still reach the card (B2). |
| 5 Idempotent, versioned | Commit and Start use operation IDs. Start rejects a stale draft version. The ownership check is broken (B1), and Edit can reuse an old operation ID (S6). |
| 6 No invented data | The strip shows only logged or told activities. Est. 1RM isn't shown on Today. |
| 7 Credentials / paid route | Not touched. |
| 8 Imported data | Not touched. |
| 9 Pain | Held via `painCap` when there's history. Pain-flagged template exercises aren't excluded, and with no history they're uncapped (B2). Pinned loads skip the hold at Start (S4). |
| 10 Your data / Coaching knowledge | Drafts are Your data. No mixing seen. |
| Minimal copy | Mostly met. No reassurance lines or rule labels. |

## §2.0.8 acceptance checks

| # | Status |
|---|---|
| 1 Airplane mode | Partly met: Start works offline, but the line reads `Not reviewed`, not `· Offline` (S5) |
| 2 One tap to Start | Met (check-in not due) |
| 3 Collapsed card | Met against the 20 Oct form (no `plan day N of 4`). The check text is out of date (SP3) |
| 4 Why? lines match stored data | Met for code facts. No coach lines yet |
| 5 Structural change only with Apply | n/a (coach stream) |
| 6 Strip | Met (✓, dashed outline, `Planned` in VoiceOver, runs only when logged) |
| 7 Clash line | Met, with copy `…fit better another day` (SP5) |
| 8 Picking writes nothing; Up next moves on | Met (tested) |
| 9 Chips | Partly met: Main lift chips work. Variations are out of scope |
| 10 Edited card + §2.8 prompt | Depends on the builder merge. B1 makes `edited` show falsely |
| 11 Resume replaces the session | Met, but slowed by S1 |
| 12 ≥ 44 pt, lists at accessibility sizes | Partly met: lists at accessibility sizes are in place. Switch tap areas fall short (S9). Not checked on a device |

---

## Spec issues

- **SP1.** §2.0.4 "Other day picked" asks for the strip to reflow and show `Chest moves to Thu`, but plan days have no dates (the rotation is undated, and week plans only hold merges and skips). The developer shows `Chest moves to next session` / `… after Legs`. The spec should either define how dated plan days get created, or accept the relative wording.
- **SP2.** The No plan state (§2.0.4) means someone with routines but no plan loses today.md's rotation-based Up next. That is a regression from what Ben has now, and Ben should decide.
- **SP3.** §2.0.8 checks 3 and 9 and §2.0.4 "One type only: No chips" still describe the older chips and `plan day N of 4`, which the 20 Oct additions replaced with the five controls and dropped `plan day N of 4`. The acceptance checks need rewriting against the 20 Oct form.
- **SP4.** The Full body and Upper mixes under `⋯` aren't defined (the developer chose them). §2.0.2 also says the plan's day "moves on as for any other pick" for Other sessions, but those have no plan day to credit. The rule needs stating.
- **SP5.** The clash copy assumes a weekday (`legs fit better Thursday`). Without dated days only `another day` is possible.
- **SP6.** The spec doesn't say what happens to control tweaks on a force-close before Start or Edit. Currently they reset and only the saved draft survives. Ben should confirm that's acceptable.
- **SP7.** §2.0.3 makes Today trigger a background coach review, which today.md said never happens. That isn't in this slice, so the Why? line always reads `Not reviewed` even when the coach is connected. The spec should state this interim.
