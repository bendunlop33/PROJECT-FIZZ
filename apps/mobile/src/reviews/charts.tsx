import { useState } from 'react';
import { Pressable, useWindowDimensions, View, type TextStyle, type ViewStyle } from 'react-native';

import { CHANGE_TAP_LABEL, changeRowTaps, PROGRESS_COPY, type CalendarRowView, type ChangeRowView, type ChangeTap, type LiftsView, type MuscleTrackerRowView, type MuscleTrackerView, type ThisWeekView, type WeekChipView } from '@fizz/domain';

import { createGuardedLoader } from '../guide/guarded-load';
import { TICK_MAX_SCALE } from '../progress/axis-width';
import { useAx } from '../progress/components';
import { useTheme } from '../theme';
import { AppText, Card, TextButton } from '../ui';
import { LIFT_TABLE, liftCellLines, liftsChartLayout, liftTableColumnWidth, lineAt, pointAt, ringAt } from './lifts-layout';
import type { LiftsCanvas } from './LiftsCanvas';
import { progressPalette } from './palette';

/**
 * Progress v3 cards (progress-goals.md "Progress v3 (agreed)", prototype `progress-simple.html`: its copy,
 * order, layout and sizes, minus the example data). Each lays out a pure view model and computes nothing.
 * Accessible: every visual has a VoiceOver summary, the lifts have their table, every tap target is at
 * least 44 pt (small visuals get the space around them), text scales with Dynamic Type, and colour is
 * never the only signal (each chip's second line, the table's numbers, the key).
 */

/** The prototype's sizes, as style overrides on the type tokens (Dynamic Type still scales them). */
export const PROGRESS_TEXT = {
  sec: { fontSize: 12, lineHeight: 16, letterSpacing: 1.7, fontWeight: '600' },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  key: { fontSize: 12, lineHeight: 16 },
  chipName: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: -0.24 },
  chipLine: { fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: -0.22 },
  table: { fontSize: 13, lineHeight: 18 },
  head: { fontSize: 10.5, lineHeight: 14, letterSpacing: 1, textTransform: 'uppercase' },
  row: { fontSize: 14, lineHeight: 20 },
  sub: { fontSize: 13, lineHeight: 18 },
  k: { fontSize: 15, lineHeight: 20 },
  v: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  chg: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  why: { fontSize: 14, lineHeight: 20 },
  note: { fontSize: 16, lineHeight: 23 },
  tag: { fontSize: 12, lineHeight: 16 },
  suffix: { fontSize: 11, lineHeight: 15, fontWeight: '500' },
} as const satisfies Record<string, TextStyle>;

const CARD = { padding: 14, gap: 10 } as const;

