import { Fragment, type ReactNode } from 'react';
import { Pressable, Switch, View, useWindowDimensions } from 'react-native';

import { HISTORY_COPY, TODAY_V2_COPY, type FeedItem, type StripCell, type StripItem, type TodayBreakdownRow, type TodayDay } from '@fizz/domain';

import type { TodayOptionChange, TodayOptions } from '../../builder/builder-service';
import type { TodayCardView } from '../../services/today-session';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Group, Icon, PrimaryButton, SecondaryButton, SectionHeader, TextButton } from '../../ui';
import { TimeNoteRow } from '../../ui/time-stepper';
import { AX_FONT_SCALE } from '../../workout/screen-rules';
import { STRIP_LABEL_FIT, STRIP_LAYOUT, stripPillStyle } from '../../today/strip-style';
import { dayRowAsList, TODAY_SCREEN_COPY, TODAY_TEXT_FIT, todayWeekStacked, type TodayCardAction, type TodaySegment } from '../../today/today-view';
import { PAST_LOG_COPY } from '../../workout/past-log-view';

/**
 * Today (v2)'s pieces (workout-builder-v3 §2.0, prototypes/today-v2.html). They only lay out what
 * `todaySession` worked out; no rule lives here. Every gesture is a tap with a VoiceOver label; every
 * target is ≥ 44 pt (small chips extend theirs with `hitSlop`); text scales with Dynamic Type, and at
 * accessibility sizes the strip and day control become lists.
 */

/** Control rows are 44 pt with no gap between them, so a 34 pt chip's 5 pt slop stays inside its own row (review S9). */
const ROW_H = 44;
const HIT = { top: 5, bottom: 5, left: 4, right: 4 } as const;
const useAx = () => useWindowDimensions().fontScale >= AX_FONT_SCALE;

// ---------------------------------------------------------------------------
// Header: `Tuesday` · `✦ Coach` + mic, one line

/**
 * (§2.0.2, Ben 20 Oct; prototypes/today-v2.html `.hdr`) The day name on the left, the compact coach
 * (`✦ Coach` pill + mic, 44 pt each) on the right, on one line at 375 pt: the name shrinks to fit
 * before it would wrap. The screen pads it below the status bar (safe-area inset).
 */
