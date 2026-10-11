import { describe, expect, it } from 'vitest';

import type { DataSummary } from '../src/backup/data-domain-service';
import { DELETE_ALERT, deleteListView, deleteResultView, offPhoneLine, RESET_ALERT, resetListView, resetResultView } from '../src/backup/data-domain-view';

/** What the Delete my data / Reset coaching knowledge screens say (data-import-export §2.7, §3.6, §5). */

const summary = (over: Partial<DataSummary> = {}): DataSummary => ({
  counts: {
    yourData: { workouts: 412, sets: 4105, gyms: 2, routines: 3, checkIns: 10, painFlags: 1, memories: 4, coachThreads: 2, imports: 1, records: 9000 },
    coachingKnowledge: { exercises: 60, playbookCandidates: 1, records: 61 },
  },
  stamp: 's',
  lastCopyToFiles: null,
  ...over,
});

describe('data domain views', () => {
  it('lists what Delete removes and keeps, and the off-phone line', () => {
    expect(deleteListView(summary()).removed[0]).toBe('412 workouts and all their sets');
    expect(deleteListView(summary()).removed).toContain('Coach sign-in');
    expect(deleteListView(summary()).kept).toBe('Coaching knowledge');
    expect(offPhoneLine(summary(), { tz: 'Europe/London', locale: 'en-GB' })).toEqual({ text: 'No copy off this phone', saveFirst: true });
    expect(offPhoneLine(summary({ lastCopyToFiles: { atUtc: '2026-10-08T18:05:00.000Z', tz: 'Europe/London', destinationLabel: 'x' } }), { tz: 'Europe/London', locale: 'en-GB' })).toEqual({
      text: 'Copy saved to Files · Thu 8 Oct',
      saveFirst: false,
    });
    expect(DELETE_ALERT.title).toBe('Delete your data?');
  });

  it('lists what Reset changes', () => {
    expect(resetListView(summary()).changed).toEqual(['Exercise list goes back to the built-in one', '1 rule to review removed']);
    expect(RESET_ALERT.message).toContain('Your data isn’t changed.');
  });

  it('says what happened after each outcome; only a finished or resumable delete relaunches', () => {
    expect(deleteResultView({ ok: true, duplicate: false, signedOutOnline: null })).toEqual({ line: null, relaunch: true, tone: 'done' });
    expect(deleteResultView({ ok: true, duplicate: false, signedOutOnline: false }).line).toMatch(/^Couldn’t sign out of ChatGPT online/);
    expect(deleteResultView({ ok: false, reason: 'stale', fresh: summary() })).toMatchObject({ relaunch: false, line: 'Your data changed. Nothing was deleted. Check and try again.' });
    expect(deleteResultView({ ok: false, reason: 'backup_failed', message: 'This iPhone is out of space.' }).line).toBe('Nothing was deleted: the backup didn’t save. This iPhone is out of space.');
    expect(deleteResultView({ ok: false, reason: 'failed', message: 'x', pending: true }).relaunch).toBe(true);
    expect(deleteResultView({ ok: false, reason: 'failed', message: 'x', pending: false }).relaunch).toBe(false);
    expect(resetResultView({ ok: true, duplicate: false, status: 'switched' })).toEqual({ line: 'Coaching knowledge reset.', relaunch: true, tone: 'done' });
    expect(resetResultView({ ok: false, reason: 'stale', fresh: summary() }).relaunch).toBe(false);
  });
});
