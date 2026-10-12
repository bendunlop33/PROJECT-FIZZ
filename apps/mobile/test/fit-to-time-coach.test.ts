import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';
import { fitShortens } from '@fizz/domain';
import type { SessionAggregate, TodayFitArgs } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { OverviewData } from '../src/services/workout-services';
import { startFromOverview } from '../src/workout/overview-start';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * The coach's fit through the app services on real SQLite (fit-to-time §5,
 * slice C): only when Ben asks; only today's shown plan goes to the model;
 * the answer is validated and applied at once as the coach's draft edits
 * with one `fit_today` record and Undo; refused edits are logged; swaps are
 * suggestions; a page that moved discards the answer; repeated opIds and
 * stale versions write nothing (FT-C9 to FT-C17).
 */

const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };
const DAY = 86_400_000;

interface PlanItem {
  slotKey: string;
  exercise: string;
  role: string;
}
interface Sent {
  askedMinutes: number;
  plan: PlanItem[];
  ownExercises: { exerciseId: string; name: string }[];
}

/** What the request's `YOUR DATA` block carried. */
function sent(req: ModelRequest): Sent & Record<string, unknown> {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as Sent & Record<string, unknown>;
}

/** A model whose answer is worked out from the request; `before` runs before it answers (a plan change, a Start). */
class FitModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(
    private readonly answer: (req: ModelRequest) => ModelEvent[],
    private readonly before: () => Promise<void> = () => Promise.resolve(),
  ) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    await this.before();
    for (const e of this.answer(request)) {
      await Promise.resolve();
      yield e;
    }
  }
}
const fitCall = (args: TodayFitArgs): ModelEvent[] => [{ type: 'tool_call', callId: 'c-fit', name: 'fit_today', arguments: JSON.stringify(args) }, { type: 'completed' }];
const e = (x: Partial<TodayFitArgs['edits'][number]>): TodayFitArgs['edits'][number] => ({ kind: 'skip', slotKey: null, exerciseId: null, workingSets: null, slotKeys: null, value: null, ...x });
const slotOf = (req: ModelRequest, name: string): string => sent(req).plan.find((p) => p.exercise === name)?.slotKey ?? 'missing';

let h: Harness;
let model: FitModel;
let connected = true;
function setModel(m: FitModel) {
  model = m;
}
beforeEach(() => {
  connected = true;
  model = new FitModel(() => [{ type: 'error', error: 'unavailable' }]);
  h = createHarness('2026-10-10T07:00:00.000Z', {
    coach: {
      model: () => model,
      connection: () => Promise.resolve(connected ? CONNECTED : { status: 'not_connected', route: null, email: null, model: null }),
    },
  });
});
afterEach(async () => {
  await h.cleanup();
});

/** Push A: bench, lateral raise, triceps pushdown, face pull (4 sets each); dumbbell curl and DB bench done before (Ben's own, not in the plan). */
async function withPushA(s: AppServices): Promise<{ gymId: string; routineId: string; dbBench: string }> {
  const gymId = await setUpGym(h, s);
  const sets = (load: number, reps: number) => Array.from({ length: 4 }, () => ({ load, reps }));
  const before = await logWorkout(h, s, gymId, [
    { exercise: 'Dumbbell curl', sets: sets(12.5, 10) },
    { exercise: 'Dumbbell bench press', sets: sets(30, 8) },
  ]);
  const dbBench = (await s.workout.load(before))?.aggregate.exercises.find((x) => x.exerciseName === 'Dumbbell bench press')?.exerciseId ?? 'none';
  h.clockMs += DAY;
  const pushA = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: sets(60, 8) },
    { exercise: 'Lateral raise', sets: sets(10, 12) },
    { exercise: 'Triceps pushdown', sets: sets(25, 12) },
    { exercise: 'Face pull', sets: sets(20, 12) },
  ]);
  const saved = await s.routines.saveFromSession({ sessionId: pushA, name: 'Push A', opId: 'save-1', addToRotation: true });
  if (!saved.ok) throw new Error(saved.message);
  h.clockMs += 2 * DAY;
  return { gymId, routineId: saved.routine.id, dbBench };
}
const targetOf = (routineId: string) => ({ kind: 'routine' as const, routineId });
async function load(s: AppServices, gymId: string, routineId: string): Promise<OverviewData> {
  const page = await s.overview.load({ target: targetOf(routineId), gymId });
  if (!page) throw new Error('no overview');
  return page;
}
const ask = (s: AppServices, page: OverviewData, gymId: string, routineId: string, minutes: number, opId: string) =>
  s.overview.requestCoachFit({ target: targetOf(routineId), gymId, expectedDraftVersion: page.draft?.version ?? null, opId, minutes, previewKey: page.view.previewKey });

