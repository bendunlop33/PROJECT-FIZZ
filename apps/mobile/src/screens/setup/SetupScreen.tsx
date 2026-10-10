import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { WeightUnit } from '@fizz/schemas';

import { useDataChanged, useServices } from '../../shell/context';
import { measurementSystem } from '../../device/runtime';
import { formatClock } from '../../format/numbers';
import type { SetupStep } from '../../services/setup';
import { DEFAULT_REST_PRESETS, unitFromMeasurementSystem } from '../../services/setup';
import { useTheme } from '../../theme';
import { AppText, ChoiceCard, Eyebrow, Group, PrimaryButton, Row, StatusLine, TextButton } from '../../ui';
import { SaveCopyToFiles } from '../data/SaveCopyToFiles';
import { GymSetupFlow, type SavedGymSummary } from './GymSetupFlow';
import { StepFrame } from './StepFrame';

type Step = Exclude<SetupStep, 'done'> | 'ready';

/** `Main gym · 4 items (4 not checked)` */
function describeGym(gym: SavedGymSummary): string {
  return `${gym.name} · ${gym.items === 0 ? 'no equipment yet' : `${String(gym.items)} items${gym.notChecked > 0 ? ` (${String(gym.notChecked)} not checked)` : ''}`}`;
}

const REST_LINE = DEFAULT_REST_PRESETS.map((p) => formatClock(p.seconds)).join(' / ');

/**
 * First run, Essentials only (onboarding.md §2.1–2.6): Welcome → How you log
 * → Your gym → How your data is kept → Ready → Today. No permission prompts.
 * Each step writes on Continue, so a force-close resumes at the right step.
 * Welcome's `Restore from a backup` opens the restore flow before any setup
 * (onboarding OB3). Not in this build: editing rest presets here, and the
 * optional About-your-training and coach steps.
 */
