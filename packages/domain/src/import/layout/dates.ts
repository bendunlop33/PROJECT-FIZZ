import type { DateFormat } from '@fizz/schemas';
import { localDateOf } from '../../calendar';
import { isCalendarDate } from '../fitnotes';
import { readInstant } from '../instant';

/**
 * Date readers for the closed format list (§9.6.2, check 5). Pure. Times have
 * no zone in these files: they are kept as written (`18:02`, AI6). Only
 * `unix_seconds` and `YYYY-MM-DDTHH:mm:ssZ` are instants; they are read in the import's zone.
 */

export interface ReadDate {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:mm`, or null when the format has no time. */
  time: string | null;
  /** `HH:mm:ss` when written, for telling workouts apart. */
  timeFull: string | null;
}

export type DateOrder = 'day_first' | 'month_first';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const LONG_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(y: number, m: number, d: number): string | null {
  const s = `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
  return isCalendarDate(s) ? s : null;
}

function time(h: string | undefined, mi: string | undefined, s: string | undefined): { time: string; timeFull: string } | null | undefined {
  if (h === undefined || mi === undefined) return undefined;
  const hh = Number(h);
  const mm = Number(mi);
  const ss = s === undefined ? 0 : Number(s);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return { time: `${pad(hh)}:${pad(mm)}`, timeFull: `${pad(hh)}:${pad(mm)}:${pad(ss)}` };
}

function withTime(date: string | null, t: { time: string; timeFull: string } | null | undefined): ReadDate | null {
  if (date === null || t === null) return null;
  return { date, time: t?.time ?? null, timeFull: t?.timeFull ?? null };
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_SPACE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/;
const ISO_T = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/;
const D_MMM = /^(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4}),? (\d{1,2}):(\d{2})$/;
const SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const UNIX = /^\d{9,10}$/;

/** The two numbers of a `03/04/2025` cell, or null. */
export function slashFields(cell: string): { first: number; second: number } | null {
  const m = SLASH.exec(cell.trim());
  return m ? { first: Number(m[1]), second: Number(m[2]) } : null;
}

/**
 * What the file itself says about day/month order (AI5): a first field
 * above 12 settles day first, a second field above 12 month first. Both:
 * `conflict` (no order reads every cell). Neither: `unknown` (asked).
 */
export function dateOrderEvidence(cells: readonly string[]): { order: DateOrder | 'unknown' | 'conflict'; cell: string | null } {
  let dayFirst: string | null = null;
  let monthFirst: string | null = null;
  for (const c of cells) {
    const f = slashFields(c);
    if (!f) continue;
    if (f.first > 12 && dayFirst === null) dayFirst = c.trim();
    if (f.second > 12 && monthFirst === null) monthFirst = c.trim();
  }
  if (dayFirst !== null && monthFirst !== null) return { order: 'conflict', cell: null };
  if (dayFirst !== null) return { order: 'day_first', cell: dayFirst };
  if (monthFirst !== null) return { order: 'month_first', cell: monthFirst };
  return { order: 'unknown', cell: null };
}

export function formatHasTime(format: DateFormat): boolean {
  return format === 'YYYY-MM-DD HH:mm:ss' || format === 'YYYY-MM-DDTHH:mm:ss' || format === 'YYYY-MM-DDTHH:mm:ssZ' || format === 'D MMM YYYY, HH:mm' || format === 'unix_seconds';
}

export function isSlashFormat(format: DateFormat): boolean {
  return format === 'DD/MM/YYYY' || format === 'MM/DD/YYYY' || format === 'day_month_unknown';
}

/**
 * Read one date cell. `order` reads a slash date; for `DD/MM/YYYY` and
 * `MM/DD/YYYY` the format's own order is used, for `day_month_unknown`
 * `order` must be given (null: the cell can't be read yet). `tz` reads
 * `unix_seconds`. Null when the cell doesn't fit the format.
 */
export function readDateCell(cell: string, format: DateFormat, opts: { order: DateOrder | null; tz: string }): ReadDate | null {
  const v = cell.trim();
  switch (format) {
    case 'YYYY-MM-DD': {
      const m = ISO.exec(v);
      return m ? withTime(ymd(Number(m[1]), Number(m[2]), Number(m[3])), undefined) : null;
    }
    case 'YYYY-MM-DD HH:mm:ss': {
      const m = ISO_SPACE.exec(v);
      return m ? withTime(ymd(Number(m[1]), Number(m[2]), Number(m[3])), time(m[4], m[5], m[6])) : null;
    }
    case 'YYYY-MM-DDTHH:mm:ss': {
      const m = ISO_T.exec(v);
      return m ? withTime(ymd(Number(m[1]), Number(m[2]), Number(m[3])), time(m[4], m[5], m[6])) : null;
    }
    case 'YYYY-MM-DDTHH:mm:ssZ': {
      const r = readInstant(v, opts.tz);
      return r === null ? null : { date: r.date, time: r.time, timeFull: r.timeFull };
    }
    case 'D MMM YYYY, HH:mm': {
      const m = D_MMM.exec(v);
      if (!m) return null;
      const name = (m[2] ?? '').toLowerCase();
      const idx = name.length === 3 ? MONTHS.indexOf(name) : LONG_MONTHS.indexOf(name);
      const month = idx === -1 && name.length === 4 && name === 'sept' ? 8 : idx;
      if (month === -1) return null;
      return withTime(ymd(Number(m[3]), month + 1, Number(m[1])), time(m[4], m[5], undefined));
    }
    case 'unix_seconds': {
      if (!UNIX.test(v)) return null;
      const ms = Number(v) * 1000;
      const date = localDateOf(ms, opts.tz);
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: opts.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(ms);
      const [h, mi, s] = hm.split(':');
      return withTime(date, time(h, mi, s));
    }
    case 'DD/MM/YYYY':
    case 'MM/DD/YYYY':
    case 'day_month_unknown': {
      const m = SLASH.exec(v);
      if (!m) return null;
      const order: DateOrder | null = format === 'DD/MM/YYYY' ? 'day_first' : format === 'MM/DD/YYYY' ? 'month_first' : opts.order;
      if (order === null) return null;
      const a = Number(m[1]);
      const b = Number(m[2]);
      const date = order === 'day_first' ? ymd(Number(m[3]), b, a) : ymd(Number(m[3]), a, b);
      return withTime(date, time(m[4], m[5], m[6]));
    }
  }
}

/** Every format that reads all of `cells` (non-empty), in list order: code's own reading when Ben gives a column the date role. */
export function formatsReading(cells: readonly string[], tz: string): DateFormat[] {
  const filled = cells.map((c) => c.trim()).filter((c) => c !== '');
  if (filled.length === 0) return [];
  const formats: DateFormat[] = ['YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ssZ', 'D MMM YYYY, HH:mm', 'unix_seconds'];
  const out = formats.filter((f) => filled.every((c) => readDateCell(c, f, { order: null, tz }) !== null));
  if (filled.every((c) => slashFields(c) !== null)) {
    const ev = dateOrderEvidence(filled);
    if (ev.order === 'day_first') out.push('DD/MM/YYYY');
    else if (ev.order === 'month_first') out.push('MM/DD/YYYY');
    else if (ev.order === 'unknown') out.push('day_month_unknown');
  }
  return out;
}