/** `THIS WEEK ……… 13–19 Oct`: a section label with its right-hand note. */
export function SectionHead({ title, right, badge }: { title: string; right: string; badge?: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: theme.space['2'], marginTop: 6, marginHorizontal: 2, marginBottom: -4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <AppText variant="sectionLabel" color="text.secondary" accessibilityRole="header" style={PROGRESS_TEXT.sec}>
          {title.toUpperCase()}
        </AppText>
        {badge != null ? (
          <View style={{ backgroundColor: theme.colors.accent, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
            <AppText variant="label" color="on.accent" style={{ fontSize: 10, lineHeight: 13, letterSpacing: 0.8, fontWeight: '700' }} maxFontSizeMultiplier={1.6}>
              {badge}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="callout" color="text.tertiary" numeric style={{ fontSize: 12, lineHeight: 16, fontWeight: '500' }}>
        {right}
      </AppText>
    </View>
  );
}

export function ProgressCard({ children }: { children: React.ReactNode }) {
  return <Card style={{ padding: CARD.padding, gap: CARD.gap, borderRadius: 18 }}>{children}</Card>;
}

// ---------------------------------------------------------------------------
// This week

function Chip({ chip, width, onOpen }: { chip: WeekChipView; width: number | null; onOpen: (sessionId: string) => void }) {
  const theme = useTheme();
  const pal = progressPalette(theme);
  const done = chip.state === 'done';
  const missed = chip.state === 'missed';
  const textColor = missed || chip.state === 'paused' ? 'text.tertiary' : 'text.primary';
  const box: ViewStyle = {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    paddingVertical: 4,
    ...(width === null ? { flexBasis: '47%', flexGrow: 1 } : { width }),
    backgroundColor: done ? pal.doneFill : missed ? pal.missedFill : 'transparent',
    borderWidth: done ? 1.5 : chip.state === 'upcoming' ? 1.5 : chip.state === 'paused' ? 1 : 0,
    borderStyle: chip.state === 'paused' ? 'dashed' : 'solid',
    borderColor: done ? pal.doneEdge : chip.state === 'upcoming' ? theme.colors['text.secondary'] : theme.colors['border.divider'],
  };
  const body = (
    <>
      <AppText variant="label" color={textColor} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={PROGRESS_TEXT.chipName}>
        {chip.name}
      </AppText>
      {chip.line !== '' ? (
        <AppText variant="label" color={missed || chip.state === 'paused' ? 'text.tertiary' : done ? 'text.primary' : 'text.secondary'} numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={PROGRESS_TEXT.chipLine}>
          {chip.line}
        </AppText>
      ) : null}
    </>
  );
  if (chip.sessionId === null) {
    return (
      <View accessible accessibilityLabel={chip.accessibilityLabel} style={box}>
        {body}
      </View>
    );
  }
  const id = chip.sessionId;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chip.accessibilityLabel}
      accessibilityHint="Opens its Summary"
      onPress={() => {
        onOpen(id);
      }}
      style={({ pressed }) => ({ ...box, opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}

export type WeekMode = 'week' | 'month';

/**
 * The This week section label: `THIS WEEK · 13–19 OCT` (or `LAST 5 WEEKS · 5 weeks on plan`) with the small
 * `Week | Month` switch on the right. The switch is small to look at; each half is a 44 pt target.
 */
export function WeekHead({ mode, range, weeksOnPlan, onMode }: { mode: WeekMode; range: string; weeksOnPlan: string | null; onMode: (m: WeekMode) => void }) {
  const theme = useTheme();
  const title = mode === 'week' ? `${PROGRESS_COPY.thisWeek} · ${range}` : PROGRESS_COPY.last5;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', columnGap: theme.space['2'], marginTop: 6, marginHorizontal: 2, marginBottom: -4 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6, flexShrink: 1 }}>
        <AppText variant="sectionLabel" color="text.secondary" accessibilityRole="header" numeric style={PROGRESS_TEXT.sec}>
          {title.toUpperCase()}
        </AppText>
        {mode === 'month' && weeksOnPlan !== null ? (
          <AppText variant="callout" color="text.tertiary" numeric style={{ fontSize: 12, lineHeight: 16, fontWeight: '500' }}>
            {weeksOnPlan}
          </AppText>
        ) : null}
      </View>
      <View accessibilityRole="tablist" accessibilityLabel="Period" style={{ flexDirection: 'row', backgroundColor: theme.colors['bg.surface'], borderRadius: 8, padding: 2 }}>
        {(['week', 'month'] as const).map((m) => {
          const on = mode === m;
          const label = m === 'week' ? PROGRESS_COPY.week : PROGRESS_COPY.month;
          return (
            <Pressable
              key={m}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              onPress={() => {
                if (!on) onMode(m);
              }}
              // 26 pt to look at, 44 pt to tap (the slop takes it the rest of the way).
              hitSlop={{ top: 9, bottom: 9, left: 2, right: 2 }}
              style={{ minHeight: 26, minWidth: 44, paddingHorizontal: 10, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? theme.colors['bg.raised'] : 'transparent' }}
            >
              <AppText variant="label" color={on ? 'text.primary' : 'text.tertiary'} maxFontSizeMultiplier={1.6} style={{ fontSize: 11, lineHeight: 14, fontWeight: '600' }}>
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const CAL = { label: 50, right: 46, cell: 28, gap: 4 } as const;
type CalKind = 'done' | 'missed' | 'planned' | 'rest';

/** One calendar day (or a planned session with no day): done soft green with its letter, missed faint grey, planned outlined. */
function CalBox({ kind, letter, cardio, width, paused }: { kind: CalKind; letter: string; cardio: boolean; width?: number; paused?: boolean }) {
  const theme = useTheme();
  const pal = progressPalette(theme);
  const style: ViewStyle = {
    height: CAL.cell,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...(width === undefined ? { flex: 1, minWidth: 0 } : { width }),
    backgroundColor: kind === 'done' ? pal.doneFill : kind === 'missed' ? pal.missedFill : paused === true ? 'transparent' : pal.restFill,
    borderWidth: kind === 'rest' ? (paused === true ? 1 : 0) : kind === 'missed' ? 1 : 1.5,
    borderColor: kind === 'done' ? pal.doneEdge : kind === 'planned' ? theme.colors['text.secondary'] : theme.colors['border.divider'],
    opacity: paused === true ? 0.5 : 1,
  };
  return (
    <View style={style}>
      {letter !== '' ? (
        <AppText variant="label" color={kind === 'missed' ? 'text.tertiary' : 'text.primary'} numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 12, lineHeight: 15, fontWeight: '700' }}>
          {letter}
        </AppText>
      ) : null}
      {cardio ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors['text.secondary'], ...(letter !== '' ? { position: 'absolute', bottom: 2 } : {}) }} /> : null}
    </View>
  );
}

/** The calendar key's small squares (`Done · Missed · Planned · Cardio`). */
function CalKey({ kind }: { kind: CalKind }) {
  const theme = useTheme();
  const pal = progressPalette(theme);
  if (kind === 'rest') {
    return (
      <View style={{ width: 16, height: 14, borderRadius: 4, backgroundColor: pal.restFill, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors['text.secondary'] }} />
      </View>
    );
  }
  return (
    <View style={{ width: 16, height: 14, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: kind === 'done' ? pal.doneFill : kind === 'missed' ? pal.missedFill : 'transparent', borderWidth: kind === 'missed' ? 1 : 1.5, borderColor: kind === 'done' ? pal.doneEdge : kind === 'planned' ? theme.colors['text.secondary'] : theme.colors['border.divider'] }}>
      <AppText variant="label" color={kind === 'missed' ? 'text.tertiary' : 'text.primary'} maxFontSizeMultiplier={1.2} style={{ fontSize: 9, lineHeight: 11, fontWeight: '700' }}>
        {kind === 'done' ? 'C' : 'L'}
      </AppText>
    </View>
  );
}

/**
 * Month: `This wk` and the 4 weeks before, M–S. Done sessions sit on the day they were logged; missed and
 * planned ones are listed after the row with no day (plan days aren't dated, rule 6). A row with a stored
 * review opens it. VoiceOver reads each row as one sentence.
 */
export function MonthCalendar({ rows, onOpenReview }: { rows: readonly CalendarRowView[]; onOpenReview: (reviewId: string) => void }) {
  const theme = useTheme();
  const head = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: CAL.gap, minHeight: 16 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ width: CAL.label }} />
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
        <AppText key={`${d}${String(i)}`} variant="label" color="text.tertiary" align="center" maxFontSizeMultiplier={1.3} style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 14 }}>
          {d}
        </AppText>
      ))}
      <View style={{ width: CAL.right }} />
    </View>
  );
  return (
    <View accessibilityRole="list" style={{ gap: 2 }}>
      {head}
      {rows.map((r) => {
        const content = (
          <View style={{ gap: 4, paddingVertical: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: CAL.gap }}>
              <AppText variant="callout" color={r.now ? 'text.primary' : 'text.secondary'} numeric numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ width: CAL.label, fontSize: 12, lineHeight: 16, fontWeight: r.now ? '600' : '400' }}>
                {r.label}
              </AppText>
              {r.cells.map((c) => (
                <CalBox key={c.date} kind={c.done.length > 0 ? 'done' : 'rest'} letter={c.done.map((d) => d.letter).join('')} cardio={c.cardio} paused={r.paused} />
              ))}
              <AppText variant="callout" color="text.secondary" numeric align="right" numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ width: CAL.right, fontSize: 12, lineHeight: 16 }}>
                {r.right}
              </AppText>
            </View>
            {r.open.length > 0 ? (
              <View style={{ flexDirection: 'row', gap: CAL.gap, paddingLeft: CAL.label + CAL.gap }}>
                {r.open.map((o, i) => (
                  <CalBox key={`${o.letter}${String(i)}`} kind={o.state} letter={o.letter} cardio={false} width={CAL.cell} />
                ))}
              </View>
            ) : null}
          </View>
        );
        const row = { minHeight: 44, justifyContent: 'center', borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'] } as const;
        if (r.reviewId === null) {
          return (
            <View key={r.key} accessible accessibilityLabel={r.accessibilityLabel} style={row}>
              {content}
            </View>
          );
        }
        const reviewId = r.reviewId;
        return (
          <Pressable
            key={r.key}
            accessibilityRole="button"
            accessibilityLabel={r.accessibilityLabel}
            accessibilityHint="Opens that week’s review"
            onPress={() => {
              onOpenReview(reviewId);
            }}
            style={({ pressed }) => ({ ...row, opacity: pressed ? 0.7 : 1 })}
          >
            {content}
          </Pressable>
        );
      })}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, paddingTop: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {(['done', 'missed', 'planned', 'rest'] as const).map((k, i) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <CalKey kind={k} />
            <AppText variant="callout" color="text.secondary" style={{ fontSize: 11.5, lineHeight: 15 }}>
              {PROGRESS_COPY.calendarKey[i]}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

/** This week: `Sessions 3 of 4 · 2 cardio`, then a chip per planned session (Week) or the 5-week calendar (Month). */
export function WeekCard({ view, mode, onOpenSession, onOpenReview }: { view: ThisWeekView; mode: WeekMode; onOpenSession: (sessionId: string) => void; onOpenReview: (reviewId: string) => void }) {
  const ax = useAx();
  const [width, setWidth] = useState(0);
  const perRow = ax ? 2 : 4;
  const gap = 4;
  const chipWidth = width > 0 ? Math.floor((width - gap * (perRow - 1)) / perRow) : null;
  return (
    <ProgressCard>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 10 }} accessible accessibilityLabel={`Sessions ${view.sessions}${view.cardio === null ? '' : `, ${view.cardio}`}`}>
        <AppText variant="callout" color="text.secondary" style={PROGRESS_TEXT.k}>
          {PROGRESS_COPY.sessions}
        </AppText>
        <AppText variant="headline" numeric style={PROGRESS_TEXT.v}>
          {view.sessions}
          {view.cardio !== null ? (
            <AppText variant="callout" color="text.secondary" style={{ fontSize: 14, fontWeight: '500' }}>
              {` · ${view.cardio}`}
            </AppText>
          ) : null}
        </AppText>
      </View>
      {mode === 'month' ? (
        <MonthCalendar rows={view.month.rows} onOpenReview={onOpenReview} />
      ) : view.chips.length > 0 ? (
        <View
          accessibilityRole="list"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}
          onLayout={(e) => {
            setWidth(Math.floor(e.nativeEvent.layout.width));
          }}
        >
          {view.chips.map((c) => (
            <Chip key={c.key} chip={c} width={chipWidth} onOpen={onOpenSession} />
          ))}
        </View>
      ) : null}
    </ProgressCard>
  );
}

