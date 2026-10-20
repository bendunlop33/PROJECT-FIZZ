import { Fragment, type ReactNode } from 'react';
import { Pressable, Switch, View, useWindowDimensions, type AccessibilityActionEvent } from 'react-native';

import { TODAY_V2_COPY, type StripCell, type StripItem, type TodayBreakdownRow, type TodayDay } from '@fizz/domain';

import type { TodayCardView } from '../../services/today-session';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Icon, PrimaryButton, SecondaryButton, TextButton } from '../../ui';
import { AX_FONT_SCALE } from '../../workout/overview';
import { breakdownLabel, TIME_LABELS, TODAY_SCREEN_COPY, type TodayCardAction, type TodaySegment } from '../../today/today-view';

/**
 * Today (v2)'s pieces (workout-builder-v3 §2.0, prototypes/today-v2.html). They only lay out what
 * `todaySession` worked out; no rule lives here. Every gesture is a tap with a VoiceOver label; every
 * target is ≥ 44 pt (small chips extend theirs with `hitSlop`); text scales with Dynamic Type, and at
 * accessibility sizes the strip and day control become lists.
 */

const HIT = { top: 6, bottom: 6, left: 4, right: 4 } as const;
const useAx = () => useWindowDimensions().fontScale >= AX_FONT_SCALE;

// ---------------------------------------------------------------------------
// Header: `Tuesday` · gym · `✦ Coach` + mic

export function TodayHeader({ title, gym, coachLabel, onCoach, onMic }: { title: string; gym: ReactNode; coachLabel: string; onCoach: () => void; onMic: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], flexWrap: 'wrap' }}>
      <AppText variant="title1" accessibilityRole="header" style={{ flexShrink: 1 }}>
        {title}
      </AppText>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'flex-start' }}>{gym}</View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={coachLabel === TODAY_V2_COPY.offline ? `${TODAY_SCREEN_COPY.coach}, offline` : TODAY_SCREEN_COPY.coach}
        onPress={onCoach}
        style={({ pressed }) => ({ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], paddingHorizontal: theme.space['3'], borderRadius: theme.radius.pill, backgroundColor: theme.colors['bg.raised'], opacity: pressed ? 0.7 : 1 })}
      >
        <AppText variant="label" color="text.secondary">
          ✦
        </AppText>
        <AppText variant="label">{coachLabel}</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={TODAY_SCREEN_COPY.speak}
        onPress={onMic}
        style={({ pressed }) => ({ width: theme.target.min.width, height: theme.target.min.height, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.pill, backgroundColor: theme.colors['bg.raised'], opacity: pressed ? 0.7 : 1 })}
      >
        <Icon name="mic" size={18} color="text.primary" />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The 7-day strip

function StripPill({ item, compact }: { item: StripItem; compact: boolean }) {
  const theme = useTheme();
  const done = item.kind === 'workout';
  const activity = item.kind === 'activity' && !item.planned;
  const planned = item.planned;
  return (
    <View
      style={{
        borderRadius: theme.radius.sm,
        paddingHorizontal: 3,
        paddingVertical: 1,
        backgroundColor: done ? theme.colors['status.done.subtle'] : activity ? theme.colors['bg.raised'] : 'transparent',
        borderWidth: planned ? 1 : 0,
        borderStyle: planned ? 'dashed' : 'solid',
        borderColor: theme.colors['border.control'],
      }}
    >
      <AppText variant="callout" color={done ? 'status.done' : item.kind === 'rest' ? 'text.tertiary' : 'text.primary'} numberOfLines={compact ? 1 : undefined} style={compact ? { fontSize: 12, lineHeight: 15 } : undefined}>
        {item.text}
      </AppText>
    </View>
  );
}

