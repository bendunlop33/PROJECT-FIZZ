import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, validate, type ImportAnswers } from '@fizz/schemas';
import {
  analyseImport,
  buildImportedSession,
  DEFAULT_ANSWERS,
  detectFitNotesFile,
  FITNOTES2_NOT_DONE,
  matchName,
  nameKey,
  parseFitNotesCsv,
  planImportRows,
  readInstant,
  type ImportContext,
} from '../src';
import { OWNER } from './fixtures';
import { CANDIDATES, fixture, idOf } from './import-fixtures';

/**
 * FitNotes 2 (iPhone) workout export, variant `D` (13 Oct 2026, from the
 * shape of Ben's real file; every value here is invented): recognised
 * offline, `NotStarted` sets skipped, warm-ups kept, RPE/RIR kept, real start
 * and end times, the workout's name, and the unit asked once.
 */
const TODAY = '2026-10-13';
const TZ = 'Europe/London';
const JOB = '00000000-0000-4000-8000-0000000d0b01';
const OP = 'commit-op-d';
const D = fixture('D.synthetic.csv');

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  ownerId: OWNER,
  candidates: CANDIDATES,
  aliases: new Map(),
  appDates: new Set(),
  importedDates: new Map(),
  defaultUnit: 'kg',
  ...over,
});
const answers = (over: Partial<ImportAnswers> = {}): ImportAnswers => ({ ...DEFAULT_ANSWERS, ...over });
const parsed = (text = D, tz = TZ) => {
  const p = parseFitNotesCsv(text, TODAY, tz);
  if (!p.ok) throw new Error('not parsed');
  return p;
};
const HEADER = D.split('\n')[0] ?? '';

describe('readInstant (ISO with an offset)', () => {
  it('reads Z and ±HH:MM as the instant, in the zone asked for', () => {
    expect(readInstant('2026-03-02T07:05:00Z', 'Europe/London')).toMatchObject({ date: '2026-03-02', time: '07:05', timeFull: '07:05:00' });
    expect(readInstant('2026-07-02T07:05:00Z', 'Europe/London')).toMatchObject({ date: '2026-07-02', time: '08:05' });
    expect(readInstant('2026-03-06T18:15:00Z', 'Pacific/Auckland')).toMatchObject({ date: '2026-03-07', time: '07:15' });
    expect(readInstant('2026-03-02T09:05:00.250+02:00', 'UTC')).toMatchObject({ date: '2026-03-02', time: '07:05' });
    expect(readInstant('2026-03-02T07:05:00Z', 'UTC')?.ms).toBe(Date.parse('2026-03-02T07:05:00Z'));
  });
  it('refuses wall-clock times and days that don’t exist', () => {
    expect(readInstant('2026-03-02T07:05:00', 'UTC')).toBeNull();
    expect(readInstant('2026-02-30T07:05:00Z', 'UTC')).toBeNull();
    expect(readInstant('2026-03-02T24:05:00Z', 'UTC')).toBeNull();
    expect(readInstant('2026-03-02', 'UTC')).toBeNull();
  });
});

