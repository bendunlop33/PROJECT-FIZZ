import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { AppServices } from '../src/services/app-services';
import type { CoachEntry } from '../src/coach/coach-service';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * ADR 0039 (Ben, 29 Oct: "Can we make the coach across chats have broader and more homogenous edit rights?").
 * Real SQLite, a scripted model. Ben's 6-day plan (Push A, Pull A, Legs, Push B, Pull B, Legs B); legs Monday,
 * pull Tuesday, push Wednesday. Thursday, from Today's coach: "make today a rest day and don't cram the rest of
 * the week" changes this week at once, with Undo (the coach had said it had no weekly-plan tool in this chat).
 * The same state gives the same tools from Today, Plan, Progress, a Summary's thread and the workout's sheet. His
 * own idea is still a proposal; a structural future change is still a proposal.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Sunday 25 Oct 2026, 10:00 in London (after the clocks went back).
  h = createHarness('2026-10-25T10:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

type Ex = [string, Record<string, unknown>?];
const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });
const PPL: [string, Ex[]][] = [
  ['Push A', [['Bench press'], ['Lateral raise']]],
  ['Pull A', [['Lat pulldown'], ['Barbell row']]],
  ['Legs', [['Back squat'], ['Leg press']]],
  ['Push B', [['Overhead press'], ['Incline dumbbell press']]],
  ['Pull B', [['Barbell row'], ['Dumbbell curl']]],
  ['Legs B', [['Romanian deadlift'], ['Leg press']]],
];

export function yourData(req: ModelRequest): Record<string, unknown> {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as Record<string, unknown>;
}
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = (yourData(req).build as { usable: { catalogueId: string; name: string }[] }).usable;
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: PPL.map(([dayName, exs]) => ({ dayName, splitDayId: null, focus: null, minutes: null, exercises: exs.map(([n, over]) => ex(idOf(n), over ?? {})) })), message: 'Push, pull, legs twice.', minutes: null, gymName: null });
};

interface WeekView {
  today: string;
  remaining: { id: string; name: string }[];
  done?: string[];
}

