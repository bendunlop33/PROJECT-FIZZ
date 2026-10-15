import { createGuardedLoader } from '../guide/guarded-load';
import type { LiveActivityPort } from './controller';

/**
 * The Live Activity binding, required on first use (as Progress's Skia
 * charts): a failure loading expo-widgets or the widget becomes "not
 * available" (the rest notification is the alert), never a crashed launch.
 */
const load = createGuardedLoader(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy, guarded load
  const mod = require('./expo-port') as { expoLiveActivityPort: LiveActivityPort };
  return mod.expoLiveActivityPort;
});

const port = (): LiveActivityPort | null => {
  const r = load();
  return r.ok ? r.value : null;
};

export const lazyLiveActivityPort: LiveActivityPort = {
  available: () => port()?.available() ?? false,
  listIds: () => port()?.listIds() ?? [],
  start: (props, staleAtMs) => {
    const p = port();
    if (p === null) throw new Error('Live Activity binding unavailable');
    return p.start(props, staleAtMs);
  },
  update: (id, props, staleAtMs) => port()?.update(id, props, staleAtMs) ?? Promise.resolve(),
  end: (id) => port()?.end(id) ?? Promise.resolve(),
};