describe('FitNotes 2 workout export: detection and rows', () => {
  it('is recognised as FitNotes from its header, offline', () => {
    expect(detectFitNotesFile(D)).toMatchObject({ kind: 'fitnotes', variant: 'D', delimiter: ',' });
    // One header cell different: not this format (the layout path reads it instead).
    expect(detectFitNotesFile(D.replace('IsWarmup', 'Warmup'))).toMatchObject({ kind: 'unknown_header' });
  });

  it('reads each row: NotStarted not done, warm-ups, RPE/RIR, no unit, workouts by start time', () => {
    const p = parsed();
    expect(p.variant).toBe('D');
    const [warm, rpe8, rpe85, notStarted] = p.rows;
    expect(warm).toMatchObject({ rowClass: 'strength', date: '2026-03-02', exercise: 'Bench Press', unitless: 40, weight: null, reps: 10, setType: 'warmup', startLocal: '07:05', equipment: 'Barbell', categories: ['Chest', 'Triceps'] });
    expect(rpe8).toMatchObject({ rowClass: 'strength', setType: null, rpe: 8, rir: 2, comment: 'Paused, first rep' });
    expect(rpe85).toMatchObject({ rpe: 8.5, rir: null });
    expect(notStarted).toMatchObject({ rowClass: 'unsupported', setType: 'not_a_set', problem: FITNOTES2_NOT_DONE });
    // A 0 weight (bodyweight) says nothing about the unit.
    expect(p.rows[6]).toMatchObject({ exercise: 'Pull Up', unitless: null, reps: 8, rowClass: 'strength', rpe: 9 });
    // Two workouts on one date are two workouts.
    const keys = new Set(p.rows.filter((r) => r.date === '2026-03-06').map((r) => r.workoutKey));
    expect(keys.size).toBe(2);
  });

  it('reads the date in the import’s zone (UTC 18:15 is the next morning in Auckland)', () => {
    expect(parsed(D, 'Pacific/Auckland').rows.at(-1)).toMatchObject({ date: '2026-03-07', startLocal: '07:15' });
  });

  it('lists rows it can’t read exactly, with the reason', () => {
    const rows = [
      'X,not a time,2026-03-02T08:00:00Z,80,Bench Press,Barbell,5,80,,,Done,false,,,Chest,',
      'X,2026-03-02T07:00:00Z,2026-03-02T08:00:00Z,80,Bench Press,Barbell,5,80,,,Skipped,false,,,Chest,',
      'X,2026-03-02T07:00:00Z,2026-03-02T08:00:00Z,80,Bench Press,Barbell,5,80,,,Done,yes,,,Chest,',
      'X,2026-03-02T07:00:00Z,2026-03-02T08:00:00Z,80,Bench Press,Barbell,5,"80,5",,,Done,false,,,Chest,',
      'X,2027-03-02T07:00:00Z,2027-03-02T08:00:00Z,80,Bench Press,Barbell,5,80,,,Done,false,,,Chest,',
      'X,2026-03-02T07:00:00Z,2026-03-02T08:00:00Z,80,Bench Press,Barbell,5,80,,,Done,false,11,12,Chest,',
    ];
    const p = parsed(`${HEADER}\n${rows.join('\n')}\n`);
    expect(p.rows.map((r) => [r.rowClass, r.problem])).toEqual([
      ['unreadable', 'StartTime isn’t a date and time (not a time)'],
      ['unreadable', 'Status isn’t Done or NotStarted (Skipped)'],
      ['unreadable', 'IsWarmup isn’t true or false (yes)'],
      ['unreadable', 'Weight uses a decimal comma (80,5)'],
      ['unreadable', 'Date is after today (a planned workout, not one done)'],
      ['strength', null],
    ]);
    // RPE 11 and RIR 12 aren't valid: kept in the original cells only.
    expect(p.rows[5]).toMatchObject({ rpe: null, rir: null });
  });
});

