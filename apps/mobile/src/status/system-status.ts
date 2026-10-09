import type { OnPhoneState } from '../backup/status';
import type { SigningStatus } from './signing';

/**
 * `buildSystemStatus` (system-states.md §2.2, §7): which banners show, in
 * priority order. Screens render the result and never decide priority.
 * Only the states that exist in this build are here (T2, T3, T5, T7, T8);
 * T1 replaces the screen instead (handled at startup).
 */

export type BannerSeverity = 'info' | 'warning';
export type BannerAction = 'add_gym' | 'how_to_refresh' | 'data_backup' | 'integrity_details';

export interface Banner {
  id: 'T2' | 'T3' | 'T5' | 'T7' | 'T8';
  severity: BannerSeverity;
  text: string;
  action: { kind: BannerAction; label: string } | null;
}

export interface SystemStatusInput {
  signing: SigningStatus;
  onPhoneBackup: OnPhoneState;
  backupFailureDetail: string | null;
  hasGym: boolean;
  damagedRecords: number;
}

export function buildSystemStatus(input: SystemStatusInput): Banner[] {
  const all: Banner[] = [];
  if (input.damagedRecords > 0) {
    all.push({
      id: 'T2',
      severity: 'warning',
      text: `GymSmarter found ${String(input.damagedRecords)} damaged record${input.damagedRecords === 1 ? '' : 's'}.`,
      action: { kind: 'integrity_details', label: 'Details' },
    });
  }
  if (input.signing.state === 'urgent' && input.signing.banner) {
    all.push({ id: 'T3', severity: 'warning', text: input.signing.banner, action: { kind: 'how_to_refresh', label: 'How' } });
  }
  if (input.onPhoneBackup === 'failed') {
    all.push({
      id: 'T5',
      severity: 'warning',
      text: `Last backup on this phone didn’t save${input.backupFailureDetail ? `: ${input.backupFailureDetail}` : '.'}`,
      action: { kind: 'data_backup', label: 'Details' },
    });
  }
  if (input.signing.state === 'notice' && input.signing.banner) {
    all.push({ id: 'T7', severity: 'info', text: input.signing.banner, action: { kind: 'how_to_refresh', label: 'How' } });
  }
  if (!input.hasGym) {
    all.push({ id: 'T8', severity: 'info', text: 'No gym yet. Add one to start a workout.', action: { kind: 'add_gym', label: 'Add gym' } });
  }
  return all;
}

/** Today and Profile show at most two, highest first (design-system §9.12). */
export function topBanners(input: SystemStatusInput): Banner[] {
  return buildSystemStatus(input).slice(0, 2);
}
