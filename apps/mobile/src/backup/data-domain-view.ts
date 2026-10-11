import { toMs } from '@fizz/domain';

import { formatShortDate } from '../format/dates';
import { plural } from '../format/numbers';
import type { DataSummary, DeleteOutcome, DeleteStep, ResetOutcome } from './data-domain-service';

/**
 * What the Export, Delete my data and Reset coaching knowledge screens show
 * (data-import-export §2.6, §2.7, §3.6, §5). Pure, so the copy is tested;
 * screens only render it. Values and actions, no explanations (minimal copy).
 */

export interface WhenContext {
  tz: string;
  locale?: string;
}

/** `Copy saved to Files · Thu 8 Oct`, or the §3.6 line with `Save a copy to Files first` listed first. */
export function offPhoneLine(summary: DataSummary, ctx: WhenContext): { text: string; saveFirst: boolean } {
  const c = summary.lastCopyToFiles;
  if (c === null) return { text: 'No copy off this phone. Deleting removes the backups on this phone too.', saveFirst: true };
  return { text: `Copy saved to Files · ${formatShortDate(toMs(c.atUtc), ctx.tz, ctx.locale)}`, saveFirst: false };
}

/** `Delete my data`: what goes, then what stays. */
export function deleteListView(summary: DataSummary): { removed: string[]; kept: string } {
  const y = summary.counts.yourData;
  return {
    removed: [
      `${plural(y.workouts, 'workout', 'workouts')} and all their sets`,
      'Your profile, gyms and equipment',
      'Routines, check-ins and pain flags',
      'Coach chats and memories',
      'Coach sign-in',
      'Your settings and scheduled alerts',
      'Backups on this phone, and the copy kept to undo a restore',
    ],
    kept: 'Coaching knowledge',
  };
}

export const DELETE_ALERT = {
  title: 'Delete your data?',
  message: 'Your workouts and everything about you are removed from this iPhone. Coaching knowledge is kept. This can’t be undone. Copies in Files are kept.',
  confirm: 'Delete',
} as const;

/** `Reset coaching knowledge`: what changes. */
export function resetListView(summary: DataSummary): { changed: string[]; unchanged: string } {
  const k = summary.counts.coachingKnowledge;
  return {
    changed: ['Exercise list goes back to the built-in one', `${plural(k.playbookCandidates, 'rule to review', 'rules to review')} removed`],
    unchanged: 'Your data',
  };
}

export const RESET_ALERT = {
  title: 'Reset coaching knowledge?',
  message: 'The exercise list returns to the built-in one. Your data isn’t changed. You can undo this from Data & backup.',
  confirm: 'Reset',
} as const;

/** What didn't finish, named for Ben (S1). */
export function deleteStepLabel(step: DeleteStep): string {
  switch (step) {
    case 'database':
      return 'Removing the old database';
    case 'alerts':
      return 'Cancelling scheduled alerts';
    case 'backups':
      return 'Removing backups on this phone';
    case 'settings_files':
      return 'Removing your settings';
    case 'coach_sign_in':
      return 'Removing the coach sign-in';
  }
}

/** After a delete: the line to show (null: none), and whether the app relaunches. */
export function deleteResultView(r: DeleteOutcome): { line: string | null; relaunch: boolean; tone: 'done' | 'warning' } {
  if (r.ok) {
    return {
      line: r.signedOutOnline === false ? 'Couldn’t sign out of ChatGPT online. The sign-in was removed from this phone; you can also remove GymSmarter’s access in your ChatGPT settings.' : null,
      relaunch: true,
      tone: 'done',
    };
  }
  switch (r.reason) {
    case 'stale':
      return { line: 'Your data changed. Nothing was deleted. Check and try again.', relaunch: false, tone: 'warning' };
    case 'failed':
      return r.deleted
        ? { line: `Deleting didn’t finish (${r.step === null ? r.message : deleteStepLabel(r.step)}). It finishes when GymSmarter opens again.`, relaunch: true, tone: 'warning' }
        : { line: `Nothing was deleted. ${r.message}`, relaunch: false, tone: 'warning' };
  }
}

/**
 * Launch after a delete that didn't finish (S1). `deleted: false`: the swap
 * never happened and the marker is gone, so `Continue` opens the app as it
 * was. Otherwise `Try again` retries the step and `Continue` opens first run
 * with that step left undone.
 */
export function deleteUnfinishedView(o: { deleted: boolean; step: DeleteStep | null; message: string }): { title: string; lines: string[]; retry: boolean } {
  if (!o.deleted) return { title: 'Deleting your data didn’t finish', lines: ['Nothing was deleted.', o.message], retry: false };
  const what = o.step === null ? 'The rest' : deleteStepLabel(o.step);
  return { title: 'Deleting your data didn’t finish', lines: [`Your data is deleted. ${what} didn’t finish.`, o.message], retry: true };
}

/** After a reset. `undo`: offer Undo with the done line (§3.6 Reset done). */
export function resetResultView(r: ResetOutcome): { line: string | null; relaunch: boolean; undo: boolean; tone: 'done' | 'warning' } {
  if (r.ok) {
    if (r.duplicate) return { line: null, relaunch: false, undo: false, tone: 'done' };
    return r.status === 'switched'
      ? { line: 'Coaching knowledge reset.', relaunch: true, undo: true, tone: 'done' }
      : { line: 'Coaching knowledge is already the built-in one.', relaunch: false, undo: false, tone: 'done' };
  }
  switch (r.reason) {
    case 'stale':
      return { line: 'Your data changed. Nothing was reset. Check and try again.', relaunch: false, undo: false, tone: 'warning' };
    case 'backup_failed':
      return { line: `Nothing was reset: the backup didn’t save. ${r.message}`, relaunch: false, undo: false, tone: 'warning' };
    case 'failed':
      return { line: `Nothing was reset. ${r.message}`, relaunch: false, undo: false, tone: 'warning' };
  }
}
