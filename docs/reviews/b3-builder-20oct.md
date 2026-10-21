# Review: Builder v3, the two-page builder (Set up → Your workout → Start)

Branch `claude/b3-builder-20oct` (`93130e4..a9acb4f`, 6 commits). Spec: `docs/design/workout-builder-v3.md` §2.1–§2.8, §3, §4.3–§4.7. Prototype: `docs/design/prototypes/workout-builder-v3.html`. Reviewer: independent, 20 Oct 2026.

## Verdict: **CHANGES NEEDED**

The domain code, the draft life cycle and the atomic Start are solid. The MERGE NOTE reconciliation is complete and the service tests use real SQLite. But I found five blocking bugs: two corrupt stored data (plan-day provenance, and silent restructuring of a template), one breaks the deterministic load guardrail, one breaks pain holds at Start, and one is a rule 1 honesty gap. There are also two blocking UI problems: VoiceOver can't edit set values, and navigation stacks the modal pages. I confirmed B1, B2, B3 and S1 with throwaway probe tests on real SQLite (deleted afterwards, and the tree is clean).

## Checks run (worktree, by the reviewer)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `eslint` on every changed package and test (8 GB heap) | pass, 0 problems |
| `npm run check:migrations` | `Migrations OK: 1 to 30` |
| Targeted: builder service, screens, v3 draft/life, `packages/domain/test/builder`, persistence, schemas | 52 files, 595 tests pass |
| `vitest run apps/mobile/test packages/domain/test --maxWorkers=2` | 319 files, 4991 pass, 1 todo |

---

## Blocking

