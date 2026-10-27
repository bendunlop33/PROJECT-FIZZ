import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { effortCellText, shownRir, stepRir, storedEffort } from '../src/ui/exercise-popup-model';
import { effortChoices, SET_SHAPE_COPY, shapeEffortRow } from '../src/workout/set-shape-view';
import { exerciseMenu, targetRpeChips, targetRpeMenu } from '../src/workout/exercise-menu';

/**
 * (Ben, 26 Oct: RIR replaces RPE in the UI) Every effort Ben sees or enters reads RIR = 10 − RPE; stored values
 * keep their own scale (RPE by default), converted at the view layer. Half values display as halves.
 */

const src = (...p: string[]) => readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8');

describe('the exercise pop-up’s effort column reads RIR (builder, workout and saved-workout editors)', () => {
  const rpeView = {};
  const rirView = { effortHeader: 'RIR' };
  it('an RPE view shows RIR and stores what Ben types back as RPE', () => {
    expect(effortCellText(rpeView, 8)).toBe('2');
    expect(effortCellText(rpeView, 8.5)).toBe('1.5');
    expect(effortCellText(rpeView, null)).toBe('');
    expect(storedEffort(rpeView, 2)).toBe(8);
    expect(storedEffort(rpeView, 1.5)).toBe(8.5);
    expect(storedEffort(rpeView, 10)).toBeNull();
    expect(storedEffort(rpeView, -1)).toBeNull();
    expect(shownRir(rpeView, 9)).toBe(1);
  });
  it('a view already in RIR passes through', () => {
    expect(effortCellText(rirView, 2)).toBe('2');
    expect(storedEffort(rirView, 3)).toBe(3);
  });
  it('the keypad bar steps RIR in half steps (whole for an RIR view), within 0–9', () => {
    expect(stepRir(rpeView, 2, 1)).toBe(2.5);
    expect(stepRir(rpeView, 0, -1)).toBe(0);
    expect(stepRir(rirView, 2, 1)).toBe(3);
    expect(stepRir(rpeView, 9, 1)).toBe(9);
  });
  it('the pop-up’s header says RIR', () => {
    expect(src('ui', 'exercise-popup.tsx')).toContain('EFFORT_HEADER]).map((h, i) =>');
  });
});

describe('target effort rows, sheets and menus read RIR', () => {
  it('a saved workout’s Target row: an RPE target reads as RIR', () => {
    expect(shapeEffortRow({ targetRpe: 8, targetRir: null }, 'rpe')).toEqual({ label: 'Target RIR', text: '2' });
    expect(shapeEffortRow({ targetRpe: 8.5, targetRir: null }, 'rpe')?.text).toBe('1.5');
    expect(shapeEffortRow({ targetRpe: null, targetRir: 3 }, 'rir')).toEqual({ label: 'Target RIR', text: '3' });
    expect(SET_SHAPE_COPY.targetRpe).toBe('Target RIR');
  });
  it('the effort sheet’s chips: None, then RIR 0 up (values stay RPE)', () => {
    const c = effortChoices('rpe');
    expect(c[0]).toEqual({ label: 'None', value: null });
    expect(c.slice(1).map((x) => x.label)).toEqual(['0', '0.5', '1', '1.5', '2', '2.5', '3', '4']);
    expect(c[1]?.value).toBe(10);
  });
  it('⋯ › Target RIR: options RIR 0 … RIR 4, the values RPE 10 … 6', () => {
    const m = targetRpeMenu({ rpe: 8, source: 'rule' });
    expect(m.options[0]).toBe('RIR 0');
    expect(m.options).toContain('RIR 2 ✓');
    expect(m.valueAt(m.options.indexOf('RIR 2 ✓'))).toBe(8);
    expect(exerciseMenu(false, false, { hasTargetRpe: true }).options).toContain('Target RIR');
    expect(targetRpeChips({ target: { rpe: 9, source: 'ben' }, override: 9 }).find((x) => x.selected)?.label).toBe('1');
  });
});

describe('logged effort entry reads RIR and stores in Ben’s scale', () => {
  it('the after-log chips and Edit set read RIR; an RPE scale stores 10 − RIR', () => {
    const screen = src('screens', 'workout', 'WorkoutScreen.tsx');
    expect(screen).toContain("const effortScale = loaded.effortScale === 'off' ? 'off' : 'rir';");
    expect(screen).toContain('patch: scale === \'rir\' ? { rir: next, rpe: null } : { rpe: next === null ? null : rpeOfRir(next), rir: null }');
    expect(screen).toContain("if (loaded.effortScale === 'rir') return { rir, rpe: null };");
    const edit = src('screens', 'workout', 'EditSetScreen.tsx');
    expect(edit).toContain('<EffortHeading scale="rir">');
    expect(edit).not.toContain("'Effort (RPE)'");
  });
});
