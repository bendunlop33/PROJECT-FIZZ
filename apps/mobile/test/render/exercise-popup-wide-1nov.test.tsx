import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../src/theme';
import { ExercisePopup } from '../../src/ui/exercise-popup';
import { popupKgColumnWidth, POPUP_CELL_PAD, type PopupSetRow, type PopupView } from '../../src/ui/exercise-popup-model';
import { textEms } from '../../src/workout/set-columns';

/**
 * (Ben, 1 Nov: Bench `100` showed as `10` in the exercise sheet; the stored loads were 105 / 100 / 100.) The sheet's
 * Kg field had the default field's 16 pt padding each side inside a 56 pt column: 24 pt of room for 17 pt digits.
 * Every Kg cell now fits its load and never less than `102.5` and `1,000`.
 */

const row = (i: number, load: number | null, done = false): PopupSetRow => ({
  key: `s${String(i)}`,
  index: i,
  mark: String(i + 1),
  type: 'working',
  typeText: 'Working',
  reps: 5,
  repsText: '5',
  kgText: load === null ? '' : String(load),
  load,
  rpeText: '',
  rpe: 8,
  done,
  editable: true,
  noRpe: false,
  canDelete: true,
  canMoveUp: false,
  canMoveDown: false,
  draggable: false,
  accessibilityLabel: `Set ${String(i + 1)}`,
  spokenName: `Set ${String(i + 1)}`,
});

const view = (rows: PopupSetRow[], kgHeader = 'Kg'): PopupView => ({
  name: 'Bench press',
  works: 'Chest',
  kgHeader,
  rows,
  canAddWarmup: true,
  canAddSet: true,
  rests: [],
  canMoveUp: false,
  canMoveDown: false,
  canSupersetNext: false,
  canUnlink: false,
  mayHurt: false,
  canSwap: true,
  deleteLabel: 'Remove',
  canDeleteExercise: true,
});

const noop = () => undefined;
const none = () => Promise.resolve(null);

async function kgFields(v: PopupView): Promise<{ value: string; width: number; pad: number }[]> {
  const root = createRoot({ textComponentTypes: ['Text', 'Animated.Text'] });
  await act(async () => {
    root.render(
      <ThemeProvider savedDirection={null} onChangeDirection={noop}>
        <ExercisePopup view={v} resetKey="x" onEditCell={none} onType={none} onDeleteRow={noop} onAddWarmup={none} onAddSet={noop} onRestStep={noop} onMove={noop} onSupersetNext={noop} onUnlink={noop} onSwap={noop} onDelete={noop} onClose={noop} kgStep={() => Promise.resolve(null)} />
      </ThemeProvider>,
    );
    await Promise.resolve();
  });
  const flat = (s: unknown): Record<string, unknown> => (Array.isArray(s) ? Object.assign({}, ...s.map(flat)) : ((s ?? {}) as Record<string, unknown>));
  const fields = root.container.queryAll((n) => n.type === 'TextInput' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.endsWith(`, ${v.kgHeader}`));
  const out = fields.map((f) => {
    const st = flat(f.props.style);
    return { value: String(f.props.value), width: Number(st.width), pad: Number(st.paddingHorizontal) };
  });
  root.unmount();
  return out;
}

describe('the exercise sheet’s Kg cells fit wide numbers (Ben, 1 Nov)', () => {
  it('100, 102.5 and 1,000 lb each fit their cell at the field’s 17 pt', async () => {
    for (const [loads, unit] of [[[105, 100, 100], 'Kg'], [[102.5, 100], 'Kg'], [[1000, 995], 'Lb']] as const) {
      const cells = await kgFields(view(loads.map((l, i) => row(i, l, i === 0)), unit));
      expect(cells.map((c) => c.value)).toEqual(loads.map(String));
      for (const c of cells) {
        expect(c.pad).toBe(POPUP_CELL_PAD);
        expect(textEms(c.value) * 17).toBeLessThanOrEqual(c.width - 2 * c.pad - 2);
        expect(textEms('1,000') * 17).toBeLessThanOrEqual(c.width - 2 * c.pad - 2);
      }
    }
  });

  it('the column grows with the text size and with what Ben types', () => {
    expect(popupKgColumnWidth(['100'], 1)).toBeGreaterThanOrEqual(Math.ceil(textEms('102.5') * 17 + 2 * POPUP_CELL_PAD));
    expect(popupKgColumnWidth(['100'], 1.6)).toBeGreaterThan(popupKgColumnWidth(['100'], 1));
    expect(popupKgColumnWidth(['1000.25'], 1)).toBeGreaterThan(popupKgColumnWidth(['100'], 1));
  });
});
