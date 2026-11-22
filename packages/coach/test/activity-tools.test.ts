import { describe, expect, it } from 'vitest';

import { addActivity, weekFacts, localMidnightUtcMs } from '@fizz/domain';
import type { ActionRecord, Activity, CoachWrite, CoachWriteResult, ZonedTimestamp } from '@fizz/schemas';

import {
  acceptActivityOffer,
  activityMentions,
  activityWords,
  asksToLogActivity,
  asksToPlanWeek,
  buildTurnRegistry,
  classifyBenRequest,
  createActivityExecutor,
  createWeekExecutor,
  WEEK_APPLIED_LINE,
  weekAtOnceOpId,
  readActivityCall,
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

  it('his words for that activity back the call; a day ahead is planned, one before done; no effort he didn’t say', () => {
    const args = { kind: 'run' as const, status: 'done' as const, date: '2026-10-24', durationMin: 95, distanceKm: 20, effort: 'long' as const };
    expect(readActivityCall(args, 'long run Saturday', TODAY)).toEqual({ agrees: true, fields: { kind: 'run', status: 'planned', date: '2026-10-24', durationS: 5700, distanceM: 20_000, effort: 'long' } });
    // No words of Ben's: the model's values, never its effort; an offer.
    expect(readActivityCall({ ...args, date: '2026-10-20' }, null, TODAY)).toEqual({ agrees: false, fields: { kind: 'run', status: 'done', date: '2026-10-20', durationS: 5700, distanceM: 20_000, effort: null } });
    expect(readActivityCall({ ...args, date: '2027-03-01' }, null, TODAY)).toBeNull();
    // His day for it differs from the model's: his day is what the offer shows.
    expect(readActivityCall({ ...args, date: '2026-10-20' }, 'long run Saturday', TODAY)).toMatchObject({ agrees: false, fields: { date: '2026-10-24' } });
    // "long" for a run his numbers make long is not an invented effort.
    expect(readActivityCall({ ...args, date: '2026-10-22', durationMin: null, distanceKm: 18 }, '18 km run yesterday', TODAY)).toMatchObject({ agrees: true, fields: { effort: null, distanceM: 18_000 } });
  });
});

