import { localDateOf } from '../calendar';

/**
 * ISO 8601 date-times that name their own offset (`2025-01-15T18:02:03Z`,
 * `…T18:02:03.120+01:00`): an instant, not a wall-clock time. Pure. The
 * FitNotes 2 (iPhone) workout CSV writes `StartTime` and `EndTime` this way,
 * in UTC. They are read as the instant they are and shown in the import's
 * zone; the cell as written stays the provenance.
 */

const ISO_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:?\d{2})$/;

export interface ReadInstant {
  /** Epoch milliseconds. */
  ms: number;
  /** `YYYY-MM-DD` in the zone asked for. */
  date: string;
  /** `HH:mm` in that zone. */
  time: string;
  /** `HH:mm:ss` in that zone. */
  timeFull: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm): no clock, no `Date`. */
function daysFromCivil(y0: number, m: number, d: number): number {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Read an ISO date-time with `Z` or `±HH:MM`; null when the cell isn't one, or names a date or time that doesn't exist. */
export function readInstant(cell: string, tz: string): ReadInstant | null {
  const m = ISO_OFFSET.exec(cell.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number];
  const s = m[6] === undefined ? 0 : Number(m[6]);
  const frac = m[7] === undefined ? 0 : Math.floor(Number(`0.${m[7]}`) * 1000);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ?? 0;
  // A day that doesn't exist (`2025-02-30`) is refused, never rolled over.
  if (d > days) return null;
  const local = daysFromCivil(y, mo, d) * 86_400_000 + ((h * 60 + mi) * 60 + s) * 1000 + frac;
  const off = m[8] ?? 'Z';
  let offsetMin = 0;
  if (off !== 'Z') {
    const om = /^([+-])(\d{2}):?(\d{2})$/.exec(off);
    if (!om) return null;
    const oh = Number(om[2]);
    const omin = Number(om[3]);
    if (oh > 14 || omin > 59) return null;
    offsetMin = (om[1] === '-' ? -1 : 1) * (oh * 60 + omin);
  }
  const ms = local - offsetMin * 60_000;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(ms);
  const [hh = '00', mm = '00', ss = '00'] = hm.split(':');
  return { ms, date: localDateOf(ms, tz), time: `${pad(Number(hh))}:${pad(Number(mm))}`, timeFull: `${pad(Number(hh))}:${pad(Number(mm))}:${pad(Number(ss))}` };
}
