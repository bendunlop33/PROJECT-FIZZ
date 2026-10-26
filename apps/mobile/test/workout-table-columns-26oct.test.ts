import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import { buildWorkoutTableView, NBSP, type ActiveViewInput } from '@fizz/domain';

import { kg, ms, values } from '../../../packages/domain/test/fixtures';
import { apply, logCmd, setsFor, startFixture, BENCH } from '../../../packages/domain/test/session-fixture';
import { boxTextRoom, PREVIOUS_FONT_FLOOR, setColumns, textEms, textFits, VALUE_FONT_FLOOR, type SetColumnsInput } from '../src/workout/set-columns';
import { buildRounds, type RoundRow } from '../src/workout/rounds';
import { exerciseMenu, rirMenu } from '../src/workout/exercise-menu';
import { AX_FONT_SCALE } from '../src/workout/screen-rules';

/**
 * (Ben, 26 Oct) The active table like Hevy: `SET | PREVIOUS | KG | REPS | RIR | ✓`, compact rows, the header on
 * its own row (name, muscles, `0/2`, `⋯`; Adjust in `⋯`), RIR replacing RPE, one scroll per round page.
 */

const plain = (s: string) => s.replaceAll(NBSP, ' ');
const WIDTHS = [320, 375, 390, 430] as const;
/** xS, Large (default), xL, xxL, xxxL, then AX1, AX3, AX5. */
const SCALES = [0.82, 1, 1.12, 1.235, 1.35, AX_FONT_SCALE, 2.35, 3.12] as const;

type Case = Omit<SetColumnsInput, 'windowWidth' | 'fontScale'>;
const CASES = {
  barbell: { hasLoad: true, texts: { previous: [`102.5${NBSP}×${NBSP}10`, '—'], load: ['102.5'], value: ['8–12'] } },
  perHand: { hasLoad: true, texts: { previous: [`22.5${NBSP}×${NBSP}10`], load: ['22.5'], value: ['10'] } },
  assisted: { hasLoad: true, texts: { previous: [`27.5${NBSP}×${NBSP}8`], load: ['27.5'], value: ['6–8'] } },
  lbHeavy: { hasLoad: true, texts: { previous: [`315${NBSP}×${NBSP}12`], load: ['315'], value: ['12'] } },
  bodyweight: { hasLoad: false, texts: { previous: ['15', '—'], load: [], value: ['12–15'] } },
  timed: { hasLoad: false, hasRir: false, texts: { previous: ['0:45'], load: [], value: ['0:45'] } },
} satisfies Record<string, Case>;

