import { ACTIVITY_LIMITS, type Activity, type ActivityEffort, type ActivityFields, type ActivityKind, type ActivityStatus } from '@fizz/schemas';
import { checkActivityFields } from '@fizz/domain';

/**
 * (Ben, 20 Oct) Today › ＋ Activity: the sheet's state and what it saves.
 * Pure: the sheet draws it; validation is the domain's (`checkActivityFields`).
 * A date after today is always planned.
 */

export interface ActivityForm {
  kind: ActivityKind;
  status: ActivityStatus;
  /** Local `YYYY-MM-DD`. */
  date: string;
  /** Minutes from the number keypad; null: not given. */
  minutes: number | null;
  /** As typed on the decimal keypad (`18`, `21.1`, `5,5`); empty: not given. */
  distanceKm: string;
  effort: ActivityEffort | null;
}

export const ACTIVITY_KINDS: readonly { kind: ActivityKind; label: string }[] = [
  { kind: 'run', label: 'Run' },
  { kind: 'ride', label: 'Ride' },
  { kind: 'swim', label: 'Swim' },
  { kind: 'sport', label: 'Sport' },
  { kind: 'other', label: 'Other' },
];

export const ACTIVITY_EFFORTS: readonly { effort: ActivityEffort; label: string }[] = [
  { effort: 'easy', label: 'Easy' },
  { effort: 'moderate', label: 'Moderate' },
  { effort: 'hard', label: 'Hard' },
  { effort: 'long', label: 'Long' },
];

export function newActivityForm(today: string): ActivityForm {
  return { kind: 'run', status: 'done', date: today, minutes: null, distanceKm: '', effort: null };
}

export function formOf(a: Activity): ActivityForm {
  const f = a.fields;
  return {
    kind: f.kind,
    status: f.status,
    date: f.date,
    minutes: f.durationS === null ? null : Math.round(f.durationS / 60),
    distanceKm: f.distanceM === null ? '' : String(Math.round(f.distanceM / 10) / 100),
    effort: f.effort,
  };
}

/** The date picked: after today it is planned. */
export function withDate(form: ActivityForm, date: string, today: string): ActivityForm {
  return { ...form, date, status: date > today ? 'planned' : form.status };
}

/** What Save writes, or the one short line why not. */
export function fieldsOf(form: ActivityForm, today: string): { ok: true; fields: ActivityFields } | { ok: false; message: string } {
  const text = form.distanceKm.trim().replace(',', '.');
  const km = text === '' ? null : Number(text);
  if (km !== null && (!Number.isFinite(km) || km <= 0 || km * 1000 > ACTIVITY_LIMITS.maxDistanceM)) return { ok: false, message: 'Check the distance.' };
  const fields: ActivityFields = {
    kind: form.kind,
    status: form.date > today ? 'planned' : form.status,
    date: form.date,
    durationS: form.minutes === null || form.minutes <= 0 ? null : form.minutes * 60,
    distanceM: km === null ? null : Math.round(km * 1000),
    effort: form.effort,
  };
  const c = checkActivityFields(fields);
  return c.ok ? { ok: true, fields: c.fields } : { ok: false, message: 'Add a time, a distance or an effort.' };
}
