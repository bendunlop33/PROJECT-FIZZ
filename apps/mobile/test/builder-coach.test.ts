import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createBuilderLoadGuard, type BuilderCoachSnapshot, type CoachModelPort, type ModelEvent, type ModelRequest, type SetupCoachContext, type SetupFill } from '@fizz/coach';
import { buildFromSetup, referenceE1rm, slotsOf, type BuilderSetup, type BuilderWorkout, type LoadReferences, type RefSession } from '@fizz/domain';
import { OWNER, builderFixture as F, idGen } from '@fizz/domain/testing';
import { openStore } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { ZonedTimestamp } from '@fizz/schemas';

import { createBuilderCoachService, createDayNotes, type BuilderCoachWorld, type BuilderWriteResult, type SetupFrom } from '../src/coach/builder-coach-service';
import { askBarView, builderReviewView, dayNotesFor, mixCoachReason, nudgeCardView, proposalCardView, todayCoachWhy } from '../src/coach/builder-coach-view';
import { createBuilderReviewProvider } from '../src/coach/builder-review-provider';
import { applyTurn, askTurn, builderSeesLabel, builderSheetStatus, settleTurn, skipTurn, turnCard, undoTurn, type BuilderTurn } from '../src/coach/builder-sheet-view';
import { editAskView } from '../src/coach/builder-coach-view';
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
const chest: BuilderSetup = { minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: [{ group: 'Chest', count: 3 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] };

function setupCtx(): SetupCoachContext {
  return {
    days: [
      { id: 'chest', name: 'Chest', mainLifts: [{ exerciseId: 'bench', catalogueId: null, name: 'Barbell bench press' }] },
      { id: 'pull', name: 'Pull', mainLifts: [{ exerciseId: 'row', catalogueId: null, name: 'Barbell row' }] },
    ],
    current: { dayId: 'chest', minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: chest.groups },
    recommend: () => [{ group: 'Back', count: 4 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }],
  };
}

function benchRefs(): LoadReferences {
  const s: RefSession = { sessionId: 's1', performedAtUtc: '2026-10-13T10:00:00Z', tz: 'Europe/London', source: 'app', sets: [{ value: 100, reps: 8, rpe: 8 }], top: { value: 100, reps: 8, rpe: 8 } };
  return { exerciseId: 'bench', unit: 'kg', convention: 'total', direction: 'resistance', equipment: F.bar, own: { sessions: [s], e1rm: referenceE1rm(s.sets), gapDays: 7, estOnly: false }, latest: s, all: [s], derived: null, patternE1rms: [], historyVersion: 'h1' };
}

async function harness(opts: { availability?: CoachAvailability; model?: StepModel | null; dayNotes?: boolean } = {}) {
  const store = await openStore(openNodeDriver(':memory:'));
  const ctx = F.context();
  let workout: BuilderWorkout = buildFromSetup(chest, F.pool, ctx).workout;
  let version = 1;
  let revs: Record<string, number> = {};
  let minutes = 60;
  let clock = Date.parse('2026-10-20T06:30:00Z');
  const now = (): ZonedTimestamp => ({ utc: new Date(clock).toISOString(), tz: 'Europe/London' });
  const setups: { fill: SetupFill; opId: string; openBuilder: boolean }[] = [];
  const setupFrom: SetupFrom[] = [];
  const applied: { opId: string; lines: readonly string[] }[] = [];
  let availability = opts.availability ?? CONNECTED;
  const model = opts.model === undefined ? new StepModel([]) : opts.model;
  const world = (): BuilderCoachWorld => {
    const snapshot: BuilderCoachSnapshot = { draftId: DRAFT, draftVersion: version, dayName: 'Chest', minutes, supersets: true, workout, revs };
    return {
      snapshot,
      env: { ctx, usable: (id) => F.info(id) !== null, pain: () => null, loads: createBuilderLoadGuard({ ctx, refs: (id) => (id === 'bench' ? benchRefs() : null), pain: () => null }), mainGroup: 'Chest' },
      extras: { usable: [{ exerciseId: 'incline_bb', name: 'Incline barbell press', group: 'Chest' }], painFlags: [], dayNotes: [], plan: null, goal: 'strength', history: [], memories: [] },
    };
  };
  const service = createBuilderCoachService({
    availability: () => Promise.resolve(availability),
    ...(model === null ? {} : { model: () => model }),
    now,
    newId: idGen(),
    ownerId: () => Promise.resolve(OWNER),
    source: {
      world: (id) => Promise.resolve(id === DRAFT ? world() : null),
      setup: (from) => {
        setupFrom.push(from);
        return Promise.resolve(setupCtx());
      },
    },
    writer: {
      applySetup: (fill, opId, o): Promise<BuilderWriteResult> => {
        if (!setups.some((s) => s.opId === opId)) setups.push({ fill, opId, openBuilder: o.openBuilder });
        return Promise.resolve({ ok: true });
      },
      applied: (opId) => Promise.resolve(applied.some((a) => a.opId === opId)),
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
    ...(opts.dayNotes === false ? {} : { dayNotes: createDayNotes({ store: () => store.repos.coach, ownerId: () => Promise.resolve(OWNER), now }) }),
  });
  const key = (id: string) => slotsOf(workout.blocks).find((s) => s.exerciseId === id)?.key ?? '';
  return {
    store,
    service,
    model,
    setups,
    setupFrom,
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

  it('from Today’s coach bar: the builder opens on Set up, filled, with Undo (review S8)', async () => {
    const h = await harness({ availability: OFFLINE });
    expect(await h.service.askSetup({ words: 'legs, 45 min', opId: 'op-t', from: 'today' })).toMatchObject({ kind: 'filled', by: 'code' });
    expect(h.setupFrom).toEqual(['today']);
    expect(h.setups[0]).toMatchObject({ openBuilder: true });
    await h.service.askSetup({ words: 'pull, 50 minutes', opId: 'op-s' });
    expect(h.setups[1]).toMatchObject({ openBuilder: false });
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
    // A double tap (or a retry after a force-close) is `applied` again and writes once (review S1).
    expect(await h.service.apply(b.proposal)).toEqual({ kind: 'applied', lines: ['Barbell bench press: 100 → 102.5 kg'] });
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
    // Set up with no coach is a field: words go to code's fill, no chat sheet (§2.6; review S9).
    expect(askBarView('setup', 'offline', 'idle').inline).toBe(true);
    expect(askBarView('setup', 'not_connected', 'idle').inline).toBe(true);
    expect(askBarView('setup', 'ok', 'idle').inline).toBe(false);
    expect(askBarView('workout', 'offline', 'idle').inline).toBe(false);
  });

  it('a call that fails while connected is `failed`, never `Coach not connected`; a gone draft is `gone` (review S12)', async () => {
    const model = new StepModel([() => call('propose_workout_edit', { ops: [], reply: 'x', weight: 100 }), () => [{ type: 'error', error: 'usage_limit' }], () => [{ type: 'error', error: 'auth_expired' }]]);
    const h = await harness({ model });
    expect(await h.service.askEdit({ draftId: DRAFT, words: 'swap the fly', opId: 'f-1' })).toEqual({ kind: 'unavailable', status: 'failed' });
    expect(await h.service.askEdit({ draftId: DRAFT, words: 'swap the fly', opId: 'f-2' })).toEqual({ kind: 'unavailable', status: 'failed' });
    expect(await h.service.askEdit({ draftId: DRAFT, words: 'swap the fly', opId: 'f-3' })).toEqual({ kind: 'unavailable', status: 'not_connected' });
    expect(await h.service.askEdit({ draftId: 'b7d0e2f4-1a2b-4c3d-8e9f-0a1b2c3d4e5f', words: 'swap the fly', opId: 'f-4' })).toEqual({ kind: 'gone' });
  });
});

describe('Your workout bar in the coach sheet (Ben, 26 Oct, option a)', () => {
  const AT = { atUtc: '2026-10-26T09:00:00.000Z', tz: 'Europe/London' };

  it('typed words come back as a proposal card with Apply / Skip; nothing is written until Apply; a stale Apply is refused; Undo once', async () => {
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
    let turns: BuilderTurn[] = askTurn([], { id: 's-1', words: ' swap the cable fly ', ...AT });
    // One request at a time: a second ask while the first is out is not added.
    expect(askTurn(turns, { id: 's-x', words: 'again', ...AT }).map((t) => t.id)).toEqual(['s-1']);
    expect(builderSheetStatus('ok', true).canSend).toBe(false);
    const a = settleTurn(turns, 's-1', editAskView(await h.service.askEdit({ draftId: DRAFT, words: turns[0]?.words ?? '', opId: 's-1' })));
    turns = askTurn(a.turns, { id: 's-2', words: 'bench heavier', ...AT });
    turns = settleTurn(turns, 's-2', editAskView(await h.service.askEdit({ draftId: DRAFT, words: 'bench heavier', opId: 's-2' }))).turns;
    expect(turns.map((t) => turnCard(t)?.actions)).toEqual([{ apply: 'Apply', skip: 'Skip' }, { apply: 'Apply', skip: 'Skip' }]);
    expect(turnCard(turns[0] as BuilderTurn)?.lines).toEqual(['Cable fly → Incline barbell press']);
    // Rule 3: asking wrote nothing.
    expect(h.applied).toEqual([]);

    // Ben edits the fly since: its Apply is refused (version-fenced), the card says so; nothing written.
    h.benEdits(h.key('cable_fly'));
    const first = turns[0];
    const second = turns[1];
    if (first?.result.kind !== 'proposal' || second?.result.kind !== 'proposal') throw new Error('proposals');
    const r1 = await h.service.apply(first.result.proposal);
    turns = applyTurn(turns, 's-1', r1.kind === 'applied' ? 'applied' : r1.kind === 'out_of_date' ? 'out_of_date' : 'failed');
    expect(turnCard(turns[0] as BuilderTurn)).toMatchObject({ actions: null, state: 'Out of date. Ask again.', undo: false });
    const r2 = await h.service.apply(second.result.proposal);
    turns = applyTurn(turns, 's-2', r2.kind === 'applied' ? 'applied' : 'failed');
    expect(h.applied.map((x) => x.opId)).toEqual(['builder-apply:s-2']);
    expect(turnCard(turns[1] as BuilderTurn)).toMatchObject({ actions: null, state: 'Applied', undo: true, undoState: null });
    turns = undoTurn(turns, 's-2', true);
    expect(turnCard(turns[1] as BuilderTurn)).toMatchObject({ undo: false, undoState: 'Undone' });
    // Undo is once: a second has no effect.
    expect(undoTurn(turns, 's-2', false)).toEqual(turns);
  });

  it('Skip writes nothing; offline is one word and Send is off; a reply has no actions', () => {
    const p = { id: 'k-1', words: 'swap it', ...AT };
    const reply = settleTurn(askTurn([], p), 'k-1', { kind: 'reply', text: 'The fly is already your only isolation.' }).turns;
    expect(turnCard(reply[0] as BuilderTurn)).toMatchObject({ actions: null, reason: 'The fly is already your only isolation.' });
    expect(skipTurn(reply, 'k-1')).toEqual(reply);
    const off = settleTurn(askTurn([], p), 'k-1', { kind: 'reach', reach: 'offline' });
    expect(off.reach).toBe('offline');
    expect(off.turns[0]?.result).toEqual({ kind: 'line', text: 'Offline', retry: true });
    expect(builderSheetStatus('offline', false)).toEqual({ word: 'Offline', canSend: false });
    expect(builderSeesLabel('Push A')).toBe('Sees: Push A (draft)');
  });

  it('wiring: Your workout opens the sheet with the builder entry (no Alert.prompt); ADR 0039: the same thread sheet as every chat, a draft change applies only from Apply', () => {
    const src = (f: string) => readFileSync(join(__dirname, '..', 'src', ...f.split('/')), 'utf8');
    const workout = src('screens/builder/BuilderWorkoutScreen.tsx');
    expect(workout).not.toContain('Alert.prompt');
    expect(workout).toContain("navigation.navigate('Coach', { entry: { kind: 'builder', draftId: snap.draftId, name: snap.name }, focus: true })");
    expect(src('screens/coach/CoachSheetScreen.tsx')).toContain('return <ThreadCoachSheet {...params} entry={params.entry} />;');
    expect(src('screens/coach/CoachSheetScreen.tsx')).not.toContain('BuilderCoachSheet');
    const cards = src('screens/coach/DraftCards.tsx');
    expect(cards.match(/services\.coach\.applyDraftEdit\(/g)?.length).toBe(1);
  });
});

describe('Coach review (§2.9) and day notes', () => {
  it('connected: verdict, suggestions with Apply, notes ticked; Done saves text notes as day notes (Your data)', async () => {
    const model = new StepModel([
      (req) => {
        const slots = (yourData(req).workout as { slots: { slotKey: string; exerciseId: string }[] }).slots;
        const fly = slots.find((s) => s.exerciseId === 'cable_fly')?.slotKey ?? '';
        return call('review_workout', { verdict: 'Balanced, 16 working sets', editComments: [], suggestions: [{ ops: [{ op: 'swap', slotKey: fly, toExerciseId: 'crossover' }], reason: 'Two lead with mid chest.' }], nextNotes: [{ text: 'Include abs', target: null }, { text: 'Hit 99 reps', target: null }, { text: null, target: { exerciseId: 'bench', value: 102.5, unit: 'kg', reps: 8 } }] });
      },
    ]);
    const h = await harness({ model });
    const r = await h.service.review({ draftId: DRAFT, opId: 'rv-1', groups: ['Chest', 'Arms', 'Core'], plan: null });
    expect(r?.status).toBe('reviewed');
    expect(h.model?.requests[0]).toMatchObject({ model: 'gpt-main', effort: 'high' });
    if (r === null) return;
    const v = builderReviewView(r, 'Chest');
    expect(v.header).toBe('● Coach');
    expect(v.verdict).toBe('Balanced, 16 working sets');
    expect(v.coverage.map((c) => c.text)).toEqual(['✓ Upper chest 3', '✓ Mid chest 7', '✓ Triceps 7', '✓ Abs 3']);
    // (Ben, 23 Oct) Not Incline barbell press: it would near-duplicate the Incline dumbbell press (code drops it).
    expect(v.suggestions.map((s) => [s.action, s.card.lines])).toEqual([['Swap', ['Cable fly → Cable crossover']]]);
    expect(v.notesTitle).toBe('For next Chest day');
    expect(v.notes.map((n) => [n.text, n.ticked])).toEqual([
      ['Include abs', true],
      ['Barbell bench press top set: 102.5 kg next', true],
    ]);
    expect(v.notShown).toEqual(['Hit 99 reps']);
    const stored = await h.store.repos.reviews.current(OWNER, { kind: 'session', draftId: DRAFT, draftVersion: 1 });
    expect(stored?.coach).toMatchObject({ status: 'reviewed', verdict: 'Balanced, 16 working sets', numbersChecked: true });
    expect(stored?.facts.some((f) => f.kind === 'group_sets' && f.group === 'Chest' && f.sets === 10)).toBe(true);

    // Unticked notes aren't saved; ticked ones are, once per op.
    const notes = r.coach?.notes ?? [];
    const save = () => h.service.saveReviewNotes({ notes, ticked: new Set(notes.map((n) => n.id)), splitDayId: 'chest', mainLiftExerciseId: 'bench', reviewId: r.reviewId, opId: 'done-1' });
    expect(await h.service.saveReviewNotes({ notes, ticked: new Set(), splitDayId: 'chest', mainLiftExerciseId: 'bench', reviewId: r.reviewId, opId: 'done-0' })).toEqual({ saved: 0, skipped: 0, notSaved: [] });
    // The numeric note is kept as a text day note in code's words until coach targets are stored (B4, SP2).
    expect(await save()).toEqual({ saved: 2, skipped: 0, notSaved: [] });
    expect(await save()).toEqual({ saved: 2, skipped: 0, notSaved: [] });
    const memories = await h.store.repos.coach.listMemories(OWNER);
    expect(memories.map((m) => [m.text, m.dayNote?.splitDayId, m.dayNote?.mainLiftExerciseId]).sort()).toEqual([
      ['Barbell bench press top set: 102.5 kg next', 'chest', 'bench'],
      ['Include abs', 'chest', 'bench'],
    ]);
    // Shown next time on Chest · bench (and sent with that day only); ✕ today hides it today; not on Chest · incline.
    expect(dayNotesFor(memories, 'chest', 'bench', '2026-10-27').map((n) => n.text).sort()).toEqual(['Barbell bench press top set: 102.5 kg next', 'Include abs']);
    expect(dayNotesFor(memories, 'chest', 'incline_bb', '2026-10-27')).toEqual([]);
    const hidden = memories.map((m) => (m.dayNote === undefined ? m : { ...m, dayNote: { ...m.dayNote, hiddenOn: ['2026-10-27'] } }));
    expect(dayNotesFor(hidden, 'chest', 'bench', '2026-10-27')).toEqual([]);
  });

  it('no day-notes port: no notes on the sheet (never a ticked note that won’t be kept; B4)', async () => {
    const model = new StepModel([() => call('review_workout', { verdict: 'Good', editComments: [], suggestions: [], nextNotes: [{ text: 'Include abs', target: null }, { text: null, target: { exerciseId: 'bench', value: 102.5, unit: 'kg', reps: 8 } }] })]);
    const h = await harness({ model, dayNotes: false });
    const r = await h.service.review({ draftId: DRAFT, opId: 'rv-n', groups: [], plan: null });
    expect(r === null ? null : builderReviewView(r, 'Chest').notes).toEqual([]);
  });

  it('From last review: only the latest review’s notes, never a pile of old ones (S5)', async () => {
    const h = await harness();
    const save = (text: string, reviewId: string, opId: string) => h.service.saveReviewNotes({ notes: [{ id: opId, kind: 'text', text }], ticked: new Set([opId]), splitDayId: 'chest', mainLiftExerciseId: 'bench', reviewId, opId });
    await save('Include abs', '1d1d1d1d-0000-4000-8000-000000000001', 'a');
    h.tick(7 * 86_400_000);
    await save('Keep the fly', '1d1d1d1d-0000-4000-8000-000000000002', 'b');
    await save('Bench first', '1d1d1d1d-0000-4000-8000-000000000002', 'c');
    const memories = await h.store.repos.coach.listMemories(OWNER);
    expect(dayNotesFor(memories, 'chest', 'bench', '2026-10-27').map((n) => n.text).sort()).toEqual(['Bench first', 'Keep the fly']);
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
    // (Ben, 23 Oct, D1) No `Update plan day` before Start: the Plan section has no plan write.
    expect(Object.keys(v.plan ?? {})).not.toContain('updatePlanDay');
    expect((await h.store.repos.reviews.current(OWNER, { kind: 'session', draftId: DRAFT, draftVersion: 1 }))?.coach).toEqual({ status: 'offline' });
  });
});

describe('pre-session nudge on Today (§6.1)', () => {
  const quiet = { today: '2026-10-20', recent: [], checkIn: null, offerAtOrBelow: 2, activities: [] };
  const low = { ...quiet, checkIn: { id: '9a1d2c3e-4f50-4a61-8b72-c3d4e5f60718', score: 1, localDate: '2026-10-20' } };

  it('no clear signal: silent by code, no model call, stored as silent', async () => {
    const h = await harness();
    const r = await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: quiet, opId: 'n-1' });
    expect(r).toEqual({ kind: 'silent', by: 'code' });
    expect(h.model?.requests).toEqual([]);
    expect((await h.store.repos.reviews.current(OWNER, { kind: 'pre_session', localDate: '2026-10-20', splitDayId: 'chest', draftId: DRAFT }))?.coach).toEqual({ status: 'silent' });
    // The coach didn't look: never reported as reviewed (SP1: Ben decides whether Why? shows `Not reviewed`).
    expect(todayCoachWhy(r)).toEqual({ coachReason: null, review: 'not_reviewed' });
  });

  it('offline with quiet inputs: `Not reviewed · Offline`, never “reviewed” (review B5)', async () => {
    const h = await harness({ availability: OFFLINE });
    const r = await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: quiet, opId: 'n-q' });
    expect(r).toEqual({ kind: 'not_reviewed', status: 'offline' });
    expect(todayCoachWhy(r)).toEqual({ coachReason: null, review: 'offline' });
    const none = await harness({ model: null });
    expect(todayCoachWhy(await none.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: quiet, opId: 'n-q2' }))).toEqual({ coachReason: null, review: 'not_connected' });
  });

  it('after Apply the nudge stays quiet that day: no new offer a step lighter, no model call (review B1)', async () => {
    const hot = {
      ...quiet,
      recent: ['2026-10-18', '2026-10-16', '2026-10-14'].map((d, i) => ({ sessionId: `0c0c0c0c-0000-4000-8000-00000000000${String(i)}`, localDate: d, exercises: [{ exerciseId: 'bench', sets: [{ working: true, reps: 6, targetRepsMin: 6, rpe: 9.5 }] }] })),
    };
    const model = new StepModel([() => call('pre_session_nudge', { speak: true, line: 'Three hard sessions in a row. Lighter today?' }), () => call('pre_session_nudge', { speak: true, line: 'Lighter again?' })]);
    const h = await harness({ model });
    const r = await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: hot, opId: 'n-a' });
    expect(r.kind === 'line' && r.offer?.proposal.lines).toEqual(['Barbell bench press: 100 → 97.5 kg']);
    if (r.kind !== 'line' || r.offer === null) return;
    expect(await h.service.applyNudge({ offer: r.offer, localDate: '2026-10-20', opId: 'tap-1' })).toMatchObject({ kind: 'applied' });
    // Today opens again (and again): settled, no new offer, no second model call.
    for (const op of ['n-b', 'n-c']) {
      const again = await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: hot, opId: op });
      expect(again).toEqual({ kind: 'settled', line: 'Three hard sessions in a row. Lighter today?', outcome: 'applied' });
      expect(nudgeCardView(again)).toBeNull();
      expect(todayCoachWhy(again)).toEqual({ coachReason: 'Three hard sessions in a row. Lighter today?', review: 'reviewed' });
    }
    expect(h.model?.requests).toHaveLength(1);
    expect(h.applied).toHaveLength(1);
  });

  it('Skip also settles the day; a new signal (a new input) may speak again', async () => {
    const model = new StepModel([() => call('pre_session_nudge', { speak: true, line: 'Rough morning: one set fewer?' }), () => call('pre_session_nudge', { speak: true, line: 'Hard run yesterday too.' })]);
    const h = await harness({ model });
    expect((await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: low, opId: 'k-1' })).kind).toBe('line');
    await h.service.skipNudge({ localDate: '2026-10-20', opId: 'skip-1' });
    expect(await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: low, opId: 'k-2' })).toMatchObject({ kind: 'settled', outcome: 'skipped' });
    expect(h.applied).toEqual([]);
    expect(h.model?.requests).toHaveLength(1);
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
    expect(todayCoachWhy(again)).toEqual({ coachReason: 'Rough morning: one set fewer on the accessories?', review: 'reviewed' });
    if (card?.offer) expect(await h.service.apply(card.offer.proposal)).toMatchObject({ kind: 'applied' });
  });

  it('a signal while offline: not reviewed, no line anywhere, the Why? says so', async () => {
    const h = await harness({ availability: OFFLINE });
    const r = await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: low, opId: 'n-4' });
    expect(r).toEqual({ kind: 'not_reviewed', status: 'offline' });
    expect(nudgeCardView(r)).toBeNull();
    expect(todayCoachWhy(r)).toEqual({ coachReason: null, review: 'offline' });
    expect(todayCoachWhy(null)).toEqual({ coachReason: null, review: 'pending' });
  });

  it('a line with an unchecked number stays silent (never shown unchecked)', async () => {
    const model = new StepModel([() => call('pre_session_nudge', { speak: true, line: 'Your HRV is 42, take it easy.' })]);
    const h = await harness({ model });
    const r = await h.service.preSessionNudge({ draftId: DRAFT, splitDayId: 'chest', input: low, opId: 'n-5' });
    expect(r).toEqual({ kind: 'silent', by: 'coach' });
    expect(todayCoachWhy(r)).toEqual({ coachReason: null, review: 'reviewed' });
  });
});

