import { toMs } from '@fizz/domain';
import type { BackupError, RestorePreview } from '@fizz/persistence';

import { formatShortDate, formatTime, formatWhen } from '../format/dates';
import { formatCount, plural } from '../format/numbers';

/**
 * Wording for Restore and Check a backup (data-import-export.md §2.3, §2.4,
 * §3.3, §5). Pure: the screens only render what these return.
 *
 * This build restores the whole file (one section). The two-section format
 * (DX11) is deferred, as the critic recommended (critic-pass-1 §3.1); the
 * preview therefore shows one count table.
 */

export interface CountRow {
  label: string;
  backup: string;
  phone: string;
}

export interface RestorePreviewView {
  /** `Made Thu 8 Oct 2026, 19:05` */
  made: string;
  /** `Fizz 0.1.0 (build 12)` */
  app: string;
  rows: CountRow[];
  /** Status-warning lines (what would be replaced). */
  warnings: string[];
  /** Info lines (migration, credentials, undo). */
  notes: string[];
  /** The confirm alert before a restore that replaces something; null = the primary is the confirmation. */
  confirm: { title: string; message: string } | null;
  identical: boolean;
}

export interface WhenContext {
  nowMs: number;
  tz: string;
  locale?: string;
}

function madeLine(utc: string, ctx: WhenContext): string {
  const ms = toMs(utc);
  const year = new Intl.DateTimeFormat(ctx.locale, { year: 'numeric', timeZone: ctx.tz }).format(ms);
  return `Made ${formatShortDate(ms, ctx.tz, ctx.locale)} ${year}, ${formatTime(ms, ctx.tz, ctx.locale)}`;
}

export function appLine(app: { name: string; version: string; build: string | null }): string {
  return `${app.name} ${app.version}${app.build ? ` (build ${app.build})` : ''}`;
}

export function buildRestorePreviewView(p: RestorePreview, ctx: WhenContext): RestorePreviewView {
  const b = p.backup.counts;
  const c = p.current.counts;
  const n = (v: number) => formatCount(v, ctx.locale);
  const rows: CountRow[] = [
    { label: 'Workouts', backup: n(b.finishedWorkouts), phone: n(c.finishedWorkouts) },
    { label: 'Sets', backup: n(b.loggedSets), phone: n(c.loggedSets) },
    { label: 'Gyms', backup: n(b.gyms), phone: n(c.gyms) },
    { label: 'Equipment', backup: n(b.equipment), phone: n(c.equipment) },
    { label: 'Exercises', backup: n(b.exercises), phone: n(c.exercises) },
  ];
  if (b.unfinishedWorkouts + c.unfinishedWorkouts > 0) rows.push({ label: 'Unfinished workouts', backup: n(b.unfinishedWorkouts), phone: n(c.unfinishedWorkouts) });

  const made = formatWhen(toMs(p.backup.createdAt.utc), ctx.nowMs, ctx.tz, ctx.locale);
  const warnings: string[] = [];
  const only = p.onlyOnPhone;
  if (only.workouts > 0) {
    const newest = only.newestWorkoutUtc ? ` (newest: ${formatShortDate(toMs(only.newestWorkoutUtc), ctx.tz, ctx.locale)})` : '';
    warnings.push(`${plural(only.workouts, 'workout', 'workouts', ctx.locale)} on this phone ${only.workouts === 1 ? 'isn’t' : 'aren’t'} in this backup${newest}. ${only.workouts === 1 ? 'It’ll' : 'They’ll'} be replaced.`);
  }
  if (only.otherRecords > 0) {
    warnings.push(`${plural(only.otherRecords, 'other record', 'other records', ctx.locale)} on this phone (gyms, equipment, check-ins and similar) ${only.otherRecords === 1 ? 'isn’t' : 'aren’t'} in this backup and will be replaced.`);
  }
  const notes: string[] = [];
  if (p.needsMigration) notes.push('This backup is from an older Fizz. It’s updated as it’s restored.');
  notes.push('Coach sign-in and API keys aren’t part of backups. Yours stay as they are.');
  notes.push('You can undo this from Data & backup.');

  const lost = only.workouts + only.otherRecords;
  const confirm =
    lost === 0
      ? null
      : {
          title: 'Replace your data on this phone?',
          message: `${only.workouts > 0 ? `${plural(only.workouts, 'workout', 'workouts', ctx.locale)} on this phone ${only.workouts === 1 ? 'isn’t' : 'aren’t'} in the backup from ${made}.` : `Some records on this phone aren’t in the backup from ${made}.`} You can undo this from Data & backup.`,
        };
  return {
    made: madeLine(p.backup.createdAt.utc, ctx),
    app: appLine(p.backup.app),
    rows,
    warnings,
    notes,
    confirm,
    identical: p.identical,
  };
}

