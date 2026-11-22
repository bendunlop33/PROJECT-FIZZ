import { useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';

import { FIT_REST_LEVEL_OPTIONS, fitRestLevelOf, mainLiftRestLine, REST_LEVEL_NAMES, restDefaultsOf, restLevelTimesLine, SHORTEN_MAIN_COPY } from '@fizz/domain';
import type { FitRestLevel, TrainingChange, TrainingProfile } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, ChoiceCard, Group, Row, Screen, StatusLine, TextButton } from '../../ui';

/**
 * Profile › Training › Rest when short on time (Ben, 27 Oct; fit-to-time.md revision 27 Oct): how far Time may
 * shorten accessory rests. `Standard rest` (never), `Medium rest`, `Minimum rest` (default). The main lift's rests never
 * change for time whichever is picked. Each tap is one versioned write on the training profile (Your data, op ID,
 * rule 5); a stale write reloads. Values only (minimal copy).
 * (Ben, 28 Oct) Each option shows its accessory rests from Ben's Rest times (`Compound 2:00 · Isolation 1:30`); the
 * main lift's rest, which never shortens, once below.
 * (Ben, 1 Nov) `Shorten main lift too` (off by default): Medium and Minimum also shorten the main lift's rests; the
 * main-lift line then shows each level's value (`Main lift 3:00 · 2:30 · 2:00`). One versioned write per tap.
 */
export function RestWhenShortScreen() {
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

  const level = fitRestLevelOf(profile);
  const defaults = restDefaultsOf(profile);

  async function save(next: FitRestLevel) {
    await write({ kind: 'fit_rest_level', level: next });
  }

  async function write(change: TrainingChange) {
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
      <View style={{ gap: theme.space['2'] }} accessibilityRole="radiogroup">
        {FIT_REST_LEVEL_OPTIONS.map((l) => (
          <ChoiceCard key={l} title={REST_LEVEL_NAMES[l]} subtitle={restLevelTimesLine(l, defaults)} selected={level === l} onPress={() => void save(l)} />
        ))}
      </View>
      <Group>
        <Row
          title={SHORTEN_MAIN_COPY.label}
          trailing={<Switch testID="shorten-main" accessibilityLabel={SHORTEN_MAIN_COPY.label} value={profile.fitShortenMain === true} onValueChange={(on) => void write({ kind: 'fit_shorten_main', on })} />}
        />
      </Group>
      <AppText variant="callout" color="text.secondary">
        {mainLiftRestLine(defaults)}
      </AppText>
      {failed ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Not saved. Try again." /> : null}
    </Screen>
  );
}
