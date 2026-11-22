import { describe, expect, it } from 'vitest';
import type { ZonedTimestamp } from '@fizz/schemas';

import { NBSP, recentWorkoutRows, shortRelativeDay, type RecentWorkoutInput } from '../src/index';

const TZ = 'Europe/London';
/** Sun 18 Oct 2026, 09:00 BST. */
const NOW: ZonedTimestamp = { utc: '2026-10-18T08:00:00.000Z', tz: TZ };
const plain = (s: string) => s.replaceAll(NBSP, ' ');
const row = (sessionId: string, startedAtUtc: string, over: Partial<RecentWorkoutInput> = {}): RecentWorkoutInput => ({ sessionId, title: 'Workout', startedAtUtc, tz: TZ, localDate: null, sets: 12, ...over });

describe('Today’s Recent (PM decision 18 Oct)', () => {
  it('short relative days: Today, Yesterday, weekday within 6 days, then `12 Oct`, a year once 11 months back', () => {
    expect(shortRelativeDay('2026-10-18', '2026-10-18')).toBe('Today');
    expect(shortRelativeDay('2026-10-17', '2026-10-18')).toBe('Yesterday');
    expect(shortRelativeDay('2026-10-16', '2026-10-18')).toBe('Fri');
    expect(shortRelativeDay('2026-10-12', '2026-10-18')).toBe('Mon');
    expect(plain(shortRelativeDay('2026-10-11', '2026-10-18'))).toBe('11 Oct');
    expect(plain(shortRelativeDay('2025-11-18', '2026-10-18'))).toBe('18 Nov 2025');
  });

  it('the last 5, newest first, any source; name, day and set count; nothing logged opens the Summary', () => {
    const rows = recentWorkoutRows(
      [
        row('a', '2026-10-06T17:00:00.000Z', { title: 'Upper body' }),
        row('b', '2026-10-17T17:00:00.000Z', { title: 'Pull · 45 min', sets: 16 }),
        row('c', '2026-10-13T17:00:00.000Z', { title: 'Push' }),
        row('d', '2026-10-16T17:00:00.000Z', { sets: 0, title: 'Empty workout' }),
        row('e', '2026-10-14T17:00:00.000Z', { sets: 1 }),
        // Imported: its own date, not the instant's.
        row('f', '2026-10-15T00:00:00.000Z', { title: 'Legs', localDate: '2026-10-15' }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.sessionId)).toEqual(['b', 'd', 'f', 'e', 'c']);
    expect(rows.map((r) => [r.title, r.when, plain(r.detail)])).toEqual([
      ['Pull · 45 min', 'Yesterday', '16 sets'],
      ['Empty workout', 'Fri', '0 sets'],
      ['Legs', 'Thu', '12 sets'],
      ['Workout', 'Wed', '1 set'],
      ['Push', 'Tue', '12 sets'],
    ]);
    expect(rows.map((r) => r.opens)).toEqual(['repeat', 'summary', 'repeat', 'repeat', 'repeat']);
    expect(rows[0]?.accessibilityLabel).toBe('Pull · 45 min, Yesterday, 16 sets');
    expect(recentWorkoutRows([], NOW)).toEqual([]);
  });
});
