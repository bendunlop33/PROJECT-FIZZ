import { toMs } from '@fizz/domain';

import { formatShortDate } from '../format/dates';
import { plural } from '../format/numbers';
import type { DataSummary, DeleteOutcome, ResetOutcome } from './data-domain-service';

/**
 * What the Export, Delete my data and Reset coaching knowledge screens show
 * (data-import-export §2.6, §2.7, §3.6, §5). Pure, so the copy is tested;
 * screens only render it. Values and actions, no explanations (minimal copy).
 */

export interface WhenContext {
  tz: string;
  locale?: string;
}

/** `Copy saved to Files · Thu 8 Oct` / `No copy off this phone` (§2.7; §3.6 lists Save first above it then). */
export function offPhoneLine(summary: DataSummary, ctx: WhenContext): { text: string; saveFirst: boolean } {
  const c = summary.lastCopyToFiles;
  if (c === null) return { text: 'No copy off this phone', saveFirst: true };
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
      'The copy kept to undo a restore',
    ],
    kept: 'Coaching knowledge',
  };
}

export const DELETE_ALERT = {
  title: 'Delete your data?',
  message: 'Your workouts and everything about you are removed from this iPhone. Coaching knowledge is kept. A backup is saved on this phone first.',
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
  message: 'The exercise list returns to the built-in one. Your data isn’t changed. A backup is saved on this phone first.',
  confirm: 'Reset',
} as const;

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
    case 'backup_failed':
      return { line: `Nothing was deleted: the backup didn’t save. ${r.message}`, relaunch: false, tone: 'warning' };
    case 'failed':
      return r.pending
        ? { line: `Deleting didn’t finish (${r.message}). It finishes when GymSmarter opens again.`, relaunch: true, tone: 'warning' }
        : { line: `Nothing was deleted. ${r.message}`, relaunch: false, tone: 'warning' };
  }
}

export function resetResultView(r: ResetOutcome): { line: string; relaunch: boolean; tone: 'done' | 'warning' } {
  if (r.ok) return { line: 'Coaching knowledge reset.', relaunch: true, tone: 'done' };
  switch (r.reason) {
    case 'stale':
      return { line: 'Your data changed. Nothing was reset. Check and try again.', relaunch: false, tone: 'warning' };
    case 'backup_failed':
      return { line: `Nothing was reset: the backup didn’t save. ${r.message}`, relaunch: false, tone: 'warning' };
    case 'failed':
      return { line: `Nothing was reset. ${r.message}`, relaunch: false, tone: 'warning' };
  }
}
