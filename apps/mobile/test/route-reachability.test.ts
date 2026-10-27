import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every registered route is reachable (app review 26 Oct, findings 3 and 15).
 *
 * The Past workouts list stayed registered for four days after its only entry
 * was removed, and its own flow test kept passing. This test reads every
 * `<…Stack.Screen name="X">` in the navigator and fails unless some source
 * file outside the navigator's registrations sends Ben there: a
 * `navigate('X')` / `push('X')` / `replace('X')`, a nested `screen: 'X'`, an
 * action object's `name: 'X'`, or one of the action helpers (`builderPage('X')`).
 */

const SRC = join(import.meta.dirname, '../src');
const NAVIGATOR = join(SRC, 'navigation/AppNavigator.tsx');
const TYPES = join(SRC, 'navigation/types.ts');

/**
 * Routes Ben never navigates to by name, each with its reason. Keep this short:
 * a new entry needs a reason a reviewer would accept.
 */
const NOT_NAVIGATED: Record<string, string> = {
  Setup: 'first-run stack, the initial route before setup',
  Tabs: 'the root after setup (initial state); left only by popTo',
  LibraryHome: 'the Library tab’s first screen',
  ProgressHome: 'the Progress tab’s first screen',
  ProfileHome: 'the Profile tab’s first screen',
  // Owned by the Progress agent's one-exercise-screen work (review 26 Oct, finding 4); remove with that change.
  ProgressExercise: 'Progress stack’s Exercise detail: finding 4 (one exercise-progress screen) decides its fate',
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

export function registeredRoutes(navigatorSource: string): string[] {
  const names = new Set<string>();
  for (const m of navigatorSource.matchAll(/<\w+\.Screen\s+name="([A-Za-z]+)"/g)) names.add(m[1] ?? '');
  return [...names].filter((n) => n !== '').sort();
}

export function navigationTargets(source: string): Set<string> {
  const found = new Set<string>();
  const patterns = [
    /\b(?:navigate|push|replace|popTo|builderPage)\(\s*['"]([A-Z][A-Za-z]+)['"]/g,
    /\b(?:screen|name):\s*['"]([A-Z][A-Za-z]+)['"]/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) found.add(m[1] ?? '');
  return found;
}

describe('route reachability (review 26 Oct, findings 3 and 15)', () => {
  const navigator = readFileSync(NAVIGATOR, 'utf8');
  const routes = registeredRoutes(navigator);
  const targets = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    if (file === TYPES) continue;
    let text = readFileSync(file, 'utf8');
    // The navigator's own `<Stack.Screen name="X">` registrations don't count; its navigate calls do.
    if (file === NAVIGATOR) text = text.replace(/<\w+\.Screen\s+name="[A-Za-z]+"/g, '');
    for (const t of navigationTargets(text)) targets.add(t);
  }

  it('reads the registrations (sanity)', () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(routes).toContain('History');
    expect(routes).not.toContain('PastWorkouts');
    expect(routes).toContain('WorkoutEditor');
  });

  it('every registered route has at least one navigation call to it', () => {
    const dead = routes.filter((r) => !targets.has(r) && !(r in NOT_NAVIGATED));
    expect(dead, `dead routes (nothing navigates to them): ${dead.join(', ')}`).toEqual([]);
  });

  it('the allow-list only names routes that exist', () => {
    for (const name of Object.keys(NOT_NAVIGATED)) expect(routes, name).toContain(name);
  });

  it('detects a dead route (the checker itself)', () => {
    const fake = '<RootStack.Screen name="Orphan" component={X} />\n<RootStack.Screen name="Used" component={Y} />';
    const used = navigationTargets("navigation.navigate('Used', {})");
    expect(registeredRoutes(fake).filter((r) => !used.has(r))).toEqual(['Orphan']);
  });

  it('History is opened from Library › Workouts and Progress › Calendar (Ben, 26 Oct; redesign v3: no longer from Today)', () => {
    const files = sourceFiles(SRC).filter((f) => readFileSync(f, 'utf8').match(/navigate\(\s*'History'/));
    const names = files.map((f) => relative(SRC, f));
    for (const f of ['screens/routines/WorkoutsScreen.tsx', 'screens/progress/CalendarView.tsx']) expect(names).toContain(f);
  });
});