describe('FitNotes 2 workout export: preview, plan and workouts', () => {
  const names = (a: ReturnType<typeof analyseImport>): ImportAnswers['names'] =>
    Object.fromEntries(a.names.map((n) => [n.key, n.match.exerciseId ? { kind: 'exercise' as const, exerciseId: n.match.exerciseId } : { kind: 'skip' as const }]));

  it('asks the unit once, nothing selected; NotStarted sets are skipped and listed', () => {
    const p = parsed();
    const first = analyseImport(p, ctx(), answers());
    expect(first.unit).toEqual({ rows: 8, answer: null, kind: 'no_unit' });
    expect(first.counts.byResult.skipped_not_a_set).toBe(2);
    expect(first.fates[3]).toEqual({ result: 'skipped_not_a_set', detail: FITNOTES2_NOT_DONE });
    expect(first.units).toEqual({ kg: 0, lb: 0 });
    expect(first.ready).toBe(false);
    const lb = analyseImport(p, ctx(), answers({ names: names(first), bothColumns: 'lb', perHand: 'each', total: 'total', bodyweight: { [nameKey('Pull Up')]: 'added' } }));
    expect(lb.units).toEqual({ kg: 0, lb: 8 });
    const bench = lb.fates[1];
    expect(bench).toMatchObject({ result: 'imported', set: { unit: 'lb', load: { value: 80, unit: 'lb', convention: 'total' }, rpe: 8, rir: 2 } });
    expect(lb.fates[0]).toMatchObject({ result: 'imported', set: { setType: 'warmup' } });
    // Four workouts: two of them on 6 March.
    expect(lb.counts.workouts).toBe(4);
  });

  it('builds workouts with the file’s start, end, duration and name; warm-ups and RIR kept', () => {
    const p = parsed();
    const first = analyseImport(p, ctx(), answers());
    const a = analyseImport(p, ctx(), answers({ names: names(first), bothColumns: 'kg', perHand: 'each', total: 'total', bodyweight: { [nameKey('Pull Up')]: 'added' } }));
    expect(a.ready).toBe(true);
    const rows = planImportRows(p, a, { jobId: JOB, defaultUnit: 'kg' });
    const push = rows.filter((r) => r.result === 'imported' && r.localDate === '2026-03-02');
    const key = push[0]?.workoutKey ?? '';
    const agg = buildImportedSession({ ownerId: OWNER, jobId: JOB, operationId: OP, tz: TZ, gymId: null, importedAtUtc: '2026-10-13T09:00:00.000Z', date: '2026-03-02', workoutKey: key, startLocal: '07:05', rows, fitNotes2: true });
    expect(validate(SessionAggregateSchema, agg).ok).toBe(true);
    expect(agg.session).toMatchObject({ routineName: 'Push (Heavy)', startedAt: { utc: '2026-03-02T07:05:00.000Z', tz: TZ }, endedAt: { utc: '2026-03-02T08:10:30.000Z', tz: TZ }, status: 'finished', source: 'import' });
    expect(agg.session.localDate).toBeUndefined();
    expect(agg.sets.map((x) => [x.setType, x.actual?.rir ?? null])).toEqual([
      ['warmup', null],
      ['working', 2],
      ['working', null],
      ['working', null],
    ]);
    // The same rows read as a date-only file (not FitNotes 2) keep the old anchor.
    const plain = buildImportedSession({ ownerId: OWNER, jobId: JOB, operationId: OP, tz: TZ, gymId: null, importedAtUtc: '2026-10-13T09:00:00.000Z', date: '2026-03-02', workoutKey: key, startLocal: '07:05', rows });
    expect(plain.session).toMatchObject({ localDate: '2026-03-02', endedAt: null, routineName: null });
  });

  it('an end before the start gives no duration (nothing invented)', () => {
    const text = `${HEADER}\nX,2026-03-02T07:00:00Z,2026-03-02T06:00:00Z,80,Back Squat,Barbell,5,100,,,Done,false,,,Legs,\nX,2026-03-02T07:00:00Z,2026-03-02T06:00:00Z,80,Back Squat,Barbell,5,100,,,Done,false,,,Legs,\n`;
    const p = parsed(text);
    const first = analyseImport(p, ctx(), answers());
    const a = analyseImport(p, ctx(), answers({ names: names(first), bothColumns: 'kg', total: 'total' }));
    const rows = planImportRows(p, a, { jobId: JOB, defaultUnit: 'kg' });
    const agg = buildImportedSession({ ownerId: OWNER, jobId: JOB, operationId: OP, tz: TZ, gymId: null, importedAtUtc: '2026-10-13T09:00:00.000Z', date: '2026-03-02', workoutKey: rows[0]?.workoutKey ?? '', rows, fitNotes2: true });
    expect(agg.session).toMatchObject({ startedAt: { utc: '2026-03-02T07:00:00.000Z' }, endedAt: null, routineName: 'X' });
  });
});

describe('FitNotes 2 `Equipment` as a matching hint', () => {
  it('drops a suggestion the equipment contradicts, only when the name says none', () => {
    expect(matchName('Romanian Deadlifts', CANDIDATES, new Map(), null, 'Dumbbell')).toMatchObject({ status: 'check', exerciseId: idOf('Dumbbell Romanian deadlift') });
    expect(matchName('Romanian Deadlifts', CANDIDATES, new Map(), null, 'Barbell')).toMatchObject({ status: 'check', exerciseId: idOf('Romanian deadlift') });
    // The name's own word wins over the hint.
    expect(matchName('Barbell Romanian Deadlift', CANDIDATES, new Map(), null, 'Dumbbell').exerciseId).toBe(idOf('Romanian deadlift'));
    // An exact name still matches whatever the hint says.
    expect(matchName('Bench press', CANDIDATES, new Map(), null, 'Dumbbell')).toMatchObject({ status: 'matched', exerciseId: idOf('Bench press') });
  });
});
