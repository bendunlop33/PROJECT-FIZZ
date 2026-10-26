import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { PB_BLOCK_COPY, PB_EDIT_COPY, pbWeekdayName, type PbBlockDay, type PbBlockStripCell } from '@fizz/domain';

import type { PlanBlockOverview } from '../../services/plan-services';
import { useTheme } from '../../theme';
import { AppText, Chip, Icon, TextButton } from '../../ui';

/**
 * (Ben, 23 Oct: plan length = block 1; prototypes plan-builder.html `renderPlan`, training-blocks.html) Your plan's
 * weeks: `Week 3 of 6` with the plan's length and effort, the week strip 1…N (D on deload weeks, ✓ on done weeks),
 * and that week's days, each opening to its exercises at that week's planned sets, reps and weights. Done weeks are
 * read-only (they say which days were done). Once the block is done, `Block done · Start next block ›` opens the
 * builder with the plan's answers. Every value comes from `services.plans.overview()`; nothing here computes a load.
 */
/** (Ben, 26 Oct) This week's plan day actions: `Move day` (Set days plans) and `Do today ›`. */
export type PlanDayActions = PlanBlockOverview['actions'];

export function PlanWeeksBlock({
  block,
  onStartNext,
  viewed: viewedProp,
  onView,
  actions,
  onMove,
  onDoToday,
}: {
  block: Pick<PlanBlockOverview, 'views' | 'current' | 'done' | 'header' | 'line'>;
  onStartNext?: () => void;
  /** Controlled week (the edit's `From week N` follows it); absent: the block keeps its own. */
  viewed?: number;
  onView?: (week: number) => void;
  actions?: PlanDayActions;
  onMove?: (dayIndex: number, weekday: number) => void;
  onDoToday?: (todayKey: string) => void;
}) {
  const theme = useTheme();
  const [own, setOwn] = useState(block.current);
  const viewed = viewedProp ?? own;
  const setViewed = (w: number): void => {
    setOwn(w);
    onView?.(w);
  };
  const [open, setOpen] = useState<number | null>(null);
  const view = block.views[Math.max(0, Math.min(block.views.length - 1, viewed - 1))];
  if (view === undefined) return null;
  return (
    <View style={{ gap: theme.space['2'] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: theme.space['2'] }}>
        <AppText variant="headline" numeric>
          {block.header}
        </AppText>
        <AppText variant="callout" color="text.secondary" numeric>
          {block.line}
        </AppText>
      </View>
      {block.done && onStartNext !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${PB_BLOCK_COPY.done}. ${PB_BLOCK_COPY.startNext}`}
          onPress={onStartNext}
          style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? 0.7 : 1 })}
        >
          <AppText variant="body" style={{ flex: 1 }}>
            {`${PB_BLOCK_COPY.done} · ${PB_BLOCK_COPY.startNext}`}
          </AppText>
          <Icon name="chevron.right" color="text.tertiary" size={14} />
        </Pressable>
      ) : null}
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['1'] }}>
        {view.strip.map((c) => (
          <WeekCell
            key={c.week}
            cell={{ ...c, selected: c.week === viewed }}
            onPress={() => {
              setViewed(c.week);
              setOpen(null);
            }}
          />
        ))}
      </View>
      {view.note !== null ? (
        <AppText variant="callout" color="text.secondary">
          {view.note}
        </AppText>
      ) : null}
      <View>
        {view.days.map((d, i) => (
          <DayCard
            key={d.index}
            day={d}
            first={i === 0}
            open={open === d.index}
            onToggle={() => {
              setOpen(open === d.index ? null : d.index);
            }}
            // This week's not-done days only (rule 2: a done day never moves).
            action={viewed === block.current && !block.done ? actions?.[d.index] : undefined}
            onMove={onMove}
            onDoToday={onDoToday}
          />
        ))}
      </View>
    </View>
  );
}

/** A week (≥ 44pt): its number, `D` on a deload week, a ✓ once done; selected is filled. Never colour alone. */
function WeekCell({ cell, onPress }: { cell: PbBlockStripCell; onPress: () => void }) {
  const theme = useTheme();
  const tint: 'on.accent' | 'text.secondary' | 'text.primary' = cell.selected ? 'on.accent' : cell.state === 'todo' ? 'text.secondary' : 'text.primary';
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: cell.selected }}
      accessibilityLabel={cell.accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 44,
        minHeight: 44,
        paddingHorizontal: theme.space['2'],
        borderRadius: theme.radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 2,
        backgroundColor: cell.selected ? theme.colors.accent : theme.colors['bg.raised'],
        borderWidth: cell.state === 'current' && !cell.selected ? 1.5 : 0,
        borderColor: theme.colors.accent,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {cell.state === 'done' ? <Icon name="checkmark" color={tint} size={10} weight="bold" /> : null}
      <AppText variant="label" color={tint} numeric>
        {String(cell.week)}
      </AppText>
      {cell.deload ? (
        <AppText variant="label" color={tint} style={{ fontSize: 11 }}>
          D
        </AppText>
      ) : null}
    </Pressable>
  );
}

/**
 * A plan day for the week viewed: its name (`Sat · Legs` on Set days plans; `✓ Done` when done that week); opens to its
 * exercises in an inset panel and, this week and not done, `Move day` (a weekday row) and `Do today ›`.
 */
function DayCard({
  day,
  first,
  open,
  onToggle,
  action,
  onMove,
  onDoToday,
}: {
  day: PbBlockDay;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  action?: PlanDayActions[number] | undefined;
  onMove?: ((dayIndex: number, weekday: number) => void) | undefined;
  onDoToday?: ((todayKey: string) => void) | undefined;
}) {
  const theme = useTheme();
  const [moving, setMoving] = useState(false);
  const title = day.weekday === null ? day.name : `${pbWeekdayName(day.weekday)} · ${day.name}`;
  return (
    <View style={{ borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}${day.done ? ', done' : ''}`}
        onPress={onToggle}
        style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? 0.7 : 1 })}
      >
        <AppText variant="body" style={{ flex: 1 }}>
          {title}
        </AppText>
        {day.done ? (
          <AppText variant="callout" color="status.done">
            {PB_BLOCK_COPY.dayDone}
          </AppText>
        ) : null}
        <Icon name={open ? 'chevron.down' : 'chevron.right'} color="text.tertiary" size={14} />
      </Pressable>
      {open ? (
        <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, paddingHorizontal: theme.space['3'], paddingVertical: theme.space['1'], marginBottom: theme.space['2'] }}>
          {day.rows.map((r, i) => (
            <View
              key={r.key}
              accessible
              accessibilityLabel={`${r.name}, ${r.line}${r.kg === null ? '' : `, ${r.kg}`}${r.est ? ', estimate' : ''}`}
              style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], borderTopWidth: i === 0 ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}
            >
              {r.kg === null ? (
                <View style={{ flex: 1, paddingVertical: theme.space['1'] }}>
                  <AppText variant="callout" style={{ fontWeight: '600' }}>
                    {r.name}
                  </AppText>
                  <AppText variant="label" color="text.secondary" numeric>
                    {`${r.line}${r.est ? ' est.' : ''}`}
                  </AppText>
                </View>
              ) : (
                <>
                  <AppText variant="callout" style={{ flex: 1, ...(r.main ? { fontWeight: '600' } : {}) }}>
                    {r.name}
                  </AppText>
                  <AppText variant="callout" color="text.secondary" numeric>
                    {r.line}
                  </AppText>
                  <AppText variant="callout" numeric style={{ minWidth: 64, textAlign: 'right' }}>
                    {`${r.kg}${r.est ? ' est.' : ''}`}
                  </AppText>
                </>
              )}
            </View>
          ))}
          {action !== undefined ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['4'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
              {action.moveTo !== null && onMove !== undefined ? (
                <TextButton
                  label={PB_EDIT_COPY.moveDay}
                  onPress={() => {
                    setMoving(!moving);
                  }}
                />
              ) : null}
              {onDoToday !== undefined ? (
                <TextButton
                  label={PB_EDIT_COPY.doToday}
                  onPress={() => {
                    onDoToday(action.todayKey);
                  }}
                />
              ) : null}
            </View>
          ) : null}
          {moving && action?.moveTo != null && onMove !== undefined ? (
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: theme.space['1'], paddingBottom: theme.space['2'] }}>
              {[0, 1, 2, 3, 4, 5, 6].map((wd) => {
                const can = action.moveTo?.includes(wd) === true;
                return (
                  <Chip
                    key={wd}
                    grow
                    size="min"
                    label={pbWeekdayName(wd)}
                    selected={wd === day.weekday}
                    disabled={!can}
                    onPress={() => {
                      if (!can || wd === day.weekday) return;
                      setMoving(false);
                      onMove(day.index, wd);
                    }}
                  />
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
