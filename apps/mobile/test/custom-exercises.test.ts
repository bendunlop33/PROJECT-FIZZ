import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clashRefusalLine, FIND_FIRST_LINE, type ModelEvent, type ModelRequest } from '@fizz/coach';
import { NO_FILTERS } from '@fizz/domain';
import type { CustomExerciseFields } from '@fizz/schemas';

import { threadRows } from '../src/coach/sheet-view';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Ben's own exercises (19 Oct: "Why can't the chat function make exercises not in the catalogue").
 * Library › ＋ New exercise and the coach's proposal card make the same kind of row: owned by Ben
 * (Your data), versioned and idempotent, in backups, hidden (not erased) on delete. A name already
 * in his list is refused with that exercise. The coach proposes (rule 3), Ben taps Add, and the
 * exercise is then a normal one: the coach adds it to today's workout with loads planned on this
 * gym's equipment. Real SQLite, scripted model.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-19T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const MEADOWS: CustomExerciseFields = { name: 'Meadows row', equipment: 'barbell', loadConvention: 'total', primaryMuscles: ['lats', 'biceps'], measurement: 'reps', laterality: 'unilateral' };

const browseNames = async (s: AppServices, query = '') => (await s.library.browse({ query, filters: NO_FILTERS }))?.view.sections.flatMap((x) => x.rows) ?? [];

