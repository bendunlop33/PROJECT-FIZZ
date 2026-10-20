import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP, tableLogLabel, type TableRow } from '@fizz/domain';
import type { SessionCommand } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { anchorReducer, anchorScrollY, anchorTargetY, bottomSpacerHeight, cellEditReducer, chipsFor, correctionPatch, doneRowEditing, keypadScrollY, loadCellA11y, valueCellA11y, openRowEditing, runRowTap, keypadTileY, rowTap, TILE_CLEARANCE, selectCommand, selectRowFlow, showsFolded, tileReportFor, workoutMenu, workoutViewOf, type AnchorEvent, type AnchorRequest, type SelectOutcome, type TileId, type TileReport } from '../src/workout/table';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * The workout Table view (active-workout §2A): anchoring and auto-advance,
 * the chips, row taps that select and never log, Finish placement, and the
 * whole loop on real SQLite with no coach: open anchored, log from the pill,
 * select a row, force-close mid-rest and relaunch on the same set.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

describe('anchor position (§2A.4)', () => {
  it('puts the anchor directly under its pinned header, or the header in place on the first row', () => {
    // Card at 400, header 120 tall; open row 300 below the card top (two done rows above it).
    expect(anchorScrollY({ cardTop: 400, headerHeight: 120, anchorTop: 700 })).toBe(580);
    // Set 1 is open: the anchor sits right under the header, so the header stays in its natural place.
    expect(anchorScrollY({ cardTop: 400, headerHeight: 120, anchorTop: 520 })).toBe(400);
    expect(anchorScrollY({ cardTop: 0, headerHeight: 120, anchorTop: 120 })).toBe(0);
  });

  it('the bottom spacer lets the anchor reach the top on the last sets, and is never negative', () => {
    expect(bottomSpacerHeight({ viewportHeight: 600, contentEnd: 1000, anchorY: 800 })).toBe(400);
    expect(bottomSpacerHeight({ viewportHeight: 600, contentEnd: 3000, anchorY: 800 })).toBe(0);
  });
});

/**
 * Phone geometry for the keypad and rest anchors, from this branch's tokens
 * (review r2 B1, S2). Window space: status bar, 52 pt top bar, then the
 * list; at the bottom the 76 pt Log bar, the 64 pt rest bar above it while
 * resting. The keypad (number pad + 44 pt Done bar) lifts both bars.
 * Content space: the card's header at 600, two done rows (2 × 52) in the
 * body, then the open row: 8 pt padding, a 44 pt top line, 8 pt gap, then
 * stacked 108 pt tiles 8 pt apart.
 */
interface Phone {
  name: string;
  height: number;
  status: number;
  keypad: number;
}
const PHONES: Phone[] = [
  { name: '375 × 667', height: 667, status: 20, keypad: 216 + 44 },
  { name: '390 × 844', height: 844, status: 47, keypad: 291 + 44 },
];
const TOP_BAR = 52;
const LOG_BAR = 76;
const REST_BAR = 64;
const HEADER = 124;
const CARD_TOP = 600;
const TILE = 108;
const OPEN_TOP = CARD_TOP + HEADER + 2 * 52;
const tileTop = (i: number) => OPEN_TOP + 8 + 44 + 8 + i * (TILE + 8);
/** The tiles in order for each field the test focuses: LOAD + REPS, or LOAD + TIME. */
const LAYOUTS: { focused: TileId; index: number; count: number }[] = [
  { focused: 'load', index: 0, count: 2 },
  { focused: 'reps', index: 1, count: 2 },
  { focused: 'time', index: 1, count: 2 },
  { focused: 'time', index: 0, count: 1 },
];
const listTop = (p: Phone) => p.status + TOP_BAR;
const viewport = (p: Phone, resting: boolean) => p.height - listTop(p) - LOG_BAR - (resting ? REST_BAR : 0);

