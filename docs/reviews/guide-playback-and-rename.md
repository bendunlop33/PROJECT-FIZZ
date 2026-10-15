# Review: in-app guide playback (ADR 0013) and the GymSmarter rename

**Verdict: PASS.** There are no blockers. Three should-fix items (S1–S3) should land before or with the next `[ios-build]`. Neither slice has run on an iPhone yet, so device tests G1–G10 and the morning checklist are still the real gate.

Reviewed on branch `claude/gracious-knuth-joxqpw`:
- Guide playback: `ff26fb5..cca23ce` (6 commits).
- Rename: `d51c7f0..efdd413` plus `df52446`.
- Two commits landed while I was reviewing: `87f253d` (an agent doc) and `bb1942b` (the designer's How to spec, exercise-library.md §8 and design-system §9.57). They are outside the reviewed range. I used `bb1942b` only for spec conformance.

## Checks run

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, vitest, `catalogue:validate`, `guide:check --all --verify`) | Pass. 75 files and 939 tests. 133 catalogue files valid. 10/10 guides pass |
| `npx expo prebuild --platform ios --no-install --clean` in a scratch copy (`git archive HEAD`, node_modules symlinked; deleted afterwards) | OK. Expo warns `CFBundleDisplayName is set… Ignoring abstract property "name": Fizz`. That is expected and harmless |
| `node scripts/check-entitlements.ts --prebuild apps/mobile/ios` (on the scratch prebuild) | `Entitlement check: OK (no forbidden keys)` |
| Generated project | Info.plist has `CFBundleDisplayName = GymSmarter`, `CFBundleName = $(PRODUCT_NAME)`, and the three permission texts start with "GymSmarter". `PRODUCT_NAME = "Fizz"`. Bundle IDs are `com.projectfizz.fizz` and `com.projectfizz.fizz.ExpoWidgetsTarget`. Both `.entitlements` files hold only `group.com.projectfizz.fizz`. The workspace is still `Fizz.xcworkspace` |
| Node imports reachable from the app | None. `packages/catalogue/src/**` imports only `@fizz/schemas`, `@fizz/domain`, `zod` and relative files. No `node:*`, `fs`, `path`, `Buffer`, `process` or `import.meta` |
| Skia binaries in CI | They come from regular npm dependencies (`react-native-skia-apple-ios`/`-android`/`-macos`/`-tvos` 147.1.0, `canvaskit-wasm`). `scripts/install-libs.js` copies them into `libs/` with no network access. So `setup-node` `cache: npm` caches them, and nothing downloads at postinstall. No `--ignore-scripts` anywhere (workflow, `.npmrc`) |

---

## Slice 1: in-app guide playback

### Blockers

None.

### Should fix

**S1. Skia and Reanimated are on the launch path for the whole app, with nothing to contain a failure.**
`apps/mobile/src/navigation/AppNavigator.tsx:30` imports `HowToScreen` statically. That pulls in `GuidePlayer.tsx` → `bake.ts`, and `bake.ts:17` runs `Skia.XYWHRect(...)` at module scope. The app has no error boundary at all (no `componentDidCatch` or `getDerivedStateFromError` anywhere in `apps/mobile/src`).
- *Failure path:* on the first SideStore build, Skia's JSI isn't installed, or a picture or path call throws inside a bake slice (`GuidePlayer.tsx:44–59` runs tasks from `setTimeout`). In the first case, module evaluation throws at launch and the app never opens: no Today, no workout, no restore, no force-close recovery. In the second, an uncaught JS error in a release build is fatal and closes the app mid-workout. The data survives in SQLite, but Ben loses the screen during rest.
- ADR 0013 says "a broken guide… never crashes". That holds only for schema failures (`guide-library.ts:75–81`). Rule 1 needs logging to keep working when an optional feature fails.
- The static import also adds Skia's and the catalogue's module evaluation to every cold start. Cold start is the force-close recovery path (morning checklist 1.1: "under a couple of seconds").
- *Fix:*
  1. Load How to lazily (`RootStack.Screen getComponent={() => require('../screens/workout/HowToScreen').HowToScreen}`).
  2. Move `UNIT` inside `recordOps`.
  3. Wrap `GuidePlayer` in an error boundary that falls back to the cues plus a `StatusLine` ("The animated guide couldn't be shown. The cues below still apply.").
  4. Wrap each bake task in try/catch so the run is reported as failed.
  5. Reanimated's native init can't be deferred. This change only isolates Skia and the guide code.

