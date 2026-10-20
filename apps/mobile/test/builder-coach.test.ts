import { describe, expect, it } from 'vitest';

import { createBuilderLoadGuard, type BuilderCoachSnapshot, type CoachModelPort, type ModelEvent, type ModelRequest, type SetupCoachContext, type SetupFill } from '@fizz/coach';
import { buildFromSetup, slotsOf, type BuilderSetup, type BuilderWorkout } from '@fizz/domain';
import { OWNER, builderFixture as F, idGen } from '@fizz/domain/testing';
import { openStore } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { ZonedTimestamp } from '@fizz/schemas';

import { createBuilderCoachService, createDayNotes, type BuilderCoachWorld, type BuilderWriteResult } from '../src/coach/builder-coach-service';
import { askBarView, builderReviewView, coachWhyLine, mixRowView, nudgeCardView, nudgeReviewStatus, proposalCardView } from '../src/coach/builder-coach-view';
import type { CoachAvailability } from '../src/coach/coach-service';
import { createDictation, type SpeechInputPort } from '../src/voice/dictation';

/**
 * Builder v3 coach in the app (§2.6, §2.9, §5, §6.1; S6, S7): honest status,
 * the offline Set up parser with no coach bubble, proposals with Out of date,
 * reviews and day notes on real SQLite, the nudge's silence and caching, and
 * on-device-only tap-to-talk. A scripted model stands in for the plan route;
 * nothing here proves the route on the iPhone.
 */

class StepModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: ((req: ModelRequest) => ModelEvent[])[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1];
    const events = step === undefined ? [{ type: 'error' as const, error: 'unavailable' as const }] : step(request);
    for (const e of events) {
      await Promise.resolve();
      yield e;
    }
  }
}
const call = (name: string, args: unknown): ModelEvent[] => [{ type: 'tool_call', callId: `c-${name}`, name, arguments: JSON.stringify(args) }, { type: 'completed' }];
const yourData = (req: ModelRequest | undefined): Record<string, unknown> => {
  const block = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as Record<string, unknown>;
};

const DRAFT = '5f0c2a52-7b1e-4c1a-9d3e-2a4b6c8d0e1f';
const CONNECTED: CoachAvailability = { status: 'ok', model: 'gpt-main', workoutModel: 'gpt-light' };
const OFFLINE: CoachAvailability = { status: 'offline', model: 'gpt-main' };
const chest: BuilderSetup = { minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: [{ group: 'Chest', count: 3 }, { group: 'Triceps', count: 1 }, { group: 'Abs', count: 1 }] };

function setupCtx(): SetupCoachContext {
  return {
    days: [
      { id: 'chest', name: 'Chest', mainLifts: [{ exerciseId: 'bench', catalogueId: null, name: 'Barbell bench press' }] },
      { id: 'pull', name: 'Pull', mainLifts: [{ exerciseId: 'row', catalogueId: null, name: 'Barbell row' }] },
    ],
    current: { dayId: 'chest', minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: chest.groups },
    recommend: () => [{ group: 'Back', count: 4 }, { group: 'Biceps', count: 1 }, { group: 'Abs', count: 1 }],
  };
}

