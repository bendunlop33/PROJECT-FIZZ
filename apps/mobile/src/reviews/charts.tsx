import { useState } from 'react';
import { Pressable, View, type TextStyle, type ViewStyle } from 'react-native';

import { PROGRESS_COPY, type ChangeRowView, type LiftsView, type MuscleTrackerRowView, type MuscleTrackerView, type PastWeekRowView, type ThisWeekView, type WeekChipView } from '@fizz/domain';

import { createGuardedLoader } from '../guide/guarded-load';
import { TICK_MAX_SCALE } from '../progress/axis-width';
import { useAx } from '../progress/components';
import { useTheme } from '../theme';
import { AppText, Card, TextButton } from '../ui';
import { liftsChartLayout, lineAt, pointAt } from './lifts-layout';
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

function PastWeeks({ rows, onOpenReview }: { rows: readonly PastWeekRowView[]; onOpenReview: (reviewId: string) => void }) {
  const theme = useTheme();
  const pal = progressPalette(theme);
  return (
    <View accessibilityRole="list" style={{ borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'], paddingTop: 4 }}>
      {rows.map((r) => {
        const squares = (
          <View style={{ flex: 1, flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {r.squares.map((q, i) => (
              <View
                key={`${r.key}-${String(i)}`}
                style={{
                  width: 34,
                  flexShrink: 1,
                  height: 14,
                  borderRadius: 4,
                  backgroundColor: q === 'done' ? pal.doneSquare : q === 'missed' ? pal.missedSquare : 'transparent',
                  borderWidth: q === 'paused' ? 1 : 0,
                  borderStyle: 'dashed',
                  borderColor: theme.colors['border.divider'],
                }}
              />
            ))}
          </View>
        );
        const content = (
          <>
            <AppText variant="callout" color="text.secondary" numeric style={[PROGRESS_TEXT.sub, { width: 64 }]}>
              {r.week}
            </AppText>
            {squares}
            <AppText variant="callout" color="text.secondary" numeric align="right" style={[PROGRESS_TEXT.sub, { minWidth: 60 }]}>
              {r.right}
            </AppText>
          </>
        );
        const row = { flexDirection: 'row', alignItems: 'center', minHeight: 44 } as const;
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
    </View>
  );
}

/** This week: `Sessions 3 of 4 · 2 runs`, a chip per planned session, `Last 4 weeks ▾`. */
export function WeekCard({ view, onOpenSession, onOpenReview }: { view: ThisWeekView; onOpenSession: (sessionId: string) => void; onOpenReview: (reviewId: string) => void }) {
  const theme = useTheme();
  const ax = useAx();
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const perRow = ax ? 2 : 4;
  const gap = 4;
  const chipWidth = width > 0 ? Math.floor((width - gap * (perRow - 1)) / perRow) : null;
  return (
    <ProgressCard>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 10 }} accessible accessibilityLabel={`Sessions ${view.sessions}${view.runs === null ? '' : `, ${view.runs}`}`}>
        <AppText variant="callout" color="text.secondary" style={PROGRESS_TEXT.k}>
          {PROGRESS_COPY.sessions}
        </AppText>
        <AppText variant="headline" numeric style={PROGRESS_TEXT.v}>
          {view.sessions}
          {view.runs !== null ? (
            <AppText variant="callout" color="text.secondary" style={{ fontSize: 14, fontWeight: '500' }}>
              {` · ${view.runs}`}
            </AppText>
          ) : null}
        </AppText>
      </View>
      {view.chips.length > 0 ? (
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
      {open ? <PastWeeks rows={view.past} onOpenReview={onOpenReview} /> : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? 'Hide past weeks' : 'Last 4 weeks'}
          onPress={() => {
            setOpen((o) => !o);
          }}
          hitSlop={8}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <AppText variant="callout" style={[PROGRESS_TEXT.sub, { fontWeight: '600', textDecorationLine: 'underline', textDecorationColor: theme.colors['text.tertiary'] }]}>
            {open ? PROGRESS_COPY.hideWeeks : PROGRESS_COPY.showWeeks}
          </AppText>
        </Pressable>
      </View>
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

const LIFT_COLS = { dot: 10, gap: 6 } as const;

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
        <AppText key={`${c}-${String(i)}`} variant="label" color="text.tertiary" align={i === 0 ? 'left' : 'right'} numberOfLines={1} style={[PROGRESS_TEXT.head, { flex: 1 }]}>
          {c}
        </AppText>
      ))}
    </View>
  );
}

/** Lifts: the chart (all lifts, or one alone on its own scale) and the table `LIFT · REPS · CURRENT · TARGET`. */
export function LiftsCard({ view, onEdit }: { view: LiftsView; onEdit: (() => void) | null }) {
  const theme = useTheme();
  const pal = progressPalette(theme);
  const [focus, setFocus] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
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
        <AppText variant="callout" numeric align="right" style={[PROGRESS_TEXT.table, { flex: 1, fontWeight: '600' }]}>
          {l.current}
        </AppText>
        <AppText variant="callout" numeric align="right" style={[PROGRESS_TEXT.table, { flex: 1, fontWeight: '600' }]}>
          {l.targetText}
        </AppText>
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
            onPress={() => {
              setFocus(null);
              setPicked(null);
            }}
          />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <AppText variant="callout" color="text.secondary" style={PROGRESS_TEXT.key} accessibilityLabel="Top set. Hollow dot means estimated.">
              {`${PROGRESS_COPY.topSet} · ${PROGRESS_COPY.est}${onEdit === null ? '' : ' · '}`}
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
      <View>
        <LiftHead cells={PROGRESS_COPY.liftHead} top />
        {main.map(row)}
        {acc.length > 0 ? <LiftHead cells={[PROGRESS_COPY.accessories, '', '', '']} top={false} /> : null}
        {acc.map(row)}
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
export function MusclesCard({ view }: { view: MuscleTrackerView }) {
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
export function ChangeRow({ row, first, onUndo, onRedo, onApply }: { row: ChangeRowView; first: boolean; onUndo: () => void; onRedo: () => void; onApply?: () => void }) {
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
      {row.canUndo ? <TextButton label={PROGRESS_COPY.undo} onPress={onUndo} accessibilityLabel={`${PROGRESS_COPY.undo}: ${row.exercise}`} /> : null}
      {row.canRedo ? <TextButton label={PROGRESS_COPY.redo} onPress={onRedo} accessibilityLabel={`${PROGRESS_COPY.redo}: ${row.exercise}`} /> : null}
      {row.canApply && onApply !== undefined ? <TextButton label={PROGRESS_COPY.apply} onPress={onApply} accessibilityLabel={`${PROGRESS_COPY.apply}: ${row.exercise}`} /> : null}
    </View>
  );
}