describe('Mix it up and tap-to-talk', () => {
  it('the coach picks from the shortlist (light model); offline, code’s pick labelled not reviewed', async () => {
    const model = new StepModel([() => call('mix_pick', { exerciseId: 'crossover', reason: 'A different line of pull.' })]);
    const h = await harness({ model });
    const pick = await h.service.mixPick({ fromExerciseId: 'cable_fly', shortlist: ['pec_deck', 'crossover'], lastDone: () => null, world: h.world() });
    expect(pick).toMatchObject({ by: 'coach', exerciseId: 'crossover', reason: 'A different line of pull.' });
    if (pick === null) return;
    expect(mixCoachReason(pick)).toBe('A different line of pull.');
    const off = await harness({ availability: OFFLINE });
    const code = await off.service.mixPick({ fromExerciseId: 'cable_fly', shortlist: ['pec_deck', 'crossover'], lastDone: () => null, world: off.world() });
    expect(code).toMatchObject({ by: 'code', exerciseId: 'pec_deck', why: 'offline' });
    expect(mixCoachReason(code)).toBeNull();
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
    // `⊘` before any tap: the probe on mount needs no tap and asks no permission (review S6).
    expect(await none.probe()).toBe('unavailable');
    expect(none.state()).toBe('unavailable');
    expect(await none.tap()).toBe('unavailable');
    expect(askBarView('setup', 'ok', 'unavailable').mic).toMatchObject({ glyph: '⊘', why: 'Needs on-device speech' });
    const denied = createDictation(port(true, 'denied'), { state: () => undefined, partial: () => undefined, done: () => undefined });
    expect(await denied.tap()).toBe('denied');
    expect(askBarView('setup', 'ok', 'denied').mic).toMatchObject({ glyph: '⊘', settingsLink: true });
    expect(started).toBe(0);

    const ok = createDictation(port(true, 'granted'), { state: (s) => states.push(s), partial: () => undefined, done: (t) => done.push(t) });
    expect(await ok.probe()).toBe('idle');
    expect(await ok.tap()).toBe('listening');
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toEqual(['pull 50 minutes']);
    expect(ok.state()).toBe('idle');
    expect(started).toBe(1);
    expect(askBarView('setup', 'ok', 'listening').mic).toMatchObject({ glyph: 'mic.fill', accessibilityLabel: 'Stop listening' });
  });
});

