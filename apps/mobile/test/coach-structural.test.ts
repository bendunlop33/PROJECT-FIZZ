import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';
import type { ActionRecord } from '@fizz/schemas';

import { coachLandOpId, type BuilderSnapshot, type BuilderWriteResult } from '../src/builder/builder-service';
import { threadRows } from '../src/coach/sheet-view';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 23 Oct, D8; review retire-workout-overview B3) The coach's `next workout` change
 * (`propose_next_workout_change`, ADR 0020 §3) is a card with before/after, offered only when Ben asks or something
 * changed (rule 3). Nothing changes until Apply. Applied, it lands on that workout's Your workout draft as a
 * today-only edit with `✦ … · Undo` (Do again, a library workout, a plan day on Today's card, Up next), so Today's
 * one-tap Start starts it too. Undo on the card or on Your workout takes it back (rule 5: only while it is still the
 * draft's last change, and not once the workout started); a pain flag or a missing exercise stops it landing (rules
 * 4, 9). Real SQLite, scripted model, offline for everything but the scripted coach.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const PUSH = ['Bench press', 'Lateral raise', 'Triceps pushdown'];

async function pushDay(): Promise<{ s: AppServices; gymId: string; sessionId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const sessionId = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }] },
    { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }] },
  ]);
  h.clockMs += DAY;
  return { s, gymId, sessionId };
}

function outputsOf(req: ModelRequest): { status: string; data: unknown }[] {
  return req.input.flatMap((i) => (i.type === 'function_call_output' ? [JSON.parse(i.output) as { status: string; data: unknown }] : []));
}

const ask = (s: AppServices, text: string) => s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
const names = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((x) => snap.facts[x.exerciseId]?.name ?? '?');
const opened = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`open ${r.status}: ${r.message}`);
  return r.snapshot;
};

/** Ben asks; the model reads swap options for `fromName` in that workout and proposes the first. */
async function proposeSwap(s: AppServices, sessionId: string, fromName: string): Promise<{ threadId: string; card: ActionRecord; toName: string; toId: string }> {
  const agg = (await s.workout.load(sessionId))?.aggregate;
  const from = agg?.exercises.find((e) => e.exerciseName === fromName);
  const steps: ((req: ModelRequest) => ModelEvent[])[] = [
    () => toolCall('get_substitutions', { exerciseId: from?.exerciseId }),
    (req) => {
      const options = (outputsOf(req)[0]?.data as { options: { exerciseId: string; name: string }[] }).options;
      return toolCall('propose_next_workout_change', { sourceSessionId: sessionId, sourceVersion: agg?.session.version ?? 1, changes: [{ change: 'swap', fromExerciseId: from?.exerciseId, toExerciseId: options[0]?.exerciseId }], reason: 'Some variety.' });
    },
    () => replyWith('Here is a swap to try.'),
  ];
  model = new StepModel(steps);
  const r = await ask(s, `Swap the ${fromName.toLowerCase()} for something else next time`);
  expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_next_workout_change');
  const card = r.cards.find((c) => c.record.detail.kind === 'propose_next_workout_change')?.record;
  if (card?.detail.kind !== 'propose_next_workout_change' || card.status !== 'proposed') throw new Error(`no card: ${String(card?.status)} ${String(card?.failure)}`);
  const op = card.detail.ops?.[0];
  if (op?.change !== 'swap') throw new Error('no swap');
  return { threadId: r.threadId, card, toName: op.toName, toId: op.toExerciseId };
}

async function cardOf(s: AppServices, threadId: string) {
  const thread = await s.coach.loadThread(threadId);
  if (thread === null) throw new Error('no thread');
  const row = threadRows(thread).find((x) => x.kind === 'card');
  return row?.kind === 'card' ? row.card : null;
}

async function apply(s: AppServices, card: ActionRecord): Promise<string> {
  const a = await s.coach.tapProposal(card.actionId, 'apply');
  if (!a.ok) throw new Error(`not applied: ${String(a.state)}`);
  return a.record.actionId;
}