/** The open pre-start drafts, read from the database file. */
function openDrafts(s: AppServices): number {
  const db = new DatabaseSync(join(h.dir, s.developer.databaseNames().current), { readOnly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM pre_start_drafts WHERE status = 'open'").get() as { n: number } | undefined;
    return row?.n ?? 0;
  } finally {
    db.close();
  }
}

/** A signal that reads as aborted once `cancel()` is called; the model step never sees it (Cancel after the answer arrived). */
function lateCancel(): { signal: AbortSignal; cancel: () => void } {
  let aborted = false;
  const signal = {
    get aborted() {
      return aborted;
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as AbortSignal;
  return {
    signal,
    cancel: () => {
      aborted = true;
    },
  };
}

/** The rows the page showed are what Start created (FT-C5). */
function sameAsStart(page: OverviewData, agg: SessionAggregate): void {
  const ordered = [...agg.exercises].sort((a, b) => a.order - b.order);
  expect(ordered.map((x) => x.exerciseName)).toEqual(page.view.rows.map((r) => r.name));
  for (const [i, row] of page.view.rows.entries()) {
    const ex = ordered[i];
    const sets = agg.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup' && x.pairedWithSetId === null);
    if (row.edit?.kind === 'skipped') {
      expect(sets.every((x) => x.status === 'skipped' && x.skippedBy === 'before_start')).toBe(true);
      continue;
    }
    expect(sets.filter((x) => x.status === 'pending')).toHaveLength(row.editRow.workingSets);
  }
  expect(agg.sets.filter((x) => x.status === 'pending' && x.setType !== 'warmup' && x.pairedWithSetId === null)).toHaveLength(page.view.workingSets);
}

/** `coach_actions` rows of a kind, read from the database file. */
function actionsOf(s: AppServices, kind: string): Promise<number> {
  const db = new DatabaseSync(join(h.dir, s.developer.databaseNames().current), { readOnly: true });
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM coach_actions WHERE kind = ?').get(kind) as { n: number } | undefined;
    return Promise.resolve(row?.n ?? 0);
  } finally {
    db.close();
  }
}

describe('Ask coach: shorter (FT-C10, FT-C14, FT-C15)', () => {
  it('only the shown plan goes; the fit applies at once with the coach card; a raised load and a rest change are refused; Undo takes it all back', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    setModel(
      new FitModel((req) =>
        fitCall({
          reason: 'Face pull goes, the superset accessories lose a set.',
          edits: [
            e({ kind: 'skip', slotKey: slotOf(req, 'Face pull') }),
            e({ kind: 'sets', slotKey: slotOf(req, 'Lateral raise'), workingSets: 3 }),
            e({ kind: 'load', slotKey: slotOf(req, 'Bench press'), value: 120 }),
            e({ kind: 'rest', slotKey: slotOf(req, 'Bench press'), value: 30 }),
          ],
        }),
      ),
    );
    const page = await load(s, gymId, routineId);
    const minutes = Math.max(15, 5 * Math.floor(((page.view.estimate?.seconds ?? 0) / 60 - 6) / 5));
    const r = await ask(s, page, gymId, routineId, minutes, 'coach-fit-1');
    expect(r).toMatchObject({ kind: 'applied', duplicate: false });

    // FT-C14: one request, one tool, and only today's plan, goal, priority groups, pain flags and equipment kinds (own exercises only when filling).
    expect(model.requests).toHaveLength(1);
    const req = model.requests[0];
    if (!req) throw new Error('no request');
    expect(req.tools.map((t) => t.name)).toEqual(['fit_today']);
    expect(Object.keys(sent(req)).sort()).toEqual(['askedMinutes', 'equipmentKinds', 'estimateMinutes', 'goal', 'ownExercises', 'paceSource', 'painFlags', 'plan', 'priorityGroups', 'workout'].sort());
    expect(sent(req).plan.map((p) => p.exercise)).toEqual(['Bench press', 'Lateral raise', 'Triceps pushdown', 'Face pull']);
    expect(sent(req).plan.find((p) => p.exercise === 'Bench press')?.role).toBe('main');
    expect(sent(req).ownExercises).toEqual([]);
    expect(req.input.map((i) => (i.type === 'message' ? i.content.split('\n')[0] : i.type))).not.toContain('NOT AVAILABLE');
    expect(JSON.stringify(req.input)).not.toMatch(/Dumbbell curl|memor/i);

    const fitted = await load(s, gymId, routineId);
    expect(fitted.view.fit).toMatchObject({ by: 'coach', minutes, title: `Coach fitted to ${String(minutes)} min` });
    expect(fitted.view.fit?.lines).toEqual(['Lateral raise · 4 → 3 sets', 'Face pull · skipped']);
    expect(fitted.coachFit).toMatchObject({ reason: 'Face pull goes, the superset accessories lose a set.', checks: ['Loads and rest unchanged.', '2 changes not used.'] });
    expect(fitted.coachFit?.rejected).toEqual(['Bench press · no increase when shortening', 'Bench press · rest stays as planned']);
    // Loads untouched: the bench row's target is the same as before.
    const bench = (p: OverviewData) => p.view.rows.find((x) => x.name === 'Bench press')?.load.value;
    expect(bench(fitted)).toBe(bench(page));
    expect(fitted.view.editCount).toBe(0);
    // FT-C15: one `fit_today` row.
    expect(await actionsOf(s, 'fit_today')).toBe(1);

    const actionId = r.kind === 'applied' ? r.actionId : '';
    expect(await s.overview.undoCoachFit({ actionId, opId: 'undo-coach-fit' })).toMatchObject({ ok: true });
    const back = await load(s, gymId, routineId);
    expect(back.view.fit).toBeNull();
    expect(back.view.workingSets).toBe(page.view.workingSets);
    expect(back.view.estimate).toEqual(page.view.estimate);
    expect(await actionsOf(s, 'undo')).toBe(1);
    // A second Undo changes nothing.
    expect(await s.overview.undoCoachFit({ actionId, opId: 'undo-coach-fit-2' })).toMatchObject({ ok: false });
  });

  it('a coach fit after Ben’s trim replaces it; its Undo brings his trim back (FT-C8)', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    const minutes = Math.max(15, 5 * Math.floor(((page.view.estimate?.seconds ?? 0) / 60 - 6) / 5));
    expect((await s.overview.trimToFit({ target: targetOf(routineId), gymId, expectedDraftVersion: null, opId: 'trim-1', minutes })).ok).toBe(true);
    const trimmed = await load(s, gymId, routineId);
    setModel(new FitModel((req) => fitCall({ reason: 'Skip face pull.', edits: [e({ kind: 'skip', slotKey: slotOf(req, 'Face pull') })] })));
    const r = await ask(s, trimmed, gymId, routineId, minutes, 'coach-fit-2');
    if (r.kind !== 'applied') throw new Error(r.kind);
    expect((await load(s, gymId, routineId)).view.fit?.by).toBe('coach');
    expect((await s.overview.undoCoachFit({ actionId: r.actionId, opId: 'undo-2' })).ok).toBe(true);
    const back = await load(s, gymId, routineId);
    expect(back.view.fit).toMatchObject({ by: 'built_in', minutes });
    expect(back.view.rows.map((x) => x.marker.kind)).toEqual(trimmed.view.rows.map((x) => x.marker.kind));
  });
});

