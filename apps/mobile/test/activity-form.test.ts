import { describe, expect, it } from 'vitest';

import { fieldsOf, formOf, newActivityForm, withDate } from '../src/activity/activity-form';

/** (Ben, 20 Oct) Today › ＋ Activity: the sheet saves only what Ben gave; a later date is planned. */
describe('the activity sheet', () => {
  const TODAY = '2026-10-23';

  it('needs a time, a distance or an effort', () => {
    expect(fieldsOf(newActivityForm(TODAY), TODAY)).toEqual({ ok: false, message: 'Add a time, a distance or an effort.' });
    expect(fieldsOf({ ...newActivityForm(TODAY), distanceKm: '18' }, TODAY)).toEqual({ ok: true, fields: { kind: 'run', status: 'done', date: TODAY, durationS: null, distanceM: 18_000, effort: null } });
    expect(fieldsOf({ ...newActivityForm(TODAY), distanceKm: '21,1', minutes: 105, effort: 'long' }, TODAY)).toMatchObject({ ok: true, fields: { distanceM: 21_100, durationS: 6300, effort: 'long' } });
    expect(fieldsOf({ ...newActivityForm(TODAY), distanceKm: 'abc' }, TODAY)).toEqual({ ok: false, message: 'Check the distance.' });
  });

  it('a date after today is planned; back to a past date keeps Ben’s choice', () => {
    const sat = withDate(newActivityForm(TODAY), '2026-10-24', TODAY);
    expect(sat.status).toBe('planned');
    expect(fieldsOf({ ...sat, effort: 'long', status: 'done' }, TODAY)).toMatchObject({ ok: true, fields: { status: 'planned' } });
    expect(withDate({ ...sat, status: 'done' }, '2026-10-22', TODAY).status).toBe('done');
  });

  it('an activity opens in the sheet as it was saved', () => {
    const r = fieldsOf({ ...newActivityForm(TODAY), distanceKm: '18', minutes: 95 }, TODAY);
    if (!r.ok) throw new Error(r.message);
    const form = formOf({ id: '00000000-0000-4000-8000-000000000001', ownerId: '00000000-0000-4000-8000-000000000002', version: 1, createdAtUtc: '2026-10-23T08:00:00.000Z', updatedAtUtc: '2026-10-23T08:00:00.000Z', fields: r.fields, tz: 'Europe/London', source: 'ben', deletedAtUtc: null, lastChange: null, opIds: [] });
    expect(form).toEqual({ kind: 'run', status: 'done', date: TODAY, minutes: 95, distanceKm: '18', effort: null });
  });
});
