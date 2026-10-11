import { toMs } from '@fizz/domain';

import { formatDayMonth, formatShortDate, formatWhen } from '../format/dates';
import { TIMING } from '../theme/tokens';
import type { BackupManifest, BackupRecord, OffPhoneCopy } from './manifest';

/**
 * `getBackupStatus` (data-import-export.md §3.1, §6): one pure function
 * decides the backup state; screens only render it. Wording uses exactly the
 * three durability phrases (design-system §7.1): `Saved on this phone`,
 * `Backed up on this phone`, `Copy saved to Files`.
 */

export type OnPhoneState =
  /** No backup yet and no finished workout: nothing is owed. */
  | 'nothing_yet'
  /** The newest backup holds exactly the finished workouts there are now. */
  | 'backed_up'
  | 'backing_up'
  /** The last attempt failed after the newest success. */
  | 'failed'
  /** The finished workouts changed since the newest backup and no attempt has finished yet (e.g. iOS stopped it). */
  | 'pending'
  /** The newest backup was written but has damaged records, so it won't restore. */
  | 'damaged';

export type OffPhoneState = 'none' | 'saved' | 'reminder';

export type StatusTone = 'done' | 'info' | 'warning' | 'progress';

export interface StatusLine {
  tone: StatusTone;
  /** SF Symbol, design-system §7.1. */
  icon: 'checkmark.circle.fill' | 'iphone' | 'externaldrive.fill.badge.checkmark' | 'ellipsis' | 'exclamationmark.triangle' | 'info.circle';
  text: string;
  detail: string | null;
}

export interface BackupStatus {
  onPhone: { state: OnPhoneState; lastSuccess: BackupRecord | null; line: StatusLine };
  offPhone: { state: OffPhoneState; lastCopy: OffPhoneCopy | null; line: StatusLine };
  copiesOnPhone: BackupRecord[];
  trialRunDoneAtUtc: string | null;
}

export interface BackupFacts {
  /** Finished workouts in the database now. */
  finishedWorkouts: number;
  /** `finishedWorkoutsDigest` of the database now (B2). */
  finishedDigest?: string;
  backingUp: boolean;
  nowMs: number;
  tz: string;
  locale?: string;
}

function newest(files: readonly BackupRecord[]): BackupRecord | null {
  return files.reduce<BackupRecord | null>((best, f) => (best === null || f.createdAtUtc > best.createdAtUtc ? f : best), null);
}

/**
 * Whether a backup holds exactly the finished workouts there are now (B2).
 * A count alone can't tell after Undo import or a restore lowered it. Records
 * from before the digest existed fall back to the count.
 */
export function backupCovers(record: BackupRecord, facts: Pick<BackupFacts, 'finishedWorkouts' | 'finishedDigest'>): boolean {
  if (record.finishedDigest !== undefined && facts.finishedDigest !== undefined) return record.finishedDigest === facts.finishedDigest;
  return record.finishedWorkouts >= facts.finishedWorkouts;
}

export function newestBackup(files: readonly BackupRecord[]): BackupRecord | null {
  return newest(files);
}

export function onPhoneState(m: BackupManifest, facts: Pick<BackupFacts, 'finishedWorkouts' | 'finishedDigest' | 'backingUp'>): OnPhoneState {
  if (facts.backingUp) return 'backing_up';
  const last = newest(m.onPhone.files);
  const attempt = m.onPhone.lastAttempt;
  if (attempt && !attempt.ok && (last === null || attempt.atUtc > last.createdAtUtc)) return 'failed';
  if (last === null) return facts.finishedWorkouts === 0 ? 'nothing_yet' : 'pending';
  if (!last.integrityOk) return 'damaged';
  return backupCovers(last, facts) ? 'backed_up' : 'pending';
}

export function offPhoneState(m: BackupManifest, nowMs: number): OffPhoneState {
  const copy = m.offPhone.lastCopy;
  if (copy === null) return 'none';
  if (!m.offPhone.reminderEnabled) return 'saved';
  const sinceCopy = nowMs - toMs(copy.atUtc);
  const dismissed = m.offPhone.reminderDismissedAtUtc;
  const sinceDismiss = dismissed === null ? Infinity : nowMs - toMs(dismissed);
  return sinceCopy >= TIMING.offPhoneReminder && sinceDismiss >= TIMING.offPhoneReminder ? 'reminder' : 'saved';
}

export function buildBackupStatus(m: BackupManifest, facts: BackupFacts): BackupStatus {
  const { nowMs, tz, locale } = facts;
  const last = newest(m.onPhone.files);
  const state = onPhoneState(m, facts);
  const when = (utc: string) => formatWhen(toMs(utc), nowMs, tz, locale);
  const onLine: StatusLine = (() => {
    switch (state) {
      case 'backing_up':
        return { tone: 'progress', icon: 'ellipsis', text: 'Backing up…', detail: null };
      case 'backed_up':
        return { tone: 'done', icon: 'iphone', text: `Backed up on this phone · ${when(last?.createdAtUtc ?? '')}`, detail: null };
      case 'failed':
        return {
          tone: 'warning',
          icon: 'exclamationmark.triangle',
          text: 'Last backup on this phone didn’t save',
          detail: m.onPhone.lastAttempt?.error ?? 'The file couldn’t be written.',
        };
      case 'damaged':
        return {
          tone: 'warning',
          icon: 'exclamationmark.triangle',
          text: 'Backup saved, but it can’t be restored',
          detail: `${String(last?.integrityIssues ?? 0)} damaged record(s)`,
        };
      case 'pending':
        return { tone: 'done', icon: 'checkmark.circle.fill', text: 'Saved on this phone', detail: null };
      case 'nothing_yet':
        return { tone: 'done', icon: 'checkmark.circle.fill', text: 'Saved on this phone', detail: null };
    }
  })();
  const off = offPhoneState(m, nowMs);
  const copy = m.offPhone.lastCopy;
  const offLine: StatusLine =
    copy === null
      ? { tone: 'info', icon: 'info.circle', text: 'No copy off this phone yet', detail: null }
      : off === 'reminder'
        ? { tone: 'info', icon: 'info.circle', text: `No copy off this phone since ${formatDayMonth(toMs(copy.atUtc), tz, locale)}`, detail: null }
        : {
            tone: 'done',
            icon: 'externaldrive.fill.badge.checkmark',
            text: `Copy saved to Files · ${formatShortDate(toMs(copy.atUtc), tz, locale)}`,
            detail: copy.destinationLabel === '' ? null : copy.destinationLabel,
          };
  return {
    onPhone: { state, lastSuccess: last, line: onLine },
    offPhone: { state: off, lastCopy: copy, line: offLine },
    copiesOnPhone: [...m.onPhone.files].sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? 1 : -1)),
    trialRunDoneAtUtc: m.trialRunDoneAtUtc,
  };
}
