import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PB_EDIT_COPY, PLAN_MUSCLES_COPY, type PlanMuscleBar } from '@fizz/domain';

import { haptic } from '../../device/haptics';
import { newUuid } from '../../device/runtime';
import type { PlanMusclesData, RebalanceCardData } from '../../services/plan-muscles-service';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Card, Chip, Eyebrow, PrimaryButton, StatusLine, TextButton, Toast, ToastHost, toastBottom } from '../../ui';
import { MuscleBar } from '../../ui/muscle-bar';

/**
 * (Ben, 1 Nov; docs/design/plan-muscles.md, prototype `plan-muscles.html`) Library › Plan › **Muscles**: the plan's
 * working sets per week by muscle group, planned only (Library looks forward, Progress looks back). The week circles
 * and `Block avg`; one bar per group (direct sets, the goal range shaded, green in range, amber outside it, neutral on a
 * deload, the lead-in or a week with a day skipped) with the week's done-so-far as a thin marker; `Done by week ›`
 * opens Progress › Training on that week. Out of range on the typical week: the gap lines and **Rebalance** (one card
 * for the whole plan: each change a line, the bars and day lengths before → after, Why?, Apply, then Undo). Lays out
 * `services.planMuscles`; computes nothing. Local only (rule 1).
 */
export function PlanMusclesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const [selected, setSelected] = useState<string | null>(null);
  const [data, reload] = useScreenData((s) => s.planMuscles.muscles(selected));
  const [open, setOpen] = useState<string | null>(null);
  const [rebalancing, setRebalancing] = useState(false);
  const [toast, setToast] = useState<{ text: string; action?: string; onAction?: () => void } | null>(null);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new week chip reads again
  }, [selected]);
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  const value: PlanMusclesData | null = data.state === 'ready' ? data.value : null;
  const v = value?.view ?? null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['8'] + insets.bottom, gap: theme.space['4'] }}>
        {data.state === 'error' ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t load muscles." action={<TextButton label="Try again" onPress={reload} />} /> : null}
        {data.state === 'ready' && value === null ? (
          <AppText variant="body" color="text.secondary">
            No plan in use.
          </AppText>
        ) : null}
        {v !== null && value !== null ? (
          <>
            {v.chips.length > 1 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }} accessibilityRole="tablist">
                {v.chips.map((c) => (
                  <Chip
                    key={c.key}
                    size="min"
                    label={c.label}
                    selected={c.selected}
                    accessibilityLabel={c.accessibilityLabel}
                    onPress={() => {
                      setSelected(c.key);
                    }}
                  />
                ))}
              </View>
            ) : null}
            <Card style={{ gap: theme.space['3'] }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space['2'] }}>
                <View accessibilityRole="header">
                  <Eyebrow>{PLAN_MUSCLES_COPY.setsPerWeek}</Eyebrow>
                </View>
                {v.note !== null ? (
                  <AppText variant="callout" color="text.secondary">
                    {v.note}
                  </AppText>
                ) : null}
              </View>
              {v.bars.map((b) => (
                <BarRow
                  key={b.group}
                  bar={b}
                  open={open === b.group}
                  onPress={() => {
                    setOpen((o) => (o === b.group ? null : b.group));
                  }}
                />
              ))}
              {v.hasDone && value.doneWeekOf !== null ? (
                <TextButton
                  label={`${PLAN_MUSCLES_COPY.doneByWeek} ›`}
                  tone="secondary"
                  onPress={() => {
                    navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressHome', params: value.doneWeekOf === null ? undefined : { weekOf: value.doneWeekOf } } });
                  }}
                />
              ) : null}
            </Card>
            {v.flagLines.length > 0 ? (
              <View style={{ backgroundColor: theme.colors['status.warning.subtle'], borderRadius: theme.radius.lg, padding: theme.space['3'], gap: theme.space['2'] }}>
                {v.flagLines.map((l) => (
                  <AppText key={l} variant="callout" color="status.warning" numeric>
                    {l}
                  </AppText>
                ))}
                {value.canRebalance && !rebalancing ? (
                  <View style={{ alignSelf: 'flex-start' }}>
                    <TextButton
                      label={PLAN_MUSCLES_COPY.rebalance}
                      onPress={() => {
                        setRebalancing(true);
                      }}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
            {rebalancing ? (
              <RebalancePanel
                onDone={(t) => {
                  setRebalancing(false);
                  changed();
                  reload();
                  setToast(t);
                }}
                onCancel={() => {
                  setRebalancing(false);
                }}
                onToast={setToast}
                reloadAll={() => {
                  changed();
                  reload();
                }}
              />
            ) : null}
            <View style={{ gap: theme.space['2'] }}>
              <View accessibilityRole="header">
                <Eyebrow>{PLAN_MUSCLES_COPY.byDay}</Eyebrow>
              </View>
              {v.byDay.map((d) => (
                <View key={d.dayIndex} accessible accessibilityLabel={`${d.name}${d.skipped ? ', skipped' : ''}: ${d.chips.map((c) => c.text).join(', ')}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['3'], minHeight: 32 }}>
                  <AppText variant="callout" color={d.skipped ? 'text.tertiary' : 'text.primary'} style={{ width: 76 }}>
                    {d.name}
                  </AppText>
                  <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['1'] }}>
                    {d.chips.map((c) => (
                      <View key={c.group} style={{ borderRadius: 999, paddingHorizontal: theme.space['2'], paddingVertical: 2, backgroundColor: theme.colors['bg.raised'] }}>
                        <AppText variant="callout" color="text.secondary" numeric>
                          {c.text}
                        </AppText>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
      <ToastHost bottom={toastBottom({ footerHeight: null, insetBottom: insets.bottom, space2: theme.space['2'], tab: true })}>
        {toast !== null ? <Toast icon="checkmark.circle.fill" text={toast.text} {...(toast.action !== undefined && toast.onAction !== undefined ? { action: toast.action, onAction: toast.onAction } : {})} /> : null}
      </ToastHost>
    </View>
  );
}

/** One group: name, `+7 assisted`, the shared bar, the number; a tap shows its Why? line. */
function BarRow({ bar, open, onPress }: { bar: PlanMuscleBar; open: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={bar.words} accessibilityState={{ expanded: open }} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, gap: theme.space['1'], opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
        <AppText variant="body" style={{ width: 96 }} numberOfLines={1}>
          {bar.label}
        </AppText>
        <View style={{ flex: 1 }}>
          <MuscleBar look={bar.look} />
        </View>
        <AppText variant="body" numeric style={{ width: 40, textAlign: 'right' }}>
          {bar.valueText}
        </AppText>
      </View>
      {bar.assistedText !== null ? (
        <AppText variant="callout" color="text.tertiary" numeric>
          {bar.assistedText}
        </AppText>
      ) : null}
      {open ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {bar.why}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** Rebalance: the one card for the whole plan. Each line can be skipped; Apply writes them, Undo is the toast's. */
function RebalancePanel({ onDone, onCancel, onToast, reloadAll }: { onDone: (t: { text: string; action?: string; onAction?: () => void }) => void; onCancel: () => void; onToast: (t: { text: string } | null) => void; reloadAll: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set());
  const [card, reloadCard] = useScreenData((s) => s.planMuscles.rebalance(rejected));
  const [why, setWhy] = useState(false);
  const busy = useRef(false);
  const op = useRef<string | null>(null);
  useEffect(() => {
    reloadCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a skipped line reads again
  }, [rejected]);
  const c: RebalanceCardData | null = card.state === 'ready' ? card.value : null;
  if (card.state === 'error') return <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t work it out." action={<TextButton label="Try again" onPress={reloadCard} />} />;
  if (c === null) return null;

  function apply(x: RebalanceCardData) {
    if (busy.current) return;
    busy.current = true;
    haptic('step');
    op.current ??= newUuid();
    void services.planMuscles
      .apply({ planId: x.planId, expectedVersion: x.planVersion, rejected: [...rejected], opId: op.current })
      .then((r) => {
        op.current = null;
        if (!r.ok) {
          onToast({ text: r.message });
          reloadAll();
          return;
        }
        const undoOp = newUuid();
        onDone({
          text: PB_EDIT_COPY.applied,
          action: 'Undo',
          onAction: () => {
            void services.planMuscles.undo({ planId: r.planId, expectedVersion: r.version, opId: undoOp }).then((u) => {
              reloadAll();
              onToast({ text: u.ok ? PB_EDIT_COPY.undone : u.message });
            });
          },
        });
      })
      .finally(() => {
        busy.current = false;
      });
  }

  return (
    <Card style={{ gap: theme.space['2'] }}>
      <AppText variant="headline" accessibilityRole="header">
        {PLAN_MUSCLES_COPY.rebalance}
      </AppText>
      {c.empty ? (
        <AppText variant="callout" color="text.secondary">
          Nothing fits within your days’ time.
        </AppText>
      ) : null}
      {c.lines.map((l) => (
        <Pressable
          key={l.id}
          accessibilityRole="switch"
          accessibilityState={{ checked: l.accepted }}
          accessibilityLabel={`${l.text}, ${l.accepted ? 'accepted' : 'skipped'}`}
          onPress={() => {
            setRejected((s) => {
              const n = new Set(s);
              if (n.has(l.id)) n.delete(l.id);
              else n.add(l.id);
              return n;
            });
          }}
          style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], opacity: pressed ? 0.7 : 1 })}
        >
          <AppText variant="callout" numeric color={l.accepted ? 'text.primary' : 'text.tertiary'} style={{ flex: 1, ...(l.accepted ? {} : { textDecorationLine: 'line-through' }) }}>
            {l.text}
          </AppText>
          <AppText variant="callout" color={l.accepted ? 'status.done' : 'text.tertiary'}>
            {l.accepted ? PB_EDIT_COPY.accept : PB_EDIT_COPY.reject}
          </AppText>
        </Pressable>
      ))}
      {c.bars.length > 0 ? (
        <View style={{ gap: theme.space['1'], paddingTop: theme.space['2'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
          {c.bars.map((b) => (
            <AppText key={b.group} variant="callout" numeric color={b.statusAfter === 'in' ? 'status.done' : 'status.warning'}>
              {b.text}
            </AppText>
          ))}
        </View>
      ) : null}
      {c.minutes.length > 0 ? (
        <View style={{ gap: theme.space['1'] }}>
          {c.minutes.map((m) => (
            <AppText key={m.dayIndex} variant="callout" numeric color={m.over ? 'status.warning' : 'text.secondary'}>
              {m.text}
            </AppText>
          ))}
        </View>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Why? Rebalance" accessibilityState={{ expanded: why }} onPress={() => { setWhy((w) => !w); }} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <AppText variant="callout" color="text.secondary" style={{ textDecorationLine: 'underline' }}>
          Why?
        </AppText>
      </Pressable>
      {why
        ? c.why.map((l) => (
            <AppText key={l} variant="callout" color="text.secondary" numeric>
              {l}
            </AppText>
          ))
        : null}
      <PrimaryButton label={PB_EDIT_COPY.apply} disabled={!c.canApply} onPress={() => { apply(c); }} />
      <TextButton label="Skip" tone="secondary" onPress={onCancel} />
    </Card>
  );
}