describe('the coach’s next-workout change lands on Your workout (D8)', () => {
  it('a card first; nothing changes until Apply; Apply lands on that workout’s Your workout with ✦ · Undo, once; the card’s Undo takes it back there', async () => {
    const { s, sessionId } = await pushDay();
    const { threadId, card, toName } = await proposeSwap(s, sessionId, 'Triceps pushdown');
    expect(card.detail).toMatchObject({ landsOn: 'your_workout', basis: { kind: 'next', sourceSessionId: sessionId }, before: PUSH, after: ['Bench press', 'Lateral raise', toName] });
    expect((await cardOf(s, threadId))?.status.word).toBe('Suggested');
    // Do again (the next session from that workout) is unchanged before Apply.
    const before = opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-before'));
    expect(names(before)).toEqual(PUSH);

    // Apply (a double tap is one write).
    const applyId = await apply(s, card);
    expect(await apply(s, card)).toBe(applyId);
    const r = await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-after');
    expect(r.status).toBe('written');
    const landed = opened(r);
    expect(landed.draftId).toBe(before.draftId);
    expect(names(landed)).toEqual(['Bench press', 'Lateral raise', toName]);
    expect(r.status === 'written' ? r.toast : null).toEqual({ text: `✦ Triceps pushdown → ${toName}`, undoOpId: coachLandOpId(applyId), why: null });
    // Opening again (or the page's reload) writes nothing more.
    const again = await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-again');
    expect(again.status).toBe('replayed');
    expect(await s.builder.landCoachChanges(landed.draftId)).toBeNull();
    expect((await cardOf(s, threadId))?.proposal).toMatchObject({ canApply: false, undoActionId: applyId });
    expect((await cardOf(s, threadId))?.status.word).toBe('Applied');

    // The card's Undo: Your workout goes back, and the change never lands again (another day either).
    const undone = await s.coach.undo(applyId, `undo:${applyId}`);
    expect(undone.result.status).toBe('written');
    const back = await s.builder.read(landed.draftId);
    expect(back === null ? null : names(back)).toEqual(PUSH);
    expect((await cardOf(s, threadId))?.status.word).toBe('Undone');
    h.clockMs += DAY;
    expect(names(opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-next-day')))).toEqual(PUSH);
  });

  it('Undo on Your workout undoes the coach’s Apply too: the card reads Undone and it never lands on another day', async () => {
    const { s, sessionId } = await pushDay();
    const { threadId, card } = await proposeSwap(s, sessionId, 'Triceps pushdown');
    const applyId = await apply(s, card);
    const landed = opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-1'));
    const u = await s.builder.undo(landed.draftId, coachLandOpId(applyId), 'page-undo');
    expect(u.status).toBe('written');
    expect(u.snapshot === null ? null : names(u.snapshot)).toEqual(PUSH);
    expect((await cardOf(s, threadId))?.status.word).toBe('Undone');
    // After a force-close, and on another day: not back.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    h.clockMs += DAY;
    expect(names(opened(await s2.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-2')))).toEqual(PUSH);
  });

  it('the card’s Undo after Ben edited Your workout since is refused (rule 5): his workout keeps the change and the card keeps Undo', async () => {
    const { s, sessionId } = await pushDay();
    const { threadId, card, toName } = await proposeSwap(s, sessionId, 'Triceps pushdown');
    const applyId = await apply(s, card);
    const landed = opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-1'));
    const bench = slotsOf(landed.workout.blocks).find((x) => landed.facts[x.exerciseId]?.name === 'Bench press');
    if (bench === undefined) throw new Error('no bench');
    opened(await s.builder.edit(landed.draftId, { kind: 'add_set', slotKey: bench.key }, { opId: 'ben-set', basis: { version: landed.version } }));
    const undone = await s.coach.undo(applyId, `undo:${applyId}`);
    expect(undone.result).toMatchObject({ status: 'not_possible', reason: 'changed_since' });
    const now = await s.builder.read(landed.draftId);
    expect(now === null ? null : names(now)).toEqual(['Bench press', 'Lateral raise', toName]);
    expect((await cardOf(s, threadId))?.proposal?.undoActionId).toBe(applyId);
  });

  it('applied today, opened another day: it lands on that day’s draft; Start starts it, the card is used and Undo is refused', async () => {
    const { s, gymId, sessionId } = await pushDay();
    const { threadId, card, toName } = await proposeSwap(s, sessionId, 'Triceps pushdown');
    const applyId = await apply(s, card);
    h.clockMs += 2 * DAY;
    const landed = opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-later'));
    expect(names(landed)).toEqual(['Bench press', 'Lateral raise', toName]);
    const started = await s.builder.start(landed.draftId, { opId: 'start-later', expectedVersion: landed.version, gymId, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    expect(a?.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseName)).toEqual(['Bench press', 'Lateral raise', toName]);
    expect((await cardOf(s, threadId))?.proposal?.undoActionId).toBeNull();
    expect((await s.coach.undo(applyId, `undo:${applyId}`)).result).toMatchObject({ status: 'not_possible', reason: 'changed_since' });
  });

  it('a pain flag on the exercise swapped in since the Apply stops it landing (rule 9); the card reads Couldn’t apply here', async () => {
    const { s, sessionId } = await pushDay();
    const { threadId, card, toName, toId } = await proposeSwap(s, sessionId, 'Triceps pushdown');
    await apply(s, card);
    expect((await s.pain.flagMovement({ exerciseId: toId, exerciseName: toName, opId: 'pain-1' })).ok).toBe(true);
    expect(names(opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-1')))).toEqual(PUSH);
    expect((await cardOf(s, threadId))?.status.word).toBe('Couldn’t apply here');
  });
});

describe('D8 review fixes (batch23 S1, S2, S5, M1)', () => {
  /** Ben asks for a second swap (`fromName`), avoiding what the first brought in; the first option otherwise. */
  async function proposeAnother(s: AppServices, sessionId: string, fromName: string, avoid: string): Promise<ActionRecord> {
    const agg = (await s.workout.load(sessionId))?.aggregate;
    const from = agg?.exercises.find((e) => e.exerciseName === fromName);
    model = new StepModel([
      () => toolCall('get_substitutions', { exerciseId: from?.exerciseId }),
      (req) => {
        const options = (outputsOf(req)[0]?.data as { options: { exerciseId: string; name: string }[] }).options.filter((o) => o.name !== avoid);
        return toolCall('propose_next_workout_change', { sourceSessionId: sessionId, sourceVersion: agg?.session.version ?? 1, changes: [{ change: 'swap', fromExerciseId: from?.exerciseId, toExerciseId: options[0]?.exerciseId }], reason: 'Some variety.' });
      },
      () => replyWith('Here is another swap.'),
    ]);
    const r = await ask(s, `Swap the ${fromName.toLowerCase()} too next time`);
    const card = r.cards.find((c) => c.record.detail.kind === 'propose_next_workout_change')?.record;
    if (card?.detail.kind !== 'propose_next_workout_change' || card.status !== 'proposed') throw new Error('no second card');
    return card;
  }

  it('two applied changes land together as one edit: one line with both, kept on the page with Undo; Undo takes both back and both cards read Undone (S5, S1)', async () => {
    const { s, sessionId } = await pushDay();
    const first = await proposeSwap(s, sessionId, 'Triceps pushdown');
    const firstId = await apply(s, first.card);
    h.clockMs += 60_000;
    const second = await proposeAnother(s, sessionId, 'Lateral raise', first.toName);
    const secondId = await apply(s, second);
    const op = second.detail.kind === 'propose_next_workout_change' ? second.detail.ops?.[0] : undefined;
    const secondTo = op?.change === 'swap' ? op.toName : '';
    const r = await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-both');
    const landed = opened(r);
    expect(names(landed)).toEqual(['Bench press', secondTo, first.toName]);
    expect(r.status === 'written' ? r.toast : null).toEqual({ text: `✦ Triceps pushdown → ${first.toName} · Lateral raise → ${secondTo}`, undoOpId: coachLandOpId(firstId), why: null });
    // Reopened (the toast gone): the line and its Undo are still on the page.
    const again = await s.builder.read(landed.draftId);
    expect(again?.coachLanded).toEqual({ text: `✦ Triceps pushdown → ${first.toName} · Lateral raise → ${secondTo}`, undoOpId: coachLandOpId(firstId) });
    const u = opened(await s.builder.undo(landed.draftId, coachLandOpId(firstId), 'page-undo'));
    expect(names(u)).toEqual(PUSH);
    expect(u.coachLanded).toBeNull();
    const t1 = (await s.coach.loadThread(first.threadId)) === null ? null : await cardOf(s, first.threadId);
    expect(t1?.status.word).toBe('Undone');
    expect((await s.coach.getAction(secondId))?.undoneBy).not.toBeNull();
  });

  it('the chat card’s Undo of one of two changes landed together takes the landing back; the other card reads Undone too, never stuck as Applied (S3)', async () => {
    const { s, sessionId } = await pushDay();
    const first = await proposeSwap(s, sessionId, 'Triceps pushdown');
    const firstId = await apply(s, first.card);
    h.clockMs += 60_000;
    const second = await proposeAnother(s, sessionId, 'Lateral raise', first.toName);
    const secondId = await apply(s, second);
    const landed = opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-both'));
    expect(names(landed)).not.toEqual(PUSH);
    const undone = await s.coach.undo(secondId, `undo:${secondId}`);
    expect(undone.result.status).toBe('written');
    const back = await s.builder.read(landed.draftId);
    expect(back === null ? null : names(back)).toEqual(PUSH);
    expect((await s.coach.getAction(firstId))?.undoneBy).not.toBeNull();
    expect((await cardOf(s, first.threadId))?.status.word).toBe('Undone');
  });

  it('a landing taken back on Your workout whose Apply wasn’t marked (a force-close between the two writes) is marked on the next open; it never lands again (S2)', async () => {
    const { s, sessionId } = await pushDay();
    const { threadId, card } = await proposeSwap(s, sessionId, 'Triceps pushdown');
    const applyId = await apply(s, card);
    const landed = opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-1'));
    // The second write (the coach record) never happens.
    const real = Object.getOwnPropertyDescriptor(s.coach, 'noteNextWorkoutChangeUndone');
    if (real === undefined) throw new Error('no coach record write');
    s.coach.noteNextWorkoutChangeUndone = () => Promise.resolve();
    opened(await s.builder.undo(landed.draftId, coachLandOpId(applyId), 'page-undo'));
    Object.defineProperty(s.coach, 'noteNextWorkoutChangeUndone', real);
    expect((await cardOf(s, threadId))?.status.word).toBe('Applied');
    // Next open (another day too): put right, nothing lands.
    h.clockMs += DAY;
    expect(names(opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-2')))).toEqual(PUSH);
    expect((await cardOf(s, threadId))?.status.word).toBe('Undone');
  });

  it('undone in chat but still on Your workout (a force-close before the draft went back): the next open takes it off (S2)', async () => {
    const { s, sessionId } = await pushDay();
    const { threadId, card } = await proposeSwap(s, sessionId, 'Triceps pushdown');
    const applyId = await apply(s, card);
    const landed = opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-1'));
    // Only the coach record's write happens.
    await s.coach.noteNextWorkoutChangeUndone(applyId);
    expect((await cardOf(s, threadId))?.status.word).toBe('Undone');
    expect(names(opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-2')))).toEqual(PUSH);
    expect((await s.builder.read(landed.draftId))?.coachLanded).toBeNull();
  });

  it('a Reload (the saved workout renamed) lands the coach’s change again in the same write: the card’s Applied stays true (M1)', async () => {
    const { s, gymId, sessionId } = await pushDay();
    const saved = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name: 'Push A', addToRotation: true, opId: 'save-push-a' });
    if (!saved.ok) throw new Error(saved.message);
    const day = opened(await s.builder.openTarget({ kind: 'routine', routineId: saved.routine.id }, 'open-push-a'));
    const done = await s.builder.start(day.draftId, { opId: 'start-push-a', expectedVersion: day.version, gymId, checkIn: null });
    if (!done.ok) throw new Error(done.message);
    await finishWorkout(h, s, done.sessionId);
    h.clockMs += DAY;
    const { card, toName } = await proposeSwap(s, done.sessionId, 'Triceps pushdown');
    await apply(s, card);
    const landed = opened(await s.builder.openTarget({ kind: 'routine', routineId: saved.routine.id }, 'open-landed'));
    expect(names(landed)).toEqual(['Bench press', 'Lateral raise', toName]);
    const r = await s.routines.editor({ routineId: saved.routine.id, gymId: null });
    expect((await s.routines.rename({ routineId: saved.routine.id, name: 'Push B', expectedVersion: r?.routine?.version ?? 0, opId: 'rename-1' })).ok).toBe(true);
    const read = await s.builder.read(landed.draftId);
    expect(read?.planDayChanged?.silent).toBe(false);
    const reloaded = opened(await s.builder.reloadPlanDay(landed.draftId, { opId: 'reload-1', expectedVersion: read?.version ?? 0 }));
    expect(names(reloaded)).toEqual(['Bench press', 'Lateral raise', toName]);
    expect(await s.builder.landCoachChanges(landed.draftId)).toBeNull();
    // Reload's Undo puts back what was there (the change included).
    expect(names(opened(await s.builder.undo(landed.draftId, 'reload-1', 'undo-reload')))).toEqual(['Bench press', 'Lateral raise', toName]);
  });
});

describe('Today: a plan day’s card and Up next start it in one tap (D8)', () => {
  const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
  const DAYS: [string, string, string[]][] = [
    ['Push', 'push', ['Bench press', 'Lateral raise', 'Triceps pushdown']],
    ['Pull', 'pull', ['Lat pulldown', 'Barbell row']],
  ];
  const planStub = (req: ModelRequest): ModelEvent[] => {
    const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
    if (block?.type !== 'message') throw new Error('no context');
    const usable = (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build: { usable: { catalogueId: string; name: string }[] } }).build.usable;
    const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
    return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((n) => ex(idOf(n))) })), message: 'Push, pull.', minutes: null, gymName: null });
  };

  it('a plan day: the change lands on Today’s card for that day (`· edited`) and its Start starts it', async () => {
    const { s, gymId } = await pushDay();
    model = new StepModel([planStub, () => replyWith('Here is your week.')]);
    const built = await ask(s, 'Build me a 2-day plan');
    const plan = built.cards[0]?.record;
    if (plan?.detail.kind !== 'build_plan') throw new Error('no plan');
    const c = await s.plans.card({ planId: plan.detail.planId, versionN: 1 });
    expect(await s.plans.apply({ planId: plan.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-plan' })).toMatchObject({ ok: true });
    const push = (await s.plans.active())?.days[0]?.routineId;
    if (push === undefined) throw new Error('no push day');
    // Push from its plan day, then the coach's change for next Push.
    const day = opened(await s.builder.openTemplate({ routineId: push }, 'open-push'));
    const done = await s.builder.start(day.draftId, { opId: 'start-push', expectedVersion: day.version, gymId, checkIn: null });
    if (!done.ok) throw new Error(done.message);
    await finishWorkout(h, s, done.sessionId);
    h.clockMs += DAY;
    const { card, toName } = await proposeSwap(s, done.sessionId, 'Triceps pushdown');
    expect(card.detail).toMatchObject({ basis: { kind: 'routine', routineId: push } });
    await apply(s, card);

    const data = await s.todaySession.load();
    if (data === null) throw new Error('no Today');
    const pushKey = data.days.find((d) => d.name === 'Push')?.key ?? '';
    const controls = data.initial[pushKey];
    if (controls === undefined) throw new Error('no controls');
    const view = s.todaySession.card(data, { dayKey: pushKey, controls });
    expect(view?.title).toMatch(/· edited$/);
    expect(view?.rows.map((r) => r.name)).toContain(toName);
    expect(view?.rows.map((r) => r.name)).not.toContain('Triceps pushdown');
    // Loading again lands nothing more.
    const again = await s.todaySession.load();
    expect(again === null ? null : s.todaySession.card(again, { dayKey: pushKey, controls })?.edited?.version).toBe(view?.edited?.version);
    const committed = await s.todaySession.commit(data, { dayKey: pushKey, controls }, 'commit-push');
    if (!committed.ok) throw new Error(committed.message);
    const started = await s.todaySession.start({ draftId: committed.draftId, expectedVersion: committed.version, gymId, opId: 'start-next-push', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    expect(started.aggregate.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseName)).toContain(toName);
  });

  it('no plan: Up next’s Your workout takes it; Up next reads `· edited` and its Start starts that draft', async () => {
    const { s, gymId, sessionId } = await pushDay();
    const saved = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name: 'Push A', addToRotation: true, opId: 'save-push-a' });
    if (!saved.ok) throw new Error(saved.message);
    const pushA = saved.routine;
    const day = opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-push-a'));
    const done = await s.builder.start(day.draftId, { opId: 'start-push-a', expectedVersion: day.version, gymId, checkIn: null });
    if (!done.ok) throw new Error(done.message);
    await finishWorkout(h, s, done.sessionId);
    h.clockMs += DAY;
    const { card, toName } = await proposeSwap(s, done.sessionId, 'Triceps pushdown');
    expect(card.detail).toMatchObject({ basis: { kind: 'routine', routineId: pushA.id }, workoutLabel: 'Push A' });
    await apply(s, card);

    const data = await s.todaySession.load();
    expect(data?.status).toBe('no_plan');
    expect(data?.upNext?.routineId).toBe(pushA.id);
    const edited = data?.upNext?.edited ?? null;
    if (edited === null) throw new Error('Up next isn’t the edited draft');
    const draft = await s.builder.read(edited.draftId);
    expect(draft === null ? null : names(draft)).toEqual(['Bench press', 'Lateral raise', toName]);
    const started = await s.builder.start(edited.draftId, { opId: 'start-up-next', expectedVersion: edited.version, gymId, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    expect(a?.session.routineId).toBe(pushA.id);
    expect(a?.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseName)).toEqual(['Bench press', 'Lateral raise', toName]);
  });
});

describe('only when Ben asks or something changed (rule 3)', () => {
  it('a plain question never gets the structural tool; a call to it anyway changes nothing and makes no card', async () => {
    const { s, sessionId } = await pushDay();
    const agg = (await s.workout.load(sessionId))?.aggregate;
    const push = agg?.exercises.find((e) => e.exerciseName === 'Triceps pushdown');
    model = new StepModel([
      () => toolCall('propose_next_workout_change', { sourceSessionId: sessionId, sourceVersion: agg?.session.version ?? 1, changes: [{ change: 'remove', exerciseId: push?.exerciseId }], reason: 'Shorter.' }),
      () => replyWith('Going well.'),
    ]);
    const r = await ask(s, 'How am I doing?');
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('propose_next_workout_change');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('get_substitutions');
    expect(r.cards.filter((c) => c.record.detail.kind === 'propose_next_workout_change' && c.record.status === 'proposed')).toEqual([]);
    expect(names(opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sessionId }, 'open-after-call')))).toEqual(PUSH);
  });

  it('a pain flag since that workout opens the tool without a request; a pain-flagged exercise is never swapped in', async () => {
    const { s, sessionId } = await pushDay();
    const agg = (await s.workout.load(sessionId))?.aggregate;
    const bench = agg?.exercises.find((e) => e.exerciseName === 'Bench press');
    const lateral = agg?.exercises.find((e) => e.exerciseName === 'Lateral raise');
    if (bench === undefined || lateral === undefined) throw new Error('no exercises');
    h.clockMs += 60_000;
    expect((await s.pain.flagMovement({ exerciseId: lateral.exerciseId, exerciseName: 'Lateral raise', opId: h.ids() })).ok).toBe(true);
    const version = (await s.workout.load(sessionId))?.aggregate.session.version ?? 1;
    model = new StepModel([
      () => toolCall('propose_next_workout_change', { sourceSessionId: sessionId, sourceVersion: version, changes: [{ change: 'swap', fromExerciseId: bench.exerciseId, toExerciseId: lateral.exerciseId }], reason: 'Shoulder.' }),
      () => replyWith('Not that one.'),
    ]);
    const r = await ask(s, 'What do you think about my plan?');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_next_workout_change');
    expect(r.cards[0]?.record.status).toBe('rejected');
  });

  it('Apply on an unknown card is refused', async () => {
    const { s } = await pushDay();
    expect(await s.coach.tapProposal('00000000-0000-4000-8000-00000000abcd', 'apply')).toMatchObject({ ok: false });
  });
});
