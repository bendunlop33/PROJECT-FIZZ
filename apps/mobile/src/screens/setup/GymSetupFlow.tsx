import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';

import { toggleDraftItem, type GymDraft, type GymPresetId } from '@fizz/domain';
import type { WeightUnit } from '@fizz/schemas';

import { useDataChanged, useServices } from '../../shell/context';
import { newUuid } from '../../device/runtime';
import { useTheme } from '../../theme';
import { AppText, ChecklistRow, ChoiceCard, Group, PrimaryButton, StatusLine, TextButton } from '../../ui';
import { StepFrame } from './StepFrame';

export interface SavedGymSummary {
  name: string;
  items: number;
  notChecked: number;
}

/**
 * Onboarding Step 2 (onboarding.md §2.3–2.4), also used for `Add gym` from
 * Today's no-gym banner until the gym editor exists. The preset becomes a
 * draft checklist; nothing is saved until `Save gym`, which writes the gym
 * and its ticked items in one transaction. The gym ID is chosen once per
 * visit, so a double tap saves one gym.
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
  const [phase, setPhase] = useState<'start' | 'checklist'>('start');
  const [name, setName] = useState('Main gym');
  const [presetId, setPresetId] = useState<GymPresetId | null>(null);
  const [draft, setDraft] = useState<GymDraft | null>(null);
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presets = services.coachingKnowledge.gymPresets();
  const nameEmpty = name.trim() === '';

  async function save(d: GymDraft | null) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await services.setup.saveGym({ gymId, name, draft: d });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    changed();
    const ticked = d?.items.filter((i) => i.ticked) ?? [];
    onSaved({ name: name.trim(), items: ticked.length, notChecked: ticked.filter((i) => i.equipment.detailsSource === 'preset').length });
  }

  function choose(id: GymPresetId) {
    if (draft !== null && edited && draft.presetId !== id) {
      const title = presets.find((p) => p.id === id)?.title ?? '';
      Alert.alert(`Replace the checklist with the "${title}" draft?`, 'Your changes to it will be lost.', [
        { text: 'Keep mine', style: 'cancel' },
        {
          text: 'Replace',
          onPress: () => {
            setPresetId(id);
            setDraft(null);
            setEdited(false);
          },
        },
      ]);
      return;
    }
    setPresetId(id);
    if (draft?.presetId !== id) setDraft(null);
  }

  function next() {
    if (presetId === null || nameEmpty) return;
    if (presetId === 'empty') {
      void save(null);
      return;
    }
    setDraft((d) => d ?? services.coachingKnowledge.buildGymDraft(presetId, unit));
    setPhase('checklist');
  }

  if (phase === 'checklist' && draft !== null) {
    const ticked = draft.items.filter((i) => i.ticked).length;
    const presetTitle = presets.find((p) => p.id === draft.presetId)?.title ?? '';
    return (
      <StepFrame
        step={step}
        title={`${name.trim()}: what’s there?`}
        explanation={`Draft from "${presetTitle}". Untick anything this gym doesn’t have.`}
        onBack={() => {
          setPhase('start');
        }}
        footer={
          <>
            {ticked === 0 ? (
              <AppText variant="callout" color="text.secondary">
                Nothing ticked. Logging still works, but loads won’t be checked.
              </AppText>
            ) : null}
            <PrimaryButton label={ticked === 0 ? 'Save empty gym' : 'Save gym'} busy={saving} onPress={() => void save(draft)} />
          </>
        }
      >
        <Group>
          {draft.items.map((item) => (
            <ChecklistRow
              key={item.key}
              title={item.label}
              checked={item.ticked}
              tag={item.ticked ? 'Typical values, not checked' : null}
              onToggle={() => {
                setDraft((d) => (d === null ? d : toggleDraftItem(d, item.key)));
                setEdited(true);
              }}
            />
          ))}
        </Group>
        <AppText variant="callout" color="text.secondary">
          You can check the numbers at the gym. Until then they’re marked “not checked”. Editing each item’s numbers comes with the gym editor.
        </AppText>
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      </StepFrame>
    );
  }

  return (
    <StepFrame
      step={step}
      title="Where do you train most?"
      explanation="Pick the closest match. You’ll check the equipment next."
      onBack={onBack}
      footer={
        <PrimaryButton
          label={presetId === null ? 'Choose a starting point' : 'Continue'}
          disabled={presetId === null || nameEmpty}
          busy={saving}
          onPress={next}
        />
      }
    >
      <View style={{ gap: theme.space['2'] }}>
        <AppText variant="label" color="text.secondary" nativeID="gym-name-label">
          Gym name
        </AppText>
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel="Gym name"
          accessibilityLabelledBy="gym-name-label"
          returnKeyType="done"
          maxLength={120}
          maxFontSizeMultiplier={theme.type.body.maxFontSizeMultiplier}
          style={{
            minHeight: 52,
            paddingHorizontal: theme.space['3'],
            borderRadius: theme.radius.sm,
            borderWidth: nameEmpty ? 2 : 1,
            borderColor: nameEmpty ? theme.colors['status.warning'] : theme.colors['border.control'],
            backgroundColor: theme.colors['bg.raised'],
            color: theme.colors['text.primary'],
            fontSize: theme.type.body.fontSize,
          }}
        />
        {nameEmpty ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Give the gym a name" /> : null}
      </View>
      <View style={{ gap: theme.space['2'] }} accessibilityRole="radiogroup">
        {presets.map((p) => (
          <ChoiceCard key={p.id} title={p.title} subtitle={p.subtitle} selected={presetId === p.id} onPress={() => { choose(p.id); }} />
        ))}
      </View>
      {onSkip ? <TextButton label="Skip for now: you’ll add a gym before your first workout" tone="secondary" onPress={onSkip} /> : null}
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
    </StepFrame>
  );
}
