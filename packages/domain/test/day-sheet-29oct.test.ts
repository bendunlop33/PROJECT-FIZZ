import { describe, expect, it } from 'vitest';

import { daySheetOf, weekPickRows, weekPlanDays, type WeekPlanDaysInput } from '../src/index';

/** (Ben, 29 Oct: day sheet) Each plan day's date and status this week, a day's sheet and its actions, the card picker's rows. */

const today = '2026-10-29';
const days = ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'].map((name, i) => ({ key: `k${String(i)}`, name, dayIndex: i }));
const ben: WeekPlanDaysInput = {
  today,
  setDays: true,
  days,
  doneOn: { k0: '2026-10-28', k1: '2026-10-27', k2: '2026-10-26' },
  plannedOn: { k3: '2026-10-29', k4: '2026-10-30', k5: '2026-10-31' },
  skippedOn: {},
  ahead: [],
  chosenKey: 'k3',
};
const title = (d: string) => `date ${d}`;

describe('weekPlanDays and daySheetOf (Set days)', () => {
  it('Ben’s Thursday: three done, Push B today, Pull B and Legs B planned; a missed day reads Missed', () => {
    expect(weekPlanDays(ben).map((d) => `${d.name} ${d.status}`)).toEqual(['Push A done', 'Pull A done', 'Legs A done', 'Push B today', 'Pull B planned', 'Legs B planned']);
    expect(weekPlanDays({ ...ben, plannedOn: { ...ben.plannedOn, k3: '2026-10-28' } })[3]?.status).toBe('missed');
  });
  it('Saturday’s sheet: Do today instead swaps with Push B; Move to… Sun only; Thursday’s sheet: Start', () => {
    const wk = weekPlanDays(ben);
    const sat = daySheetOf({ at: { date: '2026-10-31' }, today, setDays: true, days: wk, doneHere: false, dateTitle: title });
    expect(sat).toMatchObject({ title: 'Sat · Legs B', statusText: 'Planned', actions: { start: false, doToday: { kind: 'swap_days', withDayIndex: 3 }, skip: true, edit: true } });
    expect(sat.actions.moveTo.map((m) => m.label)).toEqual(['Sun']);
    const thu = daySheetOf({ at: { date: today }, today, setDays: true, days: wk, doneHere: false, dateTitle: title });
    expect(thu.actions).toMatchObject({ start: true, doToday: null });
    expect(thu.actions.moveTo.map((m) => m.label)).toEqual(['Sun']);
    const mon = daySheetOf({ at: { date: '2026-10-26' }, today, setDays: true, days: wk, doneHere: true, dateTitle: title });
    expect(mon).toMatchObject({ title: 'Mon · Legs A', status: 'done', actions: { start: false, doToday: null, skip: false, edit: false } });
    const sun = daySheetOf({ at: { date: '2026-11-01' }, today, setDays: true, days: wk, doneHere: false, dateTitle: title });
    expect(sun).toMatchObject({ title: 'date 2026-11-01', status: 'rest', day: null });
  });
  it('a rest day today: Do today instead moves the day to today; a skipped day offers Unskip', () => {
    const wk = weekPlanDays({ ...ben, plannedOn: { k4: '2026-10-30', k5: '2026-10-31' }, skippedOn: { k3: '2026-10-29' } });
    expect(wk[3]?.status).toBe('skipped');
    const fri = daySheetOf({ at: { dayKey: 'k4' }, today, setDays: true, days: wk, doneHere: false, dateTitle: title });
    expect(fri.actions.doToday).toEqual({ kind: 'move', weekday: 3 });
    const thu = daySheetOf({ at: { dayKey: 'k3' }, today, setDays: true, days: wk, doneHere: false, dateTitle: title });
    expect(thu).toMatchObject({ statusText: 'Skipped', actions: { unskip: true, skip: false, edit: false, start: false } });
  });
});

describe('Any days', () => {
  it('the card’s day today, the rest one a day after; Do today instead puts it on the card (no write); no Move to…', () => {
    const wk = weekPlanDays({ ...ben, setDays: false, plannedOn: {}, ahead: ['k3', 'k4', 'k5'], chosenKey: 'k4' });
    expect(wk.slice(3).map((d) => `${d.name} ${d.date ?? '-'} ${d.status}`)).toEqual(['Push B 2026-10-30 planned', 'Pull B 2026-10-29 today', 'Legs B 2026-10-31 planned']);
    const s = daySheetOf({ at: { dayKey: 'k3' }, today, setDays: false, days: wk, doneHere: false, dateTitle: title });
    expect(s.actions).toMatchObject({ doToday: { kind: 'pick' }, moveTo: [], skip: true });
  });
});

describe('weekPickRows (the card picker)', () => {
  it('weekday, name and status; Up next marked; selected', () => {
    const rows = weekPickRows(weekPlanDays(ben), { nextKey: 'k3', selectedKey: 'k3', upNext: 'Up next' });
    expect(rows.map((r) => `${r.weekday} ${r.name} ${r.status}${r.selected ? ' ✓' : ''}`)).toEqual(['Wed Push A Done', 'Tue Pull A Done', 'Mon Legs A Done', 'Thu Push B Up next ✓', 'Fri Pull B Planned', 'Sat Legs B Planned']);
    expect(rows[3]?.accessibilityLabel).toBe('Thursday, Push B, Up next, selected');
  });
});
