import type { ResultUpdate } from './model';

/**
 * AlarmKit detection verdict (pure). The probe never requests permission, so
 * "pass" means only "present and already authorized"; denied or not-yet-asked
 * must not count as a working alarm path in the totals.
 */
export function judgeAlarmKitStatus(status: string): ResultUpdate {
  const common = [
    `Raw authorization state: ${status}`,
    'Detection only. Scheduling an alarm needs a native module and NSAlarmKitUsageDescription (follow-up)',
    'Whether a SideStore-signed app may schedule alarms is still unproven',
  ];
  switch (status) {
    case 'unsupportedOS':
      return { status: 'unavailable', summary: 'AlarmKit needs iOS 26 or later', details: [] };
    case 'notInSDK':
      return { status: 'unavailable', summary: 'Built with an SDK that has no AlarmKit', details: [] };
    case 'authorized':
      return { status: 'pass', summary: 'AlarmKit framework present and authorized', details: common };
    case 'notDetermined':
      return {
        status: 'not_run',
        summary: 'AlarmKit framework present; permission never requested, so alarms are untested',
        details: common,
      };
    case 'denied':
      return {
        status: 'unavailable',
        summary: 'AlarmKit framework present, but permission is denied (Settings > Fizz)',
        details: common,
      };
    default:
      return { status: 'fail', summary: `AlarmKit returned an unexpected state: ${status}`, details: common };
  }
}