// ---------------------------------------------------------------------------
// Lifts

export const loadLiftsCanvas = createGuardedLoader(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy, guarded load (Skia)
  const mod = require('./LiftsCanvas') as { LiftsCanvas: typeof LiftsCanvas };
  return mod.LiftsCanvas;
});

const SMALL_LINK = { minHeight: 44, justifyContent: 'center' } as const;

function SmallLink({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ ...SMALL_LINK, opacity: pressed ? 0.7 : 1 })}>
      <AppText variant="callout" style={[PROGRESS_TEXT.sub, { fontWeight: '600', textDecorationLine: 'underline', textDecorationColor: theme.colors['text.tertiary'] }]}>
        {label}
      </AppText>
    </Pressable>
  );
}

const LIFT_COLS = { dot: LIFT_TABLE.dot, gap: LIFT_TABLE.gap } as const;

/**
 * Current / Target: the `PB` tag, the number and the load word on as many lines as the column needs (never a
 * cut-off number; review progress-v3b-design S1). Before the table is measured everything is on one line.
 */
function LoadCell({ width, number, suffix, pb }: { width: number; number: string; suffix: string | null; pb: boolean }) {
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(fontScale, LIFT_TABLE.maxScale);
  const lines = width <= 0 ? [[...(pb ? (['pb'] as const) : []), 'number' as const, ...(suffix === null ? [] : (['suffix'] as const))]] : liftCellLines({ width, number, suffix, pb, fontScale: scale });
  return (
    <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>
      {lines.map((line) => (
        <View key={line.join('-')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: LIFT_TABLE.partGap }}>
          {line.map((part) =>
            part === 'pb' ? (
              <PbTag key="pb" />
            ) : part === 'number' ? (
              <AppText key="n" variant="callout" numeric align="right" maxFontSizeMultiplier={LIFT_TABLE.maxScale} style={[PROGRESS_TEXT.table, { fontWeight: '600', flexShrink: 0 }]}>
                {number}
              </AppText>
            ) : (
              <AppText key="s" variant="callout" color="text.secondary" align="right" maxFontSizeMultiplier={LIFT_TABLE.maxScale} style={PROGRESS_TEXT.suffix}>
                {suffix}
              </AppText>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

/** The table's small `PB` tag (the latest top set is a PB); the row's VoiceOver label says it in words. */
function PbTag() {
  const theme = useTheme();
  return (
    <View style={{ backgroundColor: theme.colors.accent, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <AppText variant="label" color="on.accent" maxFontSizeMultiplier={1.4} style={{ fontSize: 9.5, lineHeight: 12, fontWeight: '700', letterSpacing: 0.4 }}>
        {PROGRESS_COPY.pb}
      </AppText>
    </View>
  );
}

function LiftHead({ cells, top }: { cells: readonly string[]; top: boolean }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'center', gap: LIFT_COLS.gap, minHeight: 22, paddingHorizontal: 2, ...(top ? {} : { marginTop: 6, paddingTop: 6, borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'] }) }}
    >
      <View style={{ width: LIFT_COLS.dot }} />
      {cells.map((c, i) => (
        <AppText key={`${c}-${String(i)}`} variant="label" color="text.tertiary" align={i === 0 ? 'left' : 'right'} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[PROGRESS_TEXT.head, { flex: 1 }]}>
          {c}
        </AppText>
      ))}
    </View>
  );
}

/** Lifts: the chart (all lifts, or one alone on its own scale) and the table `LIFT · REPS · CURRENT · TARGET`. */
export function LiftsCard({ view, onEdit, onOpen }: { view: LiftsView; onEdit: (() => void) | null; /** `All lifts ›` (null) → the Lifts tab; `Open Bench ›` → that lift's page there. */ onOpen: (exerciseId: string | null) => void }) {
  const theme = useTheme();
  const pal = progressPalette(theme);
  const [focus, setFocus] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [tableWidth, setTableWidth] = useState(0);
  const column = liftTableColumnWidth(tableWidth);
  const one = focus === null ? null : (view.lifts.find((l) => l.exerciseId === focus) ?? null);
  const layout = liftsChartLayout({ lifts: view.lifts, focus: one === null ? null : one.exerciseId, weeks: view.weeks, width: Math.max(width, 1) });
  const loaded = loadLiftsCanvas();
  const Drawing = loaded.ok ? loaded.value : null;
  const showChart = (one === null ? view.lifts.some((l) => l.colour !== null) : one.chartable && one.points.length > 0) && Drawing !== null;
  const toggle = (id: string) => {
    setPicked(null);
    setFocus((f) => (f === id ? null : id));
  };
  const main = view.lifts.filter((l) => !l.accessory);
  const acc = view.lifts.filter((l) => l.accessory);
  const row = (l: (typeof view.lifts)[number]) => {
    const on = focus === l.exerciseId;
    const dim = focus !== null && !on;
    return (
      <Pressable
        key={l.exerciseId}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${l.accessibilityLabel}. ${on ? 'Showing alone' : 'Show alone'}`}
        onPress={() => {
          toggle(l.exerciseId);
        }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: LIFT_COLS.gap, minHeight: 44, paddingHorizontal: 2, borderRadius: 8, borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'], backgroundColor: on ? theme.colors['bg.raised'] : 'transparent', opacity: dim ? 0.5 : pressed ? 0.7 : 1 })}
      >
        <View style={{ width: LIFT_COLS.dot, alignItems: 'center' }}>
          <View style={l.colour === null ? { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: theme.colors['text.tertiary'] } : { width: 8, height: 8, borderRadius: 4, backgroundColor: pal.lines[l.colour] }} />
        </View>
        <AppText variant="callout" numberOfLines={1} style={[PROGRESS_TEXT.table, { flex: 1, fontWeight: '600' }]}>
          {l.name}
        </AppText>
        <AppText variant="callout" color="text.secondary" numeric align="right" style={[PROGRESS_TEXT.table, { flex: 1 }]}>
          {l.repsText}
        </AppText>
        <LoadCell width={column} number={l.current} suffix={l.current === '–' ? null : l.loadSuffix} pb={l.latestPb} />
        <LoadCell width={column} number={l.targetText} suffix={l.target === null ? null : l.loadSuffix} pb={false} />
      </Pressable>
    );
  };
  return (
    <ProgressCard>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 10 }}>
        <AppText variant="headline" accessibilityRole="header" style={PROGRESS_TEXT.title}>
          {PROGRESS_COPY.lifts}
        </AppText>
        {one !== null ? (
          <SmallLink
            label={PROGRESS_COPY.allLifts}
            accessibilityLabel="Show all lifts"
            onPress={() => {
              setFocus(null);
              setPicked(null);
            }}
          />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <AppText variant="callout" color="text.secondary" style={PROGRESS_TEXT.key} accessibilityLabel="Top set. A ring means a personal best. Hollow dot means estimated.">
              {`${PROGRESS_COPY.topSet} · ${PROGRESS_COPY.pbKey} · ${PROGRESS_COPY.est}${onEdit === null ? '' : ' · '}`}
            </AppText>
            {onEdit !== null ? <SmallLink label={PROGRESS_COPY.edit} onPress={onEdit} accessibilityLabel="Edit lifts" /> : null}
          </View>
        )}
      </View>
      {one !== null ? (
        <AppText variant="callout" color="text.secondary" numeric style={PROGRESS_TEXT.sub}>
          <AppText variant="callout" style={[PROGRESS_TEXT.sub, { fontWeight: '700' }]}>
            {one.name}
          </AppText>
          {` · ${one.focus.subtitle}`}
          {one.focus.eta !== null ? ` · ${one.focus.eta} ` : null}
          {one.focus.eta !== null ? (
            <AppText variant="callout" color="text.tertiary" style={PROGRESS_TEXT.tag}>
              {PROGRESS_COPY.estWord}
            </AppText>
          ) : null}
        </AppText>
      ) : null}
      {one?.focus.onTrack === true ? (
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors['bg.raised'], borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors['status.done'] }} />
            <AppText variant="callout" style={PROGRESS_TEXT.sub}>
              {PROGRESS_COPY.onTrack}
            </AppText>
          </View>
        </View>
      ) : null}
      {picked !== null ? (
        <AppText variant="callout" color="text.secondary" numeric style={PROGRESS_TEXT.sub} accessibilityLiveRegion="polite">
          {picked}
        </AppText>
      ) : null}
      {showChart ? (
        <View accessible accessibilityRole="image" accessibilityLabel={one === null ? view.chartLabel : one.chartLabel} accessibilityHint={one === null ? 'Tap a lift in the table to see it alone' : undefined}>
          <Pressable
            accessible={false}
            onPress={(e) => {
              const { locationX, locationY } = e.nativeEvent;
              // A PB ring first (`PB · Bench 100 × 6 · week of 13 Oct`), then (all lifts) the line to focus.
              const ring = ringAt(layout, locationX, locationY);
              if (ring?.ringDetail != null) {
                setPicked(ring.ringDetail.replaceAll('\u00a0', ' '));
                return;
              }
              if (one === null) {
                const hit = lineAt(layout, locationX, locationY);
                if (hit !== null) toggle(hit);
                return;
              }
              const p = pointAt(layout, locationX, locationY);
              setPicked(p === null ? null : p.detail.replaceAll(' ', ' '));
            }}
            style={{ height: layout.height }}
            onLayout={(e) => {
              setWidth(Math.floor(e.nativeEvent.layout.width));
            }}
          >
            {width > 0 ? (
              <Drawing layout={layout} colours={pal.lines} grid={theme.colors['chart.grid']} surface={theme.colors['bg.surface']} target={theme.colors.accent} marker={theme.colors['text.tertiary']} lineWidth={theme.chart.activeLineWidth} />
            ) : null}
            {layout.ticks.map((t, i) => (
              <View key={`t${String(i)}`} pointerEvents="none" style={{ position: 'absolute', left: 0, width: layout.plot.left - 6, top: t.y - 8 }}>
                <AppText variant="label" color="text.tertiary" numeric align="right" maxFontSizeMultiplier={TICK_MAX_SCALE} style={{ fontSize: 11, lineHeight: 15 }}>
                  {t.label}
                </AppText>
              </View>
            ))}
            {layout.lines.map((l) =>
              l.gutter === null ? null : (
                <View key={`gl${l.key}`} pointerEvents="none" style={{ position: 'absolute', right: 2, top: l.gutter.y - 7 }}>
                  <AppText variant="label" numeric maxFontSizeMultiplier={TICK_MAX_SCALE} style={{ fontSize: 10, lineHeight: 13, fontWeight: '700', color: pal.lines[l.colour] }}>
                    {l.gutter.label}
                  </AppText>
                </View>
              ),
            )}
            {layout.target !== null ? (
              <View pointerEvents="none" style={{ position: 'absolute', right: width - layout.plot.right, top: layout.target.y - 20 }}>
                <AppText variant="label" color="text.secondary" numeric maxFontSizeMultiplier={TICK_MAX_SCALE} style={{ fontSize: 11, lineHeight: 15 }}>
                  {layout.target.label}
                </AppText>
              </View>
            ) : null}
            {layout.marker !== null ? (
              <View pointerEvents="none" style={{ position: 'absolute', left: layout.marker.x + 3, top: layout.plot.top - 2 }}>
                <AppText variant="label" color="text.tertiary" numeric maxFontSizeMultiplier={TICK_MAX_SCALE} style={{ fontSize: 10, lineHeight: 13 }}>
                  {layout.marker.label}
                </AppText>
              </View>
            ) : null}
            {layout.xLabels.map((x) => (
              <View key={`x${x.text}${String(x.x)}`} pointerEvents="none" style={{ position: 'absolute', top: layout.height - 18, ...(x.anchor === 'start' ? { left: x.x } : { right: width - x.x }) }}>
                <AppText variant="label" color="text.tertiary" numeric maxFontSizeMultiplier={TICK_MAX_SCALE} style={{ fontSize: 11, lineHeight: 15 }}>
                  {x.text}
                </AppText>
              </View>
            ))}
          </Pressable>
        </View>
      ) : null}
      <View
        onLayout={(e) => {
          setTableWidth(Math.floor(e.nativeEvent.layout.width));
        }}
      >
        <LiftHead cells={[PROGRESS_COPY.liftHead[0], PROGRESS_COPY.liftHead[1], `${PROGRESS_COPY.liftHead[2]} ${view.unit}`, `${PROGRESS_COPY.liftHead[3]} ${view.unit}`]} top />
        {main.map(row)}
        {acc.length > 0 ? <LiftHead cells={[PROGRESS_COPY.accessories, '', '', '']} top={false} /> : null}
        {acc.map(row)}
      </View>
      <View style={{ alignSelf: 'flex-end' }}>
        <SmallLink
          label={one === null ? PROGRESS_COPY.allLiftsLink : PROGRESS_COPY.openLift(one.name)}
          accessibilityLabel={one === null ? 'All lifts. Opens the Lifts tab' : `Open ${one.name} in the Lifts tab`}
          onPress={() => {
            onOpen(one === null ? null : one.exerciseId);
          }}
        />
      </View>
    </ProgressCard>
  );
}

// ---------------------------------------------------------------------------
// Muscles

const SPARK = { width: 120, height: 26 } as const;

function MuscleBars({ row }: { row: MuscleTrackerRowView }) {
  const theme = useTheme();
  const pal = progressPalette(theme);
  const n = row.bars.length;
  const slot = SPARK.width / Math.max(1, n);
  const y = (v: number) => SPARK.height - (SPARK.height * v) / row.scaleMax;
  return (
    <View style={{ width: SPARK.width, height: SPARK.height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {row.bars.map((b, i) => {
        const left = i * slot + 1.5;
        const w = slot - 3;
        if (b.value === null) return <View key={`b${String(i)}`} style={{ position: 'absolute', left, width: w, top: SPARK.height - 3, height: 2, borderRadius: 1, backgroundColor: theme.colors['border.divider'] }} />;
        const top = y(b.value);
        return <View key={`b${String(i)}`} style={{ position: 'absolute', left, width: w, top, height: Math.max(0, SPARK.height - top), borderRadius: 2, backgroundColor: b.atPlan ? pal.data : pal.dataUnder }} />;
      })}
      {/* The plan: a dotted line per week (weeks can differ), 2 pt on, 2 pt off. */}
      {row.bars.map((b, i) =>
        b.planned === null
          ? null
          : Array.from({ length: Math.floor(slot / 4) }, (_, k) => <View key={`p${String(i)}-${String(k)}`} style={{ position: 'absolute', left: i * slot + k * 4, top: y(b.planned ?? 0), width: 2, height: 1, backgroundColor: theme.colors['text.primary'] }} />),
      )}
    </View>
  );
}

/** Muscles: a row per muscle, 8 weekly mini bars against the plan line, last week `9 of 14`. */
export function MusclesCard({ view, onDetails }: { view: MuscleTrackerView; /** `Details ›` → the Training tab. */ onDetails: () => void }) {
  const theme = useTheme();
  const pal = progressPalette(theme);
  const ax = useAx();
  const keyDot = (c: string) => <View style={{ width: 8, height: 10, borderRadius: 2, backgroundColor: c, marginRight: 4 }} />;
  return (
    <ProgressCard>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 10 }}>
        <AppText variant="headline" accessibilityRole="header" style={PROGRESS_TEXT.title}>
          {PROGRESS_COPY.muscles}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {keyDot(pal.data)}
            <AppText variant="callout" color="text.secondary" style={PROGRESS_TEXT.key}>
              {PROGRESS_COPY.atPlan}
            </AppText>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {keyDot(pal.dataUnder)}
            <AppText variant="callout" color="text.secondary" style={PROGRESS_TEXT.key}>
              {PROGRESS_COPY.under}
            </AppText>
          </View>
          <AppText variant="callout" color="text.secondary" style={PROGRESS_TEXT.key}>
            {PROGRESS_COPY.plan}
          </AppText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 20 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {PROGRESS_COPY.muscleHead.map((h, i) => (
          <AppText key={h} variant="label" color="text.tertiary" align={i === 2 ? 'right' : 'left'} numberOfLines={1} style={[PROGRESS_TEXT.head, i === 1 ? { width: ax ? undefined : SPARK.width, flex: ax ? 1 : undefined } : { flex: 1 }]}>
            {h}
          </AppText>
        ))}
      </View>
      <View accessibilityRole="list" accessibilityLabel="Sets per muscle per week">
        {view.rows.map((r) => (
          <View key={r.key} accessible accessibilityLabel={r.accessibilityLabel} style={{ flexDirection: 'row', flexWrap: ax ? 'wrap' : 'nowrap', alignItems: 'center', columnGap: 10, rowGap: 4, minHeight: 36, borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'], paddingVertical: ax ? 6 : 0 }}>
            <AppText variant="callout" style={[PROGRESS_TEXT.row, { flex: 1 }]}>
              {r.name}
            </AppText>
            <MuscleBars row={r} />
            <AppText variant="callout" numeric align="right" style={[PROGRESS_TEXT.row, { flex: 1, fontWeight: '600' }]}>
              {r.last}
            </AppText>
          </View>
        ))}
      </View>
      <View style={{ alignSelf: 'flex-end' }}>
        <SmallLink label={PROGRESS_COPY.details} accessibilityLabel="Details. Opens the Training tab" onPress={onDetails} />
      </View>
    </ProgressCard>
  );
}

// ---------------------------------------------------------------------------
// Coach's changes

/**
 * One change: `Row 3 sets → 4 sets`, `next Pull · reason`, Undo (or, undone, Redo). One not made (`Not
 * applied`, `Out of date`, `Skipped`) is drawn in the secondary colour, never like a made one, with Apply
 * while it is still open.
 */
/** A change as made (or undone, skipped, out of date): its buttons are its own actions (`changeRowTaps`; review v5offers B2). */
export function ChangeRow({ row, first, onTap }: { row: ChangeRowView; first: boolean; onTap: (t: ChangeTap) => void }) {
  const theme = useTheme();
  const undone = row.status === 'undone';
  const made = row.status === 'applied';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: first ? 2 : 10, borderTopWidth: first ? 0 : theme.dividerWidth, borderColor: theme.colors['border.divider'] }}>
      <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={row.accessibilityLabel}>
        {undone ? (
          <AppText variant="headline" numeric style={PROGRESS_TEXT.chg}>
            <AppText variant="headline" color="text.tertiary" style={[PROGRESS_TEXT.chg, { fontWeight: '500', textDecorationLine: 'line-through' }]}>
              {`${row.exercise} ${row.after}`}
            </AppText>
            {` kept ${row.before}`}
          </AppText>
        ) : (
          <AppText variant="headline" numeric color={made ? 'text.primary' : 'text.secondary'} style={PROGRESS_TEXT.chg}>
            {`${row.exercise} `}
            <AppText variant="headline" color="text.tertiary" style={[PROGRESS_TEXT.chg, { fontWeight: '500', textDecorationLine: 'line-through' }]}>
              {row.before}
            </AppText>
            {` → ${row.after}`}
          </AppText>
        )}
        <AppText variant="callout" color="text.secondary" numeric style={PROGRESS_TEXT.why}>
          {undone ? (row.statusText ?? '') : [row.when, row.why, row.statusText].filter((x): x is string => x !== null).join(' · ')}
        </AppText>
      </View>
      {changeRowTaps(row).map((t) => (
        <TextButton
          key={t}
          label={CHANGE_TAP_LABEL[t]}
          onPress={() => {
            onTap(t);
          }}
          accessibilityLabel={`${CHANGE_TAP_LABEL[t]}: ${row.exercise}`}
        />
      ))}
    </View>
  );
}
