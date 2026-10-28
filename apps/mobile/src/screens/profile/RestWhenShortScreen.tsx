import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { FIT_REST_LEVEL_OPTIONS, fitRestLevelOf, mainLiftRestLine, REST_LEVEL_NAMES, restDefaultsOf, restLevelTimesLine } from '@fizz/domain';
import type { FitRestLevel, TrainingProfile } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, ChoiceCard, Screen, StatusLine, TextButton } from '../../ui';

/**
 * Profile › Training › Rest when short on time (Ben, 27 Oct; fit-to-time.md revision 27 Oct): how far Time may
 * shorten accessory rests. `Standard rest` (never), `Medium rest`, `Minimum rest` (default). The main lift's rests never
 * change for time whichever is picked. Each tap is one versioned write on the training profile (Your data, op ID,
 * rule 5); a stale write reloads. Values only (minimal copy).
 * (Ben, 28 Oct) Each option shows its accessory rests from Ben's Rest times (`Compound 2:00 · Isolation 1:30`); the
 * main lift's rest, which never shortens, once below.
 */
export function RestWhenShortScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [profile, setProfile] = useState<TrainingProfile | null | 'error'>(null);
  const [failed, setFailed] = useState(false);
  // Ben's rest presets: the standard values snap to them, as every default reader does (his own are exact).
  const [presets, setPresets] = useState<readonly number[]>([]);
  const busy = useRef(false);

  const load = () => {
    void services.training
      .snapshot()
      .then((s) => {
        setProfile(s?.profile ?? 'error');
        setPresets(s?.owner.restPresets.map((r) => r.seconds) ?? []);
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

  const level = fitRestLevelOf(profile);
  const defaults = restDefaultsOf(profile);

  async function save(next: FitRestLevel) {
    if (profile === null || profile === 'error' || busy.current) return;
    busy.current = true;
    try {
      const r = await services.training.change({ kind: 'fit_rest_level', level: next }, profile.version, newUuid());
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
      <View style={{ gap: theme.space['2'] }} accessibilityRole="radiogroup">
        {FIT_REST_LEVEL_OPTIONS.map((l) => (
          <ChoiceCard key={l} title={REST_LEVEL_NAMES[l]} subtitle={restLevelTimesLine(l, defaults, presets)} selected={level === l} onPress={() => void save(l)} />
        ))}
      </View>
      <AppText variant="callout" color="text.secondary">
        {mainLiftRestLine(defaults, presets)}
      </AppText>
      {failed ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Not saved. Try again." /> : null}
    </Screen>
  );
}
