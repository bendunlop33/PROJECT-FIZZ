import { useState } from 'react';
import { View } from 'react-native';

import {
  DUMBBELL_STEPS,
  formatNumber,
  initQuickGymForm,
  QUICK_EXTRAS,
  QUICK_GYM_TYPES,
  quickGymFormInput,
  quickGymFormRows,
  reduceQuickGymForm,
  SMALL_DUMBBELL_MAX,
  type QuickGymFormAction,
} from '@fizz/domain';
import type { WeightUnit } from '@fizz/schemas';

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
  firstGym = true,
  onBack,
  onSkip,
  onSaved,
}: {
  unit: WeightUnit;
  step: string | null;
  /** His first gym: the name starts as `Main gym`; otherwise empty (review N2). */
  firstGym?: boolean;
  onBack?: (() => void) | undefined;
  onSkip?: (() => void) | undefined;
  onSaved: (summary: SavedGymSummary) => void;
}) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [gymId] = useState(newUuid);
  const [form, setForm] = useState(() => initQuickGymForm(unit, firstGym));
  const act = (a: QuickGymFormAction) => {
    setForm((cur) => reduceQuickGymForm(cur, a));
  };
  const { name, setup, dumbbellStep, dumbbellMax, extras } = form;
  const rows = quickGymFormRows(form);
  // An empty name on a second gym is where he starts, not a mistake: the warning waits until he has typed.
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameEmpty = name.trim() === '';

  async function save() {
    if (saving || nameEmpty) return;
    setSaving(true);
    setError(null);
    const draft = services.coachingKnowledge.buildQuickGymDraft(quickGymFormInput(form));
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
          onChangeText={(t) => {
            setNameTouched(true);
            act({ kind: 'name', name: t });
          }}
          accessibilityLabel="Gym name"
          accessibilityLabelledBy="gym-name-label"
          returnKeyType="done"
          maxLength={120}
          style={nameEmpty && nameTouched ? { borderWidth: 2, borderColor: theme.colors['status.warning'] } : undefined}
        />
        {nameEmpty && nameTouched ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Give the gym a name" /> : null}
      </View>
      <Segmented
        label="Gym type"
        options={QUICK_GYM_TYPES.map((t) => ({ key: t.setup, label: t.title }))}
        selected={setup}
        onSelect={(k) => {
          act({ kind: 'setup', setup: k });
        }}
      />
      {rows.max ? (
        <View style={{ gap: theme.space['2'] }}>
          <Eyebrow>Dumbbells up to</Eyebrow>
          <ChipRow>
            {rows.none ? (
              <Chip
                label="None"
                selected={dumbbellMax === null}
                onPress={() => {
                  act({ kind: 'max', max: null });
                }}
              />
            ) : null}
            {SMALL_DUMBBELL_MAX[unit].map((m) => (
              <Chip
                key={m}
                label={`${formatNumber(m)} ${unit}`}
                selected={dumbbellMax === m}
                onPress={() => {
                  act({ kind: 'max', max: m });
                }}
              />
            ))}
          </ChipRow>
        </View>
      ) : null}
      {rows.step ? (
        <View style={{ gap: theme.space['2'] }}>
          <Eyebrow>Dumbbells go up in</Eyebrow>
          <ChipRow>
            {DUMBBELL_STEPS[unit].map((s) => (
              <Chip
                key={s}
                label={`${formatNumber(s)} ${unit}`}
                selected={dumbbellStep === s}
                onPress={() => {
                  act({ kind: 'step', step: s });
                }}
              />
            ))}
          </ChipRow>
        </View>
      ) : null}
      {rows.extras && setup !== 'full' ? (
        <Group>
          {QUICK_EXTRAS[setup].map((x) => (
            <ChecklistRow
              key={x.key}
              title={x.label}
              checked={extras[setup].includes(x.key)}
              onToggle={() => {
                act({ kind: 'extra', key: x.key });
              }}
            />
          ))}
        </Group>
      ) : null}
      {rows.bodyweightOnly ? (
        <AppText variant="callout" color="text.secondary">
          Bodyweight only
        </AppText>
      ) : null}
      {onSkip ? <TextButton label="Skip" tone="secondary" onPress={onSkip} /> : null}
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
    </StepFrame>
  );
}
