import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKOUT_KEYBOARD } from '../src/workout/keyboard';

/**
 * F5 (Ben, 13 Oct): "the keyboard stays up on a working set". Source checks (no
 * renderer in this lane), as the coach sheet's (build 131); the feel needs a real iPhone.
 */

const SRC = join(__dirname, '..', 'src');
const screen = readFileSync(join(SRC, 'screens', 'workout', 'WorkoutScreen.tsx'), 'utf8');
const table = readFileSync(join(SRC, 'screens', 'workout', 'WorkoutTable.tsx'), 'utf8');
const ui = readFileSync(join(SRC, 'ui', 'workout.tsx'), 'utf8');

describe('workout keyboard (F5)', () => {
  it('dragging Focus or the Table closes the number pad; buttons still work on the first tap', () => {
    expect(WORKOUT_KEYBOARD).toEqual({ keyboardDismissMode: 'interactive', keyboardShouldPersistTaps: 'handled' });
    expect(screen).toContain('{...WORKOUT_KEYBOARD}');
    expect(table).toContain('{...WORKOUT_KEYBOARD}');
  });

  it('a tap outside a field on Focus closes it', () => {
    expect(screen).toMatch(/\{\.\.\.WORKOUT_KEYBOARD\}>\s*\{\/\*[^*]*\*\/\}\s*<Pressable accessible=\{false\} onPress=\{\(\) => \{ Keyboard\.dismiss\(\); \}\}/);
  });

  it('Log closes it', () => {
    const log = screen.slice(screen.indexOf('async function log()'), screen.indexOf("type: 'log_set'"));
    expect(log).toContain('Keyboard.dismiss();');
  });

  it('every number field has the visible Done bar, rendered on the workout screen', () => {
    expect(ui).toMatch(/keyboardType=\{decimals \? 'decimal-pad' : 'number-pad'\}\s*inputAccessoryViewID=\{NUMBER_ACCESSORY_ID\}/);
    expect(screen).toContain('<NumberAccessory />');
  });
});
