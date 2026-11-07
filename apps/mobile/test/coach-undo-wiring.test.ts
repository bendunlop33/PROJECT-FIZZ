import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Source checks for the screen wiring that makes Undo safe to double-tap and
 * keeps the workout banner honest (review S1). The store replays a repeated
 * opId; these make sure the screens actually repeat it.
 */
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const SCREENS = {
  workoutCoach: 'screens/workout/WorkoutCoach.tsx',
  sheet: 'screens/coach/CoachSheetScreen.tsx',
  summary: 'screens/workout/SummaryScreen.tsx',
} as const;

/** The argument text of every call to `name(` in `src` (balanced parentheses). */
function callArgs(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\.${name}\\(`, 'g');
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') depth -= 1;
      i += 1;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

describe('Undo and Next-time taps use one opId per intent (bug 5)', () => {
  it('every coach Undo passes undoOpId(actionId), never a fresh id', () => {
    for (const file of [SCREENS.workoutCoach, SCREENS.sheet]) {
      const calls = callArgs(read(file), 'undo').filter((a) => a.includes(','));
      expect(calls.length, file).toBeGreaterThan(0);
      for (const a of calls) {
        expect(a, file).toMatch(/undoOpId\(\s*actionId\s*\)/);
        expect(a, file).not.toMatch(/newUuid|randomUUID|ids\(/);
      }
    }
  });

  it('every Next-time row tap passes nextTargetTapOpId for that row and tap', () => {
    const calls = callArgs(read(SCREENS.summary), 'tapNextTarget');
    expect(calls.length).toBeGreaterThan(0);
    for (const a of calls) {
      expect(a).toMatch(/nextTargetTapOpId\(/);
      expect(a).not.toMatch(/newUuid/);
    }
  });

  it('Undo all passes the coach action, so the record is undone as a whole (review B1)', () => {
    const calls = callArgs(read(SCREENS.summary), 'undoNextTargets');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/actionId\s*,/);
    expect(calls[0]).not.toMatch(/newUuid/);
  });
});

describe('The workout banner re-reads its record when the workout reloads (bug 6)', () => {
  it('WorkoutCoach calls syncAdjustment in an effect that depends on the workout', () => {
    const src = read(SCREENS.workoutCoach);
    const effects = [...src.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[([^\]]*)\]\);/g)];
    const sync = effects.find((m) => (m[1] ?? '').includes('syncAdjustment('));
    expect(sync).toBeDefined();
    expect((sync?.[2] ?? '').split(',').map((d) => d.trim())).toContain('workout');
    // The fresher record replaces the banner's when it was undone.
    expect(sync?.[1]).toMatch(/setAdjustment\(/);
  });
});