describe('Ask coach: longer, swaps, failures (FT-C9, FT-C11, FT-C12, FT-C13, FT-C17)', () => {
  it('longer: Ben’s own exercise is added with its own history’s target; a third add and +3 sets are refused', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    setModel(
      new FitModel((req) => {
        const own = sent(req).ownExercises;
        const curl = own.find((o) => o.name === 'Dumbbell curl')?.exerciseId ?? 'none';
        return fitCall({
          reason: 'Curls fill the time.',
          edits: [e({ kind: 'add', exerciseId: curl }), e({ kind: 'add', exerciseId: 'not-mine' }), e({ kind: 'sets', slotKey: slotOf(req, 'Lateral raise'), workingSets: 7 })],
        });
      }),
    );
    const page = await load(s, gymId, routineId);
    const r = await ask(s, page, gymId, routineId, 180, 'coach-fill');
    expect(r.kind).toBe('applied');
    expect(sent(model.requests[0] as ModelRequest).ownExercises.map((o) => o.name)).toContain('Dumbbell curl');
    const filled = await load(s, gymId, routineId);
    const curl = filled.view.rows.find((x) => x.name === 'Dumbbell curl');
    expect(curl?.edit?.kind).toBe('added');
    // Its target is from Ben's own curl history (12.5 kg each), never a number from the model.
    expect(curl?.load.value).toBe('12.5');
    expect(filled.view.fit?.lines).toContain('Dumbbell curl · added · 3\u00a0×\u00a08–12');
    expect(filled.coachFit?.rejected).toEqual(['add · not one of yours', 'Lateral raise · at most 2 more sets']);
  });

  it('a swap is a `Today only` suggestion: nothing is swapped until Ben applies it', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId, dbBench } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    setModel(
      new FitModel((req) =>
        fitCall({ reason: 'Swap and trim.', edits: [e({ kind: 'sets', slotKey: slotOf(req, 'Face pull'), workingSets: 3 }), e({ kind: 'swap', slotKey: slotOf(req, 'Bench press'), exerciseId: dbBench })] }),
      ),
    );
    const minutes = Math.max(15, 5 * Math.floor(((page.view.estimate?.seconds ?? 0) / 60 - 2) / 5));
    const r = await ask(s, page, gymId, routineId, minutes, 'coach-swap');
    expect(r.kind).toBe('applied');
    const after = await load(s, gymId, routineId);
    expect(after.view.rows.find((x) => x.slotKey === after.coachFit?.suggestions[0]?.slotKey)?.name).toBe('Bench press');
    expect(after.coachFit?.suggestions.map((x) => x.text)).toEqual(['Bench press → Dumbbell bench press']);
  });

  it('not connected: Ask coach makes no provider call (FT-C9); a timeout and a model error change nothing (FT-C13)', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    connected = false;
    const page = await load(s, gymId, routineId);
    expect(await s.overview.coachFitAvailable()).toBe(false);
    expect(await ask(s, page, gymId, routineId, 30, 'off-1')).toEqual({ kind: 'unavailable' });
    expect(model.requests).toHaveLength(0);
    connected = true;
    setModel(new FitModel(() => [{ type: 'error', error: 'timeout' }]));
    expect(await ask(s, page, gymId, routineId, 30, 'to-1')).toEqual({ kind: 'timeout' });
    setModel(new FitModel(() => fitCall({ reason: 'x', edits: [e({ kind: 'load', slotKey: 'a', value: 200 })] })));
    expect(await ask(s, page, gymId, routineId, 30, 'rej-1')).toMatchObject({ kind: 'rejected' });
    const still = await load(s, gymId, routineId);
    expect(still.draft).toBeNull();
    expect(await actionsOf(s, 'fit_today')).toBe(0);
  });

  it('a plan change while the coach works discards the answer; Start while pending creates the session without any coach edit (FT-C13)', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    const raise = page.view.rows.find((x) => x.name === 'Lateral raise');
    setModel(
      new FitModel(
        (req) => fitCall({ reason: 'Skip face pull.', edits: [e({ kind: 'skip', slotKey: slotOf(req, 'Face pull') })] }),
        async () => {
          // Ben edits a set count while the coach works.
          await s.overview.edit({ target: targetOf(routineId), gymId, expectedDraftVersion: null, opId: 'ben-while', edit: { kind: 'sets', slotKey: raise?.slotKey ?? '', workingSets: 5 } });
        },
      ),
    );
    expect(await ask(s, page, gymId, routineId, 30, 'pc-1')).toEqual({ kind: 'plan_changed' });
    const now = await load(s, gymId, routineId);
    expect(now.view.fit).toBeNull();
    // Start while pending.
    setModel(
      new FitModel(
        (req) => fitCall({ reason: 'Skip face pull.', edits: [e({ kind: 'skip', slotKey: slotOf(req, 'Face pull') })] }),
        async () => {
          const started = await s.overview.start({ startOf: now.startOf, gymId, opId: 'start-pending', checkIn: { kind: 'skipped', atUtc: h.now().utc }, expectedPreviewKey: now.view.previewKey, draft: now.draft === null ? null : { id: now.draft.id, expectedVersion: now.draft.version } });
          if (!started.ok) throw new Error(started.error.message);
        },
      ),
    );
    expect(await ask(s, now, gymId, routineId, 30, 'pc-2')).toEqual({ kind: 'plan_changed' });
    const active = await s.workout.load();
    expect(active?.aggregate.session.todayEdits?.fitted).toBeUndefined();
    expect(active?.aggregate.sets.every((x) => x.status === 'pending')).toBe(true);
    expect(await actionsOf(s, 'fit_today')).toBe(0);
  });

  it('a repeated opId gives one fit; a stale draft version writes nothing (FT-C17)', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    setModel(new FitModel((req) => fitCall({ reason: 'Skip face pull.', edits: [e({ kind: 'skip', slotKey: slotOf(req, 'Face pull') })] })));
    const page = await load(s, gymId, routineId);
    const minutes = Math.max(15, 5 * Math.floor(((page.view.estimate?.seconds ?? 0) / 60 - 6) / 5));
    const r1 = await ask(s, page, gymId, routineId, minutes, 'dup-1');
    expect(r1).toMatchObject({ kind: 'applied', duplicate: false });
    expect(await ask(s, page, gymId, routineId, minutes, 'dup-1')).toMatchObject({ kind: 'applied', duplicate: true });
    expect(model.requests).toHaveLength(1);
    expect(await ask(s, page, gymId, routineId, minutes, 'stale-1')).toEqual({ kind: 'plan_changed' });
    expect(await actionsOf(s, 'fit_today')).toBe(1);
  });
});

