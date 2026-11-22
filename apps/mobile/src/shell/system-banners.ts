import { toMs } from '@fizz/domain';

import type { InstallStatus } from '../device/install';
import type { AppServices } from '../services/app-services';
import { signingStatus } from '../status/signing';
import { topBanners, type Banner } from '../status/system-status';

/** Today and Profile banners from local facts only (no network). */
export async function loadBanners(services: AppServices, install: InstallStatus | null): Promise<Banner[]> {
  const [backup, gym] = await Promise.all([services.backups.getStatus(), services.yourData.currentGym()]);
  const now = services.now();
  const integrity = services.integrity.last();
  return topBanners({
    signing: signingStatus(install?.profileExpiresUtc ?? null, toMs(now.utc), now.tz),
    onPhoneBackup: backup.onPhone.state,
    backupFailureDetail: backup.onPhone.state === 'failed' ? (backup.onPhone.line.detail?.split('. ')[0] ?? null) : null,
    hasGym: gym !== null,
    damagedRecords: integrity?.report.ok === false ? integrity.report.issues.length : 0,
  });
}
