import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionAggregate, SessionCommand, SetValues } from '@fizz/schemas';
import { buildActiveSetView, buildWorkoutTableView, NBSP, reconcileDraftEdits, reduceSession, saveDraftCommand, type ActiveViewInput, type DraftEdits, type TableRow } from '@fizz/domain';

import { at, kg, ms, values } from '../../../packages/domain/test/fixtures';
import { apply, BENCH, setsFor, startFixture } from '../../../packages/domain/test/session-fixture';
import { createDraftSaver, DRAFT_SAVE_DELAY_MS, type SaveOutcome } from '../src/workout/draft-saver';
import { popupCellWrite } from '../src/workout/exercise-popup';
import { selectRowFlow, type SelectOutcome } from '../src/workout/table';

/**
 * Review weight-revert S3 (21 Oct): the workout screen's edit lifecycle as
 * sequences, not source text. `Screen` mirrors WorkoutScreen's wiring:
 * `edits = reconcileDraftEdits(rawEdits, data)` on every new state, the
 * debounced save (draft-saver.ts) re-armed only when the edits change, edits
 * dropped when the open row moves, and a write through `run` updating the
 * screen. The stored workout and the screen's copy are kept apart so a
 * screen behind the store (S2) can be set up.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const input = (aggregate: SessionAggregate, edits: DraftEdits | null = null): ActiveViewInput => ({ aggregate, nowMs: ms(10), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits });

class Screen {
  stored: SessionAggregate;
  data: SessionAggregate;
  raw: DraftEdits | null = null;
  armedFor: DraftEdits | null = null;
  saves: { ok: boolean; code?: string }[] = [];
  reloads = 0;
  readonly saver = createDraftSaver({
    save: (cmd) => Promise.resolve(this.store(cmd)),
    reload: () => {
      this.reloads += 1;
      this.data = this.stored;
      this.render();
      return Promise.resolve();
    },
    now: () => at(50),
    setTimer: (fn, delay) => setTimeout(fn, delay),
    clearTimer: (h) => {
      clearTimeout(h as ReturnType<typeof setTimeout>);
    },
  });

  constructor(s: SessionAggregate) {
    this.stored = s;
    this.data = s;
  }

  private store(cmd: SessionCommand): SaveOutcome & SelectOutcome {
    const r = reduceSession(this.stored, cmd);
    this.saves.push(r.ok ? { ok: true } : { ok: false, code: r.error.code });
    if (!r.ok) return { ok: false, error: r.error };
    this.stored = r.state;
    return { ok: true, aggregate: r.state };
  }

  get edits(): DraftEdits | null {
    return reconcileDraftEdits(this.raw, this.data);
  }

  /** What the screen's memo + effects do after any state change. */
  render(): void {
    const e = this.edits;
    if (e !== this.raw) this.raw = e;
    if (e !== null && this.data.session.activeSetId !== e.setId) this.raw = null;
    const now = this.raw;
    if (now !== this.armedFor) {
      this.saver.cancel();
      this.armedFor = now;
      if (now !== null) this.saver.schedule(now);
    }
  }

  /** Ben types on the open row (`setValues`): the edits carry the version shown. */
  type(v: SetValues): void {
    const focus = buildActiveSetView(input(this.data, this.edits)).focus;
    if (!focus) throw new Error('no open row');
    this.raw = { setId: focus.setId, values: v, setVersion: focus.setVersion };
    this.render();
  }

  /** A write through `run`: stored, and the screen shows the result. */
  write(cmd: SessionCommand): void {
    this.stored = apply(this.stored, cmd);
    this.data = this.stored;
    this.render();
  }

  /** A write the screen hasn't read yet (another path, no reload). */
  writeBehindScreen(cmd: SessionCommand): void {
    this.stored = apply(this.stored, cmd);
  }

  selectRow(setId: string): ReturnType<typeof selectRowFlow> {
    const edits = this.edits;
    return selectRowFlow({
      setId,
      version: this.data.session.version,
      draft: edits === null ? null : saveDraftCommand(edits, at(51)),
      at: at(51),
      opId: `sel-${setId}`,
      save: (cmd) => Promise.resolve(this.store(cmd)),
      rebase: () => {
        this.reloads += 1;
        this.data = this.stored;
        const live = reconcileDraftEdits(edits, this.data);
        return Promise.resolve({ version: this.data.session.version, draft: live === null ? null : saveDraftCommand(live, at(51)) });
      },
      select: (cmd) => {
        const out = this.store(cmd);
        if (out.ok) {
          this.data = this.stored;
          this.render();
        }
        return Promise.resolve(out);
      },
    });
  }

  storedRow(setId: string): TableRow {
    const r = buildWorkoutTableView(input(this.stored))
      .blocks.flatMap((b) => (b.kind === 'exercise' ? b.card.rows : b.superset.rounds.flatMap((x) => x.rows)))
      .find((x) => x.setId === setId);
    if (!r) throw new Error('row');
    return r;
  }

  focusCells() {
    return buildActiveSetView(input(this.data, this.edits)).focus?.cells;
  }
}