async function harness(opts: { availability?: CoachAvailability; model?: StepModel | null } = {}) {
  const store = await openStore(openNodeDriver(':memory:'));
  const ctx = F.context();
  let workout: BuilderWorkout = buildFromSetup(chest, F.pool, ctx).workout;
  let version = 1;
  let revs: Record<string, number> = {};
  let minutes = 60;
  let clock = Date.parse('2026-10-20T06:30:00Z');
  const now = (): ZonedTimestamp => ({ utc: new Date(clock).toISOString(), tz: 'Europe/London' });
  const setups: { fill: SetupFill; opId: string }[] = [];
  const applied: { opId: string; lines: readonly string[] }[] = [];
  let availability = opts.availability ?? CONNECTED;
  const model = opts.model === undefined ? new StepModel([]) : opts.model;
  const world = (): BuilderCoachWorld => {
    const snapshot: BuilderCoachSnapshot = { draftId: DRAFT, draftVersion: version, dayName: 'Chest', minutes, supersets: true, workout, revs };
    return {
      snapshot,
      env: { ctx, usable: (id) => F.info(id) !== null, pain: () => null, loads: createBuilderLoadGuard({ ctx, refs: () => null, pain: () => null }), mainGroup: 'Chest' },
      extras: { usable: [{ exerciseId: 'incline_bb', name: 'Incline barbell press', group: 'Chest' }], painFlags: [], dayNotes: [], plan: null, goal: 'strength', history: [], memories: [] },
    };
  };
  const service = createBuilderCoachService({
    availability: () => Promise.resolve(availability),
    ...(model === null ? {} : { model: () => model }),
    now,
    newId: idGen(),
    ownerId: () => Promise.resolve(OWNER),
    source: { world: (id) => Promise.resolve(id === DRAFT ? world() : null), setup: () => Promise.resolve(setupCtx()) },
    writer: {
      applySetup: (fill, opId): Promise<BuilderWriteResult> => {
        if (!setups.some((s) => s.opId === opId)) setups.push({ fill, opId });
        return Promise.resolve({ ok: true });
      },
      applyWorkout: (req): Promise<BuilderWriteResult> => {
        if (applied.some((a) => a.opId === req.opId)) return Promise.resolve({ ok: true });
        if (req.expectedVersion !== version) return Promise.resolve({ ok: false, reason: 'stale' });
        workout = req.workout;
        minutes = req.minutes;
        version += 1;
        applied.push({ opId: req.opId, lines: req.lines });
        return Promise.resolve({ ok: true });
      },
    },
    reviews: {
      current: (s) => store.repos.reviews.current(OWNER, s),
      record: (r) => store.repos.reviews.record(OWNER, r),
      update: (n, v, op) => store.repos.reviews.update(OWNER, n, v, op),
    },
    dayNotes: createDayNotes({ store: () => store.repos.coach, ownerId: () => Promise.resolve(OWNER), now }),
  });
  const key = (id: string) => slotsOf(workout.blocks).find((s) => s.exerciseId === id)?.key ?? '';
  return {
    store,
    service,
    model,
    setups,
    applied,
    key,
    world,
    setAvailability: (a: CoachAvailability) => {
      availability = a;
    },
    benEdits: (slotKey: string) => {
      revs = { ...revs, [slotKey]: (revs[slotKey] ?? 1) + 1 };
      version += 1;
    },
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe('Set up bar: fills at once; offline the words still fill it by code, no coach bubble', () => {
  it('connected: the coach’s fill_setup, checked; Ben’s minutes win', async () => {
    const model = new StepModel([() => call('fill_setup', { dayId: 'pull', minutes: 45, mainLiftCatalogueId: null, supersets: false, groups: null, reply: null })]);
    const h = await harness({ model });
    const r = await h.service.askSetup({ words: 'pull, 50 minutes, no supersets', opId: 'op-1' });
    expect(r).toEqual({ kind: 'filled', by: 'coach', toast: 'Pull · 50 min · supersets off', notes: [], reply: null, status: 'ok' });
    expect(h.setups[0]?.fill.next).toMatchObject({ dayId: 'pull', minutes: 50, supersets: false });
    expect(h.model?.requests[0]?.effort).toBe('medium');
  });

  it('offline: no model call, the same fill by code, and `Not understood` for words it can’t read', async () => {
    const h = await harness({ availability: OFFLINE });
    expect(await h.service.askSetup({ words: 'pull, 50 minutes, no supersets', opId: 'op-2' })).toEqual({ kind: 'filled', by: 'code', toast: 'Pull · 50 min · supersets off', notes: [], reply: null, status: 'offline' });
    expect(await h.service.askSetup({ words: 'what do you think?', opId: 'op-3' })).toEqual({ kind: 'not_understood', line: 'Not understood', status: 'offline' });
    expect(h.model?.requests).toEqual([]);
  });

  it('a network failure falls back to code and reads Offline for a while; no coach built in', async () => {
    const model = new StepModel([() => [{ type: 'error', error: 'network' }]]);
    const h = await harness({ model });
    expect(await h.service.askSetup({ words: 'legs? no: pull 40 minutes', opId: 'op-4' })).toMatchObject({ kind: 'filled', by: 'code', status: 'offline' });
    expect(await h.service.status()).toBe('offline');
    h.tick(61_000);
    expect(await h.service.status()).toBe('ok');
    const none = await harness({ model: null });
    expect(await none.service.status()).toBe('not_connected');
  });
});

describe('Your workout bar: proposals, Apply, Out of date', () => {
  it('a proposal’s lines are code’s; Apply writes once; a slot Ben edited since makes it out of date', async () => {
    let fly = '';
    let bench = '';
    const model = new StepModel([
      (req) => {
        const slots = (yourData(req).workout as { slots: { slotKey: string; exerciseId: string }[] }).slots;
        fly = slots.find((s) => s.exerciseId === 'cable_fly')?.slotKey ?? '';
        bench = slots.find((s) => s.exerciseId === 'bench')?.slotKey ?? '';
        return call('propose_workout_edit', { ops: [{ op: 'swap', slotKey: fly, toExerciseId: 'incline_bb' }], reply: 'Swap the fly for an incline press.' });
      },
      () => call('propose_workout_edit', { ops: [{ op: 'load', slotKey: bench, direction: 'heavier', value: null, unit: null }], reply: 'Up 2.5 kg.' }),
    ]);
    const h = await harness({ model });
    const a = await h.service.askEdit({ draftId: DRAFT, words: 'swap the cable fly', opId: 'p-1' });
    expect(a.kind === 'proposal' && [a.proposal.lines, a.proposal.reason]).toEqual([['Cable fly → Incline barbell press'], 'Swap the fly for an incline press.']);
    const b = await h.service.askEdit({ draftId: DRAFT, words: 'bench heavier', opId: 'p-2' });
    expect(b.kind === 'proposal' && b.proposal.lines).toEqual(['Barbell bench press: 100 → 102.5 kg']);
    // A number the coach wasn't given is hidden (2.5 isn't in the data).
    expect(b.kind === 'proposal' && b.proposal.reason).toBeNull();
    if (a.kind !== 'proposal' || b.kind !== 'proposal') return;

    h.benEdits(h.key('cable_fly'));
    expect(await h.service.apply(a.proposal)).toEqual({ kind: 'out_of_date', line: 'Out of date. Ask again.' });
    expect(await h.service.apply(b.proposal)).toEqual({ kind: 'applied', lines: ['Barbell bench press: 100 → 102.5 kg'] });
    // A double tap writes once.
    expect(await h.service.apply(b.proposal)).toMatchObject({ kind: 'out_of_date' });
    expect(h.applied.map((x) => x.opId)).toEqual(['builder-apply:p-2']);
    expect(proposalCardView(b.proposal, 'applied')).toMatchObject({ state: 'Applied', undo: true, actions: null });
  });

  it('offline or not connected: unavailable, no request, the bar disabled with the word', async () => {
    const h = await harness({ availability: OFFLINE });
    expect(await h.service.askEdit({ draftId: DRAFT, words: 'swap the fly', opId: 'p-3' })).toEqual({ kind: 'unavailable', status: 'offline' });
    expect(askBarView('workout', 'offline', 'idle')).toMatchObject({ label: 'Ask the coach to change it', status: 'Offline', disabled: true });
    expect(askBarView('setup', 'offline', 'idle')).toMatchObject({ label: 'Describe the workout', status: 'Offline', disabled: false });
    expect(askBarView('today', 'not_connected', 'idle', { compact: true })).toMatchObject({ label: 'Coach', status: 'Coach not connected' });
    expect(askBarView('today', 'ok', 'idle')).toMatchObject({ label: 'Ask the coach', status: null });
  });
});

describe('Coach review (§2.9) and day notes', () => {
  it('connected: verdict, suggestions with Apply, notes ticked; Done saves text notes as day notes (Your data)', async () => {
    const model = new StepModel([
      (req) => {
        const slots = (yourData(req).workout as { slots: { slotKey: string; exerciseId: string }[] }).slots;
        const fly = slots.find((s) => s.exerciseId === 'cable_fly')?.slotKey ?? '';
        return call('review_workout', { verdict: 'Balanced, 16 working sets', suggestions: [{ ops: [{ op: 'swap', slotKey: fly, toExerciseId: 'incline_bb' }], reason: 'Two lead with mid chest.' }], nextNotes: [{ text: 'Include abs', target: null }, { text: 'Hit 99 reps', target: null }] });
      },
    ]);
    const h = await harness({ model });
    const r = await h.service.review({ draftId: DRAFT, opId: 'rv-1', groups: ['Chest', 'Triceps', 'Abs'], plan: null });
    expect(r?.status).toBe('reviewed');
    expect(h.model?.requests[0]).toMatchObject({ model: 'gpt-main', effort: 'high' });
    if (r === null) return;
    const v = builderReviewView(r, 'Chest');
    expect(v.header).toBe('● Coach');
    expect(v.verdict).toBe('Balanced, 16 working sets');
    expect(v.coverage.map((c) => c.text)).toEqual(['✓ Upper chest 3', '✓ Mid chest 7', '✓ Triceps 7', '✓ Abs 3']);
    expect(v.suggestions.map((s) => [s.action, s.card.lines])).toEqual([['Swap', ['Cable fly → Incline barbell press']]]);
    expect(v.notesTitle).toBe('For next Chest day');
    expect(v.notes.map((n) => [n.text, n.ticked])).toEqual([['Include abs', true]]);
    expect(v.notShown).toEqual(['Hit 99 reps']);
    const stored = await h.store.repos.reviews.current(OWNER, { kind: 'session', draftId: DRAFT, draftVersion: 1 });
    expect(stored?.coach).toMatchObject({ status: 'reviewed', verdict: 'Balanced, 16 working sets', numbersChecked: true });
    expect(stored?.facts.some((f) => f.kind === 'group_sets' && f.group === 'Chest' && f.sets === 10)).toBe(true);

    // Unticked notes aren't saved; ticked ones are, once per op.
    const notes = r.coach?.notes ?? [];
    const save = () => h.service.saveReviewNotes({ notes, ticked: new Set(notes.map((n) => n.id)), splitDayId: 'chest', mainLiftExerciseId: 'bench', reviewId: r.reviewId, opId: 'done-1' });
    expect(await h.service.saveReviewNotes({ notes, ticked: new Set(), splitDayId: 'chest', mainLiftExerciseId: 'bench', reviewId: r.reviewId, opId: 'done-0' })).toEqual({ saved: 0, skipped: 0 });
    expect(await save()).toEqual({ saved: 1, skipped: 0 });
    expect(await save()).toEqual({ saved: 1, skipped: 0 });
    const memories = await h.store.repos.coach.listMemories(OWNER);
    expect(memories.map((m) => [m.text, m.dayNote?.splitDayId, m.dayNote?.mainLiftExerciseId])).toEqual([['Include abs', 'chest', 'bench']]);
  });

  it('no AI: facts and Plan section still show; no verdict, no suggestions, no notes; header Offline', async () => {
    const h = await harness({ availability: OFFLINE });
    const plan = { planName: '4-day split', since: '13 Oct', dayName: 'Chest', nextDayName: 'Chest', nextDayNumber: 1, dayCount: 4, minutes: 60, mainLiftExerciseId: 'bench', exercises: [{ exerciseId: 'bench', workingSets: 4 }, { exerciseId: 'machine_press', workingSets: 3 }] };
    const r = await h.service.review({ draftId: DRAFT, opId: 'rv-2', groups: [], plan });
    expect(h.model?.requests).toEqual([]);
    if (r === null) return;
    const v = builderReviewView(r, 'Chest');
    expect([v.header, v.verdict, v.suggestions, v.notes]).toEqual(['Offline', null, [], []]);
    expect(v.plan?.lines[0]).toMatchObject({ mark: '✓', text: 'Chest is next (day 1 of 4)' });
    expect(v.plan?.addBack.map((a) => a.label)).toEqual(['Add back Machine chest press']);
    expect(v.plan?.updatePlanDay).toBe(true);
    expect((await h.store.repos.reviews.current(OWNER, { kind: 'session', draftId: DRAFT, draftVersion: 1 }))?.coach).toEqual({ status: 'offline' });
  });
});

describe('pre-session nudge on Today (§6.1)', () => {
  const quiet = { today: '2026-10-20', recent: [], checkIn: null, offerAtOrBelow: 2, activities: [] };
  const low = { ...quiet, checkIn: { id: '9a1d2c3e-4f50-4a61-8b72-c3d4e5f60718', score: 1, localDate: '2026-10-20' } };

  it('no clear signal: silent, no model call, stored as silent', async () => {
    const h = await harness();
    expect(await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: quiet, opId: 'n-1' })).toEqual({ kind: 'silent' });
    expect(h.model?.requests).toEqual([]);
    expect((await h.store.repos.reviews.current(OWNER, { kind: 'pre_session', localDate: '2026-10-20', splitDayId: 'chest', draftId: DRAFT }))?.coach).toEqual({ status: 'silent' });
  });

  it('a low check-in: the light model speaks once; the same inputs reuse the stored line with code’s offer', async () => {
    const model = new StepModel([() => call('pre_session_nudge', { speak: true, line: 'Rough morning: one set fewer on the accessories?' })]);
    const h = await harness({ model });
    const r = await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: low, opId: 'n-2' });
    expect(h.model?.requests[0]).toMatchObject({ model: 'gpt-light', effort: 'low' });
    const card = nudgeCardView(r);
    expect(card?.line).toBe('✦ Rough morning: one set fewer on the accessories?');
    expect(card?.offer?.lines[0]).toBe('Incline dumbbell press: 3 → 2 sets');
    const again = await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: low, opId: 'n-3' });
    expect(h.model?.requests).toHaveLength(1);
    expect(nudgeCardView(again)).toEqual(card);
    // Nothing applied until Apply (rule 3); Apply writes it.
    expect(h.applied).toEqual([]);
    if (card?.offer) expect(await h.service.apply(card.offer.proposal)).toMatchObject({ kind: 'applied' });
    expect(nudgeReviewStatus(again)).toBe('reviewed');
  });

  it('a signal while offline: not reviewed, no line anywhere, the Why? says so', async () => {
    const h = await harness({ availability: OFFLINE });
    const r = await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: low, opId: 'n-4' });
    expect(r).toEqual({ kind: 'not_reviewed', status: 'offline' });
    expect(nudgeCardView(r)).toBeNull();
    expect(coachWhyLine({ status: nudgeReviewStatus(r), nudge: r, mix: null })).toBe('Not reviewed · Offline');
    expect(coachWhyLine({ status: 'not_connected', nudge: null, mix: null })).toBe('Not reviewed · Coach not connected');
    expect(coachWhyLine({ status: 'reviewed', nudge: { kind: 'silent' }, mix: null })).toBeNull();
  });

  it('a line with an unchecked number stays silent (never shown unchecked)', async () => {
    const model = new StepModel([() => call('pre_session_nudge', { speak: true, line: 'Your HRV is 42, take it easy.' })]);
    const h = await harness({ model });
    expect(await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: low, opId: 'n-5' })).toEqual({ kind: 'silent' });
  });
});