### B1. Changing Day (or Main lift) on Set up leaves the draft's plan-day key unchanged, so Start credits the wrong plan day
`apps/mobile/src/builder/builder-service.ts:721-737` (rebuild) and `:905-908` (Start's `planDay`). `packages/domain/src/builder/draft-life.ts:155-164` keeps `...current`, including `builderKey`.
- **Failure (reproduced):** Ben opens Push from the plan, goes `‹ Set up`, sets Day to Legs, then taps Next and Start. The session stores `planDay.splitDayId: 'push'` while it holds Back squat, Pull-through and so on. The snapshot label reads `Legs` while `planDay.splitDayId` is `push`. Up next then credits Push and Legs stays next, which breaks §4.2 and acceptance 2.0.8 #8. A main-lift change (bench to incline) has the same problem: the key still says bench, so Today's "last-used type" and a later `create()` for bench reopen the incline draft. Going to Custom still records the old plan day.
- **Fix:** on a rebuild, recompute the key (`draftKey(next, built.plan)`) and write it in the same transaction. If an open draft already exists for the new key, resolve that collision explicitly (resume it, or refuse with `Rebuilt` into the existing one). Build Start's `planDay` from the current set-up and template, never from a stale key. Test: a Day change followed by Start records the new day, and a change to Custom records none.

### B2. Opening Set up from a template draft replaces the template's groups with the recommendation, and Next then silently adds exercises
`apps/mobile/src/screens/builder/BuilderSetupScreen.tsx:64-79` (`withRecommendation` whenever `groupsEdited` is false) together with `builder-service.ts:642-667` (`openTemplate` stores `groupsEdited: false`).
- **Failure (reproduced):** the Push template has Bench, Incline DB and Pushdown, so its groups are Chest 2 and Triceps 1. On `‹ Set up` the rows show Chest 2, Shoulders 1, Triceps 1, Abs 1. Tapping `Next: exercises` with nothing changed merges in Arnold press and Ab-wheel rollout. There is no toast and no Undo is shown. §2.2 says "template loaded (rows show the template; groups come from its exercises)". This silently changes Ben's plan-day workout, and the Start prompt then lists the additions as his changes.
- **Fix:** don't apply the recommendation while a template or variation is loaded. Store a "from template" marker, or `groupsEdited: true`, or compare against the template's own groups. Separately, `Next` with an unchanged set-up should write nothing. Test: open the template, visit Set up, press Next, and the exercises are identical.

### B3. The built-in rule's target is re-derived as if it were for the top of its rep range, which inflates loads beyond the rule (rule 3, ADR 0006)
`apps/mobile/src/builder/builder-env.ts:193` (`ruleTarget = { value, reps: s.reps.max, rpe: 8 }`) together with `packages/domain/src/builder/loads.ts:76-78` (Epley rescale when reps differ).
- **Failure (reproduced):** Ben logged Triceps pushdown at 50 × 9 @ 8, which misses the top of 8–12, so the rule says hold at 50. The builder shows **55** on every working set, labelled `rule`, and `Why this weight?` reads `Last time + 5`. That is a 10 % rise after a miss, made by the deterministic fallback. Bench passed only because the main-barbell range tops out at 6, the same as the top-set reps. Any isolation or compound whose range max is above the set's reps is inflated. The developer listed this as an assumption to check.
- **Fix:** use the rule's load as the working load at the rule's own prescription: `reps.min` for `increase_load`, `reduce_load` and `hold`, and `reps.min == max` for `increase_reps`. Don't scale it up by formula. If other sets need a formula, anchor them at the reps the rule's load is actually for. Add tests for hold-after-miss and increase on an 8–12 isolation: the working load equals the rule's load, and `Why?` reads `Last time` / `Last time + 2.5`.

### B4. Builder loads skip every check at Start, so a pain flag raised after the build isn't held (rule 9)
`packages/domain/src/session/coach-draft.ts:812-845` (`builderSlots` skip `recheckDraftSlot` and pin `targetLoad`), and `builder-service.ts:909` (no check-in passed).
- **Failure:** Ben builds Chest (bench 102.5) and leaves. Later he reports shoulder pain (the pain sheet, the coach, or the `Still hurts?` line), or he taps `Edits from Mon 19 Oct · Use` days later. Start uses 102.5 as built. The row shows `May hurt` because `facts.mayHurt` is read live, but the load isn't held. §2.3 "Pain check-in after loads were set" requires the load to be recalculated and held. Pinning also ignores history logged since the draft was built (an earlier-date draft carries stale loads).
- **Fix:** at Start, keep the builder's loads only if the draft's load inputs are unchanged. Store a hash of the active pain flags and the newest relevant session IDs on the version, or re-run `painFlagCovering`. For any pain-flagged slot, cap at `painCap` (the last comparable working load) inside the Start transaction, typed kg included (it keeps `May hurt`). Re-derive, or refuse with `Out of date`, when history moved. Test: build, add a pain flag, Start, and the load is ≤ the last comparable load.

### B5. Coach review shows `● Coach` when no review is coming (rule 1, an explicit scope requirement)
`apps/mobile/src/screens/builder/BuilderWorkoutScreen.tsx:164-172` and `apps/mobile/src/builder/review.ts:79`, `:93-95`.
- **Failure:** the coach is connected but no provider is registered (as on this branch, until the coach stream merges), or `provider.review` throws (caught to null). Either way the status stays `pending`, the header reads `● Coach`, and the sheet never shows a verdict or an error. That suggests a live coach review that will never arrive. The scope says to show an honest unavailable state when there is no provider. The test only covers `not_connected` and `offline`.
- **Fix:** with no provider, use the status `not_connected` (or a distinct `unavailable` → `Not reviewed`). When `review()` fails, show `Not reviewed` (shortest word, with the reason behind `Why?`). Render `pending` as a neutral `Reviewing…` only while a call is actually in flight. Add a test for `ok` with no provider, and for a provider that rejects.

### B6. VoiceOver can't reach the Reps / Kg / RPE cells in the exercise pop-up (S4a: "every edit is possible with the pop-up and VoiceOver only")
`apps/mobile/src/screens/builder/BuilderSheets.tsx:171-200` wraps the cells in `SwipeRow`, whose `Pressable` (`BuilderParts.tsx:223-237`) is an accessible element with its own label. On iOS that hides its descendants, the `TextField`s included.
- **Failure:** with VoiceOver on, a set row is one element offering `Delete set` and `Change type`. Ben can't focus or edit reps, kg or RPE, and so can't use the keyboard bar either.
- **Fix:** don't make the swipe container an accessible element for set rows (`accessible={false}` on the inner Pressable, with the actions moved to the `#`/Type cell). Or add adjustable actions per field (`Reps`, `Kg`, `RPE`, with increment and decrement through the same service steps). Add a source or render test that the cells stay reachable.

### B7. `‹ Set up` and `Next: exercises` push new modal screens each round trip, and `Close` lands on stale pages
`BuilderWorkoutScreen.tsx:279` (`navigate('BuilderSetup', { draftId })`) and `BuilderSetupScreen.tsx:96` (`navigate('BuilderWorkout', …)`). In React Navigation 7.5, `navigate` to a route that isn't the current one **pushes** (see `StackRouter` NAVIGATE: it reuses only the current route unless `pop: true`). There is no `getId`.
- **Failure:** Set up → Your workout → ‹ Set up → Next leaves four full-screen modals on the stack. `Close` on Your workout goes back to the old Set up instance. That instance holds stale `setup` and `draftVersion`, so its Next returns `Out of date. Reload.` with no way to reload. The first Set up (no `draftId`) calls `create()` with a new op ID, finds the open draft and runs `changeSetup` with its old rows. That merges or rebuilds over Ben's later choices (for example, back to bench after he chose incline). Ben also has to tap Close N times to leave the builder.
- **Fix:** use `navigation.popTo('BuilderSetup', { draftId })` or `navigate(..., { pop: true })` for `‹ Set up`, and `popTo('BuilderWorkout', …)` or `replace` for Next. Have `Close` leave the builder entirely (pop both pages, `StackActions.popToTop` within the modal group, or `getParent()?.goBack()`). Re-read the draft on focus in Set up (`useFocusEffect`, as Your workout does). Add a navigation test, or at least a source check for `popTo`/`pop: true`.

---

## Should fix (not blocking on their own; most are rule 5 or honesty gaps)

### S1. Undo of `… updated` reports failure when retried with the same op ID (rule 5 idempotency)
`builder-service.ts:932-935` checks `r.version !== u.version` before `r.lastOpId === opId`. **Reproduced:** the first `undoPlanChange(t, 'undo-1')` returns `{ ok: true }`, and a retry with `'undo-1'` returns `Changed since · can't undo`. **Fix:** check `lastOpId === opId` first, as the variation branch at `:942` already does. Test the retry.

### S2. Save as new variation, and updating an open variation, don't check the version Ben opened (rule 5)
`builder-service.ts:886-901`. The variation's extras are diffed against the **current** template, and `expectedVersion: open.version` is read at Start. If the template changed after the draft opened (say, an exercise was added), the new variation stores a `remove_slot` for it. An update to an open variation overwrites a change made elsewhere. `basedOn.version` records the new version, not the one Ben's edits were based on. **Fix:** refuse `variation` and `update` choices when `template.version !== stored.templateVersion` (`Your plan changed. Today only?`). Store `variationVersion` on `BuilderSetup` at open time and use it as `expectedVersion`. Add both cases to the stale test.

### S3. A variation silently drops part of the change it was saved from
`packages/domain/src/builder/scope.ts:171-199`. Template pairs Ben split, pure reorders, and deleting the main lift (`:177 !s.main`) are listed on the Start prompt but aren't stored, while `canSaveVariation` is still true. Ben saves `arms superset` and the next open is missing part of what he saw. **Fix:** set `canSaveVariation: false` (or show `Not saved: order`) when `builderChanges` includes `order`, `unpair` or a main-lift delete that `variationExtrasOf` can't represent. Or raise the spec issue below and add `move`/`unpair` ops.

### S4. Ben's own quick successive taps go stale against themselves
`BuilderWorkoutScreen.tsx:92-97` (the slot basis comes from the last `snap`) and `BuilderSheets.tsx:217` (rest stepper `x.seconds + d*15` from the same snapshot). Two fast `+` taps on a rest row, or `+ Set` twice, send the same `rev`. The second returns `Out of date. Reload.` and is lost. The same race applies to fast `Next` between cells. **Fix:** serialise edits per draft in the screen (a queue, or disable controls while a write is in flight), or send relative ops (`rest +15`) on a version basis that is re-decided inside `writeDraft`. Rule 5 is for other writers, not Ben's own sequence.

### S5. Length "hold repeats" doesn't accumulate
`apps/mobile/src/screens/builder/BuilderParts.tsx:75-81`. The interval keeps the `onStep` closure from the long-press render, which calls `stepMinutes(setup, d)` with the stale `setup`. Holding `+` from 60 sticks at 61. **Fix:** keep `onStep` in a ref updated each render, or step from the functional `setSetup` state.

### S6. Typed kg rounding and its reason are never shown (§2.4, rule 4; S4a "a typed 101 kg becomes 100 with Why?")
`builder-service.ts:696-700` drops `r.rounded` from `applyBuilderEdit`, and `whyWeight` (`:788-817`) has no `Rounded down: 1.25 kg plates` line. **Fix:** carry `rounded` into the toast or cell note, and add the rounded-down line (naming the item) to `whyWeight` whenever any row's load was moved by the gym.

### S7. The session loses the load's reason: every builder load becomes a `Plan` target
`coach-draft.ts:838-845` pins `targetLoad` on a routine, so `create.ts:328-331` writes `planTargetProvenance` (source `plan`, routineName = draft name) for coach-target, rule, est.-max and typed loads alike. During the workout and on Summary, an est.-max load isn't labelled an estimate (rule 6), and a rule load isn't the labelled fallback (rule 3, ADR 0006). Summary logic that keys on `built_in_rule` sees none. **Fix:** map each builder slot's `builder.source` (and `ben` rows) to the matching `TargetProvenance` (`coach`, `rule` with basis, estimate flag) when pinning.

### S8. `Update … in your plan` discards Ben's rest edits
`builder-service.ts:972` (`restBySetType: was?.restBySetType ?? {}`). Rest edits don't prompt (fine under Q11), but when Ben does update the plan day, his rest changes aren't carried even though the structure is. `planDay.minutes` is also never updated. **Fix:** carry the draft's per-type rests (or none, deliberately, with a comment that cites the spec), and update `planDay.minutes` to the set-up's minutes.

### S9. The Summary Undo token lives only in memory
`PlanChangeUndo` is returned by `start()` and nothing persists it. After a force-close between Start and Summary, `Chest · bench updated · Undo` can't be offered. That contradicts the first-milestone durability rule. **Fix:** store the inverse (`{ targetId, expectedVersion, restore }`) on the session (or the draft) in the Start transaction, so Summary can read it after a relaunch.

### S10. Missing states that change what starts (developer declared them, listed for tracking)
- No check-in at Start (`builder-service.ts:909`, `checkIn: null`). Q1 moves the check-in onto Your workout, so today Edit → Start skips it. Wire it before Today points `Edit` here.
- Gym changed: Start uses the draft's `v.request.gymId` (`:862`), not the current gym, with no `Gym changed · Undo`.
- `Plan day changed elsewhere · Reload`, `Not applied … · Add anyway` (the line shows, but there's no action), and variation Rename / Delete.

### S11. Collisions with the parallel streams
- `coach-draft.ts:812` decides "loads stand, no second fit" by `request.origin === 'builder'`. When the coach stream applies `propose_workout_edit` to a builder draft as a new version, it must keep `origin: 'builder'` and set builder loads through the same codec. Otherwise Start refits and re-plans the whole workout. Agree on this before merging.
- `BuilderSetupSchema.restLevel` (§2.0.2 3a) and `DraftSlotBuilderSchema` are shared shapes the Today stream needs for the card's Time control. Make sure Today doesn't add a second `restLevel`.
- The `SessionRepository.save(…, alongside)` signature changed in `ports.ts`. Any other stream's repository double or fake must be updated.
- The time constants aren't shared with Today or time left (Q15, approved). Today's `~N min` and the builder's `about N min` can disagree for the same draft.

---

## Nits

- N1 `builder-service.ts:501`: `nothing_to_undo` shows `Changed since · can't undo`. That's the wrong reason when the toast's op isn't the stored one.
- N2 `BUILDER_COPY.outOfDate = 'Out of date. Reload.'`, but there's nothing to tap: the snapshot is already reloaded. Use `Out of date`.
- N3 `BuilderParts.tsx:165`: the `PanResponder` is created once and captures the first render's `leftAction`/`rightAction`. A set row that becomes deletable after `+ Set` won't reveal `Delete` on swipe.
- N4 Swap rebuilds set types with `makeSlot` (`edit.ts:104`). Ben's Top set / Back-off changes on the old exercise are lost, but §2.5 says "keeps … set types".
- N5 Review notes use `☑/☐` glyphs in the title with `selected={false}`, so VoiceOver reads the glyph names. Use `accessibilityRole="checkbox"` with `accessibilityState.checked`. Suggestions lack `Skip`.
- N6 VoiceOver labels on cells read `W reps` / `1 reps`. Prefer `Warm-up 1, reps` / `Set 1, reps`.
- N7 The rest stepper's `canMinus={x.seconds > 0}` lets `−` fire at the 0:30 floor (a no-op write that bumps the version and clears Undo).
- N8 The Set up coach bar opens the coach with `entry: { kind: 'today' }`. Once wired, the coach won't know about this draft. Placeholder is acceptable; note it for S6.
- N9 `add_drop` counts toward `workingCount`, so a drop prompts `3 → 4 sets`, and a variation stores `set_count 4` (4 working sets, no drop).

## Rule compliance summary

| Rule | Status |
|---|---|
| 1 Offline logging, honest AI status | Offline Start → first set: tested, passes. **B5** for review status |
| 2 Completed sets / proposals with Undo | Builder is pre-Start. **B2** silently changes the plan-day workout. Start prompt scope choice is present |
| 3 Deterministic targets | **B3** (rule target inflated), **S7** (reason lost at Start) |
| 4 Achievable loads | Start still snaps through `snapPlanToGym`. Typed kg bounded (tested). **S6** for the visible reason |
| 5 Idempotent, versioned | Op IDs and slot revisions are good. **B1**, **S1**, **S2**, **S4** |
| 6 No invented data | Est. max only behind `Why?` with `(estimate)`. **S7** loses the label in-session |
| 7 Credentials | No changes, no secrets in the diff |
| 8 Imported content as data | Not touched |
| 9 Pain stops progression | Build-time `painCap` is fine. **B4** at Start |
| 10 Your data vs Coaching knowledge | Variations, drafts and notes are owner-scoped. Catalogue read separately |
| Minimal copy | Good. Banned-string test passes. N2 |

## Tests: gaps

Tests are needed for B1–B7, S1–S5: a day or main-lift change then Start; Set up visited from a template; a rule target on an 8–12 range (hold and increase); a pain flag after the build; review with a connected coach and no provider; pop-up cells reachable by VoiceOver; navigation round trip and Close; Undo retry; variation save after a template change; two quick edits on one slot; stepper hold. The screen tests are view-model and source-grep only, with nothing rendered. That's acceptable here, but B6 and B7 slipped through because of it.

---

## Spec issues (for Ben / designer, not code defects)

1. **§2.8 / Q11 only settles load.** Which other edits prompt `Use these changes for` (reps, RPE, rest, warm-ups, drop sets) isn't decided. The developer chose structure only, and drops count as sets (N9). Needs Ben's answer.
2. **§4.3 `VariationOp` can't express order or split pairs**, yet §2.8 offers `Save as new variation` for any change and §2.3 makes reordering a first-class edit. Either add `move { exerciseId, after }` and `unpair { exerciseId }` ops, or state that such changes are today-only and the prompt says so (S3).
3. **§2.8 "changed since it was opened" for variations** needs `variationVersion` on `BuilderSetup` (§4.4 lists only `templateVersion`). Schema addition needed (S2).
4. **§3.5 "heavy"**: the prototype list includes Bulgarian split squat, but the fallback (barbell or plate-loaded compound) excludes the dumbbell version. Until the catalogue `heavy` flag (§4.7) exists, abs can pair with DB Bulgarian split squats. Decide the fallback or prioritise the flag.
5. **§3.1 step 3 "the built-in rule's target"** doesn't say which reps the rule's load is for when the builder derives other sets by formula. State that the rule's load is used as is at its rep floor (B3).
6. **§2.8 Summary Undo durability**: §4.6 describes the inverse write but not where it is stored. With the first-milestone force-close rule, it should be persisted with the session (S9).
