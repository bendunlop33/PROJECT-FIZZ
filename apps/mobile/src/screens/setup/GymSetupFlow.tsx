import { useState } from 'react';
import { View } from 'react-native';

import {
  DEFAULT_DUMBBELL_STEP,
  DEFAULT_SMALL_DUMBBELL_MAX,
  DUMBBELL_STEPS,
  formatNumber,
  QUICK_EXTRAS,
  QUICK_GYM_TYPES,
  SMALL_DUMBBELL_MAX,
  type QuickExtra,
  type QuickGymInput,
} from '@fizz/domain';
import type { GymSetup, WeightUnit } from '@fizz/schemas';

import { useDataChanged, useServices } from '../../shell/context';
import { newUuid } from '../../device/runtime';
import { Segmented } from '../../progress/components';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, ChecklistRow, Eyebrow, Group, PrimaryButton, StatusLine, TextButton, TextField } from '../../ui';
import { StepFrame } from './StepFrame';

export interface SavedGymSummary {
  name: string;
  items: number;
  notChecked: number;
}

/**
 * Add a gym in one screen (Ben, 20 Oct; ADR 0029): a name, `Full gym` /
 * `Hotel / small` / `Home`, and the one or two questions that matter
 * (`Dumbbells go up in`, `Dumbbells up to`, a few extras). Full gym is
 * preselected, so `Save gym` works at once. Everything saved is assumed until
 * Ben confirms or edits it on the gym screen, or the app learns it as he
 * trains. Used by onboarding Step 2 and `Add gym`. The gym ID is chosen once
 * per visit, so a double tap saves one gym.
 */
export function GymSetupFlow({
  unit,
  step,
  onBack,
  onSkip,
  onSaved,
}: {
  unit: WeightUnit;
  step: string | null;
  onBack?: (() => void) | undefined;
  onSkip?: (() => void) | undefined;
  onSaved: (summary: SavedGymSummary) => void;
}) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [gymId] = useState(newUuid);
  const [name, setName] = useState('Main gym');
  const [setup, setSetup] = useState<GymSetup>('full');
  const [dumbbellStep, setDumbbellStep] = useState(DEFAULT_DUMBBELL_STEP[unit]);
  const [dumbbellMax, setDumbbellMax] = useState<number | null>(DEFAULT_SMALL_DUMBBELL_MAX[unit]);
  const [extras, setExtras] = useState<Record<'small' | 'home', QuickExtra[]>>({
    small: QUICK_EXTRAS.small.filter((x) => x.on).map((x) => x.key),
    home: QUICK_EXTRAS.home.filter((x) => x.on).map((x) => x.key),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameEmpty = name.trim() === '';

  function input(): QuickGymInput {
    if (setup === 'full') return { setup, unit, dumbbellStep };
    return { setup, unit, dumbbells: dumbbellMax === null ? null : { max: dumbbellMax, step: dumbbellStep }, extras: extras[setup] };
  }

  async function save() {
    if (saving || nameEmpty) return;
    setSaving(true);
    setError(null);
    const draft = services.coachingKnowledge.buildQuickGymDraft(input());
    const result = await services.setup.saveGym({ gymId, name, draft, setup });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    changed();
    onSaved({ name: name.trim(), items: draft.items.length, notChecked: draft.items.length });
  }

  return (
    <StepFrame step={step} title={step === null ? 'Add gym' : 'Your gym'} onBack={onBack} footer={<PrimaryButton label="Save gym" disabled={nameEmpty} busy={saving} onPress={() => void save()} />}>
      <View style={{ gap: theme.space['2'] }}>
        <View nativeID="gym-name-label">
          <Eyebrow>Gym name</Eyebrow>
        </View>
        <TextField
          value={name}
          onChangeText={setName}
          accessibilityLabel="Gym name"
          accessibilityLabelledBy="gym-name-label"
          returnKeyType="done"
          maxLength={120}
          style={nameEmpty ? { borderWidth: 2, borderColor: theme.colors['status.warning'] } : undefined}
        />
        {nameEmpty ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Give the gym a name" /> : null}
      </View>
      <Segmented
        label="Gym type"
        options={QUICK_GYM_TYPES.map((t) => ({ key: t.setup, label: t.title }))}
        selected={setup}
        onSelect={(k) => {
          setSetup(k);
        }}
      />
      {setup !== 'full' ? (
        <View style={{ gap: theme.space['2'] }}>
          <Eyebrow>Dumbbells up to</Eyebrow>
          <ChipRow>
            {setup === 'home' ? (
              <Chip
                label="None"
                selected={dumbbellMax === null}
                onPress={() => {
                  setDumbbellMax(null);
                }}
              />
            ) : null}
            {SMALL_DUMBBELL_MAX[unit].map((m) => (
              <Chip
                key={m}
                label={`${formatNumber(m)} ${unit}`}
                selected={dumbbellMax === m}
                onPress={() => {
                  setDumbbellMax(m);
                }}
              />
            ))}
          </ChipRow>
        </View>
      ) : null}
      {setup === 'full' || dumbbellMax !== null ? (
        <View style={{ gap: theme.space['2'] }}>
          <Eyebrow>Dumbbells go up in</Eyebrow>
          <ChipRow>
            {DUMBBELL_STEPS[unit].map((s) => (
              <Chip
                key={s}
                label={`${formatNumber(s)} ${unit}`}
                selected={dumbbellStep === s}
                onPress={() => {
                  setDumbbellStep(s);
                }}
              />
            ))}
          </ChipRow>
        </View>
      ) : null}
      {setup !== 'full' ? (
        <Group>
          {QUICK_EXTRAS[setup].map((x) => (
            <ChecklistRow
              key={x.key}
              title={x.label}
              checked={extras[setup].includes(x.key)}
              onToggle={() => {
                setExtras((cur) => ({ ...cur, [setup]: cur[setup].includes(x.key) ? cur[setup].filter((k) => k !== x.key) : [...cur[setup], x.key] }));
              }}
            />
          ))}
        </Group>
      ) : null}
      {setup === 'home' && dumbbellMax === null && extras.home.length === 0 ? (
        <AppText variant="callout" color="text.secondary">
          Bodyweight only
        </AppText>
      ) : null}
      {onSkip ? <TextButton label="Skip" tone="secondary" onPress={onSkip} /> : null}
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
    </StepFrame>
  );
}
