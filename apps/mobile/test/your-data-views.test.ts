import { describe, expect, it } from 'vitest';

import type { DataSummary } from '../src/backup/data-domain-service';
import { DELETE_ALERT, deleteListView, deleteResultView, deleteUnfinishedView, offPhoneLine, RESET_ALERT, resetListView, resetResultView } from '../src/backup/data-domain-view';
import { rollbackRowView } from '../src/backup/restore-view';

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
    expect(deleteListView(summary()).removed).toContain('Backups on this phone, and the copy kept to undo a restore');
    expect(deleteListView(summary()).kept).toBe('Coaching knowledge');
    // §3.6: with no copy off the phone, say the phone's backups go too, and list Save first.
    expect(offPhoneLine(summary(), { tz: 'Europe/London', locale: 'en-GB' })).toEqual({ text: 'No copy off this phone. Deleting removes the backups on this phone too.', saveFirst: true });
    expect(offPhoneLine(summary({ lastCopyToFiles: { atUtc: '2026-10-08T18:05:00.000Z', tz: 'Europe/London', destinationLabel: 'x' } }), { tz: 'Europe/London', locale: 'en-GB' })).toEqual({
      text: 'Copy saved to Files · Thu 8 Oct',
      saveFirst: false,
    });
    expect(DELETE_ALERT.title).toBe('Delete your data?');
    // The alert never promises a backup on the phone (B1).
    expect(DELETE_ALERT.message).toBe('Your workouts and everything about you are removed from this iPhone. Coaching knowledge is kept. This can’t be undone. Copies in Files are kept.');
  });

  it('lists what Reset changes', () => {
    expect(resetListView(summary()).changed).toEqual(['Exercise list goes back to the built-in one', '1 rule to review removed']);
    expect(RESET_ALERT.message).toContain('Your data isn’t changed.');
    expect(RESET_ALERT.message).toContain('You can undo this from Data & backup.');
  });

  it('says what happened after each outcome; only a finished or resumable delete relaunches', () => {
    expect(deleteResultView({ ok: true, duplicate: false, signedOutOnline: null })).toEqual({ line: null, relaunch: true, tone: 'done' });
    expect(deleteResultView({ ok: true, duplicate: false, signedOutOnline: false }).line).toMatch(/^Couldn’t sign out of ChatGPT online/);
    expect(deleteResultView({ ok: false, reason: 'stale', fresh: summary() })).toMatchObject({ relaunch: false, line: 'Your data changed. Nothing was deleted. Check and try again.' });
    expect(deleteResultView({ ok: false, reason: 'failed', message: 'x', deleted: true, step: 'coach_sign_in' })).toEqual({
      line: 'Deleting didn’t finish (Removing the coach sign-in). It finishes when GymSmarter opens again.',
      relaunch: true,
      tone: 'warning',
    });
    expect(deleteResultView({ ok: false, reason: 'failed', message: 'Disk full.', deleted: false, step: 'database' })).toEqual({ line: 'Nothing was deleted. Disk full.', relaunch: false, tone: 'warning' });
    expect(resetResultView({ ok: true, duplicate: false, status: 'switched' })).toEqual({ line: 'Coaching knowledge reset.', relaunch: true, undo: true, tone: 'done' });
    // Nothing to reset: say so, don't relaunch (review N5).
    expect(resetResultView({ ok: true, duplicate: false, status: 'unchanged' })).toMatchObject({ relaunch: false, undo: false });
    expect(resetResultView({ ok: true, duplicate: true, status: 'unchanged' })).toMatchObject({ line: null, relaunch: false });
    expect(resetResultView({ ok: false, reason: 'stale', fresh: summary() }).relaunch).toBe(false);
  });

  it('a delete that didn’t finish at launch says what is true (review S1)', () => {
    expect(deleteUnfinishedView({ deleted: false, step: null, message: 'Disk full.' })).toEqual({ title: 'Deleting your data didn’t finish', lines: ['Nothing was deleted.', 'Disk full.'], retry: false });
    expect(deleteUnfinishedView({ deleted: true, step: 'backups', message: 'x' })).toEqual({
      title: 'Deleting your data didn’t finish',
      lines: ['Your data is deleted. Removing backups on this phone didn’t finish.', 'x'],
      retry: true,
    });
  });

  it('names Undo last reset and its switch back (check 31a)', () => {
    const ctx = { nowMs: Date.parse('2026-10-09T09:00:00.000Z'), tz: 'Europe/London', locale: 'en-GB' };
    expect(rollbackRowView({ available: true, last: { atUtc: '2026-10-09T08:00:00.000Z', reason: 'reset' } }, ctx)?.title).toBe('Undo last reset');
    expect(rollbackRowView({ available: true, last: { atUtc: '2026-10-09T08:00:00.000Z', reason: 'undo_reset' } }, ctx)?.title).toBe('Switch back to the reset coaching knowledge');
    expect(rollbackRowView({ available: false, last: { atUtc: '2026-10-09T08:00:00.000Z', reason: 'reset' } }, ctx)).toBeNull();
  });
});
