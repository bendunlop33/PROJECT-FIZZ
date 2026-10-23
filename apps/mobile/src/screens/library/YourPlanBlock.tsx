import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { addDays, localDateOf, localDateText, localHourUtcMs, PLAN_OVERVIEW_COPY, PLAN_PAUSE_MAX_DAYS, toMs, type PlanOverview, type PlanOverviewDay } from '@fizz/domain';

import { dateAt } from '../../clock';
import { WEEK_COPY } from '../../services/week-services';
import type { PlanOverviewWithBlock } from '../../services/plan-services';
import { openNextBlock } from '../../navigation/actions';
import { newUuid } from '../../device/runtime';
import type { LibraryStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Eyebrow, Icon, TextButton } from '../../ui';
import { LiftTargetsBlock } from './LiftTargetsBlock';
import { PlanWeeksBlock } from './PlanWeeksBlock';

/** `why`: a line behind the toast's `Why?` (End plan's `N workouts not restored`). */
export type PlanToast = { text: string; action?: string; onAction?: () => void; why?: string };

/**
 * Library › Workouts › Your plan (Ben, 19 Oct; mockup approved "ok"): the
 * plan in use, since when, the goal line (`Edit` / `Set goal` open Profile ›
 * Training details), its days in plan order with a state dot (✓ done this
 * week, a numbered ring for Up next, a plain ring to do), days this week and
 * planned sets done, then `Ask coach to change` and `End plan` (an in-page
 * confirm, then a toast with Undo). Every value comes from
 * `services.plans.overview()`; this draws it. Local only (rule 1).
 */
