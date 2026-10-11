import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clockText, finishByChoices, stepFinishBy, toIso, type TimeLeftSheetView, type TimeLeftView } from '@fizz/domain';

import { haptic } from '../../device/haptics';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, Icon, SecondaryButton, StatusLine, Tag, TextButton } from '../../ui';

/**
 * `TimeLeftLine` and the `Time left` sheet (active-workout.md §2.15). Every
 * word comes from the domain (`timeLeftLine`, `timeLeftSheet`); nothing is
 * worked out here. It's an estimate: worded `about`, never a countdown, and
 * it never changes a set. `Shorten to fit…` is build step 4 and absent.
 */

export function TimeLeftLine({ view, onPress }: { view: TimeLeftView; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={view.line.accessibilityLabel}
      accessibilityHint="Shows how the estimate is worked out"
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name="clock" color="text.secondary" size={16} />
      <AppText variant="callout" color="text.secondary" numeric>
        {view.line.text}
      </AppText>
    </Pressable>
  );
}

function Row({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space['3'] }} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="label" color="text.secondary" style={{ width: 104 }}>
        {label}
      </AppText>
      <View style={{ flex: 1, gap: theme.space['1'] }}>
        <AppText variant="callout" numeric>
          {value}
        </AppText>
        {children}
      </View>
    </View>
  );
}

const STEPS = [-15, -5, 5, 15] as const;

export function TimeLeftSheet({
  visible,
  view,
  sheet,
  nowMs,
  tz,
  onClose,
  onFinishBy,
}: {
  visible: boolean;
  view: TimeLeftView | null;
  sheet: TimeLeftSheetView | null;
  nowMs: number;
  tz: string;
  onClose: () => void;
  /** `null` = `Not set`. Resolves with an error message when it wasn't saved. */
  onFinishBy: (finishByUtc: string | null) => Promise<string | null>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const current = view?.estimate.finishBy ?? null;
  const [valueMs, setValueMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setValueMs(null);
    setError(null);
  }, [visible]);

  const choices = finishByChoices(nowMs, current, view?.estimate.endsAt ?? null);
  const shownMs = valueMs ?? choices.initialMs;
  const step = (m: number) => {
    haptic('step');
    setValueMs(stepFinishBy(shownMs, m, choices));
  };
  async function save(utc: string | null) {
    setSaving(true);
    const message = await onFinishBy(utc);
    setSaving(false);
    setError(message);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }}>
        <ScrollView contentContainerStyle={{ padding: theme.space['4'], paddingBottom: theme.space['4'] + insets.bottom, gap: theme.space['4'] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText variant="title2" accessibilityRole="header">
              Time left
            </AppText>
            <TextButton label="Done" onPress={onClose} />
          </View>
          {view === null || sheet === null ? (
            <AppText variant="callout" color="text.secondary">
              All sets are done.
            </AppText>
          ) : (
            <>
              <View style={{ gap: theme.space['1'] }}>
                <AppText variant="title2" numeric accessibilityLabel={`Estimate: ${sheet.headline}`}>
                  {sheet.headline}
                </AppText>
                {sheet.endsLine ? (
                  <AppText variant="callout" numeric>
                    {sheet.endsLine}
                  </AppText>
                ) : null}
              </View>
              <View style={{ gap: theme.space['3'] }}>
                <Row label="Left to do" value={sheet.leftToDo} />
                <Row label="Planned rest" value={sheet.plannedRest} />
                <Row label="Your pace" value={sheet.pace}>
                  <Tag text={sheet.paceSource} />
                  {sheet.changeoverSource ? <Tag text={`Between exercises: ${sheet.changeoverSource}`} /> : null}
                </Row>
                <Row label="So far" value={sheet.soFar} />
              </View>

              <View style={{ gap: theme.space['2'] }}>
                <Row label="Finish by" value={sheet.finishBy} />
                <ChipRow>
                  {STEPS.map((m) => (
                    <Chip
                      key={m}
                      label={`${m < 0 ? '−' : '+'}${String(Math.abs(m))} min`}
                      accessibilityLabel={`${m < 0 ? 'Earlier' : 'Later'} by ${String(Math.abs(m))} minutes`}
                      selected={false}
                      onPress={() => {
                        step(m);
                      }}
                    />
                  ))}
                </ChipRow>
                <SecondaryButton
                  label={`Finish by ${clockText(shownMs, tz)}`}
                  disabled={saving || (current !== null && valueMs === null)}
                  onPress={() => void save(toIso(shownMs))}
                />
                {current !== null ? <TextButton label="Not set" tone="secondary" onPress={() => void save(null)} /> : null}
                {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
