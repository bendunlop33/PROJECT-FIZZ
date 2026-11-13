# 0037: Rules-of-Hooks lint and screen render smoke tests in `npm test`

**Status:** ACCEPTED (developer, 28 Oct 2026, after the 27 Oct crash on Start). Renumber on merge if another branch
took 0037.

## Context

On 27 Oct the app closed on every workout Start: `WorkoutScreen` called a `useEffect` below its loading/empty early
returns, so the loading render and the loaded render called a different number of hooks ("Rendered more hooks than
during the previous render"). More than 10,000 tests passed, because no test rendered a screen (they test services,
view models and source text) and ESLint had no React hooks rule. The fix added a TypeScript source scan
(`apps/mobile/test/rules-of-hooks.test.ts`), which catches this one shape but not the wider class (a hook in a
condition or loop, a render that throws for any other reason on its second pass).

## Decision

1. **Lint:** `eslint-plugin-react-hooks` 7.1.1 (exact pin; ESLint 10 flat config; React 19) for every `.tsx` file and
   `apps/mobile/**/*.ts`, with only the two classic rules:
   - `react-hooks/rules-of-hooks`: **error**. It found one false positive and no real violation: a plain async
     function named `useLayout` in `ImportLayoutCheckScreen` (renamed `confirmLayout`).
   - `react-hooks/exhaustive-deps`: **off**. It reports 46 findings in 23 files. Almost all are deliberate "run on
     this trigger" effects (`once per mount`, `when the toast key changes`); adding the missing deps would change
     when effects run, and without interaction tests per screen that risks loops or repeated writes. 46 standing
     warnings in every lint run would teach everyone to ignore lint output. A follow-up slice can triage them file
     by file and turn the rule on at `warn` once the count is near zero.
   - The plugin's `recommended` preset is not used: its other rules (purity, refs, set-state-in-effect, …) are React
     Compiler rules, and the app doesn't use the compiler.
2. **Render smoke tests** (`apps/mobile/test/render/*.test.tsx`), part of `npm test` as a second Vitest project
   (`render`) beside `unit` in `vitest.config.ts`, so CI's `npm run check` runs them:
   - Renderer: **`test-renderer` 1.2.0** (exact pin), the maintained replacement for the deprecated
     `react-test-renderer` (it is what React Native Testing Library 14 renders with). It runs React's own reconciler
     (`react-reconciler` 0.33, the React 19.2 line) on a concurrent root, as the app's New Architecture root is.
     `react-test-renderer` 19.2.3 also worked but is deprecated (and fails `@typescript-eslint/no-deprecated`);
     `@testing-library/react-native` 14 needs Jest as a peer and this repo tests with Vitest.
   - Native packages are replaced by small JS stand-ins in `apps/mobile/test/render/stubs/` (`react-native`,
     React Navigation, safe areas, every Expo module the app imports, Skia, Reanimated, Worklets, `@expo/ui`), mapped
     in `setup.ts`. Components render as host elements named after the RN component; APIs are inert (no permission
     granted, no notification scheduled, no network). As on iOS, a string outside `<Text>` throws.
   - Each screen is rendered with the real services from the test harness (real SQLite via node:sqlite, the same
     startup as the phone), seeded through those services with two weeks of history and a builder plan. The first
     frame (mounted, effects run, before any local read) and the loaded frame are both read; the test fails on a
     render error, on a React warning logged to `console.error`, or if the loaded frame never shows.
   - Covered: Today (plan day, Set days rest day, done for today), Your workout (from Today's Edit), the active
     Workout (empty workout, plan day), Summary, Progress (Lifts with its Skia trend canvas, Training month, Body),
     Library › Plan, Profile.

## Consequences

- Reintroducing the 27 Oct bug fails both `npm run lint` (`rules-of-hooks`) and `npm test` (`Rendered more hooks
  than during the previous render` in both Workout render tests), as well as the existing source scan.
- `test-renderer` follows React minors: when Expo moves React to 19.3, move it to the 1.3.x line (which needs
  `react-reconciler` 0.34).
- The stand-ins can drift from the real modules. A screen importing a new native export fails loudly ("No export is
  defined on the mock"), which is the intended prompt to add it.
- Not covered by these tests, and still only checked on the phone: layout (there is no layout engine; every
  `onLayout` gets a 393 pt frame once), gestures, animation, the navigators and `Root` themselves (screens are
  rendered one at a time with a recording navigation object), native modules' behaviour, and lazily `require`d
  modules other than Progress's chart canvas (How to's guide player, the weekly review's Lifts canvas), which Vitest's
  ESM runner can't `require`; there they take their guarded fallback, as on a build where Skia fails to load.
- The render project adds about 30 s to `npm test` on this machine (10 tests over real SQLite).