export function WeekStrip({ cells, onDay }: { cells: readonly StripCell[]; onDay: (cell: StripCell) => void }) {
  const theme = useTheme();
  const ax = useAx();
  if (ax) {
    return (
      <View accessibilityRole="list">
        {cells.map((c) => (
          <Pressable key={c.date} accessibilityRole="button" accessibilityLabel={c.accessibilityLabel} onPress={() => { onDay(c); }} style={({ pressed }) => ({ minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
            <AppText variant="callout" color={c.today ? 'text.primary' : 'text.secondary'}>
              {c.today ? `Today · ${c.listText}` : c.listText}
            </AppText>
          </Pressable>
        ))}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {cells.map((c) => (
        <Fragment key={c.date}>
          {c.weekStart ? <View accessible={false} style={{ width: 1, backgroundColor: theme.colors['border.divider'] }} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={c.accessibilityLabel}
            onPress={() => {
              onDay(c);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 44,
              minHeight: 64,
              paddingVertical: theme.space['1'],
              paddingHorizontal: 2,
              alignItems: 'center',
              gap: 2,
              borderRadius: theme.radius.sm,
              borderWidth: c.today ? 1 : 0,
              borderColor: theme.colors.accent,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <AppText variant="sectionLabel" color={c.today ? 'text.primary' : 'text.tertiary'} style={{ fontSize: 11, lineHeight: 14, letterSpacing: 0.4 }}>
              {c.weekday}
            </AppText>
            <AppText variant="label" numeric color={c.past ? 'text.secondary' : 'text.primary'} style={{ fontSize: 15, lineHeight: 18 }}>
              {String(c.dayOfMonth)}
            </AppText>
            {c.items.map((it, i) => (
              <StripPill key={`${it.kind}:${String(i)}`} item={it} compact />
            ))}
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}

/** A day's sheet (§2.0.5 Tap a day): what's on it; a workout opens its Summary, an activity opens to edit. */
export function DaySheet({ cell, onClose, onWorkout, onActivity }: { cell: StripCell | null; onClose: () => void; onWorkout: (sessionId: string) => void; onActivity: (activityId: string) => void }) {
  const theme = useTheme();
  return (
    <BottomCard visible={cell !== null} onClose={onClose} footer={<TextButton label={TODAY_V2_COPY.close} tone="secondary" onPress={onClose} />}>
      {cell === null ? null : (
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="headline" accessibilityRole="header">
            {cell.listText.split(' · ')[0] ?? ''}
          </AppText>
          {cell.items.length === 0 ? (
            <AppText variant="callout" color="text.secondary">
              {TODAY_SCREEN_COPY.daySheetEmpty}
            </AppText>
          ) : null}
          {cell.items.map((it, i) => {
            const open = it.kind === 'workout' ? () => { onWorkout(it.sessionId); } : it.kind === 'activity' ? () => { onActivity(it.activityId); } : null;
            return (
              <Pressable key={`${it.kind}:${String(i)}`} accessibilityRole={open === null ? 'text' : 'button'} disabled={open === null} onPress={open ?? undefined} style={({ pressed }) => ({ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: pressed ? 0.7 : 1 })}>
                <AppText variant="body">{it.text}</AppText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
                  {it.planned && it.kind !== 'today' ? (
                    <AppText variant="callout" color="text.secondary">
                      {TODAY_V2_COPY.planned}
                    </AppText>
                  ) : null}
                  {open !== null ? <Icon name="chevron.right" size={14} color="text.tertiary" /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </BottomCard>
  );
}

// ---------------------------------------------------------------------------
// Day control

export function DayControl({ segments, paused, onDay, onMore, onAxList, axLabel }: { segments: readonly TodaySegment[]; paused: boolean; onDay: (key: string) => void; onMore: () => void; onAxList: () => void; axLabel: string }) {
  const theme = useTheme();
  const ax = useAx();
  if (ax) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Day, ${axLabel}`} onPress={onAxList} style={({ pressed }) => ({ minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: pressed ? 0.7 : 1 })}>
        <AppText variant="callout" color="text.secondary">
          Day
        </AppText>
        <AppText variant="body">{`${axLabel} ›`}</AppText>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: theme.space['1'] }}>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md, padding: 3, gap: 3 }}>
        {segments.map((s) => (
          <Pressable
            key={s.key}
            accessibilityRole="tab"
            accessibilityLabel={s.accessibilityLabel}
            accessibilityState={{ selected: s.selected }}
            onPress={() => {
              if (s.more) onMore();
              else onDay(s.key);
            }}
            style={({ pressed }) => ({
              flex: s.more && !s.selected ? 0.6 : 1,
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.sm,
              backgroundColor: s.selected ? theme.colors['bg.raised'] : 'transparent',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <AppText variant="label" color={s.selected ? 'text.primary' : 'text.tertiary'} numberOfLines={1} style={{ fontSize: 15 }}>
              {s.label}
            </AppText>
            {s.next ? (
              <AppText variant="sectionLabel" color={s.selected ? 'text.primary' : 'text.tertiary'} style={{ fontSize: 10, lineHeight: 12 }}>
                {TODAY_V2_COPY.next}
              </AppText>
            ) : null}
          </Pressable>
        ))}
      </View>
      {paused ? (
        <AppText variant="callout" color="text.secondary">
          {TODAY_V2_COPY.planPaused}
        </AppText>
      ) : null}
    </View>
  );
}

/** `⋯` Other sessions (or, at AX sizes, every day): a list sheet; Empty workout and Build your own at the end. */
export function SessionListSheet({ visible, title, days, selectedKey, nextKey, onPick, onEmpty, onBuild, onClose }: { visible: boolean; title: string; days: readonly TodayDay[]; selectedKey: string | null; nextKey: string | null; onPick: (key: string) => void; onEmpty: () => void; onBuild: () => void; onClose: () => void }) {
  const theme = useTheme();
  return (
    <BottomCard
      visible={visible}
      onClose={onClose}
      footer={
        <>
          <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
            <SecondaryButton label={TODAY_V2_COPY.emptyWorkout} onPress={onEmpty} grow />
            <SecondaryButton label={TODAY_V2_COPY.buildYourOwn} onPress={onBuild} grow />
          </View>
          <TextButton label={TODAY_V2_COPY.close} tone="secondary" onPress={onClose} />
        </>
      }
    >
      <AppText variant="headline" accessibilityRole="header">
        {title}
      </AppText>
      {days.map((d) => (
        <Pressable
          key={d.key}
          accessibilityRole="button"
          accessibilityLabel={[d.name, d.key === nextKey ? 'next' : null, d.key === selectedKey ? 'selected' : null].filter((x): x is string => x !== null).join(', ')}
          onPress={() => {
            onPick(d.key);
          }}
          style={({ pressed }) => ({ minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: pressed ? 0.7 : 1 })}
        >
          <AppText variant="body">{d.name}</AppText>
          <AppText variant="callout" color="text.secondary">
            {d.key === selectedKey ? '✓' : d.key === nextKey ? TODAY_V2_COPY.next : ''}
          </AppText>
        </Pressable>
      ))}
    </BottomCard>
  );
}

// ---------------------------------------------------------------------------
// The session card

function Chip({ label, selected, onPress, accessibilityLabel }: { label: string; selected: boolean; onPress: () => void; accessibilityLabel?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      hitSlop={HIT}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 34,
        paddingHorizontal: theme.space['3'],
        justifyContent: 'center',
        borderRadius: theme.radius.pill,
        backgroundColor: selected ? theme.colors.accent : 'transparent',
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors['border.divider'],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <AppText variant="label" color={selected ? 'on.accent' : 'text.secondary'} style={{ fontSize: 15, lineHeight: 18 }}>
        {selected ? `● ${label}` : label}
      </AppText>
    </Pressable>
  );
}

function ControlRow({ label, sub, children }: { label: string; sub?: string | null; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], minHeight: 38, flexWrap: 'wrap' }}>
      <View>
        <AppText variant="callout" color="text.secondary" style={{ fontSize: 15 }}>
          {label}
        </AppText>
        {sub ? (
          <AppText variant="callout" color="text.tertiary" style={{ fontSize: 12, lineHeight: 14 }}>
            {sub}
          </AppText>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'], justifyContent: 'flex-end', flexShrink: 1 }}>{children}</View>
    </View>
  );
}

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: () => void; hint?: string | null }) {
  return (
    <View hitSlop={HIT}>
      <Switch accessibilityLabel={hint ? `${label}, ${hint}` : label} value={value} onValueChange={onChange} />
    </View>
  );
}

function TimeStepper({ minutes, onStep }: { minutes: number; onStep: (d: -1 | 1) => void }) {
  const theme = useTheme();
  const btn = (d: -1 | 1) => (
    <Pressable accessibilityRole="button" accessibilityLabel={d < 0 ? TIME_LABELS.less : TIME_LABELS.more} hitSlop={HIT} onPress={() => { onStep(d); }} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}>
      <AppText variant="label">{d < 0 ? '−' : '+'}</AppText>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
      {btn(-1)}
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={TIME_LABELS.value(minutes)}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e: AccessibilityActionEvent) => {
          onStep(e.nativeEvent.actionName === 'increment' ? 1 : -1);
        }}
      >
        <AppText variant="label" numeric style={{ minWidth: 64, textAlign: 'center' }}>
          {TODAY_V2_COPY.minutesValue(minutes)}
        </AppText>
      </View>
      {btn(1)}
    </View>
  );
}

function BreakdownTable({ rows, unit }: { rows: readonly TodayBreakdownRow[]; unit: 'kg' | 'lb' }) {
  const theme = useTheme();
  const groups: TodayBreakdownRow[][] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (r.superset !== null && last !== undefined && last[0]?.superset?.block === r.superset.block) last.push(r);
    else groups.push([r]);
  }
  const col = { n: 30, sets: 56, top: 84 } as const;
  const row = (r: TodayBreakdownRow) => (
    <View key={r.key} accessible accessibilityLabel={r.accessibilityLabel} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingVertical: 2 }}>
      <AppText variant="callout" color="text.tertiary" numeric style={{ width: col.n }}>
        {r.label}
      </AppText>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="callout">{r.name}</AppText>
        {r.works !== null ? (
          <AppText variant="callout" color="text.tertiary" style={{ fontSize: 13, lineHeight: 16 }}>
            {r.works}
          </AppText>
        ) : null}
      </View>
      <View style={{ width: col.sets, alignItems: 'flex-end' }}>
        <AppText variant="callout" numeric>
          {String(r.sets)}
        </AppText>
        {r.warmupText !== null ? (
          <AppText variant="callout" color="text.tertiary" numeric style={{ fontSize: 12, lineHeight: 14 }}>
            {r.warmupText}
          </AppText>
        ) : null}
      </View>
      <AppText variant="callout" numeric align="right" style={{ width: col.top }}>
        {r.top}
      </AppText>
    </View>
  );
  return (
    <View>
      <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', paddingBottom: theme.space['1'], borderBottomWidth: theme.dividerWidth, borderBottomColor: theme.colors['border.divider'] }}>
        <AppText variant="sectionLabel" color="text.tertiary" style={{ width: col.n }}>
          #
        </AppText>
        <AppText variant="sectionLabel" color="text.tertiary" style={{ flex: 1 }}>
          {TODAY_V2_COPY.exercise}
        </AppText>
        <AppText variant="sectionLabel" color="text.tertiary" align="right" style={{ width: col.sets }}>
          {TODAY_V2_COPY.sets}
        </AppText>
        <AppText variant="sectionLabel" color="text.tertiary" align="right" style={{ width: col.top }}>
          {TODAY_V2_COPY.topSet(unit)}
        </AppText>
      </View>
      {groups.map((g) =>
        g.length > 1 ? (
          <View key={`ss:${g[0]?.key ?? ''}`} style={{ borderLeftWidth: 2, borderLeftColor: theme.colors['border.control'], borderRadius: theme.radius.sm, paddingLeft: theme.space['1'], marginVertical: 2, backgroundColor: theme.colors['bg.raised'] }}>
            {g.map(row)}
          </View>
        ) : (
          g.map(row)
        ),
      )}
    </View>
  );
}

export function SessionCard({
  view,
  open,
  why,
  moved,
  busy,
  dispatch,
  onStart,
  onEdit,
  onBackToPlan,
}: {
  view: TodayCardView;
  open: boolean;
  why: boolean;
  moved: string | null;
  busy: boolean;
  dispatch: (a: TodayCardAction) => void;
  onStart: () => void;
  onEdit: () => void;
  onBackToPlan: () => void;
}) {
  const theme = useTheme();
  const main = view.controls.mainLifts.find((m) => m.selected)?.label ?? null;
  return (
    <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, padding: theme.space['4'], gap: theme.space['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space['2'] }}>
        <AppText variant="title2" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {view.title}
        </AppText>
        <View style={{ alignItems: 'flex-end' }}>
          <AppText variant="callout" color="text.secondary" numeric>
            {view.summary}
          </AppText>
          {moved !== null ? (
            <AppText variant="callout" color="text.tertiary" style={{ fontSize: 13 }}>
              {moved}
            </AppText>
          ) : null}
        </View>
      </View>
      {view.fitLine !== null ? (
        <View style={{ flexDirection: 'row', gap: theme.space['1'], alignItems: 'center' }}>
          {view.over ? <Icon name="exclamationmark.triangle" size={14} color="status.warning" /> : null}
          <AppText variant="callout" color="text.secondary" style={{ fontSize: 14, flexShrink: 1 }}>
            {view.fitLine}
          </AppText>
        </View>
      ) : null}
      {view.clashLine !== null ? (
        <View style={{ flexDirection: 'row', gap: theme.space['1'], alignItems: 'center' }}>
          <AppText variant="label" color="status.warning">
            !
          </AppText>
          <AppText variant="callout" color="text.secondary" style={{ fontSize: 14, flexShrink: 1 }}>
            {view.clashLine}
          </AppText>
        </View>
      ) : null}

      {view.edited === null ? (
        <View style={{ gap: 2 }}>
          {view.controls.mainLifts.length > 0 ? (
            <ControlRow label={TODAY_V2_COPY.mainLift}>
              {view.controls.mainLifts.map((m) => (
                <Chip key={m.exerciseId ?? '-'} label={m.label} selected={m.selected} accessibilityLabel={`Main lift, ${m.label}`} onPress={() => { dispatch({ kind: 'main_lift', exerciseId: m.exerciseId }); }} />
              ))}
            </ControlRow>
          ) : null}
          <ControlRow label={TODAY_V2_COPY.accessories}>
            <Chip label={TODAY_V2_COPY.focused} selected={view.controls.accessories === 'focused'} accessibilityLabel={`Accessories, ${TODAY_V2_COPY.focused}`} onPress={() => { dispatch({ kind: 'accessories', value: 'focused' }); }} />
            <Chip label={TODAY_V2_COPY.varied} selected={view.controls.accessories === 'varied'} accessibilityLabel={`Accessories, ${TODAY_V2_COPY.varied}`} onPress={() => { dispatch({ kind: 'accessories', value: 'varied' }); }} />
          </ControlRow>
          <ControlRow label={TODAY_V2_COPY.time}>
            <TimeStepper minutes={view.controls.minutes} onStep={(d) => { dispatch({ kind: 'minutes', delta: d }); }} />
          </ControlRow>
          <ControlRow label={TODAY_V2_COPY.abs} sub={view.controls.abs.differs ? TODAY_V2_COPY.planAbs(view.controls.abs.planOn) : null}>
            <Toggle label={TODAY_V2_COPY.abs} value={view.controls.abs.on} hint={view.controls.abs.differs ? TODAY_V2_COPY.planAbs(view.controls.abs.planOn) : null} onChange={() => { dispatch({ kind: 'abs', planOn: view.controls.abs.planOn }); }} />
          </ControlRow>
          <ControlRow label={TODAY_V2_COPY.supersets}>
            <Toggle label={TODAY_V2_COPY.supersets} value={view.controls.supersets} onChange={() => { dispatch({ kind: 'supersets' }); }} />
          </ControlRow>
        </View>
      ) : (
        <View style={{ alignSelf: 'flex-start' }}>
          <TextButton label={TODAY_V2_COPY.backToPlan} tone="secondary" onPress={onBackToPlan} />
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={breakdownLabel(view.title, main, open)}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          dispatch({ kind: 'breakdown' });
        }}
        style={({ pressed }) => ({ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}
      >
        <AppText variant="label">{TODAY_V2_COPY.breakdown}</AppText>
        <Icon name={open ? 'chevron.down' : 'chevron.right'} size={14} color="text.tertiary" />
      </Pressable>

      {open ? (
        <View style={{ gap: theme.space['2'] }}>
          <BreakdownTable rows={view.rows} unit={view.unit} />
          <View style={{ alignSelf: 'flex-start' }}>
            <TextButton label={TODAY_V2_COPY.why} tone="secondary" accessibilityLabel={why ? 'Hide why' : 'Why this workout'} onPress={() => { dispatch({ kind: 'why' }); }} />
          </View>
          {why ? (
            <View style={{ gap: 2 }}>
              {view.why.map((l) => (
                <AppText key={l} variant="callout" color="text.secondary">
                  {`· ${l}`}
                </AppText>
              ))}
            </View>
          ) : null}
          {view.mix !== null ? (
            <View style={{ gap: theme.space['1'] }}>
              <View accessible accessibilityLabel={view.mix.accessibilityLabel}>
                <AppText variant="callout">{view.mix.text}</AppText>
                {view.mix.notReviewed ? (
                  <AppText variant="callout" color="text.tertiary" style={{ fontSize: 13 }}>
                    {TODAY_V2_COPY.notReviewed}
                  </AppText>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: theme.space['4'] }}>
                <TextButton label={view.mix.another} tone="secondary" onPress={() => { dispatch({ kind: 'mix' }); }} />
                <TextButton label={TODAY_V2_COPY.undo} tone="secondary" onPress={() => { dispatch({ kind: 'mix_undo' }); }} />
              </View>
            </View>
          ) : view.mixAvailable ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <TextButton label={TODAY_V2_COPY.mix} tone="secondary" accessibilityLabel="Mix it up, swap one accessory for today" onPress={() => { dispatch({ kind: 'mix' }); }} />
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: theme.space['2'], alignItems: 'center' }}>
        <View style={{ flex: 2 }}>
          <PrimaryButton label={TODAY_V2_COPY.start} busy={busy} disabled={!view.startable} onPress={onStart} />
        </View>
        <View style={{ flex: 1 }}>
          <SecondaryButton label={TODAY_V2_COPY.edit} onPress={onEdit} grow size="primary" />
        </View>
      </View>
    </View>
  );
}