describe('several things in one message (review B1)', () => {
  // Today: Thu 22 Oct.
  const THU = '2026-10-22';
  const base = { status: 'done' as const, durationMin: null, distanceKm: null, effort: null };

  it('each activity is read from its own clause', () => {
    expect(activityMentions('Had an easy 5k yesterday, long run Saturday', THU)).toEqual([
      { kind: 'run', effort: 'easy', distanceM: 5000, date: '2026-10-21' },
      { kind: 'run', effort: 'long', date: '2026-10-24' },
    ]);
    expect(activityMentions('Last session was hard, also did a 10k run', THU)).toEqual([{ kind: 'run', distanceM: 10_000 }]);
    expect(activityMentions('I swam yesterday and have a long run Saturday', THU)).toEqual([
      { kind: 'swim', date: '2026-10-21' },
      { kind: 'run', effort: 'long', date: '2026-10-24' },
    ]);
    expect(activityMentions('Legs feel heavy today', THU)).toEqual([]);
    // A trailing clause adds a number or a day, never an effort.
    expect(activityMentions('did a run yesterday, 18 km, felt hard', THU)).toEqual([{ kind: 'run', date: '2026-10-21', distanceM: 18_000 }]);
  });

  it('"Had an easy 5k yesterday, long run Saturday": the 5k stays easy and both are offers', () => {
    const easy = readActivityCall({ ...base, kind: 'run', date: '2026-10-21', distanceKm: 5, effort: 'easy' }, 'Had an easy 5k yesterday, long run Saturday', THU);
    expect(easy).toEqual({ agrees: false, fields: { kind: 'run', status: 'done', date: '2026-10-21', durationS: null, distanceM: 5000, effort: 'easy' } });
    const long = readActivityCall({ ...base, kind: 'run', status: 'planned', date: '2026-10-24', effort: 'long' }, 'Had an easy 5k yesterday, long run Saturday', THU);
    expect(long).toEqual({ agrees: false, fields: { kind: 'run', status: 'planned', date: '2026-10-24', durationS: null, distanceM: null, effort: 'long' } });
  });

  it('"Last session was hard, also did a 10k run": no effort on the run', () => {
    const r = readActivityCall({ ...base, kind: 'run', date: THU, distanceKm: 10, effort: 'hard' }, 'Last session was hard, also did a 10k run', THU);
    expect(r).toMatchObject({ agrees: false, fields: { effort: null, distanceM: 10_000 } });
  });

  it('"Swam yesterday and long run Saturday": the swim stays a swim', () => {
    const r = readActivityCall({ ...base, kind: 'swim', date: '2026-10-21', durationMin: 40 }, 'I swam yesterday and have a long run Saturday', THU);
    expect(r).toMatchObject({ agrees: false, fields: { kind: 'swim', date: '2026-10-21', effort: null } });
  });

  it('an unrelated "today" never moves the model’s date', () => {
    const r = readActivityCall({ ...base, kind: 'run', date: '2026-10-21', distanceKm: 12 }, 'Legs feel heavy today', THU);
    expect(r).toMatchObject({ agrees: false, fields: { date: '2026-10-21', status: 'done' } });
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
        const cur = activities.get(write.activity.id);
        if (write.expectedVersion === null ? cur !== undefined : cur?.version !== write.expectedVersion) return Promise.resolve({ status: 'conflict', reason: write.expectedVersion === null ? 'already_exists' : 'stale_version' });
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

  it('Ben names two activities: neither is logged without his tap (review B1)', async () => {
    const m = memoryStore();
    const exec = createActivityExecutor({ store: m.store, tz: TZ, onDate: () => Promise.resolve([]) }).log_activity;
    if (exec === undefined) throw new Error('no executor');
    const words = 'Had an easy 5k yesterday, long run Saturday';
    const a = await exec(call({ distanceKm: 5, effort: 'easy' }) as never, ctx(words, 'c-1'));
    const b = await exec(call({ date: '2026-10-24', status: 'planned', distanceKm: null, effort: 'long' }) as never, ctx(words, 'c-2'));
    expect(a.kind === 'action' && a.record).toMatchObject({ status: 'proposed', detail: { fields: { date: '2026-10-22', distanceM: 5000, effort: 'easy' } } });
    expect(b.kind === 'action' && b.record).toMatchObject({ status: 'proposed', detail: { fields: { date: '2026-10-24', status: 'planned', effort: 'long' } } });
    expect(m.activities.size).toBe(0);
  });

  it('a planned run Ben then says he did is marked done, not added twice (review S5)', async () => {
    const m = memoryStore();
    const deps = { store: m.store, tz: TZ, onDate: (date: string) => Promise.resolve([...m.activities.values()].filter((a) => a.fields.date === date && a.deletedAtUtc === null)) };
    const planned = addActivity({ id: '00000000-0000-4000-8000-0000000000a1', ownerId: OWNER, fields: { kind: 'run', status: 'planned', date: '2026-10-22', durationS: null, distanceM: null, effort: 'long' }, source: 'ben', opId: 'sheet-1', at: { utc: '2026-10-20T08:00:00.000Z', tz: TZ } });
    if (planned.kind !== 'write') throw new Error('planned');
    m.activities.set(planned.next.id, planned.next);
    const exec = createActivityExecutor(deps).log_activity;
    if (exec === undefined) throw new Error('no executor');
    const r = await exec(call({ distanceKm: 21, effort: 'long' }) as never, ctx('did my 21 km long run yesterday'));
    expect(r.kind === 'action' && r.record).toMatchObject({ status: 'committed', detail: { activityId: planned.next.id, versionAfter: 2, markedDone: true, fields: { status: 'done', distanceM: 21_000, effort: 'long' } }, entityVersions: [{ before: 1, after: 2 }] });
    expect(m.activities.size).toBe(1);
    expect(m.activities.get(planned.next.id)).toMatchObject({ version: 2, fields: { status: 'done', distanceM: 21_000 }, lastChange: { kind: 'edit', opId: 'call-1' } });
    if (r.kind === 'action') expect(renderActionResult(r.record, 'sheet').text.replaceAll('\u00a0', ' ')).toBe('Marked done: Run · 22 Oct · 21 km · long.');
    // A retry replays; it never marks or adds again.
    expect(await exec(call({ distanceKm: 21, effort: 'long' }) as never, ctx('did my 21 km long run yesterday'))).toMatchObject({ kind: 'action', replayed: true });
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

  it('ADR 0039: offered from every chat whenever this week has days, whatever Ben’s words; never without a week or in the post-workout review', () => {
    const gate = { kind: 'general' as const, acceptedOffer: false, benPainWords: false, structuralSignals: [] };
    const has = (g: Parameters<typeof buildTurnRegistry>[0]) => buildTurnRegistry(g).tools.some((t) => t.name === 'propose_week');
    expect(has({ ...gate, benRequest: classifyBenRequest('plan my week around my long run', 'general'), week: true })).toBe(true);
    expect(has({ ...gate, benRequest: classifyBenRequest('how was my week?', 'general'), week: true })).toBe(true);
    expect(has({ ...gate, kind: 'workout', benRequest: null, week: true })).toBe(true);
    expect(has({ ...gate, benRequest: classifyBenRequest('plan my week around my long run', 'general') })).toBe(false);
    expect(has({ ...gate, kind: 'summary', benRequest: null, week: true })).toBe(false);
  });

  it('ADR 0039: Ben asked (no `propose`): saved, then applied at once through `apply`, with the line for the model; his own idea stays a proposal', async () => {
    const m = memoryStore();
    const applied: string[] = [];
    const exec = createWeekExecutor({ store: m.store, week: () => Promise.resolve({ facts, basis: { kind: 'split' }, factsKey: 'k1' }), apply: (id, opId) => { applied.push(`${id}|${opId}`); return Promise.resolve({ ok: true }); } }).propose_week;
    if (exec === undefined) throw new Error('no executor');
    const r = await exec({ tool: 'propose_week', args: { merges: [], skips: ['d3'], message: 'Rest.' } }, ctx('skip legs this week'));
    if (r.kind !== 'action') throw new Error(r.kind);
    expect(r.record).toMatchObject({ status: 'proposed', detail: { kind: 'propose_week', atOnce: true, skips: [{ dayId: 'd3' }] } });
    expect(applied).toEqual([`${r.record.actionId}|${weekAtOnceOpId(r.record.actionId)}`]);
    expect(r.line).toBe(WEEK_APPLIED_LINE);
    expect(renderActionResult(r.record, 'sheet').text).not.toContain('Not applied');
    const offer = await exec({ tool: 'propose_week', args: { merges: [], skips: ['d3'], message: 'Rest.' } }, { ...ctx(null, 'call-3'), propose: true });
    if (offer.kind !== 'action') throw new Error(offer.kind);
    expect(offer.record.detail).not.toHaveProperty('atOnce');
    expect(applied).toHaveLength(1);
    expect(renderActionResult(offer.record, 'sheet').text).toContain('Not applied');
  });
});