**S2. The sled push guide can't be opened in the app, but the device test and spec say all ten can.**
The picker lists only the starter exercises in the database (`ExercisePickerScreen.tsx` header comment, `pickerExercises`). `sled-push` isn't a starter key (`packages/domain/src/starter-exercises.ts`). Its catalogue entry is `measurement: "distance"`, which `toExerciseRow` refuses ("no row until sets can record a distance", `loader.ts`). So no workout row has `catalogueExerciseId('sled-push')`, and neither the `ⓘ` button nor `⋯ › How to` can reach it.
- *Failure path:* `docs/device-tests/guide-playback.md:8` tells Ben "Ten exercises have guides… sled push", and G5 asks him to note any guide that's hard to read. He searches the picker for sled push, finds nothing, and either marks G1/G9 wrong or loses time.
- *Fix:* say "nine are reachable in the app; review sled push from its `preview.png`" in the device test (and in exercise-library §8.2). Or add a temporary entry point, but that's a product call.

**S3. An action-sheet index change next to destructive actions has no test.**
`WorkoutScreen.tsx:353–363` shifts every `⋯` index by one when `How to` is present (`destructiveButtonIndex: [2 + shift, 3 + shift]`, `cancelButtonIndex: 4 + shift`, `i = picked - shift`). The mapping is correct today. But it lives inline in the screen, next to `Delete this set` and `Skip exercise`, with no test.
- *Failure path:* a later edit adds a menu item or changes the shift. Then a tap on `Add set` runs `Delete this set`, or the red styling lands on the wrong row. Nothing catches it.
- *Fix:* extract a pure `exerciseMenuOptions(hasHowTo)` that returns `{ options, destructive, cancel, actionAt(index) }`, and unit-test both shapes.

### Nits

- **N1. Bake throughput on Hermes (risk for G2 and G7).**
  - Slices yield with `setTimeout(fn, 0)` (`GuidePlayer.tsx:49–53`). In RN that waits for the next timer flush, roughly a frame, so each 8 ms slice costs about 16 ms of wall time. The animation can't start until every frame is baked (`frames = anim?.done ? … : null`, `GuidePlayer.tsx:117`). For 75–90 frames the poster may hold for several hundred ms.
  - In the still view (Reduce Motion), `firstSync` is 0 and the bake samples about 85 overlay points before the first picture. The canvas stays empty until the whole still bake is done (`GuidePlayer.tsx:47, 157`).
  - *Fix:* let the clock run as soon as the frames it needs exist, or start with the baked prefix. In steps mode, draw key position 1 synchronously before the trace samples (bake it once without the trace, then redraw).
- **N2. `GuidePlayer.tsx:60` counts the wrong thing.** It compares `out.length` (pictures) with `tasks.length` (overlay samples plus pictures). If a bake ever finishes synchronously while overlay tasks exist, this line overwrites the `done: true` that `onDone` just set with `done: false`, and the animation never starts. It can't happen today: `playbackTimes` returns at least 2 frames and `firstSync = firstFrame + 1`. Compare against `tasks.length - firstFrame`, or skip the line when `onDone` has already run.
- **N3. Picker `ⓘ` isn't disabled while an add is in flight (`ExercisePickerScreen.tsx:148`).**
  - *Failure path:* tap a row (`add()` awaiting), then tap `ⓘ` on another row. How to opens. Then `add()` resolves and calls `navigation.goBack()` from the picker route, which pops the picker and How to together. How to vanishes under Ben's finger. No data is harmed (the opId makes the add idempotent).
  - *Fix:* `disabled={busy}`.