describe('Mix it up and tap-to-talk', () => {
  it('the coach picks from the shortlist (light model); offline, code’s pick labelled not reviewed', async () => {
    const model = new StepModel([() => call('mix_pick', { exerciseId: 'crossover', reason: 'A different line of pull.' })]);
    const h = await harness({ model });
    const pick = await h.service.mixPick({ fromExerciseId: 'cable_fly', shortlist: ['pec_deck', 'crossover'], lastDone: () => null, world: h.world() });
    expect(pick).toMatchObject({ by: 'coach', exerciseId: 'crossover', reason: 'A different line of pull.' });
    if (pick === null) return;
    expect(mixRowView({ from: 'Cable fly', to: 'Cable crossover', pick, index: 1 })).toMatchObject({ line: 'Cable fly → Cable crossover · today only', reason: 'A different line of pull.', another: 'Another (1/2)' });
    const off = await harness({ availability: OFFLINE });
    const code = await off.service.mixPick({ fromExerciseId: 'cable_fly', shortlist: ['pec_deck', 'crossover'], lastDone: () => null, world: off.world() });
    expect(code).toMatchObject({ by: 'code', exerciseId: 'pec_deck', why: 'offline' });
    if (code !== null) expect(mixRowView({ from: 'Cable fly', to: 'Pec deck', pick: code, index: 1 }).reason).toBe('Not reviewed');
  });

  it('no on-device speech: the mic is ⊘ and nothing listens (no audio leaves the phone)', async () => {
    let started = 0;
    const port = (available: boolean, perm: 'granted' | 'denied'): SpeechInputPort => ({
      onDeviceAvailable: () => Promise.resolve(available),
      permission: () => Promise.resolve(perm),
      start: (h) => {
        started += 1;
        queueMicrotask(() => {
          h.partial('pull fifty');
          h.final('pull 50 minutes');
        });
        return { stop: () => undefined };
      },
    });
    const done: string[] = [];
    const states: string[] = [];
    const none = createDictation(port(false, 'granted'), { state: (s) => states.push(s), partial: () => undefined, done: (t) => done.push(t) });
    expect(await none.tap()).toBe('unavailable');
    expect(askBarView('setup', 'ok', 'unavailable').mic).toMatchObject({ glyph: '⊘', why: 'Needs on-device speech' });
    const denied = createDictation(port(true, 'denied'), { state: () => undefined, partial: () => undefined, done: () => undefined });
    expect(await denied.tap()).toBe('denied');
    expect(askBarView('setup', 'ok', 'denied').mic).toMatchObject({ glyph: '⊘', settingsLink: true });
    expect(started).toBe(0);

    const ok = createDictation(port(true, 'granted'), { state: (s) => states.push(s), partial: () => undefined, done: (t) => done.push(t) });
    expect(await ok.tap()).toBe('listening');
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toEqual(['pull 50 minutes']);
    expect(ok.state()).toBe('idle');
    expect(started).toBe(1);
    expect(askBarView('setup', 'ok', 'listening').mic).toMatchObject({ glyph: 'mic.fill', accessibilityLabel: 'Stop listening' });
  });
});
