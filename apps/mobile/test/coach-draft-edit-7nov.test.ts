import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { slotsOf, workingCount } from '@fizz/domain';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 7 Nov, build 552, "Sees: Today") Ben's exact sequence on today's Your workout (rows, raises, curls, hanging
 * leg raises), before Start: the coach recommends back work first; he says "U shud send this" and "Make the change
 * suggestion". The coach passes the change it described (its first call can't be read: the issues go back and the
 * second call works); the builder's edit coach makes it; one Apply / Skip card; Apply, then Undo. And (Ben, 8 Nov)
 * "give me the best workout for today" reshapes the whole draft in one card. Real SQLite; one scripted model answers
 * the main coach and the builder's edit coach (the same port, as on the phone).
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-11-07T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

interface EditView {
  workout: { minutes: number; slots: { slotKey: string; exerciseId: string; exercise: string; workingSets: number }[] };
  usable: { exerciseId: string; name: string }[];
}
const editView = (req: ModelRequest): EditView => {
  const m = req.input[0];
  if (m?.type !== 'message') throw new Error('no context');
  return JSON.parse(m.content.slice(m.content.indexOf('\n') + 1)) as EditView;
};
let missing: string | null = null;
const usableId = (v: EditView, name: string | RegExp): string => {
  const u = v.usable.find((x) => (typeof name === 'string' ? x.name === name : name.test(x.name)));
  if (u === undefined) missing = `not usable: ${String(name)} (${v.usable.map((x) => x.name).join(', ')})`;
  return u?.exerciseId ?? 'missing';
};
const slotOf = (v: EditView, name: RegExp) => {
  const s = v.workout.slots.find((x) => name.test(x.exercise));
  if (s === undefined) throw new Error(`no slot ${String(name)}`);
  return s;
};
const userText = (req: ModelRequest | undefined): string => (req?.input ?? []).flatMap((i) => (i.type === 'message' && i.role === 'user' ? [i.content] : [])).join('\n');
const say = (s: AppServices, text: string, threadId: string | null) => s.coach.send({ entry: { kind: 'today' }, threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
const nameOf = (snap: BuilderSnapshot | null, exerciseId: string): string => snap?.facts[exerciseId]?.name ?? exerciseId;
const names = (snap: BuilderSnapshot | null) => slotsOf(snap?.workout.blocks ?? []).map((x) => nameOf(snap, x.exerciseId));
const setsOf = (snap: BuilderSnapshot | null, name: string) => {
  const slot = slotsOf(snap?.workout.blocks ?? []).find((x) => nameOf(snap, x.exerciseId) === name);
  return slot === undefined ? null : workingCount(slot);
};

/** Today's Pull draft made into rows, lateral raises (4 sets), curls and hanging leg raises, through the same card path. */
async function benDraft(s: AppServices): Promise<BuilderSnapshot> {
  const gymId = await setUpGym(h, s);
  // His own rows, so the draft has loads to snap.
  await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 80, reps: 6, rpe: 8 }, { load: 80, reps: 6, rpe: 8 }] }]);
  h.clockMs += 86_400_000;
  const created = await s.builder.create({ ...(await s.builder.initialSetup({ dayId: 'pull' })), minutes: 75 }, 'create-1');
  if (created.snapshot === null) throw new Error('no draft');
  model = new StepModel([
    () => toolCall('propose_workout_edit', { change: null, reason: 'Ben named the exercises.' }),
    (req) => {
      const v = editView(req);
      const keep = /^(?:Barbell row|Barbell curl)$/;
      const ops: unknown[] = v.workout.slots.filter((x) => !keep.test(x.exercise)).map((x) => ({ op: 'remove', slotKey: x.slotKey }));
      ops.push({ op: 'add', exerciseId: usableId(v, /^(?:Dumbbell )?lateral raise$/i), afterSlotKey: slotOf(v, /^Barbell row$/).slotKey, workingSets: 4, first: null, workSeconds: null });
      ops.push({ op: 'add', exerciseId: usableId(v, 'Hanging leg raise'), afterSlotKey: null, workingSets: 3, first: null, workSeconds: null });
      return toolCall('propose_workout_edit', { ops, reply: 'Rows, raises, curls and hanging leg raises.' });
    },
    () => replyWith('There it is.'),
  ]);
  const r = await say(s, 'make it rows, lateral raises x4, curls and hanging leg raises', null);
  const card = r.cards.find((c) => c.record.detail.kind === 'propose_workout_edit')?.record;
  expect(missing ?? '').toBe('');
  expect(await s.coach.applyDraftEdit(card?.actionId ?? '')).toEqual({ ok: true });
  const snap = await s.builder.read(created.snapshot.draftId);
  if (snap === null) throw new Error('no draft');
  return snap;
}