const say = (s: AppServices, text: string, entry: CoachEntry = { kind: 'today' }) => s.coach.send({ entry, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

async function doDay(s: AppServices, gymId: string, routineId: string): Promise<string> {
  const started = await s.workout.start({ gymId, opId: `start-${routineId}-${String(h.clockMs)}`, checkIn: null, routineOf: routineId });
  if (!started.ok) throw new Error(started.error.message);
  const id = started.aggregate.session.id;
  for (const set of started.aggregate.sets) {
    if (set.status !== 'pending' || set.setType === 'warmup') continue;
    h.clockMs += 60_000;
    const conv = started.aggregate.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
    const r = await s.workout.dispatch(id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: conv }, reps: set.planned.reps?.max ?? 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  }
  h.clockMs += 60_000;
  const now = await s.workout.load(id);
  const fin = await s.workout.dispatch(id, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  return id;
}

/** Sunday: the 6-day PPL plan applied (aim 6). Mon Legs, Tue Pull A, Wed Push A. Thursday 29 Oct, 09:00. */
async function benThursday() {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const snap = await s.training.snapshot();
  if (!snap) throw new Error('snapshot');
  expect(await s.training.change({ kind: 'days_per_week', days: 6 }, snap.profile.version, 'days-6')).toMatchObject({ ok: true });
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const r = await say(s, 'Build me a 6-day push pull legs plan');
  const card = r.cards.find((c) => c.record.detail.kind === 'build_plan')?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error(`no plan: ${JSON.stringify(r.toolLog)}`);
  const planId = card.detail.planId;
  const c = await s.plans.card({ planId, versionN: 1 });
  expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  const active = await s.plans.active();
  const byName = new Map(active?.days.map((d) => [d.name, d.routineId]));
  const day = (n: string) => byName.get(n) ?? '';
  h.clockMs = Date.parse('2026-10-26T08:00:00.000Z');
  const sessions = [await doDay(s, gymId, day('Legs'))];
  h.clockMs = Date.parse('2026-10-27T08:00:00.000Z');
  sessions.push(await doDay(s, gymId, day('Pull A')));
  h.clockMs = Date.parse('2026-10-28T08:00:00.000Z');
  sessions.push(await doDay(s, gymId, day('Push A')));
  h.clockMs = Date.parse('2026-10-29T09:00:00.000Z');
  return { s, gymId, planId, day, sessions };
}

const BEN = "I'm generally achy after legs Monday, pull Tuesday and push Wednesday. Make today a rest day and don't cram the rest of the week";

/** The coach reads YOUR DATA week: today's day (Up next) is left out, the rest stays as it is. */
const restWeek = (seen: WeekView[], benAsked: boolean, today: string) => (req: ModelRequest): ModelEvent[] => {
  const week = yourData(req).week as WeekView;
  seen.push(week);
  const day = week.remaining.find((d) => d.name === today);
  return toolCall('propose_week', { merges: [], skips: [day?.id ?? 'none'], message: 'Rest today; the days left fit the rest of the week.', benAsked, benQuote: benAsked ? "Make today a rest day and don't cram the rest of the week" : null });
};

describe("Ben's Today chat (29 Oct): rest today, don't cram the rest of the week", () => {
  it('applied at once with Undo on the card; Up next and Your plan follow; Undo puts the week back', async () => {
    const { s, gymId } = await benThursday();
    const before = (await s.next.preview(gymId))?.title ?? '';
    expect(['Push B', 'Pull B', 'Legs B']).toContain(before);
    const seen: WeekView[] = [];
    model = new StepModel([restWeek(seen, true, before), () => replyWith('Rest today, easy run tonight if you like.')]);
    const r = await say(s, BEN);
    // Offered from Today's chat, with the instruction to use it and the week in context.
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_week');
    expect(model.requests[0]?.instructions).toContain('call propose_week in this turn');
    expect(model.requests[0]?.instructions).toContain('Never say a tool is not available in this chat');
    expect(seen[0]?.remaining.map((d) => d.name).sort()).toEqual(['Legs B', 'Pull B', 'Push B']);
    expect([...(seen[0]?.done ?? [])].sort()).toEqual(['Legs', 'Pull A', 'Push A']);
    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_week')?.record;
    expect(rec?.detail).toMatchObject({ kind: 'propose_week', atOnce: true });
    // The card: applied, with Undo; the week has the days left out.
    const card = await s.week.card(rec?.actionId ?? '');
    expect(card?.state.kind).toBe('applied');
    expect(card?.after.map((x) => x.name)).not.toContain(before);
    expect(card?.after).toHaveLength(2);
    const after = (await s.next.preview(gymId))?.title ?? '';
    expect(after).not.toBe(before);
    expect((await s.plans.overview())?.weekChange?.text).toContain(`no ${before}`);
    // The model was told it applied (never "Not applied").
    const out = model.requests[1]?.input.find((i) => i.type === 'function_call_output');
    expect(out?.type === 'function_call_output' ? out.output : '').toContain('Applied this week');
    // Undo on the card: the plan's own week again.
    if (card?.state.kind !== 'applied') throw new Error('not applied');
    expect(await s.week.undo({ weekPlanId: card.state.weekPlanId, expectedVersion: card.state.version, opId: 'undo-rest' })).toMatchObject({ ok: true });
    expect((await s.week.card(rec?.actionId ?? ''))?.state.kind).toBe('undone');
    expect((await s.next.preview(gymId))?.title).toBe(before);
  });

  it('a "not available in this chat" line is hidden and replaced by one offer line', async () => {
    const { s } = await benThursday();
    model = new StepModel([() => replyWith("Take a lifting break today and an easy run tonight. I can advise on that adjustment here, but I don't have a weekly-plan editing tool available in this chat.")]);
    const r = await say(s, "I'm generally achy after legs Monday, pull Tuesday and push Wednesday");
    const text = r.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : [])).join(' ');
    expect(text).not.toContain('not available');
    expect(text).not.toContain("don't have");
    expect(text).toContain('Want me to change this week?');
  });

  it('the coach’s own idea (Ben only said he is achy) is a proposal with Apply, nothing changes until he applies it', async () => {
    const { s, gymId } = await benThursday();
    const before = (await s.next.preview(gymId))?.title ?? '';
    const seen: WeekView[] = [];
    model = new StepModel([restWeek(seen, false, before), () => replyWith('Want me to make today a rest day?')]);
    const r = await say(s, "I'm generally achy after legs Monday, pull Tuesday and push Wednesday");
    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_week')?.record;
    expect(rec?.status).toBe('proposed');
    expect(rec?.detail).not.toHaveProperty('atOnce');
    expect((await s.week.card(rec?.actionId ?? ''))?.state.kind).toBe('open');
    expect((await s.next.preview(gymId))?.title).toBe(before);
  });

  it('a replayed turn (same turn ID) applies once; a stale week is never changed (rule 5)', async () => {
    const { s, gymId } = await benThursday();
    const before = (await s.next.preview(gymId))?.title ?? '';
    const seen: WeekView[] = [];
    model = new StepModel([restWeek(seen, true, before), () => replyWith('Done.')]);
    const turnId = h.ids();
    const first = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: BEN, spoken: false }, turnId });
    const again = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: BEN, spoken: false }, turnId });
    expect(again.replayed).toBe(true);
    expect(model.requests).toHaveLength(2);
    const rec = first.cards.find((c) => c.record.detail.kind === 'propose_week')?.record;
    const card = await s.week.card(rec?.actionId ?? '');
    expect(card?.state.kind).toBe('applied');
    // A second ask while that change is in use: the week already has one, so it is refused as stale, nothing written.
    const upNow = (await s.next.preview(gymId))?.title ?? '';
    model = new StepModel([restWeek(seen, true, upNow), () => replyWith('ok')]);
    const second = await say(s, 'skip that day this week too');
    const rec2 = second.cards.find((c) => c.record.detail.kind === 'propose_week')?.record;
    if (rec2 !== undefined) expect((await s.week.card(rec2.actionId))?.state.kind).not.toBe('applied');
    expect((await s.next.preview(gymId))?.title).toBe(upNow);
  });
});