describe('the BuilderReview provider the builder sheet consumes (review B6)', () => {
  const plan = { planName: '4-day split', since: '13 Oct', dayName: 'Chest', nextDayName: 'Chest', nextDayNumber: 1, dayCount: 4, minutes: 60, mainLiftExerciseId: 'bench', exercises: [{ exerciseId: 'bench', workingSets: 4 }, { exerciseId: 'machine_press', workingSets: 3 }] };
  const inputs = { dayName: 'Chest', groups: ['Chest', 'Arms', 'Core'] as const, plan, splitDayId: 'chest', mainLiftExerciseId: 'bench' };

  it('review → the builder’s shape; apply by action ID (twice = once); Out of date after Ben’s edit; Done saves ticked notes', async () => {
    let fly = '';
    let push = '';
    const model = new StepModel([
      (req) => {
        const slots = (yourData(req).workout as { slots: { slotKey: string; exerciseId: string }[] }).slots;
        fly = slots.find((x) => x.exerciseId === 'cable_fly')?.slotKey ?? '';
        push = slots.find((x) => x.exerciseId === 'pushdown')?.slotKey ?? '';
        return call('review_workout', {
          verdict: 'Mid chest 7, upper chest 3',
          editComments: [],
          suggestions: [
            { ops: [{ op: 'swap', slotKey: fly, toExerciseId: 'crossover' }], reason: 'A second angle.' },
            { ops: [{ op: 'sets', slotKey: push, workingSets: 4 }], reason: 'More triceps.' },
          ],
          nextNotes: [{ text: 'Include abs', target: null }],
        });
      },
    ]);
    const h = await harness({ model });
    const provider = createBuilderReviewProvider(h.service, { inputs: (id) => Promise.resolve(id === DRAFT ? { ...inputs, groups: [...inputs.groups] } : null) }, { newId: idGen() });
    const r = await provider.review(DRAFT);
    expect(r.status).toBe('reviewed');
    expect(r.verdict).toBe('Mid chest 7, upper chest 3');
    expect(r.counts).toEqual([
      { group: 'Upper chest', sets: 3, trained: true },
      { group: 'Mid chest', sets: 7, trained: true },
      { group: 'Triceps', sets: 7, trained: true },
      { group: 'Abs', sets: 3, trained: true },
    ]);
    // (Ben, 23 Oct, D1) `Add back` only: no `Update plan day` before Start (Keep for next time is on the Summary).
    expect(r.plan?.actions.map((a) => [a.text, a.apply])).toEqual([['Add back Machine chest press', 'Add']]);
    expect(r.suggestions.map((x) => [x.text, x.reason, x.apply])).toEqual([
      ['Cable fly → Cable crossover', 'A second angle.', 'Swap'],
      ['Triceps pushdown: 3 → 4 sets', 'More triceps.', 'Apply'],
    ]);
    expect([r.nextNotesTitle, r.nextNotes]).toEqual(['For next Chest day', [{ id: expect.any(String) as string, text: 'Include abs', ticked: true }]]);

    const [swap, sets] = r.suggestions;
    if (swap === undefined || sets === undefined) return;
    expect(await provider.apply(DRAFT, sets.id, 'op-a')).toMatchObject({ ok: true });
    expect(await provider.apply(DRAFT, sets.id, 'op-b')).toMatchObject({ ok: true });
    expect(h.applied).toHaveLength(1);
    h.benEdits(fly);
    expect(await provider.apply(DRAFT, swap.id, 'op-c')).toEqual({ ok: false, message: 'Out of date. Ask again.' });
    expect(await provider.apply(DRAFT, 'nope', 'op-d')).toEqual({ ok: false, message: 'Out of date. Ask again.' });

    expect(await provider.saveNotes(DRAFT, [], 'done-0')).toMatchObject({ ok: true, saved: 0 });
    expect(await provider.saveNotes(DRAFT, r.nextNotes.map((n) => n.id), 'done-1')).toMatchObject({ ok: true, saved: 1 });
    expect((await h.store.repos.coach.listMemories(OWNER)).map((m) => m.text)).toEqual(['Include abs']);
  });

  it('offline: code’s counts and Plan with Add back, no verdict, suggestions or notes; a failed call is `failed` (Not reviewed)', async () => {
    const off = await harness({ availability: OFFLINE });
    const p = createBuilderReviewProvider(off.service, { inputs: () => Promise.resolve({ ...inputs, groups: [...inputs.groups] }) }, { newId: idGen() });
    const r = await p.review(DRAFT);
    expect([r.status, r.verdict, r.suggestions, r.nextNotes, r.nextNotesTitle]).toEqual(['offline', null, [], [], null]);
    expect(r.counts.length).toBe(4);
    expect(r.plan?.actions[0]?.text).toBe('Add back Machine chest press');
    const bad = await harness({ model: new StepModel([() => call('review_workout', { verdict: 'x', score: 1 })]) });
    const q = createBuilderReviewProvider(bad.service, { inputs: () => Promise.resolve({ ...inputs, groups: [...inputs.groups] }) }, { newId: idGen() });
    expect((await q.review(DRAFT)).status).toBe('failed');
  });
});