const CHANGE = 'Add lat pulldowns after rows, trim the raises, keep curls and hanging leg raises, and make it 60–65 minutes.';

describe('Ben’s 7 Nov sequence ends in one Apply / Skip card', () => {
  it('"U shud send this" / "Make the change suggestion": the described change comes back as a proposal; Apply, then Undo', async () => {
    const { services: s } = await h.launch();
    const before = await benDraft(s);
    expect(names(before)).toEqual(['Barbell row', 'Lateral raise', 'Barbell curl', 'Hanging leg raise']);
    expect(setsOf(before, 'Lateral raise')).toBe(4);

    model = new StepModel([() => replyWith('Back work first, then arms and core; don’t cram the missed sessions. Want me to add lat pulldowns after rows, trim the raises and make it 60–65 minutes?')]);
    const t1 = await say(s, 'What should I do today? I missed Pull A and Upper B', null);

    let editAsk = '';
    model = new StepModel([
      // The first call can't be read (no reason): the issues go back and it gets one more try.
      () => toolCall('propose_workout_edit', { change: CHANGE }),
      (req) => {
        const fed = req.input.flatMap((i) => (i.type === 'function_call_output' ? [JSON.parse(i.output) as { status: string; issues?: string[] }] : []));
        expect(fed.at(-1)).toMatchObject({ status: 'invalid_args' });
        expect(fed.at(-1)?.issues?.some((x) => x.startsWith('reason:'))).toBe(true);
        return toolCall('propose_workout_edit', { change: CHANGE, reason: 'Back work first, then arms and core.' });
      },
      // The builder's edit coach: Ben's words and the change he agreed to.
      (req) => {
        editAsk = userText(req);
        const v = editView(req);
        return toolCall('propose_workout_edit', {
          ops: [
            { op: 'add', exerciseId: usableId(v, 'Lat pulldown'), afterSlotKey: slotOf(v, /^Barbell row$/).slotKey, workingSets: 3, first: null, workSeconds: null },
            { op: 'sets', slotKey: slotOf(v, /^Lateral raise$/).slotKey, workingSets: 2 },
            { op: 'minutes', minutes: 65 },
          ],
          reply: 'Lat pulldowns after rows, fewer raises.',
        });
      },
      () => replyWith('Back first, then arms and core.'),
    ]);
    const t2 = await say(s, 'U shud send this', t1.threadId);
    expect(editAsk).toContain('U shud send this');
    expect(editAsk).toContain(CHANGE);
    const card = t2.cards.find((c) => c.record.detail.kind === 'propose_workout_edit')?.record;
    expect(card?.status).toBe('proposed');
    expect(t2.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : []))).toEqual(['Back first, then arms and core.']);
    // Nothing changed until Apply (rule 3).
    expect(names(await s.builder.read(before.draftId))).toEqual(names(before));

    expect(await s.coach.applyDraftEdit(card?.actionId ?? '')).toEqual({ ok: true });
    const after = await s.builder.read(before.draftId);
    expect(names(after).slice(0, 2)).toEqual(['Barbell row', 'Lat pulldown']);
    expect(names(after)).toEqual(expect.arrayContaining(['Barbell curl', 'Hanging leg raise']));
    expect(setsOf(after, 'Lateral raise') ?? 0).toBeLessThan(4);
    // The length is Set up's (the builder fits the workout to it; 60–65 → 65).
    expect(after?.setup.minutes).toBeGreaterThanOrEqual(60);
    expect(after?.setup.minutes).toBeLessThanOrEqual(65);

    expect(await s.coach.undoDraftEdit(card?.actionId ?? '', h.ids())).toBe(true);
    const undone = await s.builder.read(before.draftId);
    expect(names(undone)).toEqual(names(before));
    expect(setsOf(undone, 'Lateral raise')).toBe(4);
    expect(undone?.setup.minutes).toBe(before.setup.minutes);
  });
});

