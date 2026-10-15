import type { ResultUpdate } from './model';

/**
 * AlarmKit permission verdict (pure). "pass" means exactly "AlarmKit is present
 * and Fizz is authorized to use it". Scheduling an alarm is not built yet, so
 * a pass never claims an alarm has sounded. Denied or not-yet-asked must not
 * count as a working alarm path in the totals.
 *
 * `how`: "read" = the current state (Run); "requested" = the state after Ben
 * tapped Request permission (iOS only shows its prompt once; after that it
 * returns the stored answer).
 */
export function judgeAlarmKitStatus(status: string, how: 'read' | 'requested' = 'read'): ResultUpdate {
  const common = [
    `Raw authorization state: ${status} (${how === 'requested' ? 'after requesting permission' : 'read, not requested'})`,
    'Scheduling an alarm is not built yet (follow-up), so no alarm has been tested',
    'Whether a SideStore-signed app may schedule alarms is still unproven',
  ];
  switch (status) {
    case 'unsupportedOS':
      return { status: 'unavailable', summary: 'AlarmKit needs iOS 26 or later', details: [] };
    case 'notInSDK':
      return { status: 'unavailable', summary: 'Built with an SDK that has no AlarmKit', details: [] };
    case 'authorized':
      return {
        status: 'pass',
        summary:
          how === 'requested'
            ? 'AlarmKit permission granted. Scheduling an alarm is not tested yet'
            : 'AlarmKit present and authorized. Scheduling an alarm is not tested yet',
        details: common,
      };
    case 'notDetermined':
      return how === 'requested'
        ? { status: 'not_run', summary: 'The permission prompt was not answered. Tap Request permission again', details: common }
        : {
            status: 'not_run',
            summary: 'AlarmKit present; permission not requested yet. Tap Request permission',
            details: common,
          };
    case 'denied':
      return {
        status: 'unavailable',
        summary: 'AlarmKit present, but permission is denied (change it in Settings > GymSmarter)',
        details: common,
      };
    default:
      return { status: 'fail', summary: `AlarmKit returned an unexpected state: ${status}`, details: common };
  }
}