function openBench(): { screen: Screen; b1: string; b2: string } {
  let s = startFixture().state;
  const [, b1, b2] = setsFor(s, BENCH);
  if (!b1 || !b2) throw new Error('fixture');
  s = apply(s, { type: 'set_active_set', at: at(5), opId: 'open-b1', setId: b1.id, expectedVersion: s.session.version });
  return { screen: new Screen(s), b1: b1.id, b2: b2.id };
}

const version = (s: SessionAggregate, setId: string) => s.sets.find((x) => x.id === setId)?.version ?? 0;
const half = DRAFT_SAVE_DELAY_MS / 3;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the workout screen’s draft edits as sequences (review S3)', () => {
  it('a coach change mid-debounce keeps the typed 105; the save lands once, re-based', async () => {
    const { screen, b1, b2 } = openBench();
    screen.type(values(kg(105), 8));
    await vi.advanceTimersByTimeAsync(half);
    screen.write({ type: 'adjust_pending_targets', at: at(30), opId: 'coach:1', expectedVersion: screen.stored.session.version, actionId: 'act-1', changes: [{ setId: b1, target: { load: kg(95), reps: { min: 8, max: 8 } } }, { setId: b2, target: { load: kg(95), reps: { min: 8, max: 8 } } }], removeSetIds: [], addSets: [] });
    expect(screen.focusCells()?.load).toBe('105');
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    expect(screen.saves).toEqual([{ ok: true }]);
    expect(screen.storedRow(b1).cells.load).toBe('105');
    expect(screen.storedRow(b2).cells.load).toBe('95');
  });

  it('a pop-up reps change mid-debounce keeps the typed weight: 105 × 6 on screen and stored (B1)', async () => {
    const { screen, b1 } = openBench();
    screen.type(values(kg(105), 8));
    await vi.advanceTimersByTimeAsync(half);
    const w = popupCellWrite(screen.data, b1, 'reps', 6);
    if (w.kind !== 'planned') throw new Error(w.kind);
    screen.write({ type: 'edit_planned_set', at: at(30), opId: 'pop-reps', setId: b1, expectedSetVersion: w.expectedSetVersion, patch: w.patch });
    expect(screen.focusCells()).toEqual({ load: '105', value: '6' });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    expect(screen.saves).toEqual([{ ok: true }]);
    expect(screen.stored.sets.find((x) => x.id === b1)?.draft).toMatchObject({ load: kg(105), reps: 6 });
  });

  it('a set-type change mid-debounce never drops the typed weight (S1)', async () => {
    const { screen, b1 } = openBench();
    screen.type(values(kg(105), 8));
    await vi.advanceTimersByTimeAsync(half);
    screen.write({ type: 'edit_planned_set', at: at(30), opId: 'type-top', setId: b1, expectedSetVersion: version(screen.data, b1), patch: { setType: 'top' } });
    expect(screen.focusCells()?.load).toBe('105');
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    expect(screen.stored.sets.find((x) => x.id === b1)?.draft?.load).toEqual(kg(105));
  });

  it('Edit set to 110 mid-debounce: 110 wins, the old 100 is never saved back over it', async () => {
    const { screen, b1 } = openBench();
    screen.type(values(kg(100), 8));
    await vi.advanceTimersByTimeAsync(half);
    screen.write({ type: 'edit_planned_set', at: at(30), opId: 'sheet-110', setId: b1, expectedSetVersion: version(screen.data, b1), patch: { load: kg(110) } });
    expect(screen.edits).toBeNull();
    expect(screen.focusCells()?.load).toBe('110');
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS * 2);
    expect(screen.saves).toEqual([]);
    expect(screen.storedRow(b1).cells.load).toBe('110');
  });

  it('a row switch within 300 ms saves the typed value first; the row keeps 105', async () => {
    const { screen, b1, b2 } = openBench();
    screen.type(values(kg(105), 8));
    await vi.advanceTimersByTimeAsync(half);
    await expect(screen.selectRow(b2)).resolves.toEqual({ ok: true });
    expect(screen.stored.session.activeSetId).toBe(b2);
    expect(screen.edits).toBeNull();
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS * 2);
    // One draft save and the select; no late save.
    expect(screen.saves).toEqual([{ ok: true }, { ok: true }]);
    expect(screen.storedRow(b1).cells.load).toBe('105');
  });

  it('a stale debounced save reloads, re-bases and saves again; the typed value is kept (S2)', async () => {
    const { screen, b1 } = openBench();
    screen.writeBehindScreen({ type: 'edit_planned_set', at: at(20), opId: 'rest-elsewhere', setId: b1, expectedSetVersion: version(screen.stored, b1), patch: { restS: 150 } });
    screen.type(values(kg(105), 8));
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    expect(screen.saves[0]).toEqual({ ok: false, code: 'stale_version' });
    expect(screen.reloads).toBe(1);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    expect(screen.saves[1]).toEqual({ ok: true });
    expect(screen.stored.sets.find((x) => x.id === b1)?.draft?.load).toEqual(kg(105));
    // Nothing more: the re-based edits are stable.
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS * 3);
    expect(screen.saves).toHaveLength(2);
  });

  it('a stale save on a row switch re-reads and saves the re-based value before selecting (S2)', async () => {
    const { screen, b1, b2 } = openBench();
    screen.writeBehindScreen({ type: 'edit_planned_set', at: at(20), opId: 'rest-elsewhere', setId: b1, expectedSetVersion: version(screen.stored, b1), patch: { restS: 150 } });
    screen.type(values(kg(105), 8));
    await expect(screen.selectRow(b2)).resolves.toEqual({ ok: true });
    expect(screen.saves.map((x) => x.code ?? 'ok')).toEqual(['stale_version', 'ok', 'ok']);
    expect(screen.stored.session.activeSetId).toBe(b2);
    expect(screen.storedRow(b1).cells.load).toBe('105');
  });

  it('when the re-read fails the row is not switched and the refusal is shown, never a quiet loss', async () => {
    const { screen, b2 } = openBench();
    const stale = saveDraftCommand({ setId: 'x', values: values(kg(105), 8) }, at(51));
    const r = await selectRowFlow({
      setId: b2,
      version: screen.data.session.version,
      draft: stale,
      at: at(51),
      opId: 'sel',
      save: () => Promise.resolve({ ok: false, error: { code: 'stale_version', message: 'This set changed since it was edited.' } }),
      rebase: () => Promise.resolve(null),
      select: () => {
        throw new Error('must not select');
      },
    });
    expect(r).toEqual({ ok: false, quiet: false, code: 'stale_version', message: 'This set changed since it was edited.' });
    expect(plain(screen.storedRow(b2).cells.load)).toBe('100');
  });
});