describe('set table columns at 320 / 375 / 390 / 430 pt and every text size (Ben, 26 Oct)', () => {
  for (const width of WIDTHS) {
    for (const fontScale of SCALES) {
      for (const [name, c] of Object.entries(CASES) as [string, Case][]) {
        it(`${name} at ${String(width)} pt, ×${String(fontScale)}: nothing clipped, the row fits its width`, () => {
          const cols = setColumns({ windowWidth: width, fontScale, ...c });
          expect(cols.blockRows).toBe(fontScale >= AX_FONT_SCALE);
          if (cols.blockRows) return; // AX sizes: one block row per set, PREVIOUS on its own line (no columns).
          const gaps = cols.gap * ([cols.previous, cols.load, cols.value, cols.rir].filter((w) => w > 0).length + 1);
          expect(cols.set + cols.previous + cols.load + cols.value + cols.rir + cols.tick + gaps).toBeLessThanOrEqual(cols.width + 0.5);
          expect(cols.valueFont).toBeGreaterThanOrEqual(VALUE_FONT_FLOOR);
          for (const t of c.texts.load) expect(textFits(t, boxTextRoom(cols.load), cols.valueFont)).toBe(true);
          for (const t of c.texts.value) expect(textFits(t, boxTextRoom(cols.value), cols.valueFont)).toBe(true);
          if (cols.stackPrevious) {
            expect(cols.previous).toBe(0);
            for (const t of c.texts.previous) expect(textFits(t, cols.width - cols.set - cols.gap, cols.previousFont)).toBe(true);
          } else {
            expect(cols.previousFont).toBeGreaterThanOrEqual(PREVIOUS_FONT_FLOOR);
            for (const t of c.texts.previous) expect(textFits(t, cols.previous, cols.previousFont)).toBe(true);
          }
          expect(textFits('10L', cols.set, cols.setFont)).toBe(true);
          if (c.hasRir === false) expect(cols.rir).toBe(0);
          else expect(textFits('1.5', cols.rir - 6, cols.rirFont)).toBe(true);
          // Every tap target in the row keeps a sensible width.
          expect(cols.tick).toBeGreaterThanOrEqual(36);
        });
      }
    }
  }

  it('at default text size on 375 and 430 pt, PREVIOUS has its own column and typical numbers keep their full size', () => {
    for (const width of [375, 430]) {
      const cols = setColumns({ windowWidth: width, fontScale: 1, hasLoad: true, texts: { previous: [`100${NBSP}×${NBSP}8`], load: ['100'], value: ['6–8'] } });
      expect(cols.stackPrevious).toBe(false);
      expect(cols.valueFont).toBe(19);
      expect(cols.previousFont).toBe(12);
    }
    // The longest case (`102.5 × 10`, `8–12`) shrinks a hair at 375 pt rather than clip; never at 430.
    expect(setColumns({ windowWidth: 375, fontScale: 1, ...CASES.barbell }).valueFont).toBeGreaterThanOrEqual(18);
    expect(setColumns({ windowWidth: 430, fontScale: 1, ...CASES.barbell }).valueFont).toBe(19);
  });

  it('on a 320 pt window the fixed columns tighten; PREVIOUS shrinks before it ever stacks', () => {
    const narrow = setColumns({ windowWidth: 320, fontScale: 1, ...CASES.perHand });
    expect([narrow.set, narrow.rir, narrow.tick, narrow.gap]).toEqual([34, 30, 36, 3]);
    expect(narrow.stackPrevious).toBe(false);
    expect(narrow.previousFont).toBeLessThanOrEqual(12);
    expect(narrow.valueFont).toBeGreaterThanOrEqual(VALUE_FONT_FLOOR);
    // The very longest texts together (`102.5 × 10`, `102.5`, `8–12`) don't fit side by side: PREVIOUS stacks.
    expect(setColumns({ windowWidth: 320, fontScale: 1, ...CASES.barbell }).stackPrevious).toBe(true);
  });

  it('a larger text size grows the numbers; past the floor PREVIOUS stacks under SET instead of clipping', () => {
    const xxxl = setColumns({ windowWidth: 320, fontScale: 1.35, ...CASES.barbell });
    expect(xxxl.stackPrevious).toBe(true);
    expect(xxxl.previous).toBe(0);
    const big = setColumns({ windowWidth: 430, fontScale: 1.35, ...CASES.perHand });
    expect(big.stackPrevious).toBe(false);
  });

  it('glyph estimates are generous for tabular digits', () => {
    expect(textEms('100')).toBeCloseTo(1.92);
    expect(textEms(`22.5${NBSP}×${NBSP}10`)).toBeGreaterThan(textEms('22.5 10'));
  });
});

describe('rows draw again only when what they show changes (Ben, 26 Oct: smoother scrolling)', () => {
  const input = (aggregate: SessionAggregate, seconds: number): ActiveViewInput => ({ aggregate, nowMs: ms(seconds), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null });
  const rowsOf = (s: SessionAggregate, seconds: number): RoundRow[] => buildRounds(buildWorkoutTableView(input(s, seconds)), () => null, null).flatMap((r) => r.exercises.flatMap((e) => e.rows));
  const changed = (a: readonly RoundRow[], b: readonly RoundRow[]) => b.filter((r) => a.find((x) => x.setId === r.setId)?.renderKey !== r.renderKey).length;

  it('a timer tick redraws no set rows', () => {
    const s = startFixture().state;
    expect(changed(rowsOf(s, 10), rowsOf(s, 11))).toBe(0);
    expect(changed(rowsOf(s, 10), rowsOf(s, 70))).toBe(0);
  });

  it('a log redraws only the set logged and the new current set', () => {
    let s = startFixture().state;
    const [w, b1] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 8), 30));
    const before = rowsOf(s, 40);
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 60));
    const after = rowsOf(s, 70);
    expect(after.length).toBeGreaterThan(5);
    expect(changed(before, after)).toBeLessThanOrEqual(2);
  });
});