describe('Cancel and Start after the answer arrived (review C B1, S2, S4)', () => {
  it('Start with no draft while the coach works: the session starts plain, and no draft or `fit_today` is written afterwards', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    expect(page.draft).toBeNull();
    setModel(
      new FitModel(
        (req) => fitCall({ reason: 'Skip face pull.', edits: [e({ kind: 'skip', slotKey: slotOf(req, 'Face pull') })] }),
        async () => {
          const started = await s.overview.start({ startOf: page.startOf, gymId, opId: 'start-no-draft', checkIn: { kind: 'skipped', atUtc: h.now().utc }, expectedPreviewKey: page.view.previewKey, draft: null });
          if (!started.ok) throw new Error(started.error.message);
        },
      ),
    );
    const minutes = Math.max(15, 5 * Math.floor(((page.view.estimate?.seconds ?? 0) / 60 - 6) / 5));
    const r = await ask(s, page, gymId, routineId, minutes, 'nd-1');
    expect(r.kind === 'plan_changed' || r.kind === 'cancelled').toBe(true);
    expect(await actionsOf(s, 'fit_today')).toBe(0);
    expect(openDrafts(s)).toBe(0);
    const active = await s.workout.load();
    expect(active?.aggregate.session.status).toBe('active');
    expect(active?.aggregate.session.todayEdits?.fitted).toBeUndefined();
    expect(active?.aggregate.sets.every((x) => x.status === 'pending')).toBe(true);
  });

  it('Cancel after the answer arrived writes nothing, with or without a draft', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    for (const withDraft of [false, true]) {
      let page = await load(s, gymId, routineId);
      if (withDraft) {
        const raise = page.view.rows.find((x) => x.name === 'Lateral raise');
        expect((await s.overview.edit({ target: targetOf(routineId), gymId, expectedDraftVersion: null, opId: 'ben-sets', edit: { kind: 'sets', slotKey: raise?.slotKey ?? '', workingSets: 3 } })).ok).toBe(true);
        page = await load(s, gymId, routineId);
      }
      const c = lateCancel();
      setModel(
        new FitModel((req) => {
          c.cancel();
          return fitCall({ reason: 'Skip face pull.', edits: [e({ kind: 'skip', slotKey: slotOf(req, 'Face pull') })] });
        }),
      );
      const minutes = Math.max(15, 5 * Math.floor(((page.view.estimate?.seconds ?? 0) / 60 - 6) / 5));
      const r = await s.overview.requestCoachFit({ target: targetOf(routineId), gymId, expectedDraftVersion: page.draft?.version ?? null, opId: `late-${String(withDraft)}`, minutes, previewKey: page.view.previewKey, signal: c.signal });
      expect(r).toEqual({ kind: 'cancelled' });
      expect(model.requests).toHaveLength(1);
      expect(await actionsOf(s, 'fit_today')).toBe(0);
      const after = await load(s, gymId, routineId);
      expect(after.view.fit).toBeNull();
      expect(after.draft?.version ?? null).toBe(page.draft?.version ?? null);
    }
  });

  it('Clear fit on a coach fit is its Undo: edits gone, one `undo` row, the record marked undone (FT-C15)', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    setModel(new FitModel((req) => fitCall({ reason: 'Skip face pull.', edits: [e({ kind: 'skip', slotKey: slotOf(req, 'Face pull') })] })));
    const minutes = Math.max(15, 5 * Math.floor(((page.view.estimate?.seconds ?? 0) / 60 - 6) / 5));
    const r = await ask(s, page, gymId, routineId, minutes, 'cf-1');
    if (r.kind !== 'applied') throw new Error(r.kind);
    const fitted = await load(s, gymId, routineId);
    expect(fitted.view.fit?.by).toBe('coach');
    const base = { target: targetOf(routineId), gymId, expectedDraftVersion: fitted.draft?.version ?? null, opId: 'clear-coach-fit' };
    // An older version is stale and changes nothing.
    expect(await s.overview.clearFit({ ...base, expectedDraftVersion: (fitted.draft?.version ?? 1) - 1, opId: 'clear-old' })).toMatchObject({ ok: false, reason: 'stale' });
    expect((await s.overview.clearFit(base)).ok).toBe(true);
    const cleared = await load(s, gymId, routineId);
    expect(cleared.view.fit).toBeNull();
    expect(cleared.view.workingSets).toBe(page.view.workingSets);
    expect(cleared.view.rows.map((x) => x.marker.kind)).toEqual(page.view.rows.map((x) => x.marker.kind));
    expect(await actionsOf(s, 'undo')).toBe(1);
    expect((await s.overview.undoCoachFit({ actionId: r.actionId, opId: 'undo-after-clear' })).ok).toBe(false);
    // A retry of the same Clear is the same write.
    expect((await s.overview.clearFit(base)).ok).toBe(true);
    expect(await actionsOf(s, 'undo')).toBe(1);
  });

  it('Start with a coach fit (an add and more sets): rows equal the preview, `fitted.by` is coach with the add, Finish by from the fit (FT-C5)', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    setModel(
      new FitModel((req) => {
        const curl = sent(req).ownExercises.find((o) => o.name === 'Dumbbell curl')?.exerciseId ?? 'none';
        return fitCall({ reason: 'Curls and a raise set fill it.', edits: [e({ kind: 'add', exerciseId: curl }), e({ kind: 'sets', slotKey: slotOf(req, 'Lateral raise'), workingSets: 5 })] });
      }),
    );
    const page = await load(s, gymId, routineId);
    const minutes = 120;
    const r = await ask(s, page, gymId, routineId, minutes, 'coach-start');
    if (r.kind !== 'applied') throw new Error(r.kind);
    const fitted = await load(s, gymId, routineId);
    expect(fitted.view.fit?.by).toBe('coach');
    expect(fitted.view.rows.map((x) => x.name)).toContain('Dumbbell curl');
    h.clockMs += 41_000;
    const started = await startFromOverview({ start: (q) => s.overview.start(q), reload: () => s.overview.load({ target: targetOf(routineId), gymId }) }, { page: fitted, opId: 'start-coach-fit', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (started.kind !== 'started') throw new Error(started.kind);
    const agg = started.outcome.aggregate;
    sameAsStart(fitted, agg);
    expect(agg.session.todayEdits?.fitted).toMatchObject({ minutes, by: 'coach' });
    expect(agg.session.todayEdits?.fitted?.cuts.map((c) => c.kind)).toContain('add');
    const startMs = Date.parse(agg.session.startedAt.utc);
    expect(agg.session.finishBy?.utc).toBe(new Date(Math.ceil((startMs + minutes * 60_000) / 300_000) * 300_000).toISOString());
    // The added curl's targets come from Ben's own history (12.5 kg each), never the model.
    const curl = agg.exercises.find((x) => x.exerciseName === 'Dumbbell curl');
    const curlSets = agg.sets.filter((x) => x.sessionExerciseId === curl?.id && x.setType !== 'warmup');
    expect(curlSets.length).toBeGreaterThan(0);
    expect(curlSets.every((x) => x.planned.load?.value === 12.5)).toBe(true);
    // The draft is consumed: no open draft, and the coach's record stands for what was started.
    expect(openDrafts(s)).toBe(0);
  });
});