describe('custom exercises: create, edit, delete (Library)', () => {
  it('creates one owned by Ben; a retry is the same write; it is listed with a "Yours" tag and opens for Edit', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const a = await s.customExercises.create({ fields: MEADOWS, opId: 'new-1' });
    if (!a.ok) throw new Error(a.message);
    expect(a.exercise).toMatchObject({ source: 'custom', name: 'Meadows row', compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', primaryMuscles: ['lats', 'biceps'], laterality: 'unilateral', version: 1 });
    expect(a.exercise.ownerId).not.toBeNull();
    expect(await s.customExercises.create({ fields: MEADOWS, opId: 'new-1' })).toMatchObject({ ok: true, duplicate: true, exercise: { id: a.exercise.id } });
    const row = (await browseNames(s, 'meadows'))[0];
    expect(row).toMatchObject({ name: 'Meadows row', tags: [{ kind: 'custom', text: 'Yours' }] });
    expect((await s.library.detail(a.exercise.id))?.editable).toBe(true);
    // A catalogue exercise isn't editable.
    const bench = (await s.coachingKnowledge.exercises()).find((e) => e.name === 'Bench press');
    expect((await s.library.detail(bench?.id ?? ''))?.editable).toBe(false);
  });

  it('a name already in the list (by name, plural or other name) is refused with that exercise', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const calf = { ...MEADOWS, name: 'Seated calf raises', equipment: 'plate_loaded_machine' as const, loadConvention: 'added' as const, primaryMuscles: ['calves' as const], laterality: 'bilateral' as const };
    expect(await s.customExercises.create({ fields: calf, opId: 'c1' })).toMatchObject({ ok: false, reason: 'clash', message: 'Seated calf raise is already in your exercises.', clash: { name: 'Seated calf raise' } });
    expect(await s.customExercises.create({ fields: { ...calf, name: 'seated calf machine' }, opId: 'c2' })).toMatchObject({ ok: false, reason: 'clash', clash: { name: 'Seated calf raise' } });
    expect(await s.customExercises.nameClash('Seated Calf Raise')).toMatchObject({ name: 'Seated calf raise', line: 'Seated calf raise is already in your exercises.' });
    await s.customExercises.create({ fields: MEADOWS, opId: 'm1' });
    expect(await s.customExercises.create({ fields: { ...MEADOWS, name: 'meadows rows' }, opId: 'm2' })).toMatchObject({ ok: false, reason: 'clash', clash: { name: 'Meadows row' } });
    // A convention that doesn't fit the equipment is refused.
    expect(await s.customExercises.create({ fields: { ...MEADOWS, name: 'Odd', loadConvention: 'stack' }, opId: 'm3' })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('edit is versioned (stale refused, retry replays); after a logged set its shape is locked; delete hides it, history keeps it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const a = await s.customExercises.create({ fields: MEADOWS, opId: 'new-1' });
    if (!a.ok) throw new Error(a.message);
    const id = a.exercise.id;
    const e1 = await s.customExercises.edit({ exerciseId: id, fields: { ...MEADOWS, name: 'Meadows row (landmine)' }, expectedVersion: 1, opId: 'edit-1' });
    expect(e1).toMatchObject({ ok: true, exercise: { name: 'Meadows row (landmine)', version: 2 } });
    expect(await s.customExercises.edit({ exerciseId: id, fields: { ...MEADOWS, name: 'Meadows row (landmine)' }, expectedVersion: 1, opId: 'edit-1' })).toMatchObject({ ok: true, duplicate: true });
    expect(await s.customExercises.edit({ exerciseId: id, fields: MEADOWS, expectedVersion: 1, opId: 'edit-2' })).toMatchObject({ ok: false, reason: 'stale' });

    await logWorkout(h, s, gymId, [{ exercise: 'Meadows row (landmine)', sets: [{ load: 40, reps: 10 }] }]);
    const form = await s.customExercises.form(id);
    expect(form).toMatchObject({ version: 2, locked: true });
    expect(await s.customExercises.edit({ exerciseId: id, fields: { ...MEADOWS, name: 'Meadows row (landmine)', equipment: 'dumbbells', loadConvention: 'per_hand' }, expectedVersion: 2, opId: 'edit-3' })).toMatchObject({ ok: false, reason: 'locked' });
    expect(await s.customExercises.edit({ exerciseId: id, fields: { ...MEADOWS, name: 'Meadows row' }, expectedVersion: 2, opId: 'edit-4' })).toMatchObject({ ok: true, exercise: { version: 3 } });

    expect(await s.customExercises.remove({ exerciseId: id, expectedVersion: 2, opId: 'del-1' })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await s.customExercises.remove({ exerciseId: id, expectedVersion: 3, opId: 'del-2' })).toMatchObject({ ok: true, exercise: { version: 4 } });
    expect(await s.customExercises.remove({ exerciseId: id, expectedVersion: 3, opId: 'del-2' })).toMatchObject({ ok: true, duplicate: true });
    expect((await browseNames(s, 'meadows')).map((r) => r.name)).toEqual([]);
    // Pickers leave it out; its workout keeps it, named.
    const started = await s.workout.start({ gymId, opId: 'start-after-delete', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    expect((await s.workout.pickerExercises(started.aggregate.session.id, 'Meadows')).map((p) => p.exercise.name)).toEqual([]);
    const history = await s.progress.libraryHistory();
    expect(history?.sessions.some((x) => x.exercises.some((e) => e.exerciseId === id))).toBe(true);
    // The name is free again once it's deleted.
    expect(await s.customExercises.create({ fields: MEADOWS, opId: 'again' })).toMatchObject({ ok: true, duplicate: false });
  });

  it('is in backups: restore brings back the version that was backed up', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const a = await s.customExercises.create({ fields: MEADOWS, opId: 'new-1' });
    if (!a.ok) throw new Error(a.message);
    const made = await s.backups.backUpOnPhone('manual');
    if (!made.ok) throw new Error(made.error);
    const text = await s.restore.readOnPhone(made.record.fileName);
    if (text === null) throw new Error('no backup');
    expect(text).toContain('Meadows row');
    await s.customExercises.remove({ exerciseId: a.exercise.id, expectedVersion: 1, opId: 'del' });
    const p = await s.restore.prepare(text);
    if (!p.ok) throw new Error('preview');
    expect(await s.restore.restore(text, p.preview.stamp)).toMatchObject({ ok: true, status: 'restored' });
    expect((await browseNames(s, 'meadows')).map((r) => r.name)).toEqual(['Meadows row']);
    expect(await s.customExercises.form(a.exercise.id)).toMatchObject({ version: 1, fields: MEADOWS });
  });
});

function contextAddable(req: ModelRequest): { exerciseId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { addable?: { exerciseId: string; name: string }[] }).addable ?? [];
}
const outputOf = (req: ModelRequest): unknown => {
  const last = [...req.input].reverse().find((i) => i.type === 'function_call_output');
  return last?.type === 'function_call_output' ? JSON.parse(last.output) : null;
};
const meadowsArgs = { name: 'Meadows row', equipment: 'barbell', loadConvention: null, primaryMuscles: ['lats', 'biceps'], measurement: 'reps', laterality: 'unilateral', reason: 'Ben asked for it.' };

async function liveWorkout(s: AppServices): Promise<{ gymId: string; sessionId: string }> {
  const gymId = await setUpGym(h, s);
  const started = await s.workout.start({ gymId, opId: 'start-pull', checkIn: null });
  if (!started.ok) throw new Error(started.error.message);
  return { gymId, sessionId: started.aggregate.session.id };
}
const sayIn = (s: AppServices, sessionId: string, text: string, threadId: string | null = null) => s.coach.send({ entry: { kind: 'workout', sessionId }, threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

describe('the coach proposes a new exercise; Ben taps Add; the coach uses it', () => {
  it('propose → card (nothing saved) → Add (once) → "Added Meadows row." → edit_today adds it with loads on this gym’s barbell', async () => {
    const { services: s } = await h.launch();
    const { sessionId } = await liveWorkout(s);
    model = new StepModel([
      () => toolCall('find_exercises', { query: 'meadows row', muscle: null, equipment: null }),
      () => toolCall('propose_exercise', meadowsArgs),
      () => replyWith('Tap Add and I’ll put it in.'),
    ]);
    const r = await sayIn(s, sessionId, 'Can you add meadows rows?');
    const card = r.cards.find((c) => c.record.detail.kind === 'propose_exercise')?.record;
    expect(card).toMatchObject({ status: 'proposed', detail: { kind: 'propose_exercise', fields: { name: 'Meadows row', equipment: 'barbell', loadConvention: 'total', primaryMuscles: ['lats', 'biceps'], measurement: 'reps', laterality: 'unilateral' } } });
    if (card?.detail.kind !== 'propose_exercise') throw new Error('no card');
    // Rule 3: a proposal. Nothing in his list yet.
    expect((await browseNames(s, 'meadows')).map((x) => x.name)).toEqual([]);
    const thread = await s.coach.loadThread(r.threadId);
    const row = thread === null ? undefined : threadRows(thread).find((x) => x.kind === 'card' && x.card.actionId === card.actionId);
    expect(row?.kind === 'card' ? [row.card.status.word, row.card.text, row.card.newExercise?.canAdd] : null).toEqual(['Suggested', 'New exercise: Meadows row · Barbell · total load · Back, Biceps · reps · each side', true]);

    // Add: saved now; a double tap saves once.
    const added = await s.coach.addProposedExercise({ actionId: card.actionId, opId: `${card.actionId}:add` });
    if (!added.ok) throw new Error(added.message);
    expect(added.exercise.id).toBe(card.detail.exerciseId);
    expect(await s.coach.addProposedExercise({ actionId: card.actionId, opId: 'second-tap' })).toMatchObject({ ok: true, duplicate: true });
    expect(await s.coach.exerciseProposal(card.actionId)).toMatchObject({ state: 'added' });

    // Ben's "Added Meadows row." carries the coach on: it adds it to today's workout.
    let addable: { exerciseId: string; name: string }[] = [];
    model = new StepModel([
      (req): ModelEvent[] => {
        addable = contextAddable(req);
        const w = contextWorkout(req);
        const id = addable.find((x) => x.name === 'Meadows row')?.exerciseId ?? 'missing';
        return toolCall('edit_today', { baseVersion: w.version, ops: [{ op: 'add', exerciseId: id, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, afterSessionExerciseId: null, supersetWithSessionExerciseId: null }], reason: 'Ben asked.', benAsked: true, benQuote: 'Can you add meadows rows?' });
      },
      () => replyWith('In.'),
    ]);
    const r2 = await sayIn(s, sessionId, 'Added Meadows row.', r.threadId);
    expect(addable.map((x) => x.name)).toContain('Meadows row');
    expect(r2.cards[0]?.record).toMatchObject({ status: 'committed', detail: { kind: 'edit_today', added: [{ exerciseName: 'Meadows row', sets: 3 }] } });
    const w = await s.workout.load(sessionId);
    const ex = w?.aggregate.exercises.find((e) => e.exerciseName === 'Meadows row');
    // On this gym's barbell (rule 4): total load, kg; first time, no load guessed.
    expect(ex).toMatchObject({ exerciseId: added.exercise.id, loadConvention: 'total', unit: 'kg' });
    expect(ex?.equipmentId).not.toBeNull();
    // The card now reads Added.
    const after = await s.coach.loadThread(r.threadId);
    const cardRow = after === null ? undefined : threadRows(after).find((x) => x.kind === 'card' && x.card.actionId === card.actionId);
    expect(cardRow?.kind === 'card' ? [cardRow.card.status.word, cardRow.card.newExercise] : null).toEqual(['Added', undefined]);
  });

  it('Edit then Save is the Add (Ben’s fields win); the same card can’t add a second exercise', async () => {
    const { services: s } = await h.launch();
    const { sessionId } = await liveWorkout(s);
    model = new StepModel([() => toolCall('find_exercises', { query: 'meadows', muscle: null, equipment: null }), () => toolCall('propose_exercise', meadowsArgs), () => replyWith('Here.')]);
    const r = await sayIn(s, sessionId, 'add meadows rows');
    const card = r.cards.find((c) => c.record.detail.kind === 'propose_exercise')?.record;
    if (card === undefined) throw new Error('no card');
    const saved = await s.coach.addProposedExercise({ actionId: card.actionId, opId: 'form-op', fields: { ...MEADOWS, name: 'Landmine Meadows row' } });
    expect(saved).toMatchObject({ ok: true, duplicate: false, exercise: { name: 'Landmine Meadows row' } });
    expect(await s.coach.addProposedExercise({ actionId: card.actionId, opId: 'add-op' })).toMatchObject({ ok: true, duplicate: true, exercise: { name: 'Landmine Meadows row' } });
  });

  it('duplicate refusal: no card before find_exercises; a name already in his list is refused with the one to use', async () => {
    const { services: s } = await h.launch();
    const { sessionId } = await liveWorkout(s);
    const seated = { ...meadowsArgs, name: 'Seated calf raises', equipment: 'plate_loaded_machine', primaryMuscles: ['calves'], laterality: null };
    const outs: unknown[] = [];
    model = new StepModel([
      () => toolCall('propose_exercise', seated),
      (req) => {
        outs.push(outputOf(req));
        return toolCall('find_exercises', { query: 'seated calf raises', muscle: null, equipment: null });
      },
      (req) => {
        outs.push(outputOf(req));
        return toolCall('propose_exercise', { ...seated, reason: 'Again.' });
      },
      (req) => {
        outs.push(outputOf(req));
        return replyWith('Use Seated calf raise.');
      },
    ]);
    const r = await sayIn(s, sessionId, 'add seated calf raises');
    expect(JSON.stringify(outs[0])).toContain(FIND_FIRST_LINE);
    expect(JSON.stringify(outs[1])).toContain('machine-seated-calf-raise');
    expect(JSON.stringify(outs[2])).toContain(clashRefusalLine({ catalogueId: 'machine-seated-calf-raise', name: 'Seated calf raise' }).replace(/'/g, "'"));
    expect(r.cards.filter((c) => c.record.detail.kind === 'propose_exercise')).toEqual([]);
    expect((await browseNames(s, 'seated calf')).filter((x) => x.tags.some((t) => t.kind === 'custom'))).toEqual([]);
  });

  it('a custom exercise in a coach build: the load is fitted to the gym’s barbell (rule 4) and shown as an estimate the first time', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const a = await s.customExercises.create({ fields: { ...MEADOWS, laterality: 'bilateral' }, opId: 'new-1' });
    if (!a.ok) throw new Error(a.message);
    model = new StepModel([
      () =>
        toolCall('propose_workout', {
          name: null,
          exercises: [{ catalogueId: a.exercise.id, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: { value: 41, unit: 'kg', convention: 'total', basis: 'a moderate start', from: 'estimate', relatedCatalogueId: null } }],
          message: 'Rows.',
          minutes: 30,
          focus: 'back',
          gymName: null,
        }),
      () => replyWith('Built.'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 30 minute workout with meadows rows', spoken: false }, turnId: h.ids() });
    const card = r.cards.find((c) => c.record.detail.kind === 'build_workout')?.record;
    if (card?.detail.kind !== 'build_workout' || card.status !== 'committed') throw new Error(JSON.stringify(r.toolLog));
    const d = await s.coachDrafts.get(card.detail.draftId);
    const slot = d?.versions.at(-1)?.plan.slots.find((x) => x.exerciseId === a.exercise.id);
    const w = slot?.setTemplates.find((t) => t.setType !== 'warmup');
    // 41 kg can't be made on the bar and plates: 40 kg, labelled an estimate (first time).
    expect(w?.load).toMatchObject({ load: { value: 40, unit: 'kg', convention: 'total' }, source: 'coach_est' });
    expect(w?.load?.basis).toContain('est.');
  });
});