describe('the round page source (Ben, 26 Oct)', () => {
  const table = readFileSync(join(import.meta.dirname, '..', 'src', 'screens', 'workout', 'WorkoutTable.tsx'), 'utf8');
  const screen = readFileSync(join(import.meta.dirname, '..', 'src', 'screens', 'workout', 'WorkoutScreen.tsx'), 'utf8');
  const page = table.slice(table.indexOf('export function RoundPage'), table.indexOf('// The open row (the current set)'));

  it('columns: SET · PREVIOUS · KG · REPS · RIR · ✓; no RPE column; no last-time line under the rows', () => {
    expect(page).toContain("label('SET', cols.set, 'left')");
    expect(page).toContain("label('PREVIOUS', cols.previous, 'left')");
    expect(page).toContain("label('RIR', cols.rir)");
    expect(table).not.toMatch(/label\('RPE'/);
    expect(table).not.toContain('function LastRow(');
    expect(table).not.toContain('RPE_W');
  });

  it('one scroll per round page: no set boxes, no fit-to-screen, no fades', () => {
    expect(page.match(/<ScrollView\s/g)?.length).toBe(1);
    expect(table).not.toContain('fitRoundBoxes');
    expect(table).not.toContain('<Fade');
    expect(page).toContain('revealOffset(');
    // It moves on its own only on a log, an untick or a round change, never on another re-render (a timer, a draft).
    expect(page).toContain('}, [props.positionKey, flush]);');
  });

  it('set rows are memoised with stable callbacks; a tick never redraws them', () => {
    expect(table).toContain('const SetRowShell = memo(function SetRowShell');
    expect(table).toContain('}, sameShell);');
    expect(page).toContain('const actions = useMemo<RowActions>(');
  });

  it('RIR stays enterable: the cell, the hold menu, VoiceOver and the keypad bar', () => {
    expect(table).toContain("{ name: 'rir', label: 'Reps in reserve' }");
    expect(screen).toContain('onRir={enterRir}');
    expect(screen).toContain("return [{ label: 'Reps in reserve', run: () => { enterRir(setId); } }];");
    expect(screen).toContain('onRir={barRirSetId === null ? null : () => { enterRir(barRirSetId); }}');
    // A done set's RIR is a versioned correction with Undo (rule 2).
    expect(screen).toContain('patch: effortPatch(rir)');
  });

  it('PREVIOUS copies into a set not done yet (never a done one), on the same path as before', () => {
    expect(table).toContain("{...(s.canCopy ? { onCopyLast: () => { actions.copyLast(r.setId); } } : {})}");
    expect(table).toContain('canCopy={p.onCopyLast !== undefined && !r.done}');
    const copy = screen.slice(screen.indexOf('async function copyRowLast('), screen.indexOf('function editLoad('));
    expect(copy).toContain('if (row === undefined || last === null || row.done || row.skipped) return;');
    expect(copy).toContain('rpe: null, rir: null');
  });

  it('the header: name, muscles, progress and ⋯ only; Adjust leads the current exercise’s ⋯', () => {
    expect(table).not.toContain('p.adjust}');
    const menu = exerciseMenu(true, false, { adjust: true, round: { moveUp: false, moveDown: false, supersetNext: false, history: true } });
    expect(menu.options[0]).toBe('Adjust');
    expect(menu.actionAt(0)).toBe('adjust');
    expect(exerciseMenu(true, false, {}).options).not.toContain('Adjust');
  });
});

describe('RIR menu (Ben, 26 Oct)', () => {
  it('0 … 5+, the current one marked, Clear when one is set', () => {
    const m = rirMenu('Set 2', 2);
    expect(m.title).toBe('Set 2 · Reps in reserve');
    expect(m.options).toEqual(['0', '1', '2 ✓', '3', '4', '5+', 'Clear', 'Cancel']);
    expect(m.valueAt(2)).toBe(2);
    expect(m.valueAt(6)).toBeNull();
    expect(m.valueAt(7)).toBeUndefined();
    expect(rirMenu('Set 1', null).options).toEqual(['0', '1', '2', '3', '4', '5+', 'Cancel']);
    expect(plain(rirMenu('Set 1', 1.5).options[0] ?? '')).toBe('0');
  });
});