describe('ADR 0039: the same tools from every entry point, given the same state (app, table)', () => {
  // `think_harder` is the light turn's own step; `get_active_session` reads the workout in context (what the entry shows
  // first: a finished workout's thread has that workout), never a power to change anything.
  const toolsOf = (req: ModelRequest | undefined) => (req?.tools ?? []).map((t) => t.name).filter((n) => n !== 'think_harder' && n !== 'get_active_session').sort();

  it('no workout live: Today, Plan (opens Today’s thread), Progress, an exercise’s chart and a finished workout’s Summary thread get the same tools', async () => {
    const { s, sessions } = await benThursday();
    const entries: [string, CoachEntry][] = [
      ['today', { kind: 'today' }],
      ['progress', { kind: 'progress', period: '1m' }],
      ['progress_exercise', { kind: 'progress_exercise', exerciseName: 'Bench press', seriesLabel: 'Top set', from: '2026-10-01', to: '2026-10-29' }],
      ['summary', { kind: 'summary', sessionId: sessions[2] ?? '' }],
      ['workout (finished)', { kind: 'workout', sessionId: sessions[1] ?? '' }],
    ];
    const got: [string, string[]][] = [];
    for (const [name, entry] of entries) {
      model = new StepModel([() => replyWith('ok')]);
      await say(s, 'how is my week looking?', entry);
      got.push([name, toolsOf(model.requests[0])]);
    }
    const first = got[0]?.[1] ?? [];
    expect(first).toEqual(expect.arrayContaining(['propose_week', 'pause_plan', 'log_activity']));
    expect(first).not.toContain('edit_today');
    for (const [name, tools] of got) expect({ name, tools }).toEqual({ name, tools: first });
  });

  it('a workout live: its own sheet, Today, Progress and a finished workout’s Summary thread get the same tools', async () => {
    const { s, gymId, sessions, day } = await benThursday();
    const started = await s.workout.start({ gymId, opId: 'start-live', checkIn: null, routineOf: day('Push B') });
    if (!started.ok) throw new Error(started.error.message);
    const live = started.aggregate.session.id;
    const entries: [string, CoachEntry][] = [
      ['workout', { kind: 'workout', sessionId: live }],
      ['today', { kind: 'today' }],
      ['progress', { kind: 'progress', period: '1m' }],
      ['summary (another workout)', { kind: 'summary', sessionId: sessions[2] ?? '' }],
    ];
    const got: [string, string[]][] = [];
    for (const [name, entry] of entries) {
      model = new StepModel([() => replyWith('ok')]);
      await say(s, 'how is my week looking?', entry);
      got.push([name, toolsOf(model.requests[0])]);
    }
    const first = got[0]?.[1] ?? [];
    expect(first).toEqual(expect.arrayContaining(['edit_today', 'rename_workout', 'propose_week', 'pause_plan', 'log_activity']));
    for (const [name, tools] of got) expect({ name, tools }).toEqual({ name, tools: first });
    h.clockMs += DAY;
  });
});

