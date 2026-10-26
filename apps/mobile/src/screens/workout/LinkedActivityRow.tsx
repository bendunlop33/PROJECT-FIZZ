import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { HEALTH_COPY, type WorkoutHealthView } from '../../health/health-view';
import { newUuid } from '../../device/runtime';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, DangerTextButton, Icon, StatusLine, TextButton, TEXT_PRESSED_OPACITY, Toast } from '../../ui';

/**
 * (Ben, 27 Oct; apple-health.md §2.3) The Summary's and a past workout's `Linked activity` row: the watch's
 * actuals for this workout (source, duration, avg/max heart rate when `Heart rate on linked workouts` is on),
 * labelled with their source and never merged with the app's own numbers (rule 6); or the question `Link to this
 * workout?` (Link / Not it) when Health has a near match; or nothing. Unlink is in the row's sheet, with Undo.
 */
export function LinkedActivityRow({ sessionId }: { sessionId: string }) {
  const theme = useTheme();
  const services = useServices();
  const [view, setView] = useState<WorkoutHealthView>({ kind: 'none' });
  const [sheet, setSheet] = useState(false);
  const [choose, setChoose] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const op = useRef(newUuid());

  const load = useCallback(() => {
    void services.health.forWorkout(sessionId).then(setView, () => {
      setView({ kind: 'none' });
    });
  }, [services, sessionId]);
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
    setToast({ text: HEALTH_COPY.linked, undo: () => void unlink(r.healthUuid, r.version, false) });
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
    setToast(offerUndo ? { text: HEALTH_COPY.unlinked, undo: () => void link(healthUuid) } : null);
    load();
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

  if (view.kind === 'none') return toastView;

  const box = { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors['border.divider'], padding: theme.space['3'], gap: theme.space['1'] } as const;

  if (view.kind === 'linked') {
    return (
      <>
        {toastView}
        <Pressable accessibilityRole="button" accessibilityLabel={view.accessibilityLabel} onPress={() => { setSheet(true); }} style={({ pressed }) => ({ ...box, opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <Icon name="heart.fill" size={14} color="text.secondary" />
            <AppText variant="body" numeric style={{ flex: 1 }}>
              {view.line}
            </AppText>
            <Icon name="chevron.right" size={14} color="text.tertiary" />
          </View>
          {view.heartRate !== null ? (
            <AppText variant="callout" color="text.secondary" numeric>
              {view.heartRate}
            </AppText>
          ) : null}
        </Pressable>
        <BottomCard
          visible={sheet}
          onClose={() => {
            setSheet(false);
          }}
          footer={
            <>
              {message !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={message} /> : null}
              <DangerTextButton label={HEALTH_COPY.unlink} onPress={() => void unlink(view.healthUuid, view.linkVersion)} />
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
              {view.heartRate.replace(/(\d+)/g, '$1 bpm')}
            </AppText>
          ) : null}
        </BottomCard>
      </>
    );
  }

  const [first, ...rest] = view.candidates;
  if (first === undefined) return toastView;
  return (
    <>
      {toastView}
      <View style={box}>
        {rest.length === 0 || choose ? (
          (choose ? view.candidates : [first]).map((c) => (
            <View key={c.healthUuid} style={{ gap: theme.space['1'] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }} accessible accessibilityLabel={c.accessibilityLabel}>
                <Icon name="heart.fill" size={14} color="text.secondary" />
                <AppText variant="body" numeric style={{ flex: 1 }}>
                  {c.line}
                </AppText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
                {choose ? null : (
                  <AppText variant="callout" color="text.secondary" style={{ flex: 1 }}>
                    {HEALTH_COPY.linkQuestion}
                  </AppText>
                )}
                <TextButton label={HEALTH_COPY.link} onPress={() => void link(c.healthUuid)} />
                <TextButton label={HEALTH_COPY.notIt} tone="secondary" onPress={() => void notIt(c.healthUuid)} />
              </View>
            </View>
          ))
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <Icon name="heart.fill" size={14} color="text.secondary" />
            <AppText variant="body" style={{ flex: 1 }}>{`${String(view.candidates.length)} activities from Health · Link one?`}</AppText>
            <TextButton
              label="Choose ›"
              onPress={() => {
                setChoose(true);
              }}
            />
          </View>
        )}
        {message !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={message} /> : null}
      </View>
    </>
  );
}