describe('keypad anchor: the focused tile clears the keypad (WT39, review r2 B1)', () => {
  for (const phone of PHONES) {
    for (const resting of [false, true]) {
      for (const l of LAYOUTS) {
        it(`${phone.name}${resting ? ', resting' : ''}: ${l.focused.toUpperCase()} (tile ${String(l.index + 1)} of ${String(l.count)})`, () => {
          const top = tileTop(l.index);
          const bottom = top + TILE;
          const y = keypadScrollY({ cardTop: CARD_TOP, headerHeight: HEADER, viewportHeight: viewport(phone, resting), openTop: OPEN_TOP, keyboardHeight: phone.keypad, tileBottom: bottom });
          // Window positions once scrolled. The bars sit on the keypad; the tile's bottom clears them.
          const keypadTop = phone.height - phone.keypad;
          const barsTop = keypadTop - LOG_BAR - (resting ? REST_BAR : 0);
          const tileBottomOnScreen = listTop(phone) + (bottom - y);
          expect(tileBottomOnScreen).toBeLessThanOrEqual(barsTop - TILE_CLEARANCE);
          expect(barsTop + LOG_BAR + (resting ? REST_BAR : 0)).toBe(keypadTop);
          // The tile is below the pinned header whenever the space allows it.
          const room = barsTop - listTop(phone) - HEADER;
          if (room >= TILE + TILE_CLEARANCE) expect(listTop(phone) + (top - y)).toBeGreaterThanOrEqual(listTop(phone) + HEADER);
          // Never further than needed: the open row's top stays under the header when that's enough.
          expect(y).toBeGreaterThanOrEqual(OPEN_TOP - HEADER);
        });
      }
    }
  }

  it('the old anchor (open row under the header) hid REPS behind the keypad at both sizes', () => {
    for (const phone of PHONES) {
      const openY = anchorScrollY({ cardTop: CARD_TOP, headerHeight: HEADER, anchorTop: OPEN_TOP });
      const visibleBottom = openY + viewport(phone, false) - phone.keypad;
      expect(tileTop(1) + TILE, phone.name).toBeGreaterThan(visibleBottom);
    }
  });

  it('a short tile already in view keeps the open row under its header; no keypad height is no shift', () => {
    const big = keypadScrollY({ cardTop: CARD_TOP, headerHeight: HEADER, viewportHeight: 2000, openTop: OPEN_TOP, keyboardHeight: 335, tileBottom: tileTop(1) + TILE });
    expect(big).toBe(OPEN_TOP - HEADER);
    expect(keypadScrollY({ cardTop: 0, headerHeight: HEADER, viewportHeight: 600, openTop: HEADER, keyboardHeight: 0, tileBottom: 300 })).toBe(0);
  });
});

describe('keypad anchor: tile positions from before the keypad hid the plate line (review r3 S1)', () => {
  const phone = PHONES[0];
  if (!phone) throw new Error('phone');
  const PLATE_LINE = 28;
  const geometry = { cardTop: CARD_TOP, headerHeight: HEADER, viewportHeight: viewport(phone, true), openTop: OPEN_TOP };
  // REPS, the second tile: below the plate line while the keypad is closed, 28 pt higher once it opens.
  const reps = (y: number) => new Map([['reps' as const, { y, h: TILE }]]);
  const closedReport: TileReport = { setId: 's2', keypadOpen: false, boxes: reps(tileTop(1) - OPEN_TOP + PLATE_LINE) };
  const openReport: TileReport = { setId: 's2', keypadOpen: true, boxes: reps(tileTop(1) - OPEN_TOP) };

  it('a stale report waits; the fresh one then applies, about 28 pt short of the stale offset', () => {
    // Pending keypad request; the frame runs before the tiles' new onLayout.
    const state: { request: { tile: TileId } | null; scrolledTo: number | null } = { request: { tile: 'reps' }, scrolledTo: null };
    const frame = (report: TileReport | null) => {
      if (state.request === null) return;
      const y = keypadTileY({ geometry, keyboardHeight: phone.keypad, tile: state.request.tile, report: tileReportFor(report, { setId: 's2', keypadOpen: true }) });
      if (y === null) return;
      state.scrolledTo = y;
      state.request = null;
    };
    frame(closedReport);
    expect(state.scrolledTo).toBeNull();
    expect(state.request).not.toBeNull();
    frame(openReport);
    expect(state.request).toBeNull();
    const fresh = keypadScrollY({ ...geometry, keyboardHeight: phone.keypad, tileBottom: tileTop(1) + TILE });
    expect(state.scrolledTo).toBe(fresh);
    const staleY = keypadScrollY({ ...geometry, keyboardHeight: phone.keypad, tileBottom: tileTop(1) + PLATE_LINE + TILE });
    expect(staleY - fresh).toBe(PLATE_LINE);
    // At 375 x 667 during rest the fresh offset keeps the − / + row (the tile's bottom 52 pt) below the pinned header.
    const tileTopOnScreen = listTop(phone) + (tileTop(1) - fresh);
    expect(tileTopOnScreen + TILE - 52).toBeGreaterThanOrEqual(listTop(phone) + HEADER);
  });

  it('tileReportFor: another set is none; the other keypad state is stale; no keypad height waits', () => {
    expect(tileReportFor(openReport, { setId: 's3', keypadOpen: true })).toEqual({ kind: 'none' });
    expect(tileReportFor(null, { setId: 's2', keypadOpen: true })).toEqual({ kind: 'none' });
    expect(tileReportFor(openReport, { setId: 's2', keypadOpen: false })).toEqual({ kind: 'stale' });
    expect(tileReportFor(closedReport, { setId: 's2', keypadOpen: false }).kind).toBe('fresh');
    expect(keypadTileY({ geometry, keyboardHeight: 0, tile: 'reps', report: tileReportFor(openReport, { setId: 's2', keypadOpen: true }) })).toBeNull();
    expect(keypadTileY({ geometry, keyboardHeight: phone.keypad, tile: 'load', report: tileReportFor(openReport, { setId: 's2', keypadOpen: true }) })).toBeNull();
  });

});