export function SetupScreen({ initialStep, initialUnit, onDone }: { initialStep: Exclude<SetupStep, 'done'>; initialUnit: WeightUnit | null; onDone: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const [step, setStep] = useState<Step>(initialStep);
  const [unit, setUnit] = useState<WeightUnit>(initialUnit ?? unitFromMeasurementSystem(measurementSystem()));
  const [gym, setGym] = useState<SavedGymSummary | 'skipped' | null>(null);
  const [copySaved, setCopySaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(write: () => Promise<{ ok: true } | { ok: false; message: string }>, next: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await write();
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    changed();
    next();
  }

  // Resumed after a force-close: describe the gym from what was saved.
  useEffect(() => {
    if (step !== 'ready' || gym !== null) return;
    const run = { alive: true };
    void (async () => {
      const current = await services.yourData.currentGym();
      const items = current ? await services.yourData.equipment(current.id) : [];
      if (!run.alive) return;
      setGym(
        current === null
          ? 'skipped'
          : { name: current.name, items: items.length, notChecked: items.filter((i) => i.detailsSource === 'preset').length },
      );
    })();
    return () => {
      run.alive = false;
    };
  }, [step, gym, services]);

  const errorLine = error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null;

  switch (step) {
    case 'welcome':
      return (
        <StepFrame
          step={null}
          title="Set up your training log"
          explanation="Takes about 2 minutes. Everything is saved on this phone. Nothing needs an account or the internet."
          footer={
            <>
              <PrimaryButton
                label="Set up"
                onPress={() => {
                  setStep('units');
                }}
              />
              <TextButton
                label="Restore from a backup"
                onPress={() => {
                  navigation.navigate('WelcomeRestore');
                }}
              />
            </>
          }
        >
          <View>
            <View style={{ marginBottom: theme.space['2'] }}>
              <Eyebrow>You’ll set</Eyebrow>
            </View>
            {['Units and rest times', 'Your gym’s equipment', 'How your data is kept'].map((t, i, all) => (
              <View
                key={t}
                accessible
                accessibilityLabel={`${String(i + 1)}. ${t}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space['3'],
                  minHeight: 52,
                  borderTopWidth: theme.dividerWidth,
                  borderBottomWidth: i === all.length - 1 ? theme.dividerWidth : 0,
                  borderColor: theme.colors['border.divider'],
                }}
              >
                <AppText variant="body" color="text.tertiary" numeric style={{ minWidth: 18 }}>
                  {String(i + 1)}
                </AppText>
                <AppText variant="body">{t}</AppText>
              </View>
            ))}
          </View>
          <AppText variant="callout" color="text.secondary">
            Coach, goals and history import are optional and can come later.
          </AppText>
        </StepFrame>
      );

    case 'units':
      return (
        <StepFrame
          step="Step 1 of 3"
          title="How you log"
          explanation="You can change these any time in Profile."
          onBack={() => {
            setStep('welcome');
          }}
          footer={
            <PrimaryButton
              label="Continue"
              busy={busy}
              onPress={() =>
                void run(
                  () => services.setup.saveUnits(unit),
                  () => {
                    setStep('gym');
                  },
                )
              }
            />
          }
        >
          <View style={{ gap: theme.space['2'] }}>
            <Eyebrow>Weights in</Eyebrow>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }} accessibilityRole="radiogroup">
              <View style={{ flexGrow: 1, flexBasis: 150 }}>
                <ChoiceCard title="Kilograms (kg)" selected={unit === 'kg'} onPress={() => { setUnit('kg'); }} />
              </View>
              <View style={{ flexGrow: 1, flexBasis: 150 }}>
                <ChoiceCard title="Pounds (lb)" selected={unit === 'lb'} onPress={() => { setUnit('lb'); }} />
              </View>
            </View>
            <AppText variant="callout" color="text.secondary">
              Picked from your phone’s region. Each piece of equipment keeps its own unit, so a kg gym and a lb gym both work.
            </AppText>
          </View>
          <View style={{ gap: theme.space['2'] }}>
            <Eyebrow>Rest times</Eyebrow>
            <AppText variant="callout" color="text.secondary">
              Starting points, not advice.
            </AppText>
            <Group>
              {DEFAULT_REST_PRESETS.map((p) => (
                <Row key={p.presetName} title={p.presetName === 'Standard' ? 'Standard (default)' : p.presetName} trailing={<AppText variant="body" numeric>{formatClock(p.seconds)}</AppText>} />
              ))}
            </Group>
          </View>
          {errorLine}
        </StepFrame>
      );

    case 'gym':
      // Back over a saved gym (review B1, PM SP3): shown read-only until the
      // gym editor's updateGym exists. Saving again would create a second gym.
      if (gym !== null && gym !== 'skipped') {
        return (
          <StepFrame
            step="Step 2 of 3"
            title="Gym saved"
            explanation="You can edit it later in the gym editor."
            onBack={() => {
              setStep('units');
            }}
            footer={
              <PrimaryButton
                label="Continue"
                onPress={() => {
                  setStep('data');
                }}
              />
            }
          >
            <StatusLine icon="checkmark.circle.fill" tone="done" text={describeGym(gym)} />
          </StepFrame>
        );
      }
      return (
        <GymSetupFlow
          unit={unit}
          step="Step 2 of 3"
          onBack={() => {
            setStep('units');
          }}
          onSkip={() =>
            // Audit B4: "skip" still leaves a usable gym, a typical one marked not checked.
            void run(
              () => services.setup.useTypicalGym(),
              () => {
                void (async () => {
                  const current = await services.yourData.currentGym();
                  const items = current ? await services.yourData.equipment(current.id) : [];
                  setGym(current === null ? 'skipped' : { name: current.name, items: items.length, notChecked: items.filter((i) => i.detailsSource === 'preset').length });
                })();
                setStep('data');
              },
            )
          }
          onSaved={(summary) => {
            setGym(summary);
            setStep('data');
          }}
        />
      );

    case 'data':
      return (
        <StepFrame
          step="Step 3 of 3"
          title="How your data is kept"
          onBack={
            gym === null
              ? undefined
              : () => {
                  setStep('gym');
                }
          }
          onSkip={() => {
            setStep('ready');
          }}
          footer={
            <PrimaryButton
              label="Continue"
              onPress={() => {
                setStep('ready');
              }}
            />
          }
        >
          <AppText variant="body">Your data is saved and backed up on this phone.</AppText>
          <AppText variant="body">
            Copies on the phone are lost if the app is deleted or re-signed with a different Apple ID. You can save a copy to Files any time.
          </AppText>
          <SaveCopyToFiles variant="row" label="Save a copy to Files now" onSaved={setCopySaved} />
        </StepFrame>
      );

    case 'ready': {
      const gymLine = gym === null || gym === 'skipped' ? null : describeGym(gym);
      return (
        <StepFrame
          step={null}
          title="You’re ready to log"
          footer={<PrimaryButton label="Go to Today" busy={busy} onPress={() => void run(() => services.setup.complete(), onDone)} />}
        >
          <View style={{ gap: theme.space['2'] }}>
            <StatusLine icon="checkmark.circle.fill" tone="done" text={`Units: ${unit} · Rest ${REST_LINE}`} />
            {gymLine === null ? (
              <StatusLine icon="info.circle" tone="info" text={gym === 'skipped' ? 'No gym yet' : 'Gym saved'} />
            ) : (
              <StatusLine icon="checkmark.circle.fill" tone="done" text={gymLine} />
            )}
            <StatusLine icon="checkmark.circle.fill" tone="done" text="Saved on this phone · backups run after each workout" />
            {copySaved ? <StatusLine icon="externaldrive.fill.badge.checkmark" tone="done" text={`Copy saved to Files · ${copySaved}`} /> : null}
          </View>
          {errorLine}
        </StepFrame>
      );
    }
  }
}