export function TodayHeader({
  title,
  coach,
  week = null,
  onWeek,
}: {
  title: string;
  /** The shared coach bar, compact (`CoachAskBar compact`). */ coach: ReactNode;
  /** (Ben, 23 Oct: plan length = block 1; training-blocks §3.1) `· Week 3 of 6`, `· Week 6 of 6 · Deload`, `· Block done`. */
  week?: { text: string; accessibilityLabel: string; deload: boolean; done: boolean } | null;
  /** Opens Library › Your plan (the week strip). */
  onWeek?: () => void;
}) {
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  // (Ben, 26 Oct; review finding 14) The week goes under the name when the row has no room for it (320 pt, large text).
  const stacked = week !== null && todayWeekStacked(width, fontScale);
  const weekLink =
    week === null ? null : (
      <Pressable accessibilityRole="button" accessibilityLabel={week.accessibilityLabel} onPress={onWeek} hitSlop={HIT} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', flexShrink: 1, opacity: pressed ? 0.7 : 1 })}>
        <AppText variant="callout" color="text.secondary" numeric {...TODAY_TEXT_FIT.weekLabel} numberOfLines={stacked ? 2 : 1}>
          {`${stacked ? '' : '· '}${week.deload ? '◐ ' : ''}${week.text}${week.done ? ' ›' : ''}`}
        </AppText>
      </Pressable>
    );
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], minHeight: 44 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: theme.space['2'], flexShrink: 1 }}>
          <AppText variant="title1" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ flexShrink: 1 }}>
            {title}
          </AppText>
          {stacked ? null : weekLink}
        </View>
        {coach}
      </View>
      {stacked ? weekLink : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The 7-day strip

function StripPill({ item }: { item: StripItem }) {
  const theme = useTheme();
  const st = stripPillStyle(item, theme);
  return (
    <View
      style={{
        alignSelf: 'stretch',
        borderRadius: theme.radius.sm,
        paddingHorizontal: STRIP_LAYOUT.pillPadding,
        paddingVertical: 2,
        backgroundColor: st.backgroundColor,
        borderWidth: st.borderWidth,
        borderStyle: st.borderStyle,
        borderColor: st.borderColor,
      }}
    >
      <AppText variant="callout" align="center" {...STRIP_LABEL_FIT} style={{ fontSize: STRIP_LAYOUT.fontSize, lineHeight: STRIP_LAYOUT.lineHeight, letterSpacing: STRIP_LAYOUT.letterSpacing, color: st.color }}>
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
    <View style={{ flexDirection: 'row', gap: STRIP_LAYOUT.cellGap }}>
      {cells.map((c) => (
        <Fragment key={c.date}>
          {c.weekStart ? <View accessible={false} style={{ width: STRIP_LAYOUT.divider, backgroundColor: theme.colors['border.divider'] }} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={c.accessibilityLabel}
            onPress={() => {
              onDay(c);
            }}
            style={({ pressed }) => ({
              // Seven equal columns (§2.0.2 region 3): every cell the same share, never sized by its label.
              flex: 1,
              flexBasis: 0,
              minWidth: 0,
              minHeight: 64,
              paddingVertical: theme.space['1'],
              paddingHorizontal: STRIP_LAYOUT.cellPadding,
              alignItems: 'center',
              gap: 2,
              borderRadius: theme.radius.sm,
              borderWidth: c.today ? STRIP_LAYOUT.todayBorder : 0,
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
              <StripPill key={`${it.kind}:${String(i)}`} item={it} />
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
// Recent (Ben, 26 Oct; docs/design/history.md §2)

/**
 * What Ben did in the last 14 days, newest first, at most 6 rows (`todaySession` picks them), then `All history ›`.
 * One compact row each: `Sun 25 Oct  Push A  52 min · 16 sets ›`; at accessibility sizes the value wraps under the
 * name. A workout opens its Summary, an activity its sheet. Nothing done: the caller shows no section.
 */
export function RecentSection({ items, onItem, onAll }: { items: readonly FeedItem[]; onItem: (item: FeedItem) => void; onAll: () => void }) {
  const theme = useTheme();
  const ax = useAx();
  return (
    <View style={{ gap: theme.space['2'] }}>
      <SectionHeader title={HISTORY_COPY.recent} />
      <Group>
        {items.map((it) => (
          <Pressable
            key={it.key}
            accessibilityRole="button"
            accessibilityLabel={it.accessibilityLabel}
            onPress={() => {
              onItem(it);
            }}
            style={({ pressed }) => ({ minHeight: theme.target.min.height, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['2'], flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
          >
            <View style={{ flex: 1, flexDirection: ax ? 'column' : 'row', alignItems: ax ? 'flex-start' : 'baseline', gap: ax ? 2 : theme.space['3'] }}>
              <AppText variant="callout" color="text.secondary" numeric style={ax ? undefined : { minWidth: 76 }}>
                {it.when}
              </AppText>
              <AppText variant="body" numberOfLines={ax ? undefined : 1} style={ax ? undefined : { flex: 1 }}>
                {it.title}
              </AppText>
              <AppText variant="callout" color="text.secondary" numeric>
                {it.value}
              </AppText>
            </View>
            {/* (ADR 0035) From Apple Health, or linked to a Health workout: a small mark (the label says it in words). */}
            {(it.kind === 'workout' && it.linkedSource !== undefined) || (it.kind === 'activity' && it.fromHealth !== undefined) ? <Icon name="heart.fill" size={12} color="text.secondary" /> : null}
            <Icon name="chevron.right" size={14} color="text.tertiary" />
          </Pressable>
        ))}
      </Group>
      <View style={{ alignSelf: 'flex-start' }}>
        <TextButton label={HISTORY_COPY.allHistory} accessibilityLabel={HISTORY_COPY.allHistoryLabel} tone="secondary" onPress={onAll} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Day control

export function DayControl({ segments, paused, onDay, onMore, onAxList, axLabel }: { segments: readonly TodaySegment[]; paused: boolean; onDay: (key: string) => void; onMore: () => void; onAxList: () => void; axLabel: string }) {
  const theme = useTheme();
  // (Ben, 26 Oct) From xxxLarge, not AX1: the segments would cut `Shoulders` before then.
  const asList = dayRowAsList(useWindowDimensions().fontScale);
  if (asList) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Day, ${axLabel}`} onPress={onAxList} style={({ pressed }) => ({ minHeight: theme.target.workout.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: pressed ? 0.7 : 1 })}>
        <AppText variant="callout" color="text.secondary">
          Day
        </AppText>
        <AppText variant="body" style={{ flexShrink: 1, textAlign: 'right' }}>{`${axLabel} ›`}</AppText>
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
            <AppText variant="label" color={s.selected ? 'text.primary' : 'text.tertiary'} {...TODAY_TEXT_FIT.segmentLabel} style={{ fontSize: 15, paddingHorizontal: 2 }}>
              {s.label}
            </AppText>
            {s.next ? (
              <AppText variant="sectionLabel" color={s.selected ? 'text.primary' : 'text.tertiary'} {...TODAY_TEXT_FIT.segmentNext} style={{ fontSize: 10, lineHeight: 12 }}>
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
export function SessionListSheet({ visible, title, days, selectedKey, nextKey, onPick, onEmpty, onBuild, onPastLog, onClose }: { visible: boolean; title: string; days: readonly TodayDay[]; selectedKey: string | null; nextKey: string | null; onPick: (key: string) => void; onEmpty: () => void; onBuild: () => void; /** (Ben, 25 Oct) `Log a past workout`. */ onPastLog?: () => void; onClose: () => void }) {
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
          {onPastLog ? <TextButton label={PAST_LOG_COPY.entry} onPress={onPastLog} /> : null}
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
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], minHeight: ROW_H, flexWrap: 'wrap' }}>
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

/**
 * `Abs` / `Supersets`: the whole 44 pt row is the switch (review S9: a `hitSlop` on a View around a Switch doesn't
 * enlarge the Switch's own touch area on iOS). VoiceOver reads one switch with its state; the Switch inside only shows it.
 */
function ToggleRow({ label, sub, value, onChange }: { label: string; sub?: string | null; value: boolean; onChange: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      accessibilityState={{ checked: value }}
      onPress={onChange}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], minHeight: ROW_H, opacity: pressed ? 0.7 : 1 })}
    >
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
      <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
        <Switch value={value} accessible={false} />
      </View>
    </Pressable>
  );
}

/**
 * (D3, Ben 22–23 Oct) The controls that left Today's card, on Your workout opened from Today: `Main lift` (only with more
 * than one template), `Accessories` Focused | Varied, `Abs` and `Supersets`. The same 44 pt rows as the card had; each
 * tap is one change the service makes (with Undo), never computed here.
 */
export function TodayOptionRows({ options, onChange, onMix }: { options: TodayOptions; onChange: (c: TodayOptionChange) => void; /** (Ben, 23 Oct) Your workout's fifth row, `↻ Mix it up`; absent: not shown. */ onMix?: () => void }) {
  const theme = useTheme();
  return (
    <View>
      {options.mainLifts.length > 1 ? (
        <ControlRow label={TODAY_V2_COPY.mainLift}>
          {options.mainLifts.map((m) => (
            <Chip key={m.exerciseId} label={m.label} selected={m.selected} accessibilityLabel={`Main lift, ${m.label}`} onPress={() => { if (!m.selected) onChange({ kind: 'main_lift', exerciseId: m.exerciseId }); }} />
          ))}
        </ControlRow>
      ) : null}
      <ControlRow label={TODAY_V2_COPY.accessories}>
        <Chip label={TODAY_V2_COPY.focused} selected={options.accessories === 'focused'} accessibilityLabel={`Accessories, ${TODAY_V2_COPY.focused}`} onPress={() => { if (options.accessories !== 'focused') onChange({ kind: 'accessories', style: 'focused' }); }} />
        <Chip label={TODAY_V2_COPY.varied} selected={options.accessories === 'varied'} accessibilityLabel={`Accessories, ${TODAY_V2_COPY.varied}`} onPress={() => { if (options.accessories !== 'varied') onChange({ kind: 'accessories', style: 'varied' }); }} />
      </ControlRow>
      <ToggleRow label={TODAY_V2_COPY.abs} value={options.abs} onChange={() => { onChange({ kind: 'abs', on: !options.abs }); }} />
      <ToggleRow label={TODAY_V2_COPY.supersets} value={options.supersets} onChange={() => { onChange({ kind: 'supersets', on: !options.supersets }); }} />
      {onMix !== undefined ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Mix it up" onPress={onMix} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: ROW_H, opacity: pressed ? 0.7 : 1, gap: theme.space['2'] })}>
          <AppText variant="callout" style={{ fontSize: 15 }}>
            {TODAY_V2_COPY.mix}
          </AppText>
        </Pressable>
      ) : null}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
          {r.held ? <Icon name="exclamationmark.triangle" size={13} color="status.warning" /> : null}
          <AppText variant="callout" style={{ flexShrink: 1 }}>
            {r.name}
          </AppText>
        </View>
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
  why,
  moved,
  busy,
  dispatch,
  onStart,
  onEdit,
  onBackToPlan,
  onTimeNote,
  onEditedTime,
  offer = null,
  onEmpty,
}: {
  /** (Ben, 26 Oct) `Empty workout` under Start: one tap, the screen's own empty start. */
  onEmpty?: (() => void) | undefined;
  /** (§6.1) The coach's pre-session line with code's offer (`Apply` / `Skip`, rule 3); null: nothing to say. */
  offer?: { line: string; lines: string[]; busy: boolean; onApply: () => void; onSkip: () => void; /** (§6.2) Opens Progress › Reviews. */ onReviews?: () => void } | null;
  view: TodayCardView;
  why: boolean;
  moved: string | null;
  busy: boolean;
  dispatch: (a: TodayCardAction) => void;
  onStart: () => void;
  onEdit: () => void;
  onBackToPlan: () => void;
  /** The Time note's tap: everything the fit changed, with Undo (the screen's sheet). */
  onTimeNote: () => void;
  /** (Review todaylean S4) An edited card's Time step: Your workout's Time on that draft at this length (the screen writes it). */
  onEditedTime: (minutes: number) => void;
}) {
  const theme = useTheme();
  const time = view.time;
  // (fit-to-time 22 Oct revision, item 4) `Time · −1 exercise ›  [−] 45 min [+]`: the note in place, nothing moves.
  const timeRow =
    time === null ? null : (
      <TimeNoteRow
        minutes={time.minutes}
        over={time.over}
        note={time.note}
        noteLabel={time.noteLabel}
        onStep={(d) => {
          // (Ben, 27 Oct) The number is the live estimate; a step goes to the service's next length (`liveTime`).
          const to = d < 0 ? time.less : time.more;
          if (to === null) return;
          if (view.edited !== null) onEditedTime(to);
          else dispatch({ kind: 'minutes_to', minutes: to });
        }}
        onNote={onTimeNote}
      />
    );
  const backToPlan = (
    <View style={{ alignSelf: 'flex-start' }}>
      <TextButton label={TODAY_V2_COPY.backToPlan} tone="secondary" onPress={onBackToPlan} />
    </View>
  );
  // The session's rows, then `Why?`. (D3; V5: with or without a plan) Mix it up left the card with the other Today-only
  // controls; it is on Your workout.
  const details = (
    <View style={{ gap: theme.space['2'] }}>
      <BreakdownTable rows={view.rows} unit={view.unit} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['4'] }}>
        <TextButton label={TODAY_V2_COPY.why} tone="secondary" accessibilityLabel={why ? 'Hide why' : 'Why this workout'} onPress={() => { dispatch({ kind: 'why' }); }} />
      </View>
      {why ? (
        <View style={{ gap: 2 }}>
          {view.why.map((l, i) => (
            <AppText key={`${String(i)}:${l}`} variant="callout" color="text.secondary">
              {`· ${l}`}
            </AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
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
      {time?.overText != null ? (
        <AppText variant="label" color="status.warning" numeric>
          {time.overText}
        </AppText>
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

      {/* (D3, Ben 22–23 Oct; V5: no plan reads the same) The rows, Time, Start and Edit. Main lift, accessories, abs and
          supersets are in Edit (Your workout). An edited card keeps Time (the draft's own; review todaylean S4) and `Back to plan`. */}
      {timeRow}
      {view.edited === null ? null : backToPlan}
      {details}

      {offer !== null ? (
        <View style={{ gap: theme.space['1'] }} accessibilityLabel={[offer.line, ...offer.lines].join('. ')}>
          <AppText variant="callout">{offer.line}</AppText>
          {offer.lines.map((l) => (
            <AppText key={l} variant="callout" color="text.secondary" numeric>
              {l}
            </AppText>
          ))}
          {offer.lines.length > 0 || offer.onReviews !== undefined ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['4'] }}>
              {offer.lines.length > 0 ? <TextButton label={TODAY_V2_COPY.apply} disabled={offer.busy} onPress={offer.onApply} /> : null}
              {offer.lines.length > 0 ? <TextButton label={TODAY_V2_COPY.skip} tone="secondary" disabled={offer.busy} onPress={offer.onSkip} /> : null}
              {offer.onReviews !== undefined ? <TextButton label="Reviews" icon="chevron.right" tone="secondary" accessibilityLabel="Open Reviews in Progress" onPress={offer.onReviews} /> : null}
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
      {onEmpty !== undefined ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <TextButton label={TODAY_V2_COPY.emptyWorkout} tone="secondary" disabled={busy} onPress={onEmpty} />
        </View>
      ) : null}
    </View>
  );
}
