import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { REST_TIMES_COPY, restDefaultsOf, restTimesView } from '@fizz/domain';
import type { TrainingChange, TrainingProfile } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { CountStepper, Screen, StatusLine, TextButton } from '../../ui';

/**
 * Profile › Rest times (Ben, 28 Oct): Ben's default rests, `Main lift`, `Top set`, `Back-off`, `Compound`, `Isolation`,
 * `Superset round`, `Warm-up`, each − / + in 15 s steps (0:30–6:00), and `Reset to defaults`. Each tap is one versioned
 * write on the training profile (Your data, op ID, rule 5); a stale write reloads. New drafts and future workouts use
 * them; an open workout and done sets keep theirs (rule 2). Values only (minimal copy); the domain gives every value.
 */
export function RestTimesScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [profile, setProfile] = useState<TrainingProfile | null | 'error'>(null);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const load = () => {
    void services.training
      .snapshot()
      .then((s) => {
        setProfile(s?.profile ?? 'error');
      })
      .catch(() => {
        setProfile('error');
      });
  };
  useEffect(load, [services]);

  if (profile === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open your settings." action={<TextButton label="Try again" onPress={load} />} />
      </Screen>
    );
  }
  if (profile === null) return <Screen>{null}</Screen>;

  const view = restTimesView(restDefaultsOf(profile));

  async function save(change: TrainingChange) {
    if (profile === null || profile === 'error' || busy.current) return;
    busy.current = true;
    try {
      const r = await services.training.change(change, profile.version, newUuid());
      setFailed(!r.ok);
      if (r.ok) {
        setProfile(r.profile);
        changed();
      } else if (r.profile !== null) setProfile(r.profile);
    } finally {
      busy.current = false;
    }
  }

  return (
    <Screen>
      <View style={{ gap: theme.space['1'] }}>
        {view.rows.map((row) => (
          <CountStepper
            key={row.key}
            label={row.label}
            value={row.seconds}
            valueText={row.text}
            limits={{ min: 0, max: 0 }}
            steps={{ down: row.down, up: row.up }}
            fewerLabel={`${row.label} shorter`}
            moreLabel={`${row.label} longer`}
            onChange={(seconds) => void save({ kind: 'rest_default', key: row.key, seconds })}
          />
        ))}
      </View>
      <TextButton label={REST_TIMES_COPY.reset} disabled={!view.canReset} onPress={() => void save({ kind: 'reset_rest_defaults' })} />
      {failed ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Not saved. Try again." /> : null}
    </Screen>
  );
}
