import { useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';

import { GENERAL_WARMUP_DEFAULT_MINUTES, generalWarmupDaysText, generalWarmupsEveryDay, mergeGeneralWarmups } from '@fizz/domain';
import { GENERAL_WARMUP_LIMITS, type GeneralWarmupDays, type GeneralWarmupRule } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { ChoiceCard, CountStepper, Group, Icon, Row, Screen, StatusLine, TextButton } from '../../ui';
import { WARMUP_PREFS_COPY, type WarmupPrefsView } from '../../services/warmup-prefs-service';

/**
 * Profile › Training › Cardio first (Ben, 2 Nov: "bike for 8 minutes first on leg days, rowing for 4 minutes first on
 * other days"). A cardio exercise and minutes for leg days and for other days, or `Same every day`. Every workout he
 * starts gets it first (Start puts it there; nothing is computed here). Each tap is one versioned write on the training
 * profile (Your data, op ID, rule 5); a stale write reloads. Values only (minimal copy).
 */
export function CardioFirstScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [view, setView] = useState<WarmupPrefsView | null | 'error'>(null);
  const [options, setOptions] = useState<readonly { id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<GeneralWarmupDays>('legs');
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const load = () => {
    void Promise.all([services.warmupPrefs.view(), services.warmupPrefs.cardioOptions()])
      .then(([v, o]) => {
        setView(v ?? 'error');
        setOptions(o);
      })
      .catch(() => {
        setView('error');
      });
  };
  useEffect(load, [services]);

  if (view === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open your settings." action={<TextButton label="Try again" onPress={load} />} />
      </Screen>
    );
  }
  if (view === null) return <Screen>{null}</Screen>;

  const rules = view.general;
  const everyDay = rules.some((r) => r.days === 'all');
  const kind: GeneralWarmupDays = everyDay ? 'all' : editing === 'all' ? 'legs' : editing;
  const rule = rules.find((r) => r.days === kind) ?? null;
  const nameOf = (id: string) => options.find((o) => o.id === id)?.name ?? 'Cardio';
  const valueOf = (r: GeneralWarmupRule | null) => (r === null ? WARMUP_PREFS_COPY.off : `${nameOf(r.exerciseId)} · ${String(r.minutes)} min`);

  async function save(next: readonly GeneralWarmupRule[]) {
    if (view === null || view === 'error' || busy.current) return;
    busy.current = true;
    try {
      const r = await services.warmupPrefs.setGeneral(next, view.version, newUuid());
      setFailed(!r.ok);
      if (r.ok) {
        setView(r.view);
        changed();
      } else load();
    } finally {
      busy.current = false;
    }
  }

  const pick = (exerciseId: string | null) => {
    void save(mergeGeneralWarmups(rules, [{ days: kind, exerciseId, minutes: rule?.minutes ?? GENERAL_WARMUP_DEFAULT_MINUTES }]));
  };

  return (
    <Screen>
      <Group>
        <Row title="Same every day" trailing={<Switch accessibilityLabel="Same every day" value={everyDay} onValueChange={(on) => {
              void save(generalWarmupsEveryDay(rules, on));
            }} />} />
      </Group>
      {everyDay ? null : (
        <View style={{ gap: theme.space['2'] }} accessibilityRole="radiogroup">
          {(['legs', 'other'] as const).map((d) => (
            <ChoiceCard key={d} title={generalWarmupDaysText(d)} subtitle={valueOf(rules.find((r) => r.days === d) ?? null)} selected={kind === d} onPress={() => {
                setEditing(d);
              }} />
          ))}
        </View>
      )}
      <Group>
        {[{ id: null, name: WARMUP_PREFS_COPY.off }, ...options].map((o) => (
          <Row key={o.id ?? 'off'} title={o.name} trailing={(rule?.exerciseId ?? null) === o.id ? <Icon name="checkmark" color="accent" /> : null} onPress={() => {
              pick(o.id);
            }} />
        ))}
      </Group>
      {rule === null ? null : (
        <CountStepper
          label="Minutes"
          value={rule.minutes}
          limits={{ min: GENERAL_WARMUP_LIMITS.minMinutes, max: GENERAL_WARMUP_LIMITS.maxMinutes }}
          fewerLabel="Fewer minutes"
          moreLabel="More minutes"
          onChange={(minutes) => {
            void save(mergeGeneralWarmups(rules, [{ days: kind, exerciseId: rule.exerciseId, minutes }]));
          }}
        />
      )}
      {failed ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Not saved. Try again." /> : null}
    </Screen>
  );
}
