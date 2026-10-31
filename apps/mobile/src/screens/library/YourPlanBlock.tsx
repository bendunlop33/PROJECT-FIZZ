import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRef, useState, type ReactNode } from 'react';
import { ActionSheetIOS, Pressable, View } from 'react-native';

import {
  addDays,
  localDateOf,
  localDateText,
  localHourUtcMs,
  PB_EDIT_COPY,
  PLAN_OVERVIEW_COPY,
  PLAN_PAUSE_MAX_DAYS,
  PLAN_TAB_VIEW_COPY,
  planTabDayMenu,
  planTabEditAction,
  planTabMenu,
  planTabView,
  planWeekCircles,
  pbWeekdayName,
  toMs,
  type LibraryChangesView,
  type PlanOverview,
  type PlanTabRow,
} from '@fizz/domain';

import type { Activity } from '@fizz/schemas';

import { dateAt } from '../../clock';
import { changePlanView, CHANGE_PLAN_COPY, type ChangePlanAction } from '../../library/change-plan-view';
import { WEEK_COPY } from '../../services/week-services';
import type { PlanOverviewWithBlock } from '../../services/plan-services';
import { openNextBlock, openPlanChange, todayWithDay } from '../../navigation/actions';
import { newUuid } from '../../device/runtime';
import type { LibraryStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, Eyebrow, Icon, TextButton } from '../../ui';
import { SwipeRow } from '../../ui/table-parts';
import { activitySavedToast } from '../../activity/activity-toast';
import { ActivitySheet } from '../activity/ActivitySheet';
import { ChangePlanSheet, EditPlanButton } from './ChangePlanSheet';
import { LiftTargetsBlock } from './LiftTargetsBlock';
import { DaySheetFlow } from '../today/DaySheet';
import { WeekCircles } from './WeekCircles';
import { MovedByYou } from '../../today/MovedByYou';

/** `why`: a line behind the toast's `Why?` (End plan's `N workouts not restored`). */
export type PlanToast = { text: string; action?: string; onAction?: () => void; why?: string };

/**
 * Library › Plan › the plan in use (redesign 27 Oct, section D; prototype `Library › Plan`). A header card: the plan's
 * name with `⋯` (Pause / Resume, Ask coach), `Goal: Muscle · 3 days a week · 45 min`, and the week circles spread
 * evenly (done ✓, this week filled, later outlined, `Deload` under a deload week; a tap shows that week). Under it,
 * when there are any, `✦ 3 changes · next week ›` (the Changes screen). Then `This week`: the selected week's days,
 * ✓ done with its date, Up next; a tap opens the day, a swipe (or `⋯`, long-press, VoiceOver actions) has `Do today`
 * and `Move day`. At the bottom the full-width `Edit plan` opens **Change plan** (Days and time, Goal, a day's
 * exercises, Ask the coach, End plan). Every value comes from `services.plans.overview()` and
 * `services.libraryChanges` through pure views; nothing here computes a plan, a load or a change. Local only (rule 1).
 * Every write keeps its op ID, its read version (rule 5) and its Undo toast.
 */