describe('"give me the best workout for today" reshapes today’s draft in one card (Ben, 8 Nov)', () => {
  it('a workout ask with today’s draft in context: forced to the draft edit, one Apply / Skip card with the whole workout; Apply replaces it; Undo restores', async () => {
    const { services: s } = await h.launch();
    const before = await benDraft(s);
    let forced: ModelRequest['toolChoice'] | undefined;
    const reshape = (req: ModelRequest): ModelEvent[] => {
      const v = editView(req);
      const ops: unknown[] = v.workout.slots.filter((x) => x.exercise !== 'Barbell row').map((x) => ({ op: 'remove', slotKey: x.slotKey }));
      const row = slotOf(v, /^Barbell row$/).slotKey;
      // Back first (row stays first), then arms, then core; fitted to 60 minutes.
      ops.push({ op: 'add', exerciseId: usableId(v, 'Lat pulldown'), afterSlotKey: row, workingSets: 3, first: null, workSeconds: null });
      ops.push({ op: 'add', exerciseId: usableId(v, 'Chest-supported machine row'), afterSlotKey: null, workingSets: 3, first: null, workSeconds: null });
      ops.push({ op: 'add', exerciseId: usableId(v, 'Barbell curl'), afterSlotKey: null, workingSets: 3, first: null, workSeconds: null });
      ops.push({ op: 'add', exerciseId: usableId(v, 'Hanging leg raise'), afterSlotKey: null, workingSets: 3, first: null, workSeconds: null });
      ops.push({ op: 'minutes', minutes: 60 });
      return toolCall('propose_workout_edit', { ops, reply: 'Back first, then arms and core.' });
    };
    model = new StepModel([
      // A text answer first: held, and the next step is named.
      () => replyWith('Rows, pulldowns and cable rows, then curls and hanging leg raises.'),
      (req) => {
        forced = req.toolChoice;
        expect(req.instructions).toContain('not propose_workout');
        return toolCall('propose_workout_edit', { change: 'Back first: barbell row, lat pulldown, chest-supported machine row; then barbell curl and hanging leg raise; 60 minutes.', reason: 'Missed Pull A and Upper B.' });
      },
      reshape,
      () => replyWith('Back first, then arms and core.'),
    ]);
    const r = await say(s, "I missed Pull A and Upper B this week, I've got about 60 minutes, give me the best workout for today", null);
    expect(missing ?? '').toBe('');
    const card = r.cards.find((c) => c.record.detail.kind === 'propose_workout_edit')?.record;
    expect(r.cards.filter((c) => c.record.detail.kind === 'build_workout')).toEqual([]);
    expect(forced).toEqual({ type: 'function', name: 'propose_workout_edit' });
    expect(card?.status).toBe('proposed');
    expect(await s.coach.applyDraftEdit(card?.actionId ?? '')).toEqual({ ok: true });
    const after = await s.builder.read(before.draftId);
    // Back first (the builder orders within it), then arms, then core.
    expect(names(after)[0]).toBe('Barbell row');
    expect([...names(after).slice(0, 3)].sort()).toEqual(['Barbell row', 'Chest-supported machine row', 'Lat pulldown']);
    expect(names(after).slice(3)).toEqual(['Barbell curl', 'Hanging leg raise']);
    expect(after?.setup.minutes).toBe(60);
    // Loads are the builder's, on this gym's bar and plates (2.5 kg steps).
    const rowLoads = slotsOf(after?.workout.blocks ?? []).find((x) => nameOf(after, x.exerciseId) === 'Barbell row')?.rows.flatMap((x) => (x.load === null ? [] : [x.load])) ?? [];
    expect(rowLoads.length).toBeGreaterThan(0);
    for (const l of rowLoads) expect(Math.abs(l / 2.5 - Math.round(l / 2.5))).toBeLessThan(1e-9);
    expect(await s.coach.undoDraftEdit(card?.actionId ?? '', h.ids())).toBe(true);
    expect(names(await s.builder.read(before.draftId))).toEqual(names(before));
  });
});
