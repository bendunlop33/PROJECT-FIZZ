import { afterEach, describe, expect, it } from 'vitest';

import { benWithBlocks, type BlockBen } from './block-seed';
import { logWorkout } from './harness';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall } from './coach-model';

/**
 * (Ben, 31 Oct; docs/design/block-progress.md) Block progress over real SQLite, offline, no coach: two past blocks and
 * a current one worked out from the stored plan documents; the Blocks list; one lift compared across blocks; the
 * stalled lift's `Next week` fix (the built-in rule's stall reset) applied and undone; Library › Plan's line.
 */

let ben: BlockBen | null = null;

const pulldownId = async (b: BlockBen) => (await b.s.workout.load(b.offPlanSessionId))?.aggregate.exercises.find((e) => e.exerciseName === 'Lat pulldown')?.exerciseId;
afterEach(async () => {
  await ben?.h.cleanup();
  ben = null;
});

describe('block progress (real SQLite)', () => {
  it('three blocks from three plan documents: newest first, Now on the current, sessions and lifts counted', async () => {
    ben = await benWithBlocks();
    const v = await ben.s.blockProgress.blocks();
    expect(v?.rows.map((r) => r.title)).toEqual(['Block 3 · Muscle', 'Block 2 · Muscle', 'Block 1 · Strength']);
    expect(v?.rows[0]).toMatchObject({ tag: 'Now', current: true });
    expect(v?.rows[0]?.sub).toContain('week 3 of 6');
    expect(v?.rows[1]?.sub).toBe('7 Sep – 4 Oct · 4 of 12 sessions');
    expect(v?.rows[2]?.sub).toBe('3 Aug – 30 Aug · 4 of 12 sessions');
    expect(v?.rows[2]?.facts).toMatch(/\+7\.5 kg/);
  });

  it('This block: Week 3 of 6, the main lift stalled 2 weeks; a past block opens the same view', async () => {
    ben = await benWithBlocks();
    const now = await ben.s.blockProgress.thisBlock();
    expect(now).toMatchObject({ title: 'This block', meta: 'Week 3 of 6', current: true });
    const row = now?.rows.find((r) => r.exerciseId === ben?.plans[2]?.mainId);
    expect(row).toMatchObject({ stalled: true, delta: null });
    expect(row?.bars.map((b) => b.state)).toEqual(['up', 'stalled', 'stalled', 'none', 'none', 'deload']);
    const blocks = await ben.s.blockProgress.blocks();
    const past = await ben.s.blockProgress.thisBlock(blocks?.rows[1]?.key ?? null);
    expect(past).toMatchObject({ title: 'Block 2 · Muscle', meta: '7 Sep – 4 Oct', current: false });
    const pastRow = past?.rows.find((r) => r.exerciseId === ben?.plans[1]?.mainId);
    expect(pastRow).toMatchObject({ line: '60×8 → 65×8 kg', stalled: false });
    expect(pastRow?.bars.map((b) => b.state)).toEqual(['up', 'up', 'up', 'deload']);
  });

  it('cross-block comparison: rep ranges differ, so Est. 1RM labelled est.', async () => {
    ben = await benWithBlocks();
    const v = await ben.s.blockProgress.blocks(ben.plans[2]?.mainId ?? null);
    const rows = v?.compare?.rows ?? [];
    // Only blocks where the lift was trained are compared (the first day's main lift may differ by goal).
    expect(rows.length).toBeGreaterThanOrEqual(1);
    if (v?.compare?.byEstimate === true) for (const r of rows) expect(`${r.start} ${r.end}`).toMatch(/est\./);
  });

  it('a stalled lift’s Next week: the coach’s bigger change (3 → 4 sets) with Skip / Apply; Apply then Undo, each a versioned write', async () => {
    let model = new StepModel([]);
    ben = await benWithBlocks({ coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
    // The plan day's accessory (straight working sets): stalled 2 weeks.
    const id = ben.accessory.exerciseId;
    const d = await ben.s.blockProgress.liftDetail(null, id, 'connected');
    expect(d?.view.pill).toEqual({ text: 'Stalled 2 weeks', tone: 'stalled' });
    expect(d?.view.latestSessionId).toBe(ben.accessory.latestSessionId);
    // The coach's Summary review of that workout (rule 3: a clear signal, two weeks with no gain): one bigger change.
    model = new StepModel([
      (req) => {
        const w = contextWorkout(req);
        return toolCall('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: id, target: { load: { value: 20, unit: 'kg', convention: 'per_hand' }, reps: { min: 6, max: 8 } }, sets: 4, reason: 'Two weeks with no gain.' }] });
      },
      () => replyWith('One change for next week.'),
    ]);
    expect(await ben.s.coach.runSummaryTurn(ben.accessory.latestSessionId)).not.toBeNull();
    const next = (await ben.s.blockProgress.liftDetail(null, id, 'connected'))?.next;
    if (next == null) throw new Error('no Next week row');
    expect(next.row.actions.map((a) => a.tap)).toEqual(['not_now', 'apply']);
    expect(next.row.line.text).toContain('4');
    expect(next.row.info.join(' ')).toContain('Two weeks with no gain.');
    expect(await ben.s.blockProgress.tapNext(next.sessionId, next.row, 'apply')).toEqual({ ok: true });
    const after = (await ben.s.blockProgress.liftDetail(null, id, 'connected'))?.next;
    expect(after?.row.actions.map((a) => a.tap)).toEqual(['undo']);
    // A repeat Apply on the old read is the same op ID: it replays, never writes twice (rule 5).
    const rowsAfter = await ben.s.coach.nextTargets(next.sessionId);
    expect(await ben.s.blockProgress.tapNext(next.sessionId, next.row, 'apply')).toEqual({ ok: true });
    expect(await ben.s.coach.nextTargets(next.sessionId)).toEqual(rowsAfter);
    expect(rowsAfter.find((r) => r.exerciseId === id)?.status).toBe('applied');
    // Skip on the read from before Apply: a stale version, refused; Apply stands.
    expect(await ben.s.blockProgress.tapNext(next.sessionId, next.row, 'not_now')).toMatchObject({ ok: false });
    expect((await ben.s.coach.nextTargets(next.sessionId)).find((r) => r.exerciseId === id)?.status).toBe('applied');
    if (after == null) throw new Error('no Undo');
    expect(await ben.s.blockProgress.tapNext(after.sessionId, after.row, 'undo')).toEqual({ ok: true });
    const back = (await ben.s.blockProgress.liftDetail(null, id, 'connected'))?.next;
    expect(back?.row.actions.length).toBeGreaterThan(0);
    expect(back?.row.actions.some((a) => a.tap === 'undo')).toBe(false);
  });

  it('no coach: a stalled lift with no rule reset shows its pill and no fix to apply (nothing invented)', async () => {
    ben = await benWithBlocks();
    const d = await ben.s.blockProgress.liftDetail(null, ben.accessory.exerciseId);
    expect(d?.view.stalled).toBe(true);
    expect(d?.next?.row.actions.some((a) => a.tap === 'apply') ?? false).toBe(false);
  });

  it('the stalled main lift (top set + back-offs), no AI: the rule’s reset as `Top … · back-off …` with Skip / Apply; Apply changes next week’s plan day, Undo puts it back (decision 1)', async () => {
    ben = await benWithBlocks();
    const mainId = ben.plans[2]?.mainId ?? '';
    const d = await ben.s.blockProgress.liftDetail(null, mainId);
    expect(d?.view.pill).toEqual({ text: 'Stalled 2 weeks', tone: 'stalled' });
    expect(d?.view.table.every((r) => r.e1rm === '—' || r.e1rm.endsWith(' est.'))).toBe(true);
    const next = d?.next;
    if (next == null) throw new Error('no Next week row');
    // 70 × 2 twice against 3–6: the built-in rule's own stall reset (playbook rule 8), snapped to the bar; the back-off moves with it.
    expect(next.row.line.text).toBe('Top 70×6 → 65×3–6 kg · back-off 65');
    expect(next.row.info[0]).toBe('Rule');
    expect(next.row.actions.map((a) => a.tap)).toEqual(['not_now', 'apply']);
    expect(await ben.s.blockProgress.tapNext(next.sessionId, next.row, 'apply')).toEqual({ ok: true });
    const after = (await ben.s.blockProgress.liftDetail(null, mainId))?.next;
    expect(after?.row.actions.map((a) => a.tap)).toEqual(['undo']);
    // End to end: the plan day's next start plans the top at 65 (the workout started from this one).
    const plannedTop = async () => {
      const preview = await ben?.s.workout.start({ gymId: ben.gymId, opId: ben.h.ids(), checkIn: null, routineOf: ben.plans[2]?.routineId ?? '' });
      if (preview?.ok !== true) throw new Error('not started');
      const ex = preview.aggregate.exercises.find((e) => e.exerciseId === mainId);
      const top = preview.aggregate.sets.find((x) => x.sessionExerciseId === ex?.id && x.setType === 'top')?.planned.load?.value;
      const v = (await ben?.s.workout.load(preview.aggregate.session.id))?.aggregate.session.version ?? 0;
      await ben?.s.workout.dispatch(preview.aggregate.session.id, { type: 'discard', at: ben.h.now(), opId: ben.h.ids(), expectedVersion: v, confirmedLoggedSets: 0 });
      return top;
    };
    expect(await plannedTop()).toBe(65);
    if (after == null) throw new Error('no Undo');
    expect(await ben.s.blockProgress.tapNext(after.sessionId, after.row, 'undo')).toEqual({ ok: true });
    expect((await ben.s.blockProgress.liftDetail(null, mainId))?.next?.row.actions.map((a) => a.tap)).toEqual(['not_now', 'apply']);
    expect(await plannedTop()).toBe(70);
  });

  it('the main lift with the coach connected: its top-set change reads `Top … · back-off …`; lighter + fewer reps is a bigger change, Skip / Apply (rule 3)', async () => {
    let model = new StepModel([]);
    ben = await benWithBlocks({ coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
    const mainId = ben.plans[2]?.mainId ?? '';
    model = new StepModel([
      (req) => {
        const w = contextWorkout(req);
        return toolCall('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: mainId, target: { load: { value: 67.5, unit: 'kg', convention: 'total' }, reps: { min: 4, max: 6 } }, sets: null, reason: 'Two misses at 70.' }] });
      },
      () => replyWith('A little lighter next week.'),
    ]);
    expect(await ben.s.coach.runSummaryTurn(ben.accessory.latestSessionId)).not.toBeNull();
    const next = (await ben.s.blockProgress.liftDetail(null, mainId, 'connected'))?.next;
    if (next == null) throw new Error('no Next week row');
    expect(next.row.line.text).toMatch(/^Top 70×6 → 67\.5×4–6 kg · back-off \d+(\.5)?$/);
    expect(next.row.tag).toBe('Suggested');
    expect(next.row.actions.map((a) => a.tap)).toEqual(['not_now', 'apply']);
    expect(await ben.s.blockProgress.tapNext(next.sessionId, next.row, 'apply')).toEqual({ ok: true });
    expect((await ben.s.blockProgress.liftDetail(null, mainId, 'connected'))?.next?.row.actions.map((a) => a.tap)).toEqual(['undo']);
  });

  it('a pain flag on the lift: the coach’s change is not offered to apply (rule 9)', async () => {
    let model = new StepModel([]);
    ben = await benWithBlocks({ coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
    const id = ben.accessory.exerciseId;
    model = new StepModel([
      (req) => {
        const w = contextWorkout(req);
        return toolCall('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: id, target: { load: { value: 20, unit: 'kg', convention: 'per_hand' }, reps: { min: 6, max: 8 } }, sets: 4, reason: 'Stalled.' }] });
      },
      () => replyWith('One change.'),
    ]);
    await ben.s.coach.runSummaryTurn(ben.accessory.latestSessionId);
    expect((await ben.s.pain.flagMovement({ exerciseId: id, exerciseName: 'Accessory', opId: 'pain-block' })).ok).toBe(true);
    const d = await ben.s.blockProgress.liftDetail(null, id, 'connected');
    expect(d?.next?.row.actions.some((a) => a.tap === 'apply') ?? false).toBe(false);
  });

  it('an off-plan workout in the block’s weeks counts for its lifts', async () => {
    ben = await benWithBlocks();
    const blocks = await ben.s.blockProgress.blocks();
    const d = await ben.s.blockProgress.liftDetail(blocks?.rows[0]?.key ?? null, (await pulldownId(ben)) ?? '');
    expect(d?.view.latestSessionId).toBe(ben.offPlanSessionId);
    expect(d?.view.table.find((r) => r.week === '3')?.topSet).toBe('59×10 kg');
  });

  it('a week with only an off-plan workout is a block week by date; its sets count (decision 4)', async () => {
    ben = await benWithBlocks();
    const { h, s, gymId } = ben;
    // Week 4 (26 Oct): no plan day, one off-plan bench workout.
    h.clockMs = Date.parse('2026-10-27T17:00:00.000Z');
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 72.5, reps: 6, rpe: 8 }] }]);
    h.clockMs = Date.parse('2026-11-03T12:00:00.000Z');
    expect((await s.blockProgress.thisBlock())?.meta).toBe('Week 5 of 6');
    const d = await s.blockProgress.liftDetail(null, ben.plans[2]?.mainId ?? '');
    expect(d?.view.table.find((r) => r.week === '4')?.topSet).toBe('72.5×6 kg');
    // A gain after the stall ends it.
    expect(d?.view.stalled).toBe(false);
  });

  it('Library › Plan’s line: `1 stalled` (nothing up yet this block)', async () => {
    ben = await benWithBlocks();
    expect(await ben.s.blockProgress.planLine()).toBe('1 stalled');
  });

  it('survives a restart: the same blocks read again after a relaunch (nothing stored)', async () => {
    ben = await benWithBlocks();
    const before = await ben.s.blockProgress.blocks();
    const { services } = await ben.h.launch();
    const after = await services.blockProgress.blocks();
    expect(after?.rows).toEqual(before?.rows);
  });
});