export function YourPlanBlock({ plan, changes, onToast }: { plan: PlanOverviewWithBlock; changes: LibraryChangesView | null; onToast: (t: PlanToast | null) => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const stack = useNavigation<NativeStackNavigationProp<LibraryStackParams, 'LibraryHome'>>();
  // (Ben, 20 Oct) Pause: the in-place picker; null closed, else the picked `until` (null: until Resume).
  const [pausing, setPausing] = useState<{ until: string | null } | null>(null);
  const [sheet, setSheet] = useState(false);
  // (Ben, 29 Oct) This week's day row: the day sheet.
  const [daySheet, setDaySheet] = useState<{ key: string; routineId: string; name: string } | null>(null);
  const busy = useRef(false);
  // (Ben, 31 Oct) This week's activity line tapped: its sheet (a Health workout's has Pair).
  const [activity, setActivity] = useState<Activity | null>(null);
  async function openActivity(activityId: string) {
    const a = await services.activities.get(activityId);
    if (a !== null) setActivity(a);
  }
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

  /** (Ben, 26 Oct) `Move day`: this week only, then `Legs on Sat this week · Undo` (rule 5: against this read). */
  async function moveDay(dayIndex: number, weekday: number) {
    const b = plan.block;
    if (busy.current || b == null) return;
    busy.current = true;
    try {
      const r = await services.plans.moveDay({ planId: plan.planId, dayIndex, weekday, expectedVersion: b.planVersion, opId: newUuid() });
      changed();
      if (!r.ok) {
        onToast({ text: r.message });
        return;
      }
      const after = r.plan;
      const name = b.views[b.current - 1]?.days.find((d) => d.index === dayIndex)?.name ?? '';
      const undoOp = newUuid();
      onToast({
        text: PB_EDIT_COPY.moved(name, pbWeekdayName(weekday)),
        action: PLAN_OVERVIEW_COPY.undo,
        onAction: () => {
          onToast(null);
          void services.plans.undoMove({ planId: after.id, expectedVersion: after.version, opId: undoOp }).then((u) => {
            changed();
            if (!u.ok) onToast({ text: u.message });
          });
        },
      });
    } finally {
      busy.current = false;
    }
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

  // (Ben, 27 Oct: Library › Plan v2) One page: the header card, then one list of the selected week's days.
  const [picked, setPicked] = useState<{ key: string; week: number } | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const b = plan.block ?? null;
  const blockKey = b === null ? '' : `${plan.planId}:${String(b.current)}:${String(b.done)}`;
  const view = planTabView({
    overview: plan,
    block: b === null ? null : { views: b.views, current: b.current, done: b.done, editable: b.editable, actions: b.actions, startsOn: b.startsOn },
    // A new block week (or another plan) opens on the current week again.
    selected: picked !== null && picked.key === blockKey ? picked.week : null,
  });

  const edit = planTabEditAction(view);
  const sheetView = changePlanView({
    answers: b?.answers ?? null,
    editable: view.editable,
    goalText: view.goal,
    days: plan.days.map((d) => ({ name: d.name, routineId: d.routineId })),
    block: b === null ? null : { current: b.current, of: b.views.length },
  });

  /** The header's `⋯` (D1): Pause / Resume and Ask coach. */
  function openMenu() {
    const items = planTabMenu(view, plan.paused !== null);
    const options = [...items.map((x) => x.label), PLAN_TAB_VIEW_COPY.cancel];
    ActionSheetIOS.showActionSheetWithOptions({ title: plan.name, options, cancelButtonIndex: items.length }, (i) => {
      const item = items[i];
      if (item === undefined) return;
      if (item.kind === 'pause') setPausing({ until: null });
      else if (item.kind === 'resume') resume();
      else navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true, draft: PLAN_OVERVIEW_COPY.coachDraft });
    });
  }

  /** Change plan's rows (D4): each opens its page; End plan was confirmed in the sheet. */
  function changePlan(a: ChangePlanAction) {
    setSheet(false);
    switch (a.kind) {
      case 'week':
      case 'goal':
        if (a.kind === 'goal' && sheetView.goalOpens === 'profile') openTraining();
        else navigation.dispatch(openPlanChange(plan.planId, a.kind === 'week' ? 'week' : 'goals'));
        return;
      case 'day':
        navigation.navigate('WorkoutEditor', { routineId: a.routineId, from: 'PlanDay' });
        return;
      case 'coach':
        navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true, draft: PLAN_OVERVIEW_COPY.coachDraft });
        return;
      case 'end':
        endOp.current = null;
        void end();
        return;
    }
  }

  function doToday(row: PlanTabRow) {
    if (row.actions !== null) navigation.dispatch(todayWithDay(row.actions.todayKey, newUuid()));
  }

  /** A day's `⋯` / long-press (the same as its swipes): `Do today` and, on Set days plans, `Move day`. */
  function openDayMenu(row: PlanTabRow) {
    const items = planTabDayMenu(row);
    if (items.length === 0) return;
    ActionSheetIOS.showActionSheetWithOptions({ title: row.name, options: [...items.map((x) => x.label), PLAN_TAB_VIEW_COPY.cancel], cancelButtonIndex: items.length }, (i) => {
      dayAction(row, items[i]?.kind);
    });
  }

  function dayAction(row: PlanTabRow, kind: string | undefined) {
    if (kind === 'today') doToday(row);
    else if (kind === 'move') setMoving(row.dayIndex);
  }

  const circles = view.chips === null ? null : planWeekCircles(view.chips);

  return (
    <View style={{ gap: theme.space['4'] }}>
      <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, padding: theme.space['4'], gap: theme.space['2'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
            {view.title}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${PLAN_TAB_VIEW_COPY.more}, ${view.title}`}
            onPress={openMenu}
            hitSlop={4}
            style={({ pressed }) => ({ width: 44, height: 44, marginVertical: -theme.space['2'], marginRight: -theme.space['2'], alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
          >
            <Icon name="ellipsis" color="text.secondary" size={20} />
          </Pressable>
        </View>
        {view.goal !== null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {view.goal}
          </AppText>
        ) : null}
        {view.chips === null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {view.line}
          </AppText>
        ) : null}
        {view.blockDone ? (
          <AppText variant="callout" color="text.secondary">
            {view.line}
          </AppText>
        ) : null}
        {plan.paused !== null ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'] }}>
            <Icon name="pause.circle" color="text.secondary" size={16} />
            <AppText variant="callout" color="text.secondary" numeric>
              {`${plan.paused.text} ·`}
            </AppText>
            <TextButton label={PLAN_OVERVIEW_COPY.resume} onPress={resume} />
          </View>
        ) : null}
        {circles !== null ? (
          <WeekCircles
            circles={circles}
            onSelect={(w) => {
              setPicked({ key: blockKey, week: w });
              setMoving(null);
            }}
          />
        ) : null}
        {/* (Ben, 31 Oct; block-progress §3) `5 lifts up · 1 stalled ›`: this block's lifts in Progress. */}
        {circles !== null ? <BlockLiftsLine /> : null}
        {pausing !== null ? (
          <View style={{ gap: theme.space['2'], paddingTop: theme.space['2'] }}>
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
        ) : null}
      </View>
      {/* (D2) The coach's changes to come, only when there are any. */}
      {changes !== null && changes.rowText !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={changes.rowText}
          onPress={() => {
            stack.navigate('LibraryChanges');
          }}
          style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], paddingHorizontal: theme.space['4'], borderRadius: theme.radius.lg, backgroundColor: theme.colors['bg.surface'], opacity: pressed ? 0.7 : 1 })}
        >
          <AppText variant="body" color="accent">
            ✦
          </AppText>
          <AppText variant="body" numeric style={{ flex: 1, fontWeight: '600' }}>
            {changes.rowText}
          </AppText>
          <Icon name="chevron.right" color="text.tertiary" size={14} />
        </Pressable>
      ) : null}
      <View>
        <View style={{ minHeight: 36, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: theme.space['2'] }}>
          <View accessibilityRole="header">
            <Eyebrow>{view.listTitle}</Eyebrow>
          </View>
          {view.listMeta !== null ? (
            <AppText variant="callout" color="text.secondary" numeric>
              {view.listMeta}
            </AppText>
          ) : null}
        </View>
        {view.note !== null ? (
          <AppText variant="callout" color="text.secondary">
            {view.note}
          </AppText>
        ) : null}
        {view.rows.map((row, i) => (
          <DayRow
            key={row.key}
            row={row}
            first={i === 0}
            moving={moving !== null && moving === row.dayIndex}
            extra={
              view.thisWeek && row.state === 'next' ? (
                <MovedByYou
                  dayIndex={row.dayIndex}
                  onResult={(text) => {
                    onToast({ text });
                  }}
                />
              ) : null
            }
            onPress={() => {
              if (row.routineId === null) return;
              // (Ben, 29 Oct) This week's day: the day sheet (the same as Today's), Every week by default.
              if (view.thisWeek && row.dayIndex !== null && plan.block != null) {
                setDaySheet({ key: `plan:${plan.planId}:${String(row.dayIndex)}`, routineId: row.routineId, name: row.name });
                return;
              }
              const week = view.selected !== null && !view.thisWeek ? view.selected : undefined;
              stack.navigate('LibraryPlanDay', { routineId: row.routineId, name: row.name, ...(week === undefined ? {} : { week }) });
            }}
            onMore={() => {
              openDayMenu(row);
            }}
            onAction={(kind) => {
              dayAction(row, kind);
            }}
            onMove={(wd) => {
              setMoving(null);
              if (row.dayIndex !== null) void moveDay(row.dayIndex, wd);
            }}
            onCancelMove={() => {
              setMoving(null);
            }}
          />
        ))}
        {view.thisWeek && plan.weekChange !== null ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'], paddingTop: theme.space['2'] }}>
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
        {view.thisWeek
          ? plan.activities.map((line, i) => {
              // (Ben, 31 Oct) Each line opens its activity's sheet (a Health workout's has Pair).
              const id = plan.activityIds[i] ?? null;
              return (
                <Pressable key={`${line}:${String(i)}`} accessibilityRole={id === null ? 'text' : 'button'} accessibilityLabel={line} disabled={id === null} onPress={() => { if (id !== null) void openActivity(id); }} style={({ pressed }) => ({ paddingTop: theme.space['1'], opacity: pressed ? 0.7 : 1 })}>
                  <AppText variant="callout" color="text.secondary" numeric>
                    {line}
                  </AppText>
                </Pressable>
              );
            })
          : null}
      </View>
      {/* (Ben approved 20 Oct) Lift targets: nothing while the setting is off. */}
      <LiftTargetsBlock onToast={onToast} />
      {/* (D4) Full-width at the bottom: Change plan; once the block is done, Start next block. */}
      <EditPlanButton
        label={edit?.kind === 'next' ? edit.label : CHANGE_PLAN_COPY.editPlan}
        onPress={() => {
          if (edit?.kind === 'next') navigation.dispatch(openNextBlock(plan.planId));
          else setSheet(true);
        }}
      />
      <ActivitySheet
        visible={activity !== null}
        activity={activity}
        onClose={() => {
          setActivity(null);
        }}
        onSaved={(saved) => {
          setActivity(null);
          changed();
          onToast(activitySavedToast(saved, { undo: services.activities.undo, newOpId: newUuid, changed, show: onToast }));
        }}
      />
      <DaySheetFlow
        target={daySheet === null ? null : { dayKey: daySheet.key }}
        from="library"
        chosenKey={null}
        doneRows={[]}
        dateTitle={(d) => d}
        onOpen={() => undefined}
        onStart={(key) => {
          setDaySheet(null);
          navigation.dispatch(todayWithDay(key, newUuid()));
        }}
        onPick={(key) => {
          setDaySheet(null);
          navigation.dispatch(todayWithDay(key, newUuid()));
        }}
        onMore={
          daySheet === null
            ? undefined
            : () => {
                const d = daySheet;
                setDaySheet(null);
                stack.navigate('LibraryPlanDay', { routineId: d.routineId, name: d.name });
              }
        }
        onClose={() => {
          setDaySheet(null);
        }}
        onChanged={changed}
        onToast={onToast}
      />
      <ChangePlanSheet
        visible={sheet}
        title={plan.name}
        view={sheetView}
        onAction={changePlan}
        onClose={() => {
          setSheet(false);
        }}
      />
    </View>
  );
}

/**
 * A day of the selected week (≥ 60pt): its mark (✓ done, a numbered ring for Up next, a plain ring), name with `Next`,
 * the weekday and main lifts, the date done, and a chevron (opens the day). This week's not-done days also swipe:
 * `Do today` (leading) and `Move` (trailing, Set days plans), with the same in a `⋯` button, long-press and VoiceOver
 * actions (UX review 27 Oct §P4). `Move day` shows the weekday chips under the row.
 */
function DayRow({ row, first, moving, extra = null, onPress, onMore, onAction, onMove, onCancelMove }: { row: PlanTabRow; first: boolean; moving: boolean; /** (Ben, 31 Oct) Under the row: `Moved by you · Undo` on NEXT. */ extra?: ReactNode; onPress: () => void; onMore: () => void; onAction: (kind: string) => void; onMove: (weekday: number) => void; onCancelMove: () => void }) {
  const theme = useTheme();
  const menu = planTabDayMenu(row);
  const today = menu.find((x) => x.kind === 'today');
  const move = menu.find((x) => x.kind === 'move');
  const content = (
    <View style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], paddingVertical: theme.space['2'] }}>
      <Mark row={row} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'] }}>
          <AppText variant="body">{row.name}</AppText>
          {row.state === 'next' ? (
            <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
              <AppText variant="sectionLabel" color="text.primary">
                {PLAN_TAB_VIEW_COPY.next}
              </AppText>
            </View>
          ) : null}
        </View>
        {row.sub !== null ? (
          <AppText variant="callout" color="text.secondary" numberOfLines={1}>
            {row.sub}
          </AppText>
        ) : null}
      </View>
      {row.trailing !== null ? (
        <AppText variant="callout" color="text.secondary" numeric style={{ flexShrink: 0 }}>
          {row.trailing}
        </AppText>
      ) : null}
      {menu.length > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={PLAN_TAB_VIEW_COPY.dayActions(row.name)} onPress={onMore} style={({ pressed }) => ({ width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Icon name="ellipsis" color="text.secondary" size={18} />
        </Pressable>
      ) : null}
      {row.routineId !== null ? <Icon name="chevron.right" color="text.tertiary" size={14} /> : null}
    </View>
  );
  return (
    <View style={{ borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
      {menu.length > 0 ? (
        <SwipeRow
          surface="bg.canvas"
          onPress={onPress}
          accessibilityLabel={row.accessibilityLabel}
          actions={menu.map((x) => ({ name: x.kind, label: x.label }))}
          onAction={onAction}
          holdProps={{ onLongPress: onMore }}
          {...(today !== undefined ? { rightAction: { label: today.label, onPress: () => { onAction('today'); } } } : {})}
          {...(move !== undefined ? { leftAction: { label: PLAN_TAB_VIEW_COPY.move, tone: 'accent' as const, onPress: () => { onAction('move'); } } } : {})}
        >
          {content}
        </SwipeRow>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={row.accessibilityLabel} disabled={row.routineId === null} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          {content}
        </Pressable>
      )}
      {extra !== null ? <View style={{ paddingLeft: 24 + theme.space['3'], paddingBottom: theme.space['2'] }}>{extra}</View> : null}
      {moving && row.actions?.moveTo != null ? (
        <View style={{ gap: theme.space['1'], paddingBottom: theme.space['2'] }}>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: theme.space['1'] }}>
            {[0, 1, 2, 3, 4, 5, 6].map((wd) => {
              const can = row.actions?.moveTo?.includes(wd) === true;
              return (
                <Chip
                  key={wd}
                  grow
                  size="min"
                  label={pbWeekdayName(wd)}
                  selected={wd === row.weekday}
                  disabled={!can}
                  onPress={() => {
                    if (!can || wd === row.weekday) return;
                    onMove(wd);
                  }}
                />
              );
            })}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <TextButton label={PLAN_TAB_VIEW_COPY.cancel} tone="secondary" onPress={onCancelMove} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** ✓ (done that week), a numbered ring (Up next), a plain ring (to do): never colour alone (the row's label says it). */
function Mark({ row }: { row: PlanTabRow }) {
  const theme = useTheme();
  const size = 24;
  if (row.state === 'done') {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors['status.done.subtle'], alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="checkmark" color="status.done" size={12} weight="bold" />
      </View>
    );
  }
  if (row.state === 'next') {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <AppText variant="label" color="accent" numeric style={{ fontSize: 13, lineHeight: 16 }}>
          {String(row.n)}
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


/** (Ben, 31 Oct; block-progress §3) One line under the week circles, opening Progress's This block. Nothing until a lift is up or stalled. */
function BlockLiftsLine() {
  const theme = useTheme();
  const navigation = useNavigation();
  const [data] = useScreenData((s) => s.blockProgress.planLine().catch(() => null));
  const line = data.state === 'ready' ? data.value : null;
  if (line === null) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={line}
      onPress={() => {
        navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressBlock', params: {} } });
      }}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? 0.7 : 1 })}
    >
      <AppText variant="callout" color="text.secondary" numeric style={{ flex: 1 }}>
        {line}
      </AppText>
      <Icon name="chevron.right" color="text.tertiary" size={14} />
    </Pressable>
  );
}