- **N4. Reduce Motion with no labelled key frames autoplays (`player-model.ts:35`).** `guide:check` prevents this for bundled guides, but `GuideSchema` allows it at runtime. This is spec P6. Start in a paused still state instead.
- **N5. The canvas label always says "Animated guide for…" (`how-to.ts:100`), even for the still view under Reduce Motion.** This is spec P4.
- **N6. Previous/Next aren't announced to VoiceOver.** After `Next`, focus stays on the button and the new `2 of 3 · Bottom` and caption aren't read (`GuidePlayer.tsx:177–188`). Call `AccessibilityInfo.announceForAccessibility` on step change. G8 should cover it.
- **N7. Misleading notice when the entry is invalid but the guide is fine (`how-to.ts:109`).** It shows "Couldn't read the how-to for X" above a working guide. This is spec P7.
- **N8. Nothing enforces that `packages/catalogue/src` (and `domain`/`schemas`) stays free of Node imports.** Today that's a manual Hermes export noted in the ADR. Add an ESLint `no-restricted-imports` rule for `node:*`, `fs`, `path` and `crypto` on those `src/` trees, so a future `figure/*.ts` change can't break the app bundle silently.
- **N9. The accent test doesn't cover Increase Contrast.** `guide-playback.test.ts:230` calls `resolveTheme(direction, scheme)` without the a11y prefs. Add the `increaseContrast: true` variants.
- **N10. Pictures are never disposed.** Evicted LRU bakes (`bake.ts:117–125`) and cancelled partial bakes (`GuidePlayer.tsx:61`) rely on GC of the host objects. That's small at about 90 pictures per bake. Optionally call `dispose()` on eviction and cancel.
- **N11. CI cost.** `npm ci` now extracts about 1.45 GB in both jobs (the four Skia binary packages, plus a 713 MB copy into `@shopify/react-native-skia/libs`). The Linux `check` job has a 15-minute timeout and now also runs prebuild. It's fine for now, but watch the first run.
  - Add a one-line comment above both `- run: npm ci` lines saying scripts must stay enabled (Skia's podspec needs `libs/`). Today that rule is only in ADR 0013.
  - Optionally add `test -d node_modules/@shopify/react-native-skia/libs/ios` in the Linux job, so a broken postinstall fails in 2 minutes instead of at `pod install` on macOS.

### Verified OK

- **Worklets.**
  - `tick` is a `'worklet'` and calls only the worklets `advanceClock`, `frameIndexAt` and `passMs`.
  - Its only JS hop is `scheduleOnRN(onFinished)`, once per autoplay end. There's no React render per frame: `useDerivedValue` swaps a pre-baked `SkPicture`, and the rig maths never runs on the UI thread.
  - `useFrameCallback(tick, false)` re-registers when `count` changes and keeps its active state (checked against `react-native-reanimated/src/hook/useFrameCallback.ts`).
  - On unmount it unregisters the callback, cancels the bake timer (`run.cancel`) and removes the AppState listener.
  - The reset effect for Replay and Play animation (`GuidePlayer.tsx:147–152`) is queued to the UI thread after `setActive`, so ordering is safe.
- **Pausing.** The clock stops on blur (`useIsFocused`), when scrolled past the player (`HowToScreen.tsx:285–296`), on AppState other than `active` (including `inactive`), when paused, when finished and in steps mode (`isRunning`). Nothing runs during rest unless How to is open, visible and in the foreground.
- **Rest loop.** How to is a root-stack `modal` above the `fullScreenModal` Workout, which stays mounted. Its deadline-based countdown and the `tick` dispatch keep running. `setWorkoutOnScreen(false)` on blur means the rest-end notification shows as a banner over How to, and the in-app haptic still fires.
- **Navigation.** How to doesn't navigate anywhere else, so there's no second `Tabs` and no `popToToday` from it. Force-close with How to open relaunches into the workout via `initialRootState` (How to keeps no state). Draft edits survive the round trip (`WorkoutScreen.tsx:211–213`).
- **Reduce Motion.** It opens on the key positions. Turning it on mid-play switches at once. Turning it off starts nothing. `Play animation` opts in. All tested.
- **VoiceOver, Draft label, colours.** The canvas is one accessible image with a fixed label. `Draft guide` shows unless `review.status === 'approved'` (tested: all 10 are drafts). Art colours are the six neutral aliases from the live theme, in both looks and both schemes (tested). The `Tag` is `bg.raised`/`text.secondary`, and the art has no text.
- **CLAUDE.md rules.** Rule 1: everything is bundled, with no fetch or network. Rule 6: no invented data. How to only reads static catalogue text. Rule 10: How to reads and writes no Your data, and the guides and catalogue stay in `@fizz/catalogue` as Coaching knowledge. No `console.*` in the new code.
- **Honest messages.** Missing, unreadable and no-how-to cases each show a `StatusLine`, never a blank screen. Tested.
- **Shared drawing.** `frameOps` is shared by `svg.ts` and `bake.ts`. Stale generated cameras fail `catalogue:validate`.
- **CI build job.** `scripts/ci/check-patched-binaries.sh` and the expo-widgets patch are unaffected (Skia adds no markers and no change to `CFBundleExecutable`). The Pods cache key already includes `package-lock.json`.

---

## Slice 2: rename to GymSmarter

### Blockers

None.

### Should fix

None.

### Nits

- **R1. A second, unchecked copy of the name.** `apps/mobile/src/device/runtime.ts:56` hard-codes `name: 'GymSmarter'` instead of using `DISPLAY_NAME`. It's provenance only, written into backup headers. But it can drift on the next rename, and no test ties it to `app-identity.mts`. Add an assertion in `app-identity.test.ts`, or import the constant (if `.mts` is awkward for Metro, re-export it from a plain `.ts`).
- **R2. ChatGPT Settings may still say "Fizz".** `agent_name_hint` is sent only on a new registration (`packages/providers/src/openai/authorize.ts:78`). If Ben registered during an earlier sign-in test, ChatGPT Settings still lists "Fizz". Meanwhile `sign-in-test.ts:384, 386, 557` tell him to "disconnect GymSmarter in ChatGPT Settings". Say "GymSmarter (or Fizz, if you connected before the rename)" until he has re-registered.
- **R3. Backup file names Ben sees still say "fizz".** Backup files are still `fizz-backup-…json` (`apps/mobile/src/backup/manifest.ts:101–111`, `packages/persistence/src/backup/backup.ts:177`). That's correct to keep, but Ben sees those names in Files and in the restore picker. Only the CHANGELOG mentions it. Add one line to `docs/guides/building-the-ipa.md` or the SideStore guide.
- **R4. The `.ipa` naming step can fail with no explanation, and doesn't sanitise the name.** `.github/workflows/ios-ipa.yml:215`: if the key is missing, `plutil` exits 1 and the step's default `bash -e` stops the build. That's the intended failure, but it shows only plutil's stderr. Use `|| { echo "::error::CFBundleDisplayName missing from $APP/Info.plist"; exit 1; }`. The display name also flows unsanitised into the file and artifact name. A future name containing `/`, `:` or `"` would break `upload-artifact`. Run `tr -cd 'A-Za-z0-9._-'` on it for the file name.

### Verified OK

- **Only the name Ben sees changed:**
  - `CFBundleDisplayName`;
  - the three permission texts;
  - `AGENT_NAME`;
  - in-app copy;
  - Swift loopback page text and the background-task name;
  - docs.
- **Unchanged:**
  - Identifiers: bundle ID `com.projectfizz.fizz`, widget ID, App Group `group.com.projectfizz.fizz`, Expo `slug: 'fizz'`, Expo `name` / `IOS_PROJECT_NAME = 'Fizz'` (so the Xcode project, workspace, scheme, `.app`, `CFBundleExecutable` and `CFBundleName` stay `Fizz`).
  - Workflow `IOS_PROJECT: Fizz`.
  - Data and format names: `BACKUP_FORMAT = 'fizz-backup'`, file prefix, database file names. No keychain service or account strings were touched.
  - Tests pin `config.name`, `CFBundleDisplayName`, the slug, the permission prefixes and the workflow lines.
- **Old backups still restore.** The backup header's `app.name` is free text (`AppInfoSchema`) and isn't used for recognition. A "Fizz"-named backup stays restorable (`expo-driver.test.ts:173`).
- **The `plutil` step.** `$APP/Info.plist` is the right path, because an iOS `.app` bundle is flat. `plutil -extract <key> raw` works on macOS 12+ and the same step already uses it for `CFBundleShortVersionString` and `CFBundleIdentifier`. It reads binary plists. Under GitHub's default `bash -e`, a failed command substitution in a plain assignment ends the step.
- **CLAUDE.md edit (`df52446`).** It adds the name and "never rename internal identifiers". The approval is recorded in `docs/brief/CHANGELOG.md` (2026-10-09) and `provisional-2026-10-09.md`. *Process note:* the PM should confirm Ben approved this CLAUDE.md wording itself, not only the name. An agent's commit can't be that approval.

---

## Spec issues

- **CLAUDE.md "Stack" is out of date.** It doesn't list `@shopify/react-native-skia` 2.6.2, `react-native-reanimated` 4.5.1 and `react-native-worklets` 0.10.1 (research brief change 5). ADR 0013 records the decision, but CLAUDE.md is the shared context every agent reads first. Needs Ben's approval to edit.
- **Brief §157** still says "defer… large exercise-media libraries". Research brief change 1 and exercise-library EL8 (now replaced) both say it needs the matching wording. It's unapproved in the brief CHANGELOG.
- **Unbuilt spec proposals.** exercise-library §8.9 (committed in `bb1942b`, after the reviewed range) proposes P1–P7, and none is built. P4, P6 and P7 match N5, N4 and N7 above. **P5** is a product gap rather than a code bug: rich-entry cues are shown with no `Draft` label, even though Ben hasn't approved them (`review.status` on the entry). The ADR's "Draft until Ben approves" covers guides only.
- **Device test vs. reality.** `guide-playback.md:8` and exercise-library §8.2 imply all ten guides can be reached. Sled push can't (S2), because the picker only lists the starter list and distance exercises have no row.
