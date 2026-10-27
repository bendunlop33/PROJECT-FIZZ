import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { CHANGE_PLAN_COPY as C, type ChangePlanAction, type ChangePlanView } from '../../library/change-plan-view';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Eyebrow, Group, Icon, SecondaryButton, TextButton } from '../../ui';

/**
 * (Redesign 27 Oct, D4) The **Change plan** sheet behind Library › Plan's `Edit plan`: Days and time (its line),
 * Goal, A day's exercises, ✦ Ask the coach, End plan (red), then `Close`. End plan asks first in the same sheet:
 * `End plan?` · `Week 3 of 6 · history kept` · End plan / Keep plan. Draws `changePlanView`; every action is the
 * caller's (nothing is written here).
 */
export function ChangePlanSheet({ visible, title, view, onAction, onClose }: { visible: boolean; title: string; view: ChangePlanView; onAction: (a: ChangePlanAction) => void; onClose: () => void }) {
  const theme = useTheme();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!visible) setConfirm(false);
  }, [visible]);

  if (confirm) {
    return (
      <BottomCard visible={visible} onClose={onClose} scroll={false}>
        <View style={{ gap: theme.space['1'], alignItems: 'center' }}>
          <AppText variant="title2" accessibilityRole="header" align="center">
            {C.endTitle}
          </AppText>
          <AppText variant="callout" color="text.secondary" numeric align="center">
            {view.endLine}
          </AppText>
        </View>
        <View style={{ gap: theme.space['2'] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={C.endPlan}
            onPress={() => {
              onAction({ kind: 'end' });
            }}
            style={({ pressed }) => ({ minHeight: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors['status.danger'], opacity: pressed ? 0.8 : 1 })}
          >
            <AppText variant="headline" color="on.accent">
              {C.endPlan}
            </AppText>
          </Pressable>
          <SecondaryButton
            label={C.keepPlan}
            onPress={() => {
              setConfirm(false);
            }}
          />
        </View>
      </BottomCard>
    );
  }

  const row = (label: string, value: string | null, onPress: () => void, opts: { icon?: 'sparkles'; danger?: boolean } = {}) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={value === null ? label : `${label}, ${value}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], paddingHorizontal: theme.space['4'], paddingVertical: theme.space['2'], opacity: pressed ? 0.7 : 1 })}
    >
      {opts.icon !== undefined ? <Icon name={opts.icon} color="accent" size={16} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" color={opts.danger === true ? 'status.danger' : 'text.primary'} style={opts.danger === true ? { fontWeight: '600' } : undefined}>
          {label}
        </AppText>
        {value !== null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {value}
          </AppText>
        ) : null}
      </View>
      {opts.danger === true ? null : <Icon name="chevron.right" color="text.tertiary" size={14} />}
    </Pressable>
  );

  return (
    <BottomCard visible={visible} onClose={onClose} footer={<TextButton label={C.close} tone="secondary" onPress={onClose} />}>
      <View style={{ gap: 2 }}>
        <AppText variant="title2" accessibilityRole="header">
          {C.title}
        </AppText>
        <AppText variant="callout" color="text.secondary">
          {title}
        </AppText>
      </View>
      <Group>
        {[
          ...(view.daysAndTime !== null ? [row(C.daysAndTime, view.daysAndTime, () => { onAction({ kind: 'week' }); })] : []),
          row(C.goal, view.goal, () => {
            onAction({ kind: 'goal' });
          }),
        ]}
      </Group>
      {view.days.length > 0 ? (
        <View style={{ gap: theme.space['2'] }}>
          <View accessibilityRole="header">
            <Eyebrow>{C.dayExercises}</Eyebrow>
          </View>
          <Group>
            {view.days.map((d) =>
              row(d.name, null, () => {
                onAction({ kind: 'day', routineId: d.routineId });
              }),
            )}
          </Group>
        </View>
      ) : null}
      <Group>
        {row(C.askCoach, null, () => {
          onAction({ kind: 'coach' });
        }, { icon: 'sparkles' })}
      </Group>
      <Group>
        {row(C.endPlan, null, () => {
          setConfirm(true);
        }, { danger: true })}
      </Group>
    </BottomCard>
  );
}

/** The full-width `Edit plan` at the bottom of Library › Plan (D4); `Start next block` once the block is done. */
export function EditPlanButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <SecondaryButton label={label} onPress={onPress} />;
}