export function YourPlanBlock({ plan, onToast }: { plan: PlanOverviewWithBlock; onToast: (t: PlanToast | null) => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const stack = useNavigation<NativeStackNavigationProp<LibraryStackParams, 'LibraryHome'>>();
  const [confirming, setConfirming] = useState(false);
  // (Ben, 20 Oct) Pause: the in-place picker; null closed, else the picked `until` (null: until Resume).
  const [pausing, setPausing] = useState<{ until: string | null } | null>(null);
  const busy = useRef(false);
  // One op ID per confirm, so a retried tap is the same End (rule 5).
  const endOp = useRef<string | null>(null);
  const pauseOp = useRef<string | null>(null);
  const now = services.now();
  const today = localDateOf(toMs(now.utc), now.tz);
  // The wheel's dates are noon local, so a zone change never moves the picked day.
  const noon = (date: string) => localHourUtcMs(date, 12, now.tz);

  /** Pause or Resume, then a toast with Undo (the write's own; a retried tap replays). */
  async function control(write: () => Promise<{ ok: true; plan: { id: string; version: number } } | { ok: false; message: string }>, opId: string, done: string) {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await write();
      changed();
      if (!r.ok) {
        onToast({ text: r.message });
        return;
      }
      const after = r.plan;
      const undoOp = newUuid();
      onToast({
        text: done,
        action: PLAN_OVERVIEW_COPY.undo,
        onAction: () => {
          onToast(null);
          void services.plans.undoControl({ planId: after.id, targetOpId: opId, expectedVersion: after.version, opId: undoOp }).then((u) => {
            changed();
            if (!u.ok) onToast({ text: u.message });
          });
        },
      });
    } finally {
      busy.current = false;
    }
  }

  function pause(until: string | null) {
    pauseOp.current ??= newUuid();
    const opId = pauseOp.current;
    void control(() => services.plans.pause({ planId: plan.planId, untilDate: until, expectedVersion: plan.planVersion, opId }), opId, PLAN_OVERVIEW_COPY.pausedToast).then(() => {
      setPausing(null);
      pauseOp.current = null;
    });
  }

  function resume() {
    const opId = newUuid();
    void control(() => services.plans.resumePause({ planId: plan.planId, expectedVersion: plan.planVersion, opId }), opId, PLAN_OVERVIEW_COPY.resumedToast);
  }

  /** (Ben, 20 Oct) Undo of this week's change (merged or skipped days): the plan's own days this week again. */
  function undoWeek(change: NonNullable<PlanOverview['weekChange']>) {
    if (busy.current) return;
    busy.current = true;
    void services.week
      .undo({ weekPlanId: change.weekPlanId, expectedVersion: change.version, opId: newUuid() })
      .then((r) => {
        changed();
        onToast({ text: r.ok ? WEEK_COPY.undone : r.message });
      })
      .finally(() => {
        busy.current = false;
      });
  }

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
        // (Ben, 20 Oct) Replaced workouts Ben deleted or changed since aren't put back: said behind `Why?`.
        ...(r.notRestored.length > 0 ? { why: PLAN_OVERVIEW_COPY.notRestored(r.notRestored.length, r.notRestored) } : {}),
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
      {plan.paused !== null ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'] }}>
          <Icon name="pause.circle" color="text.secondary" size={16} />
          <AppText variant="callout" color="text.secondary" numeric>
            {`${plan.paused.text} ·`}
          </AppText>
          <TextButton label={PLAN_OVERVIEW_COPY.resume} onPress={resume} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['1'] }}>
        {plan.goal.text !== null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {`${plan.goal.text} ·`}
          </AppText>
        ) : null}
        <TextButton label={plan.goal.action} tone="secondary" accessibilityLabel={plan.goal.action === PLAN_OVERVIEW_COPY.edit ? 'Edit goal' : 'Set goal'} onPress={openTraining} />
      </View>
      {/* (Ben, 23 Oct: plan length = block 1) A builder plan's weeks: the strip, that week's days, and the block's end. */}
      {plan.block != null ? (
        <PlanWeeksBlock
          key={`${plan.planId}:${String(plan.block.current)}:${String(plan.block.done)}`}
          block={plan.block}
          onStartNext={() => {
            navigation.dispatch(openNextBlock(plan.planId));
          }}
        />
      ) : null}
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
      {plan.weekChange !== null ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'] }}>
          <AppText variant="callout" style={{ flexShrink: 1 }}>
            {plan.weekChange.text}
          </AppText>
          <TextButton
            label={WEEK_COPY.undo}
            tone="secondary"
            accessibilityLabel="Undo this week's change"
            onPress={() => {
              if (plan.weekChange !== null) undoWeek(plan.weekChange);
            }}
          />
        </View>
      ) : null}
      {plan.activities.map((line) => (
        <AppText key={line} variant="callout" color="text.secondary" numeric>
          {line}
        </AppText>
      ))}
      <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
        <Stat value={plan.daysThisWeek.text} label={PLAN_OVERVIEW_COPY.daysThisWeek} />
        {plan.setsDone !== null ? <Stat value={plan.setsDone.text} label={PLAN_OVERVIEW_COPY.setsDone} /> : null}
      </View>
      {/* (Ben approved 20 Oct) Lift targets: nothing while the setting is off. */}
      <LiftTargetsBlock onToast={onToast} />
      {pausing !== null ? (
        <View style={{ gap: theme.space['2'] }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['4'] }}>
            <Choice
              label={PLAN_OVERVIEW_COPY.pauseNoDate}
              selected={pausing.until === null}
              onPress={() => {
                setPausing({ until: null });
              }}
            />
            <Choice
              label={pausing.until === null ? PLAN_OVERVIEW_COPY.pauseUntil : `${PLAN_OVERVIEW_COPY.pauseUntil} ${localDateText(pausing.until)}`}
              selected={pausing.until !== null}
              onPress={() => {
                setPausing({ until: pausing.until ?? addDays(today, 7) });
              }}
            />
          </View>
          {pausing.until !== null ? (
            <DateTimePicker
              value={dateAt(noon(pausing.until))}
              mode="date"
              display="spinner"
              timeZoneName={now.tz}
              minimumDate={dateAt(noon(addDays(today, 1)))}
              maximumDate={dateAt(noon(addDays(today, PLAN_PAUSE_MAX_DAYS)))}
              themeVariant={theme.scheme}
              onValueChange={(_e, date) => {
                setPausing({ until: localDateOf(date.getTime(), now.tz) });
              }}
            />
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['4'] }}>
            <TextButton
              label={PLAN_OVERVIEW_COPY.pause}
              onPress={() => {
                pause(pausing.until);
              }}
            />
            <TextButton
              label={PLAN_OVERVIEW_COPY.cancel}
              tone="secondary"
              onPress={() => {
                setPausing(null);
                pauseOp.current = null;
              }}
            />
          </View>
        </View>
      ) : confirming ? (
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
          {plan.paused === null ? (
            <TextButton
              label={PLAN_OVERVIEW_COPY.pause}
              tone="secondary"
              onPress={() => {
                setPausing({ until: null });
              }}
            />
          ) : null}
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
            <AppText variant="sectionLabel" color="text.primary">
              {PLAN_OVERVIEW_COPY.next}
            </AppText>
          </View>
        ) : null}
      </View>
      {day.when !== null ? (
        <AppText variant="callout" color="text.secondary" numeric style={{ flexShrink: 1, textAlign: 'right' }}>
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
        <AppText variant="label" color="accent" numeric style={{ fontSize: 13, lineHeight: 16 }}>
          {String(day.n)}
        </AppText>
      </View>
    );
  }
  return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: theme.colors['text.tertiary'] }} />;
}

/** A radio-style choice (≥ 44pt): a filled or empty circle and its words, never colour alone. */
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label} onPress={onPress} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
      <Icon name={selected ? 'largecircle.fill.circle' : 'circle'} color={selected ? 'accent' : 'text.tertiary'} size={18} />
      <AppText variant="body" numeric>
        {label}
      </AppText>
    </Pressable>
  );
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
