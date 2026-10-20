import { describe, expect, it } from 'vitest';

import { addActivity, weekFacts, localMidnightUtcMs } from '@fizz/domain';
import type { ActionRecord, Activity, CoachWrite, CoachWriteResult, ZonedTimestamp } from '@fizz/schemas';

import {
  acceptActivityOffer,
  activityFieldsFrom,
  activityWords,
  asksToLogActivity,
  asksToPlanWeek,
  buildTurnRegistry,
  classifyBenRequest,
  createActivityExecutor,
  createWeekExecutor,
  renderActionResult,
  requestHas,
  type CoachWriteStore,
  type ToolCallContext,
} from '../src/index';

/**
 * (Ben, 20 Oct) `log_activity` (logged when Ben's own words tell the coach,
 * else an offer he taps) and `propose_week` (always a proposal). Today is
 * Fri 23 Oct 2026 in London.
 */

const TZ = 'Europe/London';
const TODAY = '2026-10-23';
const NOW: ZonedTimestamp = { utc: '2026-10-23T08:00:00.000Z', tz: TZ };
const OWNER = '00000000-0000-4000-8000-000000000001';

describe('Ben tells the coach about an activity', () => {
  it.each(['18 km run yesterday', 'long run Saturday', "I've got a long run Saturday, plan my week around it", 'did a 10k this morning', 'log a 45 min ride', 'Played football last night, 90 min', 'easy 5k run today'])('"%s" asks to log it', (text) => {
    expect(asksToLogActivity(text)).toBe(true);
  });

  it.each(['Should I run before legs?', 'I ran out of time today', 'run me through the plan', 'What is a long run?', 'my legs are sore', 'Build me a 4-day plan'])('"%s" does not', (text) => {
    expect(asksToLogActivity(text)).toBe(false);
  });

  it.each(["I've got a long run Saturday, plan my week around it", 'rejig my week', 'can you work my training around my run', 'plan the week around Saturday’s long run'])('"%s" asks to shape the week', (text) => {
    expect(asksToPlanWeek(text)).toBe(true);
    // Never a new plan.
    expect(requestHas(classifyBenRequest(text, 'general'), 'build_plan')).toBe(false);
  });

  it('"plan my week" alone is still a new plan', () => {
    expect(asksToPlanWeek('can you plan my week')).toBe(false);
    expect(requestHas(classifyBenRequest('can you plan my week', 'general'), 'build_plan')).toBe(true);
  });

  it('reads the day, distance, time and effort from his words', () => {
    expect(activityWords('18 km run yesterday', TODAY)).toEqual({ kind: 'run', distanceM: 18_000, date: '2026-10-22' });
    expect(activityWords('long run Saturday', TODAY)).toEqual({ kind: 'run', effort: 'long', date: '2026-10-24' });
    expect(activityWords('did a long run on Wednesday', TODAY)).toMatchObject({ date: '2026-10-21' });
    expect(activityWords('1h 30 min ride', TODAY)).toMatchObject({ kind: 'ride', durationS: 5400 });
    expect(activityWords('10 miles easy', TODAY)).toMatchObject({ distanceM: 16_093, effort: 'easy' });
    expect(activityWords('half marathon sunday', TODAY)).toMatchObject({ kind: 'run', distanceM: 21_097, date: '2026-10-25' });
    expect(activityWords('run on friday', TODAY).date).toBe(TODAY);
  });

  it('his words win; a day ahead is planned, one before done; no effort he didn’t say', () => {
    const args = { kind: 'run' as const, status: 'done' as const, date: '2026-10-20', durationMin: 95, distanceKm: 20, effort: 'long' as const };
    expect(activityFieldsFrom(args, activityWords('long run Saturday', TODAY), TODAY)).toEqual({ kind: 'run', status: 'planned', date: '2026-10-24', durationS: 5700, distanceM: 20_000, effort: 'long' });
    expect(activityFieldsFrom(args, {}, TODAY)).toEqual({ kind: 'run', status: 'done', date: '2026-10-20', durationS: 5700, distanceM: 20_000, effort: null });
    expect(activityFieldsFrom({ ...args, date: '2027-03-01' }, {}, TODAY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The executors, against an in-memory store

function memoryStore() {
  const records = new Map<string, ActionRecord>();
  const activities = new Map<string, Activity>();
  const store: CoachWriteStore = {
    commit(_owner: string, write: CoachWrite): Promise<CoachWriteResult> {
      const prior = [...records.values()].find((r) => r.opId === write.action.opId);
      if (prior !== undefined) return Promise.resolve({ status: 'replayed', action: prior });
      if (write.kind === 'activity') {
        if (activities.has(write.activity.id)) return Promise.resolve({ status: 'conflict', reason: 'already_exists' });
        activities.set(write.activity.id, write.activity);
      }
      records.set(write.action.actionId, write.action);
      return Promise.resolve({ status: 'written', action: write.action });
    },
    getMemory: () => Promise.resolve(null),
    listRecentActions: () => Promise.resolve([...records.values()]),
  };
  return { store, records, activities };
}

const ctx = (benWords: string | null, opId = 'call-1'): ToolCallContext => ({ ownerId: OWNER, turnId: 'turn-1', opId, now: NOW, benWords, messagePain: null, intent: 'general' });
const call = (args: Record<string, unknown>) => ({ tool: 'log_activity' as const, args: { kind: 'run', status: 'done', date: '2026-10-22', durationMin: null, distanceKm: 18, effort: null, reason: 'Ben ran', ...args } });

describe('log_activity: asked vs offered (rule 3)', () => {
  it('Ben asked: logged at once, with Undo on the card; a retry replays', async () => {
    const m = memoryStore();
    const exec = createActivityExecutor({ store: m.store, tz: TZ, onDate: (date) => Promise.resolve([...m.activities.values()].filter((a) => a.fields.date === date && a.deletedAtUtc === null)) }).log_activity;
    if (exec === undefined) throw new Error('no executor');
    const r = await exec(call({}) as never, ctx('18 km run yesterday'));
    expect(r.kind === 'action' && r.record).toMatchObject({ status: 'committed', detail: { kind: 'log_activity', fields: { kind: 'run', status: 'done', date: '2026-10-22', distanceM: 18_000, effort: null }, versionAfter: 1 } });
    expect(m.activities.size).toBe(1);
    expect([...m.activities.values()][0]).toMatchObject({ source: 'coach' });
    if (r.kind === 'action') expect(renderActionResult(r.record, 'sheet').text.replaceAll(' ', ' ')).toBe('Logged: Run · 22 Oct · 18 km.');
    const again = await exec(call({}) as never, ctx('18 km run yesterday'));
    expect(again).toMatchObject({ kind: 'action', replayed: true });
    expect(m.activities.size).toBe(1);
    // The same run told again in another turn: refused, never twice.
    const twice = await exec(call({}) as never, ctx('18 km run yesterday', 'call-2'));
    expect(twice.kind === 'action' && twice.record).toMatchObject({ status: 'rejected', failure: 'it’s already logged' });
  });

  it('the coach raised it: an offer; Ben’s Log logs exactly that (once)', async () => {
    const m = memoryStore();
    const deps = { store: m.store, tz: TZ, onDate: () => Promise.resolve([] as Activity[]) };
    const exec = createActivityExecutor(deps).log_activity;
    if (exec === undefined) throw new Error('no executor');
    const r = await exec(call({ date: '2026-10-24', status: 'planned', distanceKm: null, durationMin: 120 }) as never, ctx('my legs feel heavy this week'));
    if (r.kind !== 'action') throw new Error(r.kind);
    expect(r.record).toMatchObject({ status: 'proposed', detail: { activityId: null, fields: { status: 'planned', date: '2026-10-24', durationS: 7200 } } });
    expect(m.activities.size).toBe(0);
    expect(renderActionResult(r.record, 'sheet').text.replaceAll(' ', ' ')).toBe('Log Planned run · 24 Oct · 2 h?');
    const yes = await acceptActivityOffer(deps, r.record, { ownerId: OWNER, turnId: 'turn-2', now: NOW });
    expect(yes.kind === 'action' && yes.record).toMatchObject({ status: 'committed', detail: { proposalId: r.record.actionId } });
    expect(await acceptActivityOffer(deps, r.record, { ownerId: OWNER, turnId: 'turn-3', now: NOW })).toMatchObject({ kind: 'action', replayed: true });
    expect(m.activities.size).toBe(1);
  });

  it('nothing to log but a day: refused (no invented effort, rule 6)', async () => {
    const m = memoryStore();
    const exec = createActivityExecutor({ store: m.store, tz: TZ, onDate: () => Promise.resolve([]) }).log_activity;
    if (exec === undefined) throw new Error('no executor');
    const r = await exec(call({ distanceKm: null }) as never, ctx('went for a run yesterday'));
    expect(r.kind === 'action' && r.record).toMatchObject({ status: 'rejected' });
    expect(m.activities.size).toBe(0);
  });
});

describe('propose_week: always a proposal', () => {
  const day = (n: number, name: string, bodyParts: string[]) => ({ id: `d${String(n)}`, name, bodyParts: bodyParts as never, done: false });
  const nowMs = localMidnightUtcMs(TODAY, TZ) + 9 * 3_600_000;
  const run = addActivity({ id: '00000000-0000-4000-8000-000000000099', ownerId: OWNER, fields: { kind: 'run', status: 'planned', date: '2026-10-24', durationS: null, distanceM: null, effort: 'long' }, source: 'ben', opId: 'r', at: NOW });
  if (run.kind !== 'write') throw new Error('run');
  const facts = weekFacts({ today: TODAY, nowMs, tz: TZ, aim: 4, gymDates: new Set(['2026-10-19', '2026-10-21']), days: [day(1, 'Chest', ['Chest']), day(2, 'Shoulders', ['Shoulders']), day(3, 'Legs', ['Quads'])], activities: [run.next] });

  it('checked against the week and saved as proposed with its before/after list', async () => {
    const m = memoryStore();
    const exec = createWeekExecutor({ store: m.store, week: () => Promise.resolve({ facts, basis: { kind: 'split' }, factsKey: 'k1' }) }).propose_week;
    if (exec === undefined) throw new Error('no executor');
    const r = await exec({ tool: 'propose_week', args: { merges: [{ dayIds: ['d1', 'd2'], name: 'Push' }], skips: [], message: 'Saturday’s long run.' } }, ctx('plan my week around it'));
    if (r.kind !== 'action') throw new Error(r.kind);
    expect(r.record).toMatchObject({ status: 'proposed', detail: { kind: 'propose_week', weekMonday: '2026-10-19', factsKey: 'k1', after: [{ name: 'Push', note: 'Chest + Shoulders' }, { name: 'Legs' }] } });
    expect(renderActionResult(r.record, 'sheet').text).toContain('This week: Push (Chest + Shoulders)');
    const bad = await exec({ tool: 'propose_week', args: { merges: [{ dayIds: ['d1', 'nope'], name: 'Push' }], skips: [], message: '' } }, ctx(null, 'call-2'));
    expect(bad.kind === 'action' && bad.record.status).toBe('rejected');
  });

  it('opens on Ben’s ask or when code sees more days than gym days; never on a plain question', () => {
    const gate = { kind: 'general' as const, acceptedOffer: false, benPainWords: false, structuralSignals: [] };
    const has = (g: Parameters<typeof buildTurnRegistry>[0]) => buildTurnRegistry(g).tools.some((t) => t.name === 'propose_week');
    expect(has({ ...gate, benRequest: classifyBenRequest('plan my week around my long run', 'general') })).toBe(true);
    expect(has({ ...gate, benRequest: null, weekOpen: true })).toBe(true);
    expect(has({ ...gate, benRequest: classifyBenRequest('how was my week?', 'general') })).toBe(false);
    // A pain flag is about the next workout, not the week.
    expect(has({ ...gate, benRequest: null, structuralSignals: ['pain_flag'] })).toBe(false);
    expect(has({ ...gate, kind: 'workout', benRequest: null, weekOpen: true })).toBe(false);
  });
});