describe('source checks (feel and device behaviour go on Ben’s checklist)', () => {
  const SRC = join(__dirname, '..', 'src');
  const flat = (f: string) => readFileSync(join(SRC, f), 'utf8').replace(/\s+/g, ' ');
  it('the ask bar: two controls with VoiceOver labels, 48 pt targets, Listening announced on iOS, ⊘ probed on mount, Set up words straight to code offline', () => {
    const bar = flat('ui/coach-ask-bar.tsx');
    expect(bar).toContain('const BAR_HEIGHT = 48;');
    // Two controls (bar, mic) in each layout; the active workout's `icons` layout and Today's `compact` header
    // (`✦ Coach` pill, §2.0.2) and (redesign v3 §A1) its round `✦` icon button each have their own ✦ button and share the mic.
    expect(bar.match(/accessibilityRole="button"/g)?.length).toBe(5);
    expect(bar).toContain('const ICON_SIZE = 44;');
    expect(bar).toContain("AccessibilityInfo.announceForAccessibility('Listening')");
    expect(bar).toContain('AccessibilityInfo.announceForAccessibility(text)');
    expect(bar).toContain('void dictation.probe();');
    expect(bar).toContain("AppState.addEventListener('change'");
    expect(bar).toContain('Linking.openSettings()');
    expect(bar).toContain('send.current = inline ? (text) => { onSubmit(text); } : (text) => { onOpen(text); };');
    // Dynamic Type wraps, never clips (N1).
    expect(bar).not.toContain('numberOfLines');
  });
  it('speech is on-device only, checked before every start; no server fallback', () => {
    const speech = flat('voice/on-device-speech.ts');
    expect(speech).toContain('requiresOnDeviceRecognition: true');
    expect(speech).toContain('!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()');
    expect(speech).not.toMatch(/requiresOnDeviceRecognition: false/);
    // A start that throws leaves no listeners behind (N4).
    expect(speech).toContain('} catch (e) { // Never left listening for a session that didn');
  });
});