describe('rest anchor: the after-set block gives way to the open row’s tiles (review r2 S2)', () => {
  const phone = PHONES[1] ?? PHONES[0];
  if (!phone) throw new Error('phone');
  const AFTER_TOP = OPEN_TOP;
  const geometry = (afterHeight: number) => {
    const open = AFTER_TOP + afterHeight;
    const tilesBottom = open + 8 + 44 + 8 + 2 * TILE + 8;
    return { cardTop: CARD_TOP, headerHeight: HEADER, viewportHeight: viewport(phone, true), openTop: open, afterTop: AFTER_TOP, tilesBottom };
  };

  it('effort chips alone: the block sits under the header and REPS is still above the rest bar', () => {
    const g = geometry(100);
    const y = anchorTargetY(g);
    expect(y).toBe(AFTER_TOP - HEADER);
    expect(g.tilesBottom).toBeLessThanOrEqual(y + g.viewportHeight - TILE_CLEARANCE);
  });

  it('chips plus an offer: the list goes just far enough for REPS to clear the rest bar; the block stays partly above', () => {
    const g = geometry(250);
    const y = anchorTargetY(g);
    expect(y).toBeGreaterThan(AFTER_TOP - HEADER);
    expect(g.tilesBottom + TILE_CLEARANCE).toBe(y + g.viewportHeight);
    expect(y).toBeLessThanOrEqual(g.openTop - HEADER);
  });

  it('when even the open row can’t fit, its top goes under the header (never past it)', () => {
    const g = { ...geometry(250), viewportHeight: 300 };
    expect(anchorTargetY(g)).toBe(g.openTop - HEADER);
  });

  it('no after-set block: the open row; tiles not measured yet: the block', () => {
    expect(anchorTargetY({ ...geometry(250), afterTop: null })).toBe(AFTER_TOP + 250 - HEADER);
    expect(anchorTargetY({ ...geometry(250), tilesBottom: null })).toBe(AFTER_TOP - HEADER);
  });
});

