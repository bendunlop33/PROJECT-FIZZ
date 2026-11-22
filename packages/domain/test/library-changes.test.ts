import { describe, expect, it } from 'vitest';

import type { Load, NextSessionTargetRecord, ReviewProposal, TrainingReview } from '@fizz/schemas';

import { coachChangesView, libraryChangeCounts, libraryChangeMarks, libraryChangesView, loadChangeText, NBSP, nextTimeCardRows, nextTimeChangeRow, type NextTimeChangeInput } from '../src/index';

/**
 * Redesign 27 Oct, D2 and D5: Library › Plan › Changes. The coach's next-session targets (D21) and the weekly
 * review's set changes as one list: small ones made (Undo), bigger ones asked (Apply / Skip), the Plan row's count,
 * the dot on a changed number (was / now) and a saved workout's `✦1`. Values only from the stored records.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const kg = (value: number, convention: Load['convention'] = 'total'): Load => ({ value, unit: 'kg', convention });
const lb = (value: number, convention: Load['convention'] = 'total'): Load => ({ value, unit: 'lb', convention });

type Row = NextTimeChangeInput['row'];
const row = (more: Partial<Row> = {}): Row => ({
  id: 'r1',
  version: 1,
  exerciseId: 'bench',
  exerciseName: 'Bench press',
  target: { load: kg(85), reps: { min: 6, max: 8 } },
  builtIn: { load: kg(82.5), reps: { min: 6, max: 8 } },
  sets: null,
  builtInSets: 4,
  status: 'saved',
  reason: 'All reps hit',
  guardNotes: [],
  usedBySessionId: null,
  ...more,
});
const input = (r: Row = row(), more: Partial<NextTimeChangeInput> = {}): NextTimeChangeInput => ({ row: r, routineId: 'push', routineName: 'Push', stale: false, ...more });

describe('loadChangeText: kg/lb and the load convention are always explicit', () => {
  it('total, per dumbbell, stack, assisted, added, another unit', () => {
    expect(plain(loadChangeText(kg(82.5), kg(85)))).toBe('82.5 → 85 kg');
    expect(plain(loadChangeText(kg(22.5, 'per_hand'), kg(24, 'per_hand')))).toBe('22.5 → 24 kg each');
    expect(plain(loadChangeText(kg(45, 'stack'), kg(50, 'stack')))).toBe('45 → 50 kg stack');
    // Assisted: less assistance is harder; both values named in full.
    expect(plain(loadChangeText(kg(30, 'assistance'), kg(25, 'assistance')))).toBe('Assist 30 kg → Assist 25 kg');
    expect(plain(loadChangeText(kg(10, 'added'), kg(12.5, 'added')))).toBe('BW + 10 kg → BW + 12.5 kg');
    expect(plain(loadChangeText(lb(185), lb(190)))).toBe('185 → 190 lb');
    // A unit change never reads as one number moving.
    expect(plain(loadChangeText(lb(185), kg(85)))).toBe('185 lb → 85 kg');
    expect(plain(loadChangeText(null, kg(85)))).toBe('85 kg');
  });
});

describe('a coach next-session target as a change', () => {
  it('saved small change: `Bench press 82.5 → 85 kg`, the day, Why? (reason, rule), Undo, the mark', () => {
    const r = nextTimeChangeRow(input(row({ guardNotes: [{ kind: 'snapped', text: 'Snapped to 85 kg' } as never] })));
    expect(r).not.toBeNull();
    expect(plain(r?.title)).toBe('Bench press 82.5 → 85 kg');
    expect(r).toMatchObject({ sub: 'Push', state: 'made', taps: ['undo'], statusText: null, routineId: 'push', exerciseId: 'bench', ref: { kind: 'next', rowId: 'r1' } });
    expect(r?.why.map(plain)).toEqual(['“All reps hit”', 'Snapped to 85 kg', 'Rule: 82.5 kg · 6–8 reps']);
    expect(r?.mark).toEqual({ now: `85${NBSP}kg`, was: `82.5${NBSP}kg` });
    expect(plain(r?.undoneText)).toBe('Bench press back to 82.5 kg');
  });

  it('per-dumbbell loads keep `each`; sets and reps changes read as their own numbers', () => {
    const db = nextTimeChangeRow(input(row({ exerciseName: 'Incline dumbbell press', target: { load: kg(24, 'per_hand'), reps: { min: 8, max: 10 } }, builtIn: { load: kg(22, 'per_hand'), reps: { min: 8, max: 10 } } })));
    expect(plain(db?.title)).toBe('Incline dumbbell press 22 → 24 kg each');
    const sets = nextTimeChangeRow(input(row({ exerciseName: 'Cable lateral raise', target: { load: kg(7.5), reps: { min: 12, max: 15 } }, builtIn: { load: kg(7.5), reps: { min: 12, max: 15 } }, sets: 4, builtInSets: 3 })));
    expect(plain(sets?.title)).toBe('Cable lateral raise 3 → 4 sets');
    expect(sets?.mark).toEqual({ now: '4 sets', was: '3 sets' });
    const reps = nextTimeChangeRow(input(row({ target: { load: kg(82.5), reps: { min: 4, max: 6 } } })));
    expect(plain(reps?.title)).toBe('Bench press 6–8 → 4–6 reps');
    const both = nextTimeChangeRow(input(row({ sets: 3, builtInSets: 4 })));
    expect(plain(both?.title)).toBe('Bench press 82.5 → 85 kg · 4 → 3 sets');
  });

  it('a bigger change only suggested: Apply / Skip, no mark (not made yet)', () => {
    const r = nextTimeChangeRow(input(row({ status: 'proposed' })));
    expect(r).toMatchObject({ state: 'offer', taps: ['apply', 'skip'], mark: null });
  });

  it('not a change to show: used by a workout, corrected since (stale), declined, the rule’s own reset, or the same as the rule', () => {
    expect(nextTimeChangeRow(input(row({ usedBySessionId: 's2' })))).toBeNull();
    expect(nextTimeChangeRow(input(row(), { stale: true }))).toBeNull();
    expect(nextTimeChangeRow(input(row({ status: 'not_applied' })))).toBeNull();
    expect(nextTimeChangeRow(input(row({ origin: 'rule' })))).toBeNull();
    expect(nextTimeChangeRow(input(row({ target: { load: kg(82.5), reps: { min: 6, max: 8 } } })))).toBeNull();
  });

  it('undone: no Undo, no mark, not counted', () => {
    const r = nextTimeChangeRow(input(row({ status: 'undone' })));
    expect(r).toMatchObject({ state: 'undone', taps: [], mark: null, statusText: 'Undone' });
    const v = libraryChangesView({ nextTime: [input(row({ status: 'undone' }))], weekly: null, hasEarlier: false });
    expect(v.count).toBe(0);
    expect(v.rowText).toBeNull();
  });
});

describe('weekly review changes (moved from Progress) with the next-time ones', () => {
  const proposal = (more: Partial<ReviewProposal> = {}): ReviewProposal => ({
    id: 'p1',
    source: 'coach',
    change: { kind: 'template_sets', routineId: 'push', routineName: 'Push', expectedVersion: 2, exerciseId: 'raise', exerciseName: 'Cable lateral raise', fromSets: 4, toSets: 3 },
    reason: 'Shoulders over plan',
    status: 'applied',
    actionId: 'a1',
    ...more,
  });
  const review = (proposals: ReviewProposal[]): TrainingReview => ({
    id: 'rev',
    ownerId: 'o',
    version: 3,
    createdAtUtc: '2026-10-26T09:00:00.000Z',
    updatedAtUtc: '2026-10-26T09:00:00.000Z',
    subject: { kind: 'weekly', weekMonday: '2026-10-19' },
    inputsHash: 'h',
    facts: [],
    coach: { status: 'reviewed', verdict: 'Good week.', lines: [], actionIds: [], numbersChecked: true },
    status: 'current',
    supersededById: null,
    opIds: ['o'],
    createdAt: { utc: '2026-10-26T09:00:00.000Z', tz: 'Europe/London' },
    proposals,
  });

  const weeklyOf = (r: TrainingReview, current = true) => {
    const v = coachChangesView(r, '2026-10-27', { current });
    if (v === null) throw new Error('no view');
    return v;
  };

  it('`3 changes · next week`: made + asked, tweaks first then offers; marks per workout; ✦ per workout', () => {
    const r = review([proposal(), proposal({ id: 'p2', change: { ...proposal().change, exerciseId: 'fly', exerciseName: 'Cable fly', fromSets: 3, toSets: 4 }, status: 'open', actionId: null, offer: true })]);
    const weekly = { view: weeklyOf(r), proposals: r.proposals ?? [] };
    const v = libraryChangesView({ nextTime: [input()], weekly, hasEarlier: true });
    expect(v.count).toBe(3);
    expect(v.rowText).toBe('3 changes · next week');
    expect(v.tweaks.map((x) => plain(x.title))).toEqual(['Bench press 82.5 → 85 kg', 'Cable lateral raise 4 → 3 sets']);
    expect(v.tweaks[1]).toMatchObject({ taps: ['undo'], ref: { kind: 'weekly', reviewId: 'rev', proposalId: 'p1' }, sub: 'Push', why: ['Shoulders over plan'] });
    expect(v.offers.map((x) => [plain(x.title), x.taps])).toEqual([['Cable fly 3 → 4 sets', ['apply', 'skip']]]);
    expect(v).toMatchObject({ note: 'Good week.', hasEarlier: true, reviewId: 'rev' });
    const marks = libraryChangeMarks(v, 'push');
    expect([...marks.keys()]).toEqual(['bench', 'raise']);
    expect(plain(marks.get('bench')?.text)).toBe('Bench press 85 kg · was 82.5 kg');
    expect(marks.get('raise')?.text).toBe('Cable lateral raise 3 sets · was 4 sets');
    expect(libraryChangeMarks(v, 'pull').size).toBe(0);
    expect(libraryChangeCounts(v).get('push')).toBe(3);
    expect(nextTimeCardRows(v, 'push').map((x) => x.key)).toEqual(['next:r1']);
  });

  it('an undone weekly change stays with Redo; skipped and out-of-date ones keep their status, none counted', () => {
    const r = review([proposal({ status: 'undone' }), proposal({ id: 'p3', status: 'skipped', offer: true }), proposal({ id: 'p4', status: 'stale' })]);
    const v = libraryChangesView({ nextTime: [], weekly: { view: weeklyOf(r), proposals: r.proposals ?? [] }, hasEarlier: false });
    expect(v.count).toBe(0);
    expect(v.tweaks.map((x) => [x.taps, x.statusText])).toEqual([[['redo'], 'Undone']]);
    expect(v.offers.map((x) => x.statusText)).toEqual(['Out of date', 'Skipped']);
  });

  it('an older week’s review is under Earlier changes, not next week’s', () => {
    const r = review([proposal()]);
    const v = libraryChangesView({ nextTime: [], weekly: { view: weeklyOf(r, false), proposals: r.proposals ?? [] }, hasEarlier: true });
    expect(v.count).toBe(0);
    expect(v.tweaks).toEqual([]);
    expect(v.reviewId).toBeNull();
  });

  it('ad-hoc next-time targets (no workout) follow the exercise: listed, never marked on a workout', () => {
    const v = libraryChangesView({ nextTime: [input(row(), { routineId: null, routineName: null })], weekly: null, hasEarlier: false });
    expect(v.count).toBe(1);
    expect(v.tweaks[0]?.sub).toBeNull();
    expect(libraryChangeCounts(v).size).toBe(0);
  });
});

// Keep the record type honest: the row input is a slice of the stored record.
export const sliceOfRecord = (r: NextSessionTargetRecord): NextTimeChangeInput['row'] => r;
