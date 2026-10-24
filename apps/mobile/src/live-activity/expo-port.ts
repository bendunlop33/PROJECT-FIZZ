import Constants from 'expo-constants';
import type { LiveActivity } from 'expo-widgets';

import type { LiveActivityPort, WorkoutActivityProps } from './controller';
import { restCountdownActivity } from './RestCountdownActivity';

/**
 * Phone binding for the workout Live Activity (expo-widgets 57). Local start,
 * update and end only: no push token is ever requested (free Apple ID,
 * ADR 0004). `available()` is the build flag (`FIZZ_LIVE_ACTIVITY`); iOS can
 * still refuse a start (Live Activities off in Settings), which the
 * controller treats as unavailable for that workout.
 */

/** Built with the widget extension (`FIZZ_LIVE_ACTIVITY`, read from `extra` as the probe does). */
function includedInBuild(): boolean {
  const extra: unknown = Constants.expoConfig?.extra;
  return typeof extra === 'object' && extra !== null && (extra as { includeLiveActivity?: unknown }).includeLiveActivity === true;
}

const instances = new Map<string, LiveActivity<WorkoutActivityProps>>();

function refresh(): LiveActivity<WorkoutActivityProps>[] {
  const list = restCountdownActivity().getInstances();
  instances.clear();
  for (const a of list) instances.set(a.getId(), a);
  return list;
}

// eslint-disable-next-line no-restricted-globals -- converting an injected instant, not reading the clock
const dateOf = (ms: number | null) => (ms === null ? undefined : new Date(ms));

export const expoLiveActivityPort: LiveActivityPort = {
  available: includedInBuild,
  listIds() {
    return refresh().map((a) => a.getId());
  },
  start(props, staleAtMs) {
    const a = restCountdownActivity().start(props, undefined, dateOf(staleAtMs));
    instances.set(a.getId(), a);
    return a.getId();
  },
  async update(id, props, staleAtMs) {
    const a = instances.get(id) ?? refresh().find((x) => x.getId() === id);
    if (!a) throw new Error('Live Activity not found');
    await a.update(props, dateOf(staleAtMs));
  },
  async end(id) {
    const a = instances.get(id) ?? refresh().find((x) => x.getId() === id);
    instances.delete(id);
    if (a) await a.end('immediate');
  },
};