describe('ADR 0039 (Ben, 29 Oct: "Why does it get confused with my split?"): one split, the plan in use', () => {
  interface SplitSeen {
    kind: string;
    plan?: { name: string; paused: boolean };
    days: { name: string; on?: string; mainLift: { name: string; source: string } | null }[];
  }
  const splitOf = (req: ModelRequest): SplitSeen => (yourData(req).training as { split: SplitSeen }).split;
  const PROFILE_DAYS = ['Chest', 'Shoulders', 'Back', 'Full body'];

  it('profile split Chest/Legs/Shoulders/Back/Full body and a PPL A/B plan in use: the coach sees only the plan’s days, paused too', async () => {
    const { s, planId } = await benThursday();
    const snap = await s.training.snapshot();
    if (!snap) throw new Error('snapshot');
    expect(await s.training.change({ kind: 'preset_split', split: 'clsb' }, snap.profile.version, 'split-clsb')).toMatchObject({ ok: true });
    const seen: ModelRequest[] = [];
    model = new StepModel([
      (req) => {
        seen.push(req);
        return replyWith('Legs B is Saturday’s leg day.');
      },
    ]);
    await say(s, 'what is Legs B again, and how does it fit my split?');
    const split = splitOf(seen[0] as ModelRequest);
    expect(split.kind).toBe('plan');
    expect(split.plan).toMatchObject({ paused: false });
    expect(split.days.map((d) => d.name)).toEqual(['Push A', 'Pull A', 'Legs', 'Push B', 'Pull B', 'Legs B']);
    // The profile's split is nowhere in what the model gets: not in training, the week or the last days.
    const everything = JSON.stringify(seen[0]?.input ?? []);
    for (const d of PROFILE_DAYS) expect(everything).not.toContain(`"name":"${d}"`);
    expect(everything).not.toContain('Full body');
    const week = yourData(seen[0] as ModelRequest).week as { daysFrom: string; remaining: { name: string }[] };
    expect(week.daysFrom).toBe('plan');
    for (const d of week.remaining) expect(['Push A', 'Pull A', 'Legs', 'Push B', 'Pull B', 'Legs B']).toContain(d.name);

    // Paused (holiday): still the plan's days, marked paused; nothing to reshape, never the profile's days.
    const plan = await s.plans.active();
    expect(plan).not.toBeNull();
    const p2 = await s.plans.overview();
    expect(p2).not.toBeNull();
    const cur = await s.plans.card({ planId, versionN: 1 });
    expect(await s.plans.pause({ planId, untilDate: '2026-11-03', expectedVersion: cur?.planVersion ?? 0, opId: 'pause-1' })).toMatchObject({ ok: true });
    seen.length = 0;
    model = new StepModel([
      (req) => {
        seen.push(req);
        return replyWith('Enjoy the break.');
      },
    ]);
    await say(s, 'what are my days again?');
    const paused = splitOf(seen[0] as ModelRequest);
    expect(paused.kind).toBe('plan');
    expect(paused.plan).toMatchObject({ paused: true });
    expect(paused.days.map((d) => d.name)).toContain('Legs B');
    const all = JSON.stringify(seen[0]?.input ?? []);
    expect(all).not.toContain('Full body');
    expect((yourData(seen[0] as ModelRequest).week as { remaining: unknown[] }).remaining).toEqual([]);
    expect(seen[0]?.tools.map((t) => t.name)).not.toContain('propose_week');
  });
});