describe('Fit or Fill from the unrounded estimate (review C S1)', () => {
  it('a length just under the plan is sent as a shorten with the unrounded estimate, and its skip is used', async () => {
    const { services: s } = await h.launch();
    const { gymId, routineId } = await withPushA(s);
    const page = await load(s, gymId, routineId);
    const seconds = page.view.estimate?.seconds ?? 0;
    // The largest chip under the plan's unrounded length: the sheet's default `Trim to N` (a shorten).
    const minutes = Math.max(15, 5 * Math.floor((seconds - 1) / 300));
    expect(fitShortens(minutes, seconds)).toBe(true);
    setModel(new FitModel((req) => fitCall({ reason: 'Skip face pull.', edits: [e({ kind: 'skip', slotKey: slotOf(req, 'Face pull') })] })));
    const r = await ask(s, page, gymId, routineId, minutes, 'round-1');
    expect(r.kind).toBe('applied');
    const req = model.requests[0];
    if (!req) throw new Error('no request');
    const ctx = sent(req) as unknown as { estimateMinutes: number };
    expect(ctx.estimateMinutes).toBe(Math.round(seconds / 6) / 10);
    const ask0 = req.input.find((i) => i.type === 'message' && i.role === 'user');
    expect(ask0?.type === 'message' ? ask0.content : '').toBe(`Fit today to ${String(minutes)} minutes.`);
  });
});
