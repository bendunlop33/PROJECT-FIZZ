import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { HEALTH_COPY, type LinkCandidateView, type WorkoutHealthView } from '../../health/health-view';
import { newUuid } from '../../device/runtime';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, DangerTextButton, Group, Icon, Row, StatusLine, TextButton, TEXT_PRESSED_OPACITY, Toast } from '../../ui';

/**
 * (Ben, 27 Oct; apple-health.md §2.3) The Summary's and a past workout's `Linked activity` row.
 *
 * - Linked: the watch's actuals for this workout (source, minutes, avg/max heart rate when `Heart rate on linked
 *   workouts` is on, active energy if recorded), labelled with their source and never merged with the app's own
 *   numbers (rule 6). Its sheet has Unlink, with Undo.
 * - Not linked, Health has a strength workout that day: one tap, TrainingPeaks-style (Ben: "TrainingPeaks lets you
 *   just click Pair or Link"). One candidate: `Link` links at once with an Undo toast; several: `Link` opens a short
 *   pick list (time · source · type · min). `Not it` stays as a small secondary.
 * - `⋯ › Link activity from Health` (`pickerOpen`): the day before to the day after, any strength or `other` workout.
 * - Nothing: no row.
 */
export function LinkedActivityRow({ sessionId, pickerOpen = false, onPickerClose, onChoices, onTimesChanged }: { sessionId: string; pickerOpen?: boolean; onPickerClose?: () => void; onChoices?: (n: number) => void; /** The workout's times changed (`Use watch times` or its Undo): the Summary reloads. */ onTimesChanged?: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [view, setView] = useState<WorkoutHealthView>({ kind: 'none' });
  const [choices, setChoices] = useState<LinkCandidateView[]>([]);
  const [sheet, setSheet] = useState(false);
  const [choose, setChoose] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const op = useRef(newUuid());

  const load = useCallback(() => {
    void services.health.forWorkout(sessionId).then(setView, () => {
      setView({ kind: 'none' });
    });
    void services.health.linkChoices(sessionId).then(
      (c) => {
        setChoices(c);
        onChoices?.(c.length);
      },
      () => {
        setChoices([]);
        onChoices?.(0);
      },
    );
  }, [services, sessionId, onChoices]);
  useEffect(load, [load]);

  const fresh = () => {
    op.current = newUuid();
  };

  async function link(healthUuid: string) {
    const r = await services.health.link({ healthUuid, sessionId, opId: op.current });
    fresh();
    if (!r.ok) {
      setMessage(r.message);
      return;
    }
    setMessage(null);
    setChoose(false);
    onPickerClose?.();
    setToast({ text: HEALTH_COPY.paired, undo: () => void unlink(r.healthUuid, r.version, false) });
    changed();
    load();
  }

  async function unlink(healthUuid: string, version: number, offerUndo = true) {
    const r = await services.health.unlink({ healthUuid, expectedVersion: version, opId: op.current });
    fresh();
    if (!r.ok) {
      setMessage(r.message);
      return;
    }
    setSheet(false);
    setToast(offerUndo ? { text: HEALTH_COPY.unpaired, undo: () => void link(healthUuid) } : null);
    changed();
    load();
  }

  async function applyWatchTimes() {
    const r = await services.health.useWatchTimes(sessionId, op.current);
    fresh();
    if (!r.ok) {
      setToast({ text: r.message });
      return;
    }
    changed();
    load();
    onTimesChanged?.();
    setToast({
      text: HEALTH_COPY.timesChanged,
      undo: () =>
        void r.undo().then((u) => {
          changed();
          load();
          onTimesChanged?.();
          if (!u.ok) setToast({ text: u.message ?? HEALTH_COPY.failed });
        }),
    });
  }

  async function notIt(healthUuid: string) {
    const r = await services.health.notIt({ healthUuid, sessionId, opId: op.current });
    fresh();
    if (!r.ok) setMessage(r.message);
    load();
  }

  const toastView =
    toast !== null ? (
      <Toast
        text={toast.text}
        {...(toast.undo !== undefined
          ? {
              action: HEALTH_COPY.undo,
              onAction: () => {
                const u = toast.undo;
                setToast(null);
                u?.();
              },
            }
          : {})}
        onDismiss={() => {
          setToast(null);
        }}
      />
    ) : null;

  const picker = (
    <BottomCard
      visible={pickerOpen}
      onClose={() => {
        onPickerClose?.();
      }}
      footer={message !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={message} /> : null}
    >
      <AppText variant="title2">{HEALTH_COPY.linkFromHealth}</AppText>
      <Group>
        {choices.map((c) => (
          <Row key={c.healthUuid} title={c.line} trailing={<TextButton label={HEALTH_COPY.pair} accessibilityLabel={`${HEALTH_COPY.pair}, ${c.accessibilityLabel}`} onPress={() => void link(c.healthUuid)} />} />
        ))}
      </Group>
    </BottomCard>
  );

  const box = { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors['border.divider'], padding: theme.space['3'], gap: theme.space['2'] } as const;

  if (view.kind === 'none') {
    return (
      <>
        {toastView}
        {picker}
      </>
    );
  }

  if (view.kind === 'linked') {
    return (
      <>
        {toastView}
        {picker}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={view.accessibilityLabel}
          onPress={() => {
            setSheet(true);
          }}
          style={({ pressed }) => ({ ...box, opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <Icon name="heart.fill" size={14} color="text.secondary" />
            <AppText variant="body" numeric style={{ flex: 1 }}>
              {view.line}
            </AppText>
            <TextButton label={HEALTH_COPY.unpair} tone="secondary" onPress={() => void unlink(view.healthUuid, view.linkVersion)} />
          </View>
          {view.heartRate !== null ? (
            <AppText variant="callout" color="text.secondary" numeric>
              {view.heartRate}
            </AppText>
          ) : null}
        </Pressable>
        {view.useWatchTimes === true ? (
          // (Ben, 27 Oct) Offered, never applied silently: the workout takes the watch's start and end, with Undo.
          <View style={{ alignSelf: 'flex-start' }}>
            <TextButton label={HEALTH_COPY.useWatchTimes} tone="secondary" onPress={() => void applyWatchTimes()} />
          </View>
        ) : null}
        <BottomCard
          visible={sheet}
          onClose={() => {
            setSheet(false);
          }}
          footer={
            <>
              {message !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={message} /> : null}
              <DangerTextButton label={HEALTH_COPY.unpair} onPress={() => void unlink(view.healthUuid, view.linkVersion)} />
            </>
          }
        >
          <AppText variant="title2">{HEALTH_COPY.linkedActivity}</AppText>
          <AppText variant="body">{view.sheetTitle}</AppText>
          <AppText variant="callout" color="text.secondary" numeric>
            {view.sheetWhen}
          </AppText>
          {view.heartRate !== null ? (
            <AppText variant="body" numeric>
              {view.heartRate.replace(/(Avg HR \d+|Max \d+)/g, '$1 bpm')}
            </AppText>
          ) : null}
        </BottomCard>
      </>
    );
  }

  const [first] = view.candidates;
  if (first === undefined) return toastView;
  const several = view.candidates.length > 1;
  return (
    <>
      {toastView}
      {picker}
      <View style={box}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <Icon name="heart.fill" size={14} color="text.secondary" />
          <AppText variant="body" numeric style={{ flex: 1 }} accessibilityLabel={several ? `${String(view.candidates.length)} activities from Apple Health` : first.accessibilityLabel}>
            {several ? `${String(view.candidates.length)} activities from Health` : first.line}
          </AppText>
          {/* One tap: links at once (one), or opens the short pick list (several). */}
          <TextButton
            label={HEALTH_COPY.pair}
            onPress={() => {
              if (several) setChoose((c) => !c);
              else void link(first.healthUuid);
            }}
          />
        </View>
        {several && choose
          ? view.candidates.map((c) => (
              <View key={c.healthUuid} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
                <AppText variant="callout" numeric style={{ flex: 1 }} accessibilityLabel={c.accessibilityLabel}>
                  {c.line}
                </AppText>
                <TextButton label={HEALTH_COPY.pair} accessibilityLabel={`${HEALTH_COPY.pair}, ${c.accessibilityLabel}`} onPress={() => void link(c.healthUuid)} />
              </View>
            ))
          : null}
        {several ? null : (
          <View style={{ alignSelf: 'flex-start' }}>
            <TextButton label={HEALTH_COPY.notIt} tone="secondary" onPress={() => void notIt(first.healthUuid)} />
          </View>
        )}
        {message !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={message} /> : null}
      </View>
    </>
  );
}
