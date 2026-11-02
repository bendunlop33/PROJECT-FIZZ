import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useLayoutEffect, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { newUuid } from '../../device/runtime';
import { openNextBlock, openPlanChange, openYourPlan } from '../../navigation/actions';
import type { ProgressStackParams } from '../../navigation/types';
import { PLAN_SUMMARY_COPY as C, type PlanSummaryDay, type PlanSummaryEdit, type PlanSummaryLift, type PlanSummaryMuscle, type PlanSummaryView, type PlanSummaryWeek } from '../../progress/plan-summary-view';
import { useScreenData } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Eyebrow, Icon, SecondaryButton, StatusLine, TextButton } from '../../ui';
import { MuscleBar } from '../../ui/muscle-bar';

/**
 * (Ben, 2 Nov; docs/design/plan-summary.md, prototype `plan-summary-2nov.html`) The plan in use at a glance, from This
 * block's header in Progress: title and week line, the week strip, three facts, the days (done this week, `Next`; a tap
 * opens the day), main lifts now → plan-end estimate (est.), and sets per week per muscle (`Muscles ›`). `Edit` (top
 * right) and `Edit plan` open Plan setup. Lays out `services.planSummary.read()`; computes nothing. Local only (rule 1).
 */
export function PlanSummaryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<ProgressStackParams, 'ProgressPlan'>>();
  const [data, reload] = useScreenData((s) => s.planSummary.read());
  const view = data.state === 'ready' ? data.value : null;

  function edit(e: PlanSummaryEdit, planId: string) {
    if (e.kind === 'edit') navigation.dispatch(openPlanChange(planId, 'goals'));
    else if (e.kind === 'next') navigation.dispatch(openNextBlock(planId));
    else navigation.dispatch(openYourPlan(newUuid()));
  }

  useLayoutEffect(() => {
    if (view === null) return;
    navigation.setOptions({
      headerRight: () => (
        <TextButton
          label={C.edit}
          tone="secondary"
          accessibilityLabel={view.edit.label}
          onPress={() => {
            edit(view.edit, view.planId);
          }}
        />
      ),
    });
  }, [navigation, view]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['2'], paddingBottom: theme.space['8'] + insets.bottom }}>
        {data.state === 'error' ? <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t load your plan." action={<TextButton label="Try again" onPress={reload} />} /> : null}
        {data.state === 'ready' && view === null ? (
          <AppText variant="body" color="text.secondary">
            No plan in use.
          </AppText>
        ) : null}
        {view !== null ? (
          <PlanSummaryBody
            view={view}
            onDay={(d) => {
              navigation.navigate('ProgressPlanDay', { routineId: d.routineId, name: d.name });
            }}
            onMuscles={() => {
              navigation.navigate('ProgressPlanMuscles');
            }}
            onEdit={() => {
              edit(view.edit, view.planId);
            }}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

/** The summary from a loaded view (the render test drives it through the screen). */
export function PlanSummaryBody({ view, onDay, onMuscles, onEdit }: { view: PlanSummaryView; onDay: (d: PlanSummaryDay) => void; onMuscles: () => void; onEdit: () => void }) {
  const theme = useTheme();
  return (
    <View>
      <AppText variant="title1" accessibilityRole="header">
        {view.title}
      </AppText>
      {view.line !== null ? (
        <AppText variant="callout" color="text.secondary" numeric style={{ marginTop: theme.space['1'] }}>
          {view.line}
        </AppText>
      ) : null}
      {view.weeks !== null ? <WeekStrip weeks={view.weeks} label={view.weeksLabel} /> : null}
      {view.facts !== null ? <Facts facts={view.facts} /> : null}

      {view.days.rows.length > 0 ? (
        <Section title={C.days} meta={view.days.meta}>
          <Rows>
            {view.days.rows.map((d, i) => (
              <DayRow
                key={d.routineId}
                day={d}
                first={i === 0}
                onPress={() => {
                  onDay(d);
                }}
              />
            ))}
          </Rows>
        </Section>
      ) : null}

      {view.lifts !== null ? (
        <Section title={C.mainLifts} meta={view.lifts.meta}>
          <Rows>
            {view.lifts.rows.map((l, i) => (
              <LiftRow key={l.key} lift={l} first={i === 0} />
            ))}
          </Rows>
        </Section>
      ) : null}

      {view.muscles !== null ? (
        <Section title={C.setsPerWeek} link={{ label: `${C.muscles} ›`, onPress: onMuscles }}>
          <Rows>
            {view.muscles.map((m, i) => (
              <MuscleRow key={m.bar.group} muscle={m} first={i === 0} />
            ))}
          </Rows>
        </Section>
      ) : null}

      <View style={{ marginTop: theme.space['6'] }}>
        <SecondaryButton label={view.edit.label} onPress={onEdit} />
      </View>
    </View>
  );
}

function WeekStrip({ weeks, label }: { weeks: readonly PlanSummaryWeek[]; label: string }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ flexDirection: 'row', gap: 6, marginTop: theme.space['4'] }}>
      {weeks.map((w) => (
        <View key={w.week} testID={`plan-week-${w.state}${w.deload ? '-deload' : ''}`} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
          <View
            style={{
              alignSelf: 'stretch',
              height: 8,
              borderRadius: 4,
              ...(w.deload && w.state === 'todo'
                ? { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors['border.control'] }
                : { backgroundColor: theme.colors[w.state === 'current' ? 'accent' : w.state === 'done' ? 'text.secondary' : 'bg.raised'] }),
            }}
          />
          <AppText variant="callout" color={w.state === 'current' ? 'text.primary' : 'text.tertiary'} numeric numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, ...(w.state === 'current' ? { fontWeight: '600' } : {}) }}>
            {w.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function Facts({ facts }: { facts: readonly { key: string; value: string; label: string }[] }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, marginTop: theme.space['4'] }}>
      {facts.map((f, i) => (
        <View key={f.key} accessible accessibilityLabel={`${f.value} ${f.label}`} style={{ flex: 1, alignItems: 'center', paddingVertical: theme.space['3'], paddingHorizontal: theme.space['2'], borderLeftWidth: i === 0 ? 0 : theme.dividerWidth, borderLeftColor: theme.colors['border.divider'] }}>
          <AppText variant="headline" numeric numberOfLines={1}>
            {f.value}
          </AppText>
          <AppText variant="callout" color="text.secondary" numberOfLines={1}>
            {f.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function Section({ title, meta = null, link = null, children }: { title: string; meta?: string | null; link?: { label: string; onPress: () => void } | null; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginTop: theme.space['6'], gap: theme.space['2'] }}>
      <View style={{ minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
        <View accessibilityRole="header">
          <Eyebrow>{title}</Eyebrow>
        </View>
        {link !== null ? (
          <TextButton label={link.label} tone="secondary" onPress={link.onPress} />
        ) : meta !== null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {meta}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Rows({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, overflow: 'hidden' }}>{children}</View>;
}

function DayRow({ day, first, onPress }: { day: PlanSummaryDay; first: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={day.accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], paddingHorizontal: theme.space['4'], paddingVertical: theme.space['3'], borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ width: day.weekday === null ? 8 : 40, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {day.done ? <View testID="plan-day-done" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors['status.done'] }} /> : null}
        {day.weekday !== null ? (
          <AppText variant="callout" color="text.tertiary" numeric style={{ fontSize: 12, lineHeight: 16 }}>
            {day.weekday}
          </AppText>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="body" numberOfLines={1}>
          {day.name}
        </AppText>
        {day.meta !== null ? (
          <AppText variant="callout" color="text.secondary" numeric numberOfLines={1}>
            {day.meta}
          </AppText>
        ) : null}
      </View>
      {day.next ? (
        <View style={{ backgroundColor: theme.colors.accent, borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
          <AppText variant="sectionLabel" color="on.accent">
            {C.next}
          </AppText>
        </View>
      ) : null}
      <Icon name="chevron.right" color="text.tertiary" size={14} />
    </Pressable>
  );
}

function LiftRow({ lift, first }: { lift: PlanSummaryLift; first: boolean }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel={lift.accessibilityLabel} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], paddingHorizontal: theme.space['4'], paddingVertical: theme.space['3'], borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
      <AppText variant="body" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
        {lift.name}
      </AppText>
      <AppText variant="callout" numeric numberOfLines={1}>
        {lift.now}
        <AppText variant="callout" color="text.tertiary">
          {' → '}
        </AppText>
        {lift.end}
        <AppText variant="callout" color="text.tertiary" style={{ fontSize: 13 }}>
          {` ${C.est}`}
        </AppText>
      </AppText>
    </View>
  );
}

function MuscleRow({ muscle, first }: { muscle: PlanSummaryMuscle; first: boolean }) {
  const theme = useTheme();
  const { bar, low } = muscle;
  return (
    <View accessible accessibilityLabel={bar.words} style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], paddingHorizontal: theme.space['4'], paddingVertical: theme.space['2'], borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
      <AppText variant="callout" numberOfLines={1} style={{ width: 96 }}>
        {bar.label}
      </AppText>
      <View style={{ flex: 1 }}>
        <MuscleBar look={bar.look} />
      </View>
      <AppText variant="callout" color={low ? 'status.warning' : 'text.secondary'} numeric style={{ width: 40, textAlign: 'right' }}>
        {bar.valueText}
      </AppText>
    </View>
  );
}
