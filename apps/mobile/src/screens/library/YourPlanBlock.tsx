import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { PLAN_OVERVIEW_COPY, type PlanOverview, type PlanOverviewDay } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import type { LibraryStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Eyebrow, Icon, TextButton } from '../../ui';
import { LiftTargetsBlock } from './LiftTargetsBlock';

export type PlanToast = { text: string; action?: string; onAction?: () => void };

/**
 * Library › Workouts › Your plan (Ben, 19 Oct; mockup approved "ok"): the
 * plan in use, since when, the goal line (`Edit` / `Set goal` open Profile ›
 * Training details), its days in plan order with a state dot (✓ done this
 * week, a numbered ring for Up next, a plain ring to do), days this week and
 * planned sets done, then `Ask coach to change` and `End plan` (an in-page
 * confirm, then a toast with Undo). Every value comes from
 * `services.plans.overview()`; this draws it. Local only (rule 1).
 */
export function YourPlanBlock({ plan, onToast }: { plan: PlanOverview; onToast: (t: PlanToast | null) => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const stack = useNavigation<NativeStackNavigationProp<LibraryStackParams, 'LibraryHome'>>();
  const [confirming, setConfirming] = useState(false);
  const busy = useRef(false);
  // One op ID per confirm, so a retried tap is the same End (rule 5).
  const endOp = useRef<string | null>(null);

  function openTraining() {
    navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'TrainingDetails', initial: false } });
  }

  async function end() {
    if (busy.current) return;
    busy.current = true;
    endOp.current ??= newUuid();
    try {
      const r = await services.plans.end({ planId: plan.planId, expectedVersion: plan.planVersion, opId: endOp.current });
      setConfirming(false);
      endOp.current = null;
      changed();
      if (!r.ok) {
        onToast({ text: r.message });
        return;
      }
      const ended = r.plan;
      // One op ID per toast (review planview N1): a double tap on Undo is the same write, replayed.
      const resumeOp = newUuid();
      onToast({
        text: PLAN_OVERVIEW_COPY.ended,
        action: PLAN_OVERVIEW_COPY.undo,
        onAction: () => {
          onToast(null);
          void services.plans.resume({ planId: ended.id, expectedVersion: ended.version, opId: resumeOp }).then((u) => {
            changed();
            onToast({ text: u.ok ? PLAN_OVERVIEW_COPY.resumed : u.message });
          });
        },
      });
    } finally {
      busy.current = false;
    }
  }

  return (
    <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, padding: theme.space['4'], gap: theme.space['3'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space['2'] }} accessibilityRole="header">
        <Eyebrow color="text.secondary">{PLAN_OVERVIEW_COPY.label}</Eyebrow>
        <AppText variant="callout" color="text.secondary" numeric>
          {plan.since}
        </AppText>
      </View>
      <AppText variant="title2">{plan.name}</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['1'] }}>
        {plan.goal.text !== null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {`${plan.goal.text} ·`}
          </AppText>
        ) : null}
        <TextButton label={plan.goal.action} tone="secondary" accessibilityLabel={plan.goal.action === PLAN_OVERVIEW_COPY.edit ? 'Edit goal' : 'Set goal'} onPress={openTraining} />
      </View>
      <View>
        {plan.days.map((d, i) => (
          <DayRow
            key={d.routineId}
            day={d}
            first={i === 0}
            onPress={() => {
              stack.navigate('LibraryPlanDay', { routineId: d.routineId, name: d.name });
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
        <Stat value={plan.daysThisWeek.text} label={PLAN_OVERVIEW_COPY.daysThisWeek} />
        {plan.setsDone !== null ? <Stat value={plan.setsDone.text} label={PLAN_OVERVIEW_COPY.setsDone} /> : null}
      </View>
      {/* (Ben approved 20 Oct) Lift targets: nothing while the setting is off. */}
      <LiftTargetsBlock onToast={onToast} />
      {confirming ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['4'] }}>
          <AppText variant="callout">{PLAN_OVERVIEW_COPY.endConfirm}</AppText>
          <TextButton label={PLAN_OVERVIEW_COPY.endPlan} onPress={() => void end()} />
          <TextButton
            label={PLAN_OVERVIEW_COPY.cancel}
            tone="secondary"
            onPress={() => {
              setConfirming(false);
              endOp.current = null;
            }}
          />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['5'] }}>
          <TextButton
            label={PLAN_OVERVIEW_COPY.askCoach}
            onPress={() => {
              navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true, draft: PLAN_OVERVIEW_COPY.coachDraft });
            }}
          />
          <TextButton
            label={PLAN_OVERVIEW_COPY.endPlan}
            tone="secondary"
            onPress={() => {
              setConfirming(true);
            }}
          />
        </View>
      )}
    </View>
  );
}

/** A plan day (≥ 52pt): the dot, the name with `NEXT`, when, a chevron. Opens the day. */
function DayRow({ day, first, onPress }: { day: PlanOverviewDay; first: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={day.accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
        borderTopWidth: first ? 0 : theme.dividerWidth,
        borderTopColor: theme.colors['border.divider'],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Dot day={day} />
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'] }}>
        <AppText variant="body">{day.name}</AppText>
        {day.next ? (
          <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
            <AppText variant="sectionLabel" color="text.primary" style={{ fontSize: 11 }}>
              {PLAN_OVERVIEW_COPY.next}
            </AppText>
          </View>
        ) : null}
      </View>
      {day.when !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {day.when}
        </AppText>
      ) : null}
      <Icon name="chevron.right" color="text.tertiary" size={14} />
    </Pressable>
  );
}

/** ✓ (done this week, a word for VoiceOver in the row's label), a numbered ring (next), a plain ring (to do): never colour alone. */
function Dot({ day }: { day: PlanOverviewDay }) {
  const theme = useTheme();
  const size = 22;
  if (day.state === 'done') {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors['status.done.subtle'], alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="checkmark" color="status.done" size={12} weight="bold" />
      </View>
    );
  }
  if (day.state === 'next') {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <AppText variant="label" color="accent" numeric style={{ fontSize: 12, lineHeight: 14 }}>
          {String(day.n)}
        </AppText>
      </View>
    );
  }
  return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: theme.colors['text.tertiary'] }} />;
}

function Stat({ value, label }: { value: string; label: string }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flex: 1, backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, paddingHorizontal: theme.space['3'], paddingVertical: theme.space['2'], gap: 2 }}>
      <AppText variant="title2" numeric>
        {value}
      </AppText>
      <AppText variant="callout" color="text.secondary">
        {label}
      </AppText>
    </View>
  );
}
