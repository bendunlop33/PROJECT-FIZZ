import { toMs } from '@fizz/domain';

import { formatShortDate, formatTime } from '../format/dates';
import { plural } from '../format/numbers';
import type { DataSummary, DeleteLeftover, DeleteOutcome, DeleteStep, FinishLeftoverOutcome, ResetOutcome } from './data-domain-service';

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
      'Workouts, check-ins and pain flags',
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
    changed: [
      'Exercise list goes back to the built-in one',
      `${plural(k.playbookCandidates, 'rule to review', 'rules to review')} removed`,
      ...(k.playbookRules > 0 ? [`${plural(k.playbookRules, 'approved chat rule', 'approved chat rules')} removed`] : []),
    ],
    unchanged: 'Your data',
  };
}

export const RESET_ALERT = {
  title: 'Reset coaching knowledge?',
  message: 'The exercise list returns to the built-in one. Your data isn’t changed. You can undo this from Data & backup.',
  confirm: 'Reset',
} as const;

/**
 * The Reset confirmation (review r5 B1). Reset deletes the copy kept for
 * Undo; when that copy holds data that isn't on this phone, the alert says
 * so and that it's saved as a backup on this phone first.
 */
export function resetAlertView(summary: Pick<DataSummary, 'keptForUndo'>, ctx: WhenContext): { title: string; message: string; confirm: string } {
  const k = summary.keptForUndo;
  if (k === null) return { ...RESET_ALERT };
  const since = k.keptSinceUtc ? ` (since ${formatShortDate(toMs(k.keptSinceUtc), ctx.tz, ctx.locale)})` : '';
  let line: string;
  if (k.unreadable) {
    line = `The copy kept for Undo${since} can’t be read. Reset deletes it.`;
  } else {
    const parts = [k.workouts > 0 ? plural(k.workouts, 'workout', 'workouts', ctx.locale) : null, k.otherRecords > 0 ? plural(k.otherRecords, 'other record', 'other records', ctx.locale) : null].filter(
      (x): x is string => x !== null,
    );
    const n = k.workouts + k.otherRecords;
    line = `The copy kept for Undo${since} holds ${parts.join(' and ')} that ${n === 1 ? 'isn’t' : 'aren’t'} on this phone. Reset saves that copy as a backup on this phone, then deletes it.`;
  }
  return { ...RESET_ALERT, message: `${RESET_ALERT.message} ${line}` };
}

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

/** One or two words for a step, inside a line that already says where (review r3 N3). */
const SHORT_STEP: Record<DeleteStep, string> = {
  database: 'old database',
  coach_sign_in: 'coach sign-in',
  alerts: 'alerts',
  backups: 'backups',
  settings_files: 'settings',
};

/** ChatGPT sign-in removed from the phone, online revoke not confirmed (§3.6). */
export const SIGN_OUT_NOT_CONFIRMED = 'Couldn’t sign out of ChatGPT online. The sign-in was removed from this phone; you can also remove GymSmarter’s access in your ChatGPT settings.';

/** After a delete: the line to show (null: none), and whether the app relaunches. */
export function deleteResultView(r: DeleteOutcome): { line: string | null; relaunch: boolean; tone: 'done' | 'warning' } {
  if (r.ok) {
    return {
      line: r.signedOutOnline === false ? SIGN_OUT_NOT_CONFIRMED : null,
      relaunch: true,
      tone: 'done',
    };
  }
  switch (r.reason) {
    case 'stale':
      return { line: 'Your data changed. Nothing was deleted. Check and try again.', relaunch: false, tone: 'warning' };
    case 'failed':
      if (r.deleted === null) return { line: 'Couldn’t check whether your data was deleted. GymSmarter tries again when it opens.', relaunch: true, tone: 'warning' };
      return r.deleted
        ? { line: `Deleting didn’t finish (${r.step === null ? r.message : deleteStepLabel(r.step)}). It finishes when GymSmarter opens again.`, relaunch: true, tone: 'warning' }
        : { line: `Nothing was deleted. ${r.message}`, relaunch: false, tone: 'warning' };
  }
}

/**
 * What a step left on this phone when it didn't finish (review r2 S2):
 * something of Ben's is always left when a step after the swap fails.
 */
const LEFT_ON_PHONE = 'Your data is removed from the app. Some of it is still on this phone.';

/**
 * Launch after a delete that didn't finish (S1). `deleted: false`: the swap
 * never happened and the marker is gone, so `Continue` opens the app as it
 * was. `null`: it couldn't be checked (review r2 N2). Otherwise `Try again`
 * retries the step and `Continue` opens first run with that step left
 * undone (then `Finish deleting` on Data & backup).
 */
export function deleteUnfinishedView(o: { deleted: boolean | null; step: DeleteStep | null; message: string }): { title: string; lines: string[]; retry: boolean } {
  const title = 'Deleting your data didn’t finish';
  if (o.deleted === false) return { title, lines: ['Nothing was deleted.', o.message], retry: false };
  if (o.deleted === null) return { title, lines: ['Couldn’t check whether your data was deleted.', o.message], retry: true };
  const what = o.step === null ? 'The rest' : deleteStepLabel(o.step);
  return { title, lines: [LEFT_ON_PHONE, `${what} didn’t finish.`, o.message], retry: true };
}

/**
 * Data & backup after `Continue` (review r2 S2): one warning line and
 * `Finish deleting`. Its confirmation says so when it signs out of ChatGPT
 * (review r3 N1); otherwise it has no message.
 */
export function deleteLeftoverView(l: Pick<DeleteLeftover, 'step' | 'steps'>): { line: string; action: string; confirmMessage: string | undefined } {
  return {
    line: `Deleting didn’t finish (${SHORT_STEP[l.step]}). Some of your data is still on this phone.`,
    action: 'Finish deleting',
    confirmMessage: l.steps.includes('coach_sign_in') ? 'Signs you out of ChatGPT.' : undefined,
  };
}

/** After `Finish deleting`. */
export function finishLeftoverView(r: FinishLeftoverOutcome): { line: string; tone: 'done' | 'warning'; relaunch: boolean } {
  if (r.ok) return { line: 'Deleting finished.', tone: 'done', relaunch: true };
  return { line: `Couldn’t finish deleting (${deleteStepLabel(r.step).toLowerCase()}). ${r.message}`, tone: 'warning', relaunch: false };
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
    case 'workout_unfinished':
      return { line: `Finish or discard your workout first (${r.block.title}, started ${formatTime(toMs(r.block.startedAtUtc), r.block.tz)}).`, relaunch: false, undo: false, tone: 'warning' };
    case 'backup_failed':
      return { line: `Nothing was reset: the backup didn’t save. ${r.message}`, relaunch: false, undo: false, tone: 'warning' };
    case 'failed':
      return { line: `Nothing was reset. ${r.message}`, relaunch: false, undo: false, tone: 'warning' };
  }
}