/** One line per failure (data-import-export §3.3, §5). Every one says nothing changed. */
export function describeBackupError(e: BackupError): string {
  switch (e.code) {
    case 'not_a_backup':
      return 'This isn’t a Fizz backup file. Nothing was changed.';
    case 'checksum_mismatch':
    case 'counts_mismatch':
      return 'This backup file is damaged (its checksum doesn’t match). Nothing was changed.';
    case 'malformed':
      return 'This backup file is damaged or incomplete. Nothing was changed.';
    case 'backup_too_new':
    case 'schema_too_new':
      return 'This backup was made by a newer Fizz. Install that build or newer first. Nothing was changed.';
    case 'unexpected_tables':
    case 'unexpected_columns':
      return 'This backup doesn’t match any Fizz database layout, so it wasn’t read. Nothing was changed.';
    case 'integrity_failed':
      return `This backup has ${plural(e.issues?.length ?? 1, 'damaged record', 'damaged records')}, so it can’t be restored. Nothing was changed.`;
    case 'nothing_to_roll_back':
      return 'There’s no earlier data to go back to.';
    case 'restore_failed':
      return `Restore didn’t finish: ${e.message.replace(/^Restore failed[;:]?\s*/i, '')} Your data is as it was.`;
  }
}

export interface CheckResultView {
  ok: boolean;
  title: string;
  lines: string[];
}

/** `Check a backup` result (§2.4). */
export function buildCheckResultView(
  r: { restorable: boolean; preview: RestorePreview; issues: readonly { path: string; message: string }[] },
  ctx: WhenContext,
  newestGoodUtc: string | null,
): CheckResultView {
  const b = r.preview.backup.counts;
  const made = `Made ${formatWhen(toMs(r.preview.backup.createdAt.utc), ctx.nowMs, ctx.tz, ctx.locale)}`;
  const counts = `${plural(b.finishedWorkouts, 'workout', 'workouts', ctx.locale)} · ${plural(b.loggedSets, 'set', 'sets', ctx.locale)} · ${plural(b.gyms, 'gym', 'gyms', ctx.locale)}`;
  if (r.restorable) {
    return { ok: true, title: 'This backup restores', lines: [made, counts, r.preview.needsMigration ? 'It’s from an older Fizz and is updated when restored.' : null, 'Nothing on this phone was changed.'].filter((l): l is string => l !== null) };
  }
  return {
    ok: false,
    title: 'This backup won’t restore',
    lines: [
      made,
      `${formatCount(r.issues.length, ctx.locale)} ${r.issues.length === 1 ? 'record is' : 'records are'} damaged.`,
      newestGoodUtc ? `Your newest good backup: ${formatShortDate(toMs(newestGoodUtc), ctx.tz, ctx.locale)}.` : null,
      'Nothing on this phone was changed.',
    ].filter((l): l is string => l !== null),
  };
}

/** `Undo last restore` row (§3.3). */
export function rollbackRowView(target: { available: boolean; last: { atUtc: string; reason: 'restore' | 'rollback' } | null }, ctx: WhenContext): { title: string; subtitle: string } | null {
  if (!target.available || target.last === null) return null;
  const when = formatWhen(toMs(target.last.atUtc), ctx.nowMs, ctx.tz, ctx.locale);
  return target.last.reason === 'restore'
    ? { title: 'Undo last restore', subtitle: `Brings back your data from before ${when}` }
    : { title: 'Switch back to the restored backup', subtitle: `You undid a restore at ${when}` };
}