describe('anchor requests: what may move the list (WT3, WT7)', () => {
  const step = (events: AnchorEvent[], reduceMotion = false): AnchorRequest | null => events.reduce<AnchorRequest | null>((cur, e) => anchorReducer(cur, e, { reduceMotion }), null);

  it('opening (Start, Resume, relaunch) and switching back from Focus jump without animation', () => {
    expect(step([])).toBeNull();
    expect(step([{ kind: 'opened' }])).toEqual({ animated: false, target: { kind: 'anchor' }, focus: true });
    expect(step([{ kind: 'view_switched' }])).toEqual({ animated: false, target: { kind: 'anchor' }, focus: true });
  });

  it('each Log auto-advances with motion; under Reduce Motion it jumps to the same place', () => {
    // VoiceOver focus moves to the new open row after a Log (S5).
    expect(step([{ kind: 'logged' }])).toEqual({ animated: true, target: { kind: 'anchor' }, focus: true });
    expect(step([{ kind: 'logged' }], true)).toEqual({ animated: false, target: { kind: 'anchor' }, focus: true });
    expect(step([{ kind: 'now_chip' }], true)).toEqual({ animated: false, target: { kind: 'anchor' }, focus: false });
  });

  it('the keypad anchors the tile Ben focused, named by the tile itself (WT39, review r2 B1)', () => {
    expect(step([{ kind: 'keypad_opened', tile: 'reps' }])).toEqual({ animated: true, target: { kind: 'tile', tile: 'reps' }, focus: false });
    expect(step([{ kind: 'keypad_opened', tile: 'load' }], true)).toEqual({ animated: false, target: { kind: 'tile', tile: 'load' }, focus: false });
    // Moving to another tile retargets; a Log after it lands on the after-set block again.
    expect(step([{ kind: 'keypad_opened', tile: 'load' }, { kind: 'keypad_opened', tile: 'time' }])).toMatchObject({ target: { kind: 'tile', tile: 'time' } });
    expect(step([{ kind: 'keypad_opened', tile: 'reps' }, { kind: 'applied' }, { kind: 'logged' }])).toMatchObject({ target: { kind: 'anchor' } });
  });

  it('only a tile sends keypad_opened: the screen no longer guesses from the focused input (review r2 B1)', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'screens/workout/WorkoutScreen.tsx'), 'utf8');
    expect(src).not.toContain('currentlyFocusedInput');
    expect(src.match(/anchorEvent\(\{ kind: 'keypad_opened'/g)).toHaveLength(1);
    // It also says which field the keypad is on, for `Next ›` (design pass 1.4).
    expect(src).toMatch(/onTileFocus=\{\(tile\) => \{\s*setKeypadField\(\{ row: 'open', field: tile \}\);\s*if \(modeRef\.current === 'table'\) anchorEvent\(\{ kind: 'keypad_opened', tile \}\)/);
    const row = readFileSync(join(import.meta.dirname, '..', 'src', 'screens/workout/WorkoutTable.tsx'), 'utf8');
    for (const tile of ['load', 'time', 'distance', 'reps']) expect(row).toContain(`onFocus={tileFocus('${tile}')}`);
    expect(readFileSync(join(import.meta.dirname, '..', 'src', 'ui/workout.tsx'), 'utf8')).toMatch(/setFocused\(true\);\s*onFocus\?\.\(\);/);
  });

  it('timers, toasts, effort taps, offers and reloads never move the list; Ben scrolling cancels a pending move', () => {
    const quiet: AnchorEvent[] = [{ kind: 'reloaded' }, { kind: 'rest_ended' }, { kind: 'effort' }, { kind: 'offer' }, { kind: 'toast' }];
    expect(step(quiet)).toBeNull();
    expect(step([{ kind: 'logged' }, { kind: 'user_scrolled' }])).toBeNull();
    expect(step([{ kind: 'logged' }, { kind: 'applied' }, ...quiet])).toBeNull();
  });

  it('selecting a row on screen moves nothing; from off-screen (voice, a menu) it re-anchors', () => {
    expect(step([{ kind: 'selected', onScreen: true }])).toBeNull();
    expect(step([{ kind: 'selected', onScreen: false }])).toEqual({ animated: true, target: { kind: 'anchor' }, focus: false });
  });
});

describe('chips (WT8, WT9)', () => {
  const base = { doneCount: 3, firstDoneTop: 0, openTop: 700, openBottom: 1000, scrollY: 580, viewportHeight: 600, pinnedHeight: 120 };
  it('anchored: `↑ N done` shows, no Now chip', () => {
    expect(chipsFor(base)).toEqual({ done: true, now: null });
  });
  it('a fresh workout: nothing done, no chip', () => {
    expect(chipsFor({ ...base, doneCount: 0, firstDoneTop: null, openTop: 120, openBottom: 400, scrollY: 0 })).toEqual({ done: false, now: null });
  });
  it('scrolled up past the open row: Now ↓ and the title instead of the done chip', () => {
    expect(chipsFor({ ...base, scrollY: 0 })).toEqual({ done: false, now: 'below' });
  });
  it('scrolled down past it: Now ↑', () => {
    expect(chipsFor({ ...base, scrollY: 1200 })).toEqual({ done: false, now: 'above' });
  });
});

describe('row taps (WT10, WT11, WT12; Ben decision 4)', () => {
  const row = (state: TableRow['state']) => ({ state, setId: `set-${state}` });
  it('a done row opens the correction sheet; a pending row opens Edit set and its ring only selects; open and skipped do nothing', () => {
    expect(rowTap(row('done'))).toEqual({ kind: 'edit', setId: 'set-done' });
    expect(rowTap(row('done'), 'marker')).toEqual({ kind: 'edit', setId: 'set-done' });
    expect(rowTap(row('pending'))).toEqual({ kind: 'edit', setId: 'set-pending' });
    expect(rowTap(row('pending'), 'marker')).toEqual({ kind: 'select', setId: 'set-pending' });
    expect(rowTap(row('open'), 'marker')).toEqual({ kind: 'none' });
    expect(rowTap(row('open'))).toEqual({ kind: 'none' });
    expect(rowTap(row('skipped'))).toEqual({ kind: 'none' });
  });
  it('a KG or REPS cell edits in place (18 Oct): pending selects then opens the cell, done corrects in its row; no full-screen editor', () => {
    const cols = { loadLabel: 'KG', valueLabel: 'REPS' } as const;
    expect(rowTap({ ...row('pending'), columns: cols }, 'load')).toEqual({ kind: 'select_edit', setId: 'set-pending', field: 'load' });
    expect(rowTap({ ...row('pending'), columns: cols }, 'value')).toEqual({ kind: 'select_edit', setId: 'set-pending', field: 'reps' });
    expect(rowTap({ ...row('done'), columns: cols }, 'load')).toEqual({ kind: 'correct', setId: 'set-done', field: 'load' });
    expect(rowTap({ ...row('done'), columns: { loadLabel: null, valueLabel: 'TIME' } }, 'value')).toEqual({ kind: 'correct', setId: 'set-done', field: 'time' });
    expect(rowTap({ ...row('done'), columns: { loadLabel: 'KG', valueLabel: 'DIST' } }, 'value')).toEqual({ kind: 'correct', setId: 'set-done', field: 'distance' });
    // A row with no load column has no load cell: the set number still opens Edit set.
    expect(rowTap({ ...row('pending'), columns: { loadLabel: null, valueLabel: 'REPS' } }, 'load')).toEqual({ kind: 'edit', setId: 'set-pending' });
    expect(rowTap({ ...row('open'), columns: cols }, 'load')).toEqual({ kind: 'none' });
    expect(rowTap({ ...row('skipped'), columns: cols }, 'value')).toEqual({ kind: 'none' });
    const calls: string[] = [];
    const h = { dismissKeyboard: () => calls.push('dismiss'), edit: () => calls.push('edit'), select: () => calls.push('select'), selectEdit: (id: string, f: string) => calls.push(`selectEdit:${id}:${f}`), correct: (id: string, f: string) => calls.push(`correct:${id}:${f}`) };
    runRowTap({ ...row('pending'), columns: cols }, h, 'load');
    runRowTap({ ...row('done'), columns: cols }, h, 'value');
    expect(calls).toEqual(['dismiss', 'selectEdit:set-pending:load', 'dismiss', 'correct:set-done:reps']);
  });
});

describe('in-place cell editing (18 Oct; review S3, S4, S6)', () => {
  const open = { kind: 'tap', setId: 's2', field: 'load', row: 'open' } as const;
  it('a cell tap opens it; the same tap, Done or a tap elsewhere closes it', () => {
    const s = cellEditReducer(null, open);
    expect(s).toEqual({ setId: 's2', field: 'load', row: 'open' });
    expect(cellEditReducer(s, open)).toBeNull();
    expect(cellEditReducer(s, { kind: 'close' })).toBeNull();
    // Another cell moves the editor there.
    expect(cellEditReducer(s, { ...open, field: 'reps' })).toEqual({ setId: 's2', field: 'reps', row: 'open' });
  });
  it('a Log closes it, so an Undo that makes the set current again never reopens it', () => {
    const s = cellEditReducer(null, open);
    const logged = cellEditReducer(s, { kind: 'logged' });
    expect(logged).toBeNull();
    // After Undo, s2 is active again: nothing is open.
    expect(openRowEditing(logged, 's2')).toBeNull();
    // Without the close, the stale edit would have shown up again on s2.
    expect(openRowEditing(s, 's2')).toBe('load');
    expect(openRowEditing(s, 's3')).toBeNull();
    expect(cellEditReducer(s, { kind: 'selected' })).toBeNull();
  });
  it('Enter load opens the open row’s load cell and never toggles it shut', () => {
    const s = cellEditReducer(null, { kind: 'enter', setId: 's2', field: 'load' });
    expect(openRowEditing(s, 's2')).toBe('load');
    expect(cellEditReducer(s, { kind: 'enter', setId: 's2', field: 'load' })).toEqual(s);
  });
  it('a done row’s edit is a correction, never the open row’s draft', () => {
    const s = cellEditReducer(null, { kind: 'tap', setId: 's1', field: 'reps', row: 'done' });
    expect(doneRowEditing(s)).toEqual({ setId: 's1', field: 'reps', row: 'done' });
    expect(openRowEditing(s, 's1')).toBeNull();
    expect(doneRowEditing(cellEditReducer(null, open))).toBeNull();
  });
  it('a correction sends only what changed, and nothing when unchanged (rule 2: one versioned write on close)', () => {
    const kg = (value: number) => ({ value, unit: 'kg' as const, convention: 'total' as const });
    const actual = { load: kg(100), reps: 8, durationS: null, distanceM: null };
    expect(correctionPatch(actual, actual)).toBeNull();
    expect(correctionPatch(actual, { ...actual, reps: 7 })).toEqual({ reps: 7 });
    expect(correctionPatch(actual, { ...actual, load: kg(102.5) })).toEqual({ load: kg(102.5) });
  });
  it('a select is set_active_set, versioned; never log_set', () => {
    const at = { utc: '2026-10-08T17:00:00.000Z', tz: 'Europe/London' };
    expect(selectCommand('s3', 7, at, 'op-1')).toEqual({ type: 'set_active_set', at, opId: 'op-1', setId: 's3', expectedVersion: 7 });
  });
});

describe('selectRowFlow: save the open row’s draft, then select (review S6, N9)', () => {
  const at = { utc: '2026-10-10T07:00:00.000Z', tz: 'Europe/London' };
  const draft = { type: 'save_draft' as const, at, setId: 'open', values: { load: null, reps: 5, durationS: null, rpe: null, rir: null } };
  const ok = (version: number): SelectOutcome => ({ ok: true, aggregate: { session: { version } } });

  it('saves the draft first and selects with the version the save returned; never logs', async () => {
    const calls: SessionCommand[] = [];
    const r = await selectRowFlow({
      setId: 'third',
      version: 7,
      draft,
      at,
      opId: 'sel-1',
      save: (cmd) => {
        calls.push(cmd);
        return Promise.resolve(ok(7));
      },
      select: (cmd) => {
        calls.push(cmd);
        return Promise.resolve(ok(8));
      },
    });
    expect(r).toEqual({ ok: true });
    expect(calls.map((c) => c.type)).toEqual(['save_draft', 'set_active_set']);
    expect(calls[1]).toMatchObject({ setId: 'third', expectedVersion: 7, opId: 'sel-1' });
    expect(calls.some((c) => c.type === 'log_set')).toBe(false);
  });

  it('no draft: selects straight away on the screen’s version; a failed save still selects', async () => {
    const seen: number[] = [];
    await selectRowFlow({ setId: 's', version: 4, draft: null, at, opId: 'o', save: () => Promise.reject(new Error('not called')), select: (cmd) => (seen.push(cmd.expectedVersion), Promise.resolve(ok(5))) });
    await selectRowFlow({ setId: 's', version: 4, draft, at, opId: 'o2', save: () => Promise.resolve({ ok: false, error: { code: 'write_failed', message: 'disk' } }), select: (cmd) => (seen.push(cmd.expectedVersion), Promise.resolve(ok(5))) });
    expect(seen).toEqual([4, 4]);
  });

  it('a refused select is reported: stale (a double tap) quietly, anything else with its reason', async () => {
    const refuse = (code: string) => selectRowFlow({ setId: 's', version: 4, draft: null, at, opId: 'o', save: () => Promise.resolve(ok(4)), select: () => Promise.resolve({ ok: false, error: { code, message: `refused: ${code}` } }) });
    expect(await refuse('stale_version')).toMatchObject({ ok: false, quiet: true });
    expect(await refuse('set_not_pending')).toEqual({ ok: false, quiet: false, code: 'set_not_pending', message: 'refused: set_not_pending' });
    // A write conflict is a real failure, never a silent dead tap (review r2 S4).
    expect(await refuse('write_conflict')).toMatchObject({ ok: false, quiet: false, code: 'write_conflict' });
  });
});

describe('folding (§2A.3)', () => {
  const folded = { key: 'bench', folded: { name: 'Bench press', summary: '100 × 8', skipped: false, accessibilityLabel: '' } };
  it('a finished block folds; expanded, it stays open until the open row moves to another block', () => {
    expect(showsFolded(folded, {}, 'row')).toBe(true);
    expect(showsFolded(folded, { bench: 'row' }, 'row')).toBe(false);
    expect(showsFolded(folded, { bench: 'row' }, 'face')).toBe(true);
    expect(showsFolded({ key: 'row', folded: null }, {}, 'row')).toBe(false);
  });
});

describe('Finish placement and the top bar menu (WT27, WT28, check 14)', () => {
  it('Finish is in ⋯ (and the Log slot only when all is done), never in the list; Focus view leads', () => {
    const m = workoutMenu({ view: 'table', paused: false, openEnded: false, ax: false, gymName: 'Main Gym' });
    expect(m.map((x) => x.label)).toEqual(['Focus view', 'Pause workout', 'Rename workout', 'Ask the coach', 'Finish workout', 'Edit workout times', 'Discard workout']);
    expect(workoutMenu({ view: 'focus', paused: true, openEnded: true, ax: true, gymName: 'Main Gym' }).map((x) => x.label)).toEqual([
      'Table view',
      'Resume workout',
      'Gym: Main Gym ›',
      'Ask the coach',
      'Finish workout',
      'Edit workout times',
      'Discard workout',
    ]);
  });

  it('Table is the default view', () => {
    expect(workoutViewOf(undefined)).toBe('table');
    expect(workoutViewOf('focus')).toBe('focus');
  });

  it('a superset keeps Adjust and acts on the open member: the group ⋯ uses the domain’s menu target, never A1 by position (review B3)', () => {
    const list = readFileSync(join(import.meta.dirname, '..', 'src', 'screens/workout/WorkoutTable.tsx'), 'utf8');
    expect(list).toMatch(/onMenu\(superset\.menuTarget\)/);
    expect(list).not.toMatch(/members\[0\]/);
    expect(list).toMatch(/<SupersetHeader[^>]*adjust=\{current \? props\.adjust : null\}/);
    // Each member line opens its own sheet and menu.
    expect(list).toMatch(/onMenu\(m\.sessionExerciseId\)/);
    expect(list).toMatch(/onName\(\{ sessionExerciseId: m\.sessionExerciseId/);
  });

  it('the Table code has one Log path and no Finish in the list, and never computes progression or loads', () => {
    const src = join(import.meta.dirname, '..', 'src');
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
    const loggers = files(src).filter((f) => /type: 'log_set'/.test(readFileSync(f, 'utf8')));
    expect(loggers.map((f) => relative(src, f))).toEqual(['screens/workout/WorkoutScreen.tsx']);
    expect(readFileSync(join(src, 'screens/workout/WorkoutScreen.tsx'), 'utf8').match(/type: 'log_set'/g)).toHaveLength(1);
    const list = readFileSync(join(src, 'screens/workout/WorkoutTable.tsx'), 'utf8');
    expect(list).not.toMatch(/Finish workout/);
    const table = list + readFileSync(join(src, 'workout/table.ts'), 'utf8');
    expect(table).not.toMatch(/'log_set'|commitSet/);
    expect(table).not.toMatch(/getAchievableLoads|roundToAvailableLoad|stepLoad|calculateNextTargets|nextTarget/);
  });
});

// ---------------------------------------------------------------------------
// End to end on real SQLite, no coach connected (WT42, rule 1)

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function benchWorkout(s: AppServices): Promise<string> {
  const gymId = await setUpGym(h, s);
  const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const picks = await s.workout.pickerExercises(sessionId, 'Bench press');
  const bench = picks.find((p) => p.exercise.name === 'Bench press');
  const added = await s.workout.addExercise({ sessionId, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId: 'add-bench' });
  if (!added.ok) throw new Error(added.error.message);
  return sessionId;
}

const load60 = { value: 60, unit: 'kg' as const, convention: 'total' as const };

describe('the Table loop end to end, offline (WT1, WT6, WT10, WT13, WT42)', () => {
  it('opens on set 1; one Log saves exactly the pill; the next row opens; no coach needed', async () => {
    const { services: s } = await h.launch();
    expect((await s.coach.availability()).status).not.toBe('ok');
    const sessionId = await benchWorkout(s);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const t = s.workout.tableView(data, h.clockMs, null);
    const first = t.anchor?.setId ?? '';
    const v0 = s.workout.view(data, h.clockMs, null);
    expect(first).toBe(v0.focus?.setId);
    expect(t.doneCount).toBe(0);

    const edits = { setId: first, values: { ...(v0.focus?.draft ?? { load: null, reps: null, durationS: null, rpe: null, rir: null }), load: load60 } };
    const v = s.workout.view(data, h.clockMs, edits);
    const pill = tableLogLabel(v.primary, s.workout.tableView(data, h.clockMs, edits).log, { offscreen: false });
    expect(plain(pill.label)).toBe('Set 1 · Log 60 kg × 6');
    h.clockMs += 30_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v.focus?.opId ?? '', setId: first, values: v.focus?.logValues ?? edits.values, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    expect(logged.aggregate.sets.find((x) => x.id === first)?.actual).toMatchObject({ load: load60, reps: 6 });

    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const after = s.workout.tableView(data, h.clockMs, null);
    expect(after.doneCount).toBe(1);
    expect(after.anchor?.setId).not.toBe(first);
    expect(after.anchor?.setId).toBe(s.workout.view(data, h.clockMs, null).focus?.setId);
  });

  it('tapping a non-current row selects it and never logs; the previous row keeps its draft', async () => {
    const { services: s } = await h.launch();
    const sessionId = await benchWorkout(s);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const t = s.workout.tableView(data, h.clockMs, null);
    const rows = t.blocks[0]?.kind === 'exercise' ? t.blocks[0].card.rows : [];
    const [open, , third] = rows;
    if (!open || !third) throw new Error('rows');
    expect(rowTap(third, 'marker')).toEqual({ kind: 'select', setId: third.setId });
    // The screen's own flow: the open row's unsaved edit is saved, then the select, on the version the save returned.
    const selected = await selectRowFlow({
      setId: third.setId,
      version: data.aggregate.session.version,
      draft: { type: 'save_draft', at: h.now(), setId: open.setId, values: { load: load60, reps: 5, durationS: null, rpe: null, rir: null } },
      at: h.now(),
      opId: 'sel-1',
      save: (cmd) => s.workout.dispatch(sessionId, cmd),
      select: (cmd) => s.workout.dispatch(sessionId, cmd),
    });
    expect(selected).toEqual({ ok: true });
    const sel = await s.workout.load();
    if (!sel) throw new Error('no workout');
    expect(sel.aggregate.sets.filter((x) => x.status === 'completed')).toHaveLength(0);
    // A second tap on the same row with the old version is refused as stale, quietly, and changes nothing.
    const again = await selectRowFlow({ setId: third.setId, version: data.aggregate.session.version, draft: null, at: h.now(), opId: 'sel-dup', save: (cmd) => s.workout.dispatch(sessionId, cmd), select: (cmd) => s.workout.dispatch(sessionId, cmd) });
    expect(again).toMatchObject({ ok: false, quiet: true });
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(s.workout.tableView(data, h.clockMs, null).anchor?.setId).toBe(third.setId);
    // Back to the first row: its draft is still there.
    const back = await s.workout.dispatch(sessionId, selectCommand(open.setId, sel.aggregate.session.version, h.now(), 'sel-2'));
    if (!back.ok) throw new Error(back.error.message);
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(s.workout.view(data, h.clockMs, null).focus?.draft).toMatchObject({ load: load60, reps: 5 });
  });

  it('force-close mid-rest: relaunch lands on the same open row, its unsaved edit and the stored rest deadline', async () => {
    let { services: s } = await h.launch();
    const sessionId = await benchWorkout(s);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const v0 = s.workout.view(data, h.clockMs, { setId: s.workout.tableView(data, h.clockMs, null).anchor?.setId ?? '', values: { load: load60, reps: 6, durationS: null, rpe: null, rir: null } });
    h.clockMs += 30_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v0.focus?.opId ?? '', setId: v0.focus?.setId ?? '', values: v0.focus?.logValues ?? { load: load60, reps: 6, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const before = s.workout.tableView(data, h.clockMs, null);
    const openId = before.anchor?.setId ?? '';
    // An unsaved edit on the open row (the screen saves it as a draft after 300 ms).
    const saved = await s.workout.dispatch(sessionId, { type: 'save_draft', at: h.now(), setId: openId, values: { load: { ...load60, value: 62.5 }, reps: 5, durationS: null, rpe: null, rir: null } });
    if (!saved.ok) throw new Error(saved.error.message);
    const deadline = s.workout.view(data, h.clockMs, null).rest;
    expect(deadline?.kind).toBe('running');

    await h.forceClose();
    h.clockMs += 20_000;
    const relaunch = await h.launch();
    s = relaunch.services;
    expect(relaunch.recovery?.openInto).toBe('active_workout');
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const t = s.workout.tableView(data, h.clockMs, null);
    expect(t.anchor?.setId).toBe(openId);
    expect(t.doneCount).toBe(1);
    // The screen opens anchored on it, without animation.
    expect(anchorReducer(null, { kind: 'opened' }, { reduceMotion: false })).toEqual({ animated: false, target: { kind: 'anchor' }, focus: true });
    const v = s.workout.view(data, h.clockMs, null);
    expect(v.focus?.setId).toBe(openId);
    expect(v.focus?.draft).toMatchObject({ load: { value: 62.5 }, reps: 5 });
    expect(v.focus?.draftSource).toBe('draft');
    expect(v.rest).toMatchObject({ kind: 'running' });
    if (v.rest?.kind !== 'running' || deadline?.kind !== 'running') throw new Error('rest');
    expect(v.rest.deadlineUtc).toBe(deadline.deadlineUtc);
    expect(v.rest.remainingMs).toBe(deadline.remainingMs - 20_000);
  });

  it('while resting, Log saves the open row and ends the rest; its alert is cancelled (WT13)', async () => {
    const { services: s } = await h.launch();
    const sessionId = await benchWorkout(s);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const firstId = s.workout.tableView(data, h.clockMs, null).anchor?.setId ?? '';
    const values = { load: load60, reps: 6, durationS: null, rpe: null, rir: null };
    const one = s.workout.view(data, h.clockMs, { setId: firstId, values });
    const r1 = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: one.focus?.opId ?? '', setId: firstId, values: one.focus?.logValues ?? values, restTimerId: h.ids() });
    if (!r1.ok) throw new Error(r1.error.message);
    await h.settle(s);
    const alertsBefore = [...h.pending.values()].map((a) => a.key);
    expect(alertsBefore).toHaveLength(1);
    h.clockMs += 10_000;
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const two = s.workout.view(data, h.clockMs, null);
    expect(two.phase).toBe('resting');
    const r2 = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: two.focus?.opId ?? '', setId: two.focus?.setId ?? '', values: two.focus?.logValues ?? values, restTimerId: h.ids() });
    if (!r2.ok) throw new Error(r2.error.message);
    await h.settle(s);
    expect(r2.aggregate.sets.filter((x) => x.status === 'completed')).toHaveLength(2);
    // One alert per workout: the old deadline's alert is replaced by the new rest's, never left to fire.
    const after = [...h.pending.values()].map((a) => a.key);
    expect(after).toHaveLength(1);
    for (const k of alertsBefore) expect(after).not.toContain(k);
  });
});

describe('cell labels (review S7)', () => {
  it('never reads `BW kg` or `— kg`', () => {
    expect(loadCellA11y('KG', '82.5')).toBe('Load 82.5 kg');
    expect(loadCellA11y('LB', '185')).toBe('Load 185 lb');
    expect(loadCellA11y('ASSIST KG', '20')).toBe('Assistance 20 kg');
    expect(loadCellA11y('+KG', '10')).toBe('Added load 10 kg');
    expect(loadCellA11y('+KG', 'BW')).toBe('Added load: bodyweight');
    expect(loadCellA11y('KG', '—')).toBe('Load: none');
    expect(loadCellA11y('KG', null)).toBe('Load: none');
    expect(loadCellA11y(null, '25\u00a0lb each')).toBe('Load 25 lb each');
  });
  it('reads ranges as words', () => {
    expect(valueCellA11y('REPS', '6–8')).toBe('Reps 6 to 8');
    expect(valueCellA11y('REPS', '—')).toBe('Reps: none');
    expect(valueCellA11y('TIME', '0:45')).toBe('Time 0:45');
    expect(valueCellA11y('DIST', '20\u00a0m')).toBe('Distance 20 m');
  });
});
