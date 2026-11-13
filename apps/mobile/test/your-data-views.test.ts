import { describe, expect, it } from 'vitest';

import type { DataSummary } from '../src/backup/data-domain-service';
import {
  DELETE_ALERT,
  deleteLeftoverView,
  deleteListView,
  deleteResultView,
  deleteUnfinishedView,
  finishLeftoverView,
  offPhoneLine,
  RESET_ALERT,
  resetAlertView,
  resetListView,
  resetResultView,
} from '../src/backup/data-domain-view';
import { describeBackupError, rollbackConfirmMessage, rollbackRowView } from '../src/backup/restore-view';

/** What the Delete my data / Reset coaching knowledge screens say (data-import-export §2.7, §3.6, §5). */

const summary = (over: Partial<DataSummary> = {}): DataSummary => ({
  counts: {
    yourData: { workouts: 412, sets: 4105, gyms: 2, routines: 3, checkIns: 10, painFlags: 1, memories: 4, coachThreads: 2, imports: 1, records: 9000 },
    coachingKnowledge: { exercises: 60, playbookCandidates: 1, playbookRules: 0, records: 61 },
  },
  keptForUndo: null,
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
      lines: ['Your data is removed from the app. Some of it is still on this phone.', 'Removing backups on this phone didn’t finish.', 'x'],
      retry: true,
    });
    // Never "deleted" when nobody could check (review r2 N2).
    expect(deleteUnfinishedView({ deleted: null, step: 'database', message: 'x' })).toEqual({
      title: 'Deleting your data didn’t finish',
      lines: ['Couldn’t check whether your data was deleted.', 'x'],
      retry: true,
    });
    expect(deleteResultView({ ok: false, reason: 'failed', message: 'x', deleted: null, step: 'database' })).toMatchObject({ relaunch: true, line: 'Couldn’t check whether your data was deleted. GymSmarter tries again when it opens.' });
  });

  it('after Continue, Data & backup says something is still on this phone and offers Finish deleting (review r2 S2)', () => {
    expect(deleteLeftoverView({ step: 'database', steps: ['database', 'backups'] })).toEqual({
      line: 'Deleting didn’t finish (old database). Some of your data is still on this phone.',
      action: 'Finish deleting',
      confirmMessage: undefined,
    });
    expect(deleteLeftoverView({ step: 'backups', steps: ['backups'] }).line).toBe('Deleting didn’t finish (backups). Some of your data is still on this phone.');
    // Only when it signs out of ChatGPT does the confirmation say anything (review r3 N1).
    expect(deleteLeftoverView({ step: 'coach_sign_in', steps: ['coach_sign_in', 'settings_files'] })).toMatchObject({ line: 'Deleting didn’t finish (coach sign-in). Some of your data is still on this phone.', confirmMessage: 'Signs you out of ChatGPT.' });
    expect(finishLeftoverView({ ok: true })).toEqual({ line: 'Deleting finished.', tone: 'done', relaunch: true });
    expect(finishLeftoverView({ ok: false, step: 'backups', message: '1 backup file(s) couldn’t be deleted' })).toEqual({
      line: 'Couldn’t finish deleting (removing backups on this phone). 1 backup file(s) couldn’t be deleted',
      tone: 'warning',
      relaunch: false,
    });
  });

  it('Reset during a workout names the workout, as Restore does (review r2 S3)', () => {
    const view = resetResultView({ ok: false, reason: 'workout_unfinished', block: { title: 'Push day', startedAtUtc: '2026-10-08T17:00:00.000Z', tz: 'Europe/London' } });
    expect(view).toMatchObject({ relaunch: false, undo: false, tone: 'warning' });
    expect(view.line).toMatch(/^Finish or discard your workout first \(Push day, started .+\)\.$/);
  });

  it('names Undo last reset and its switch back (check 31a)', () => {
    const ctx = { nowMs: Date.parse('2026-10-09T09:00:00.000Z'), tz: 'Europe/London', locale: 'en-GB' };
    expect(rollbackRowView({ available: true, last: { atUtc: '2026-10-09T08:00:00.000Z', reason: 'reset' } }, ctx)?.title).toBe('Undo last reset');
    expect(rollbackRowView({ available: true, last: { atUtc: '2026-10-09T08:00:00.000Z', reason: 'undo_reset' } }, ctx)?.title).toBe('Switch back to the reset coaching knowledge');
    expect(rollbackRowView({ available: false, last: { atUtc: '2026-10-09T08:00:00.000Z', reason: 'reset' } }, ctx)).toBeNull();
  });

  it('Undo last reset says Your data isn’t changed; Undo last restore says where anything since stays (review r5 S1)', () => {
    const row = { subtitle: 'Brings back coaching knowledge from before 08:00' };
    expect(rollbackConfirmMessage(row, 'reset')).toBe('Brings back coaching knowledge from before 08:00. Your data isn’t changed.');
    expect(rollbackConfirmMessage(row, 'undo_reset')).toMatch(/Your data isn’t changed\.$/);
    expect(rollbackConfirmMessage({ subtitle: 'x' }, 'restore')).toMatch(/stays only in the data you switch away from/);
  });

  it('the Reset alert names data that only the copy kept for Undo holds, and that it’s saved first (review r5 B1)', () => {
    const ctx = { tz: 'Europe/London', locale: 'en-GB' };
    expect(resetAlertView(summary(), ctx)).toEqual({ ...RESET_ALERT });
    const kept = { workouts: 1, newestWorkoutUtc: '2026-10-10T08:00:00.000Z', otherRecords: 2, keptSinceUtc: '2026-10-10T09:00:00.000Z', unreadable: false };
    expect(resetAlertView(summary({ keptForUndo: kept }), ctx).message).toBe(
      `${RESET_ALERT.message} The copy kept for Undo (since Sat 10 Oct) holds 1 workout and 2 other records that aren’t on this phone. Reset saves that copy as a backup on this phone, then deletes it.`,
    );
    expect(resetAlertView(summary({ keptForUndo: { ...kept, workouts: 0, otherRecords: 1 } }), ctx).message).toMatch(/holds 1 other record that isn’t on this phone\./);
    expect(resetAlertView(summary({ keptForUndo: { ...kept, unreadable: true } }), ctx).message).toMatch(/The copy kept for Undo \(since Sat 10 Oct\) can’t be read\. Reset deletes it\.$/);
    expect(describeBackupError({ code: 'kept_copy_at_risk', message: 'x' })).toBe('The copy kept for Undo holds data that isn’t on this phone. Nothing was reset.');
  });
});
