import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { measureMetric, parseTrailing, PLAN_VERDICT_WORD, TRAILING_OPTIONS, type DateRange, type ExerciseExtrasView, type LiftChip, type ExerciseMeasure, type ExerciseTabView, type ExerciseTargetHistory } from '@fizz/domain';
import type { ProgressPeriodKey } from '@fizz/schemas';

import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { ExerciseLiftTarget } from '../../lift-targets/ExerciseLiftTarget';
import { DropdownButton, DropdownPanel, PeriodPicker, Segmented, useAx } from '../../progress/components';
import { ExerciseLineChart } from '../../progress/exercise-line-chart';
import { LIFTS_TAB_SECTIONS, type LiftsTabSection } from '../../progress/lifts-tab-layout';
import { RepTable } from '../../progress/trend-chart';
import { unreadableText } from '../../progress/copy';
import type { ExerciseTab } from '../../services/progress-service';
import { useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, Icon, InfoLine, StatStrip, StatusLine, TextButton, TextField } from '../../ui';

/**
 * Progress › Lifts (Ben, 13–14 Oct 2026; ideas-2026-10-12 D3; layout Ben
 * 26 Oct): his main lifts as chips with `More` (searchable), the line chart
 * with a dashed trailing average straight under them, then the series,
 * Measure and Period dropdowns, one stat line and the sessions table. The tab
 * keeps its own period. Lays out the service's view model and computes
 * nothing. Local only.
 *
 * (Ben, 26 Oct: one exercise-progress screen) Exercise detail is this same component for one exercise
 * (`exerciseId`): no chip row, the same chart, controls, periods and table, then `BEST REPS` and `RECORDS`
 * (in Lifts too). A tap on a chart point, a record or a best-reps row opens that workout.
 */

type Open = 'exercise' | 'measure' | 'period' | 'series' | 'trailing' | null;

const DEFAULT_PERIOD: ProgressPeriodKey = '6m';

/** Open on this exercise and workout (a home record); a new `n` re-opens it. */
export interface ExercisesFocus {
  exerciseId: string;
  /** Null: the exercise's page (Overview's `Open Bench ›`); else that workout in it (a record's tap). */
  sessionId: string | null;
  sessionExerciseId: string | null;
  n: number;
}

export function ExercisesTab({
  focus = null,
  active = true,
  exerciseId: only = null,
  opening = null,
  onLoaded,
}: {
  focus?: ExercisesFocus | null;
  /** Showing now: a hidden tab doesn't read (Ben, 26 Oct). */
  active?: boolean;
  /** Exercise detail: this exercise alone (no chip row; Ben's Lifts pick on this phone is left as it is). */
  exerciseId?: string | null;
  /** Exercise detail opened on a workout (Summary, history): its series, selected, in a period that holds it. */
  opening?: { sessionId: string; sessionExerciseId: string | null } | null;
  /** The tab's data each time it loads (Exercise detail's title and the coach's entry). */
  onLoaded?: (tab: ExerciseTab | null) => void;
} = {}) {
  const theme = useTheme();
  const ax = useAx();
  const navigation = useNavigation();
  const [exerciseId, setExerciseId] = useState<string | null>(only);
  const [period, setPeriod] = useState<ProgressPeriodKey>(DEFAULT_PERIOD);
  const [range, setRange] = useState<DateRange | null>(null);
  const [measure, setMeasure] = useState<ExerciseMeasure | null>(null);
  const [trailing, setTrailing] = useState<number | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(opening?.sessionId ?? null);
  const [open, setOpen] = useState<Open>(null);
  const [repBy, setRepBy] = useState<'weight' | 'reps'>('weight');
  const [repAll, setRepAll] = useState(false);
  const [recordsAll, setRecordsAll] = useState(false);
  // The record's workout: picks its series and widens the period until Ben picks another exercise, series or period.
  const [opened, setOpened] = useState<{ sessionId: string; sessionExerciseId: string | null } | null>(opening);
  const { prefs, update } = useDevicePrefs();
  const [data, reload] = useScreenData(
    (s) => s.progress.exerciseTab({ exerciseId, remembered: only === null ? (prefs.liftsExercise ?? null) : null, period, range, measure, trailing, seriesId, open: opened, targetsHit: prefs.targetsHit, repBy }),
    { enabled: active },
  );
  const loaded = data.state === 'ready' ? data.value : undefined;
  useEffect(() => {
    if (loaded !== undefined) onLoaded?.(loaded);
  }, [loaded, onLoaded]);
  // (Ben, 26 Oct) A chart point, a record or a best-reps row opens the workout it came from (read-only Summary).
  const openWorkout = (sessionId: string) => {
    navigation.navigate('Summary', { sessionId, back: true });
  };
  useEffect(() => {
    if (focus === null) return;
    setExerciseId(focus.exerciseId);
    setSeriesId(null);
    setMeasure(null);
    setOpened(focus.sessionId === null ? null : { sessionId: focus.sessionId, sessionExerciseId: focus.sessionExerciseId });
    setSelected(focus.sessionId);
    setOpen(null);
    reload();
  }, [focus, reload]);
  const toggle = (k: Exclude<Open, null>) => {
    setOpen((o) => (o === k ? null : k));
  };

  if (data.state === 'error') {
    return <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open your training data." info={data.message} infoLabel="Error details" action={<TextButton label="Try again" onPress={reload} />} />;
  }
  if (data.state !== 'ready') return null;
  const tab = data.value;
  const view = tab?.view ?? null;
  if (tab === null || view === null) {
    return (
      <AppText variant="body" color="text.secondary">
        Nothing logged yet.
      </AppText>
    );
  }
  const selectedRow = selected === null ? undefined : view.table.rows.find((r) => r.sessionId === selected);

  const measurePanel =
    open === 'measure' ? (
      <DropdownPanel
        options={view.measures}
        selected={view.measure}
        onSelect={(k) => {
          setOpen(null);
          setMeasure(k);
          setSelected(null);
          reload();
        }}
      />
    ) : null;

  const pick = (id: string) => {
    setOpen(null);
    setExerciseId(id);
    setOpened(null);
    setSeriesId(null);
    setMeasure(null);
    setSelected(null);
    // His last pick opens the tab next time on this phone (Ben, 26 Oct).
    if (only === null && prefs.liftsExercise !== id) update({ liftsExercise: id });
    reload();
  };

  const extras = tab.extras;
  const sections: Record<LiftsTabSection, React.ReactNode> = {
    lifts: only !== null ? null : (
      <LiftChipRow
        chips={tab.lifts.chips}
        selectedId={view.exerciseId}
        moreOpen={open === 'exercise'}
        onMore={() => {
          toggle('exercise');
        }}
        onPick={pick}
      />
    ),
    chart:
      view.empty !== null ? (
        <AppText variant="body" color="text.secondary">
          {view.empty}
        </AppText>
      ) : (
        <ChartWithTarget view={view} selected={selected} readout={selectedRow?.readout ?? null} onOpen={openWorkout} />
      ),
    pain:
      extras?.pain == null ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={extras.pain.words}
          onPress={() => {
            const flagId = extras.pain?.flagId;
            if (flagId) navigation.navigate('PainFlag', { flagId });
          }}
          style={{ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['3'], borderRadius: theme.radius.md, backgroundColor: theme.colors['bg.raised'] }}
        >
          <Icon name="exclamationmark.triangle" color="status.warning" size={16} />
          <AppText variant="callout" numeric style={{ flex: 1 }}>
            {extras.pain.text}
          </AppText>
          <Icon name="chevron.right" color="text.tertiary" size={14} />
        </Pressable>
      ),
    controls: (
      <View style={{ gap: theme.space['2'] }}>
        {view.series.length > 1 ? (
          <View style={{ gap: theme.space['1'] }}>
            <DropdownButton
              small
              label={view.series.find((s) => s.id === view.seriesId)?.label ?? ''}
              accessibilityLabel={`Type, ${view.series.find((s) => s.id === view.seriesId)?.label ?? ''}`}
              open={open === 'series'}
              onPress={() => {
                toggle('series');
              }}
            />
            {open === 'series' ? (
              <DropdownPanel
                options={view.series.map((s) => ({ key: s.id, label: s.label }))}
                selected={view.seriesId}
                onSelect={(k) => {
                  setOpen(null);
                  setOpened(null);
                  setSeriesId(k);
                  setMeasure(null);
                  setSelected(null);
                  reload();
                }}
              />
            ) : null}
          </View>
        ) : null}
        <PeriodPicker
          period={tab.period}
          custom={tab.range !== null}
          today={tab.today}
          earliest={tab.earliest}
          current={tab.window}
          datesLine={tab.datesLine}
          datesWords={tab.datesWords}
          open={open === 'period'}
          onOpenChange={(o) => {
            setOpen(o ? 'period' : null);
          }}
          onPreset={(p) => {
            setOpened(null);
            setPeriod(p);
            setRange(null);
            setSelected(null);
            reload();
          }}
          onCustom={(r) => {
            setOpened(null);
            setRange(r);
            setSelected(null);
            reload();
          }}
          leading={
            view.measures.length > 1 ? (
              <DropdownButton
                label={view.measureLabel}
                accessibilityLabel={`Measure, ${view.measureLabel}`}
                open={open === 'measure'}
                onPress={() => {
                  toggle('measure');
                }}
              />
            ) : undefined
          }
          leadingPanel={measurePanel}
        />
      </View>
    ),
    stats: <StatStrip items={view.stats} accessibilityLabel={view.statsWords} ax={ax} />,
    target: <LiftTargetSection exerciseId={view.exerciseId} />,
    trailing: (
      <TrailingControl
        value={view.trailing}
        open={open === 'trailing'}
        onToggle={() => {
          toggle('trailing');
        }}
        onChoose={(n) => {
          setOpen(null);
          setTrailing(n);
          reload();
        }}
      />
    ),
    sessions: (
      <SessionsTable
        view={view}
        targets={tab.targets ?? null}
        selected={selected}
        onSelect={(id) => {
          setSelected((cur) => (cur === id ? null : id));
        }}
      />
    ),
    reps: (
      <BestReps
        extras={extras}
        showAll={repAll}
        onShowAll={() => {
          setRepAll(true);
        }}
        onBy={(k) => {
          setRepBy(k);
          reload();
        }}
        onOpen={openWorkout}
      />
    ),
    records: (
      <Records
        extras={extras}
        showAll={recordsAll}
        onShowAll={() => {
          setRecordsAll(true);
        }}
        onOpen={openWorkout}
      />
    ),
  };

  // (Ben, 26 Oct) The chips, the chart straight under them, then the rest (`LIFTS_TAB_SECTIONS`).
  return (
    <View style={{ gap: theme.space['4'] }}>
      {tab.unreadable > 0 ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={unreadableText(tab.unreadable)} /> : null}
      {LIFTS_TAB_SECTIONS.map((k) => (sections[k] === null ? null : <View key={k}>{sections[k]}</View>))}
    </View>
  );
}

/**
 * The lift chips (Ben, 26 Oct): his main lifts in a row that scrolls sideways (names are never cut), the
 * one showing selected, and `More` for any other exercise (the searchable list, in place under the row).
 */
function LiftChipRow({ chips, selectedId, moreOpen, onMore, onPick }: { chips: readonly LiftChip[]; selectedId: string; moreOpen: boolean; onMore: () => void; onPick: (id: string) => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['2'] }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Lifts" contentContainerStyle={{ gap: theme.space['2'] }}>
        {chips.map((c) => (
          <Chip
            key={c.exerciseId}
            size="min"
            label={c.label}
            selected={c.selected}
            onPress={() => {
              if (!c.selected) onPick(c.exerciseId);
            }}
          />
        ))}
        <Chip size="min" label="More" accessibilityLabel="More exercises" selected={moreOpen} onPress={onMore} />
      </ScrollView>
      {moreOpen ? <ExercisePicker onPick={onPick} selectedId={selectedId} /> : null}
    </View>
  );
}

/** `More`: every exercise with history, searchable; a tap opens it. */
function ExercisePicker({ onPick, selectedId }: { onPick: (id: string) => void; selectedId: string }) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [data, reload] = useScreenData((s) => s.progress.exercises({ query }));
  const rows = data.state === 'ready' ? (data.value?.view.rows ?? []) : [];
  const noMatches = data.state === 'ready' ? (data.value?.view.noMatches ?? null) : null;
  return (
    <View style={{ gap: theme.space['2'], borderRadius: theme.radius.md, backgroundColor: theme.colors['bg.surface'], borderWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'], padding: theme.space['2'] }}>
      <TextField
        value={query}
        placeholder="Search"
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
        accessibilityLabel="Search exercises"
        onChangeText={(t) => {
          setQuery(t);
          reload();
        }}
      />
      {noMatches !== null ? (
        <AppText variant="callout" color="text.secondary">
          {noMatches}
        </AppText>
      ) : null}
      <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {rows.map((r) => {
          const on = r.exerciseId === selectedId;
          return (
            <Pressable
              key={r.exerciseId}
              accessibilityRole="button"
              accessibilityLabel={r.words}
              accessibilityState={{ selected: on }}
              onPress={() => {
                setQuery('');
                onPick(r.exerciseId);
              }}
              style={({ pressed }) => ({ minHeight: theme.target.min.height, paddingVertical: theme.space['2'], paddingHorizontal: theme.space['2'], flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="body">{r.name}</AppText>
                <AppText variant="callout" color="text.secondary" numeric>
                  {r.line}
                </AppText>
              </View>
              {on ? <Icon name="checkmark" color="text.primary" /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** `Trailing average · Last 5 ▾`: Last 3 / 5 / 10 / 20, or Other (a number). The dashed swatch matches the chart's average line. */
function TrailingControl({ value, open, onToggle, onChoose }: { value: number; open: boolean; onToggle: () => void; onChoose: (n: number) => void }) {
  const theme = useTheme();
  const [other, setOther] = useState('');
  const preset = TRAILING_OPTIONS.includes(value);
  const typed = parseTrailing(other);
  return (
    <View style={{ gap: theme.space['1'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <View style={{ width: 18, flexDirection: 'row', gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ width: 4, height: 2, backgroundColor: theme.colors['chart.bar'] }} />
          ))}
        </View>
        <AppText variant="callout" color="text.secondary">
          Trailing average
        </AppText>
        <DropdownButton
          small
          label={`Last ${String(value)}`}
          accessibilityLabel={`Trailing average, last ${String(value)} sessions`}
          open={open}
          onPress={() => {
            setOther(preset ? '' : String(value));
            onToggle();
          }}
        />
      </View>
      {open ? (
        <DropdownPanel
          options={TRAILING_OPTIONS.map((n) => ({ key: n, label: `Last ${String(n)}` }))}
          selected={preset ? value : null}
          onSelect={onChoose}
          footer={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], padding: theme.space['3'] }}>
              <AppText variant="body">Other</AppText>
              <TextField
                value={other}
                keyboardType="number-pad"
                returnKeyType="done"
                accessibilityLabel="Other, sessions"
                placeholder="8"
                style={{ flex: 1 }}
                onChangeText={setOther}
                onSubmitEditing={() => {
                  if (typed !== null) onChoose(typed);
                }}
              />
              <TextButton
                label="Show"
                disabled={typed === null}
                onPress={() => {
                  if (typed !== null) onChoose(typed);
                }}
              />
            </View>
          }
        />
      ) : null}
    </View>
  );
}

const COLS = { date: 64, sets: 36 } as const;

/** Sessions in the period, newest first; tapping a row selects its point. */
function SessionsTable({ view, targets, selected, onSelect }: { view: ExerciseTabView; targets: ExerciseTargetHistory | null; selected: string | null; onSelect: (sessionId: string) => void }) {
  const theme = useTheme();
  const ax = useAx();
  if (view.table.rows.length === 0) return null;
  const head = (t: string, style: object) => (
    <AppText variant="sectionLabel" color="text.tertiary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={style}>
      {t}
    </AppText>
  );
  const cell = (t: string, style: object) => (
    <AppText variant="callout" numeric numberOfLines={1} style={style}>
      {t}
    </AppText>
  );
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
        {`SESSIONS · ${view.table.unit.toUpperCase()}`}
      </AppText>
      {/* Only when there's something to say (20 Oct): `Converted from lb`, an assumed dumbbell count behind a `≈` total. Below the header so it wraps (review N1). */}
      {view.info !== null ? <InfoLine info={view.info} infoLabel="Details" /> : null}
      {/* Plan tracker v1 (19 Oct): targets hit, counted from what was planned and logged. */}
      {targets?.hitText != null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {targets.hitText}
        </AppText>
      ) : null}
      {ax ? null : (
        <View style={{ flexDirection: 'row', gap: theme.space['2'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {head('DATE', { width: COLS.date })}
          {/* Design pass 6.4: TOP SET gets the most room (`L 22.5×12` uncut at 375pt). */}
          {head('TOP SET', { flex: 1.6 })}
          {/* Its own plain unit: a total counts both dumbbells, never `kg each` (review B1). */}
          {head(view.table.totalUnit === null ? 'TOTAL' : `TOTAL ${view.table.totalUnit.toUpperCase()}`, { flex: 1, textAlign: 'right' })}
          {head('SETS', { width: COLS.sets, textAlign: 'right' })}
          {head('EST. 1RM', { flex: 1, textAlign: 'right' })}
        </View>
      )}
      <View>
        {view.table.rows.map((r) => {
          const on = r.sessionId === selected;
          // One line per copy when the exercise was done twice that day (review S1).
          const ts = on ? (targets?.rows.filter((x) => x.sessionId === r.sessionId && x.target !== null && x.verdict !== null) ?? []) : [];
          return (
            <View key={r.sessionId}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={r.words}
                accessibilityState={{ selected: on }}
                onPress={() => {
                  onSelect(r.sessionId);
                }}
                style={({ pressed }) => ({
                  minHeight: theme.target.min.height,
                  paddingVertical: theme.space['2'],
                  flexDirection: ax ? 'column' : 'row',
                  alignItems: ax ? 'flex-start' : 'center',
                  gap: ax ? 2 : theme.space['2'],
                  borderTopWidth: theme.dividerWidth,
                  borderTopColor: theme.colors['border.divider'],
                  backgroundColor: on ? theme.colors['accent.subtle'] : pressed ? theme.colors['bg.raised'] : 'transparent',
                })}
              >
                {ax ? (
                  <>
                    <AppText variant="body">{r.cells.date}</AppText>
                    <AppText variant="callout" color="text.secondary" numeric>{`${r.cells.topSet} · ${r.cells.total}${view.table.totalUnit !== null && r.cells.total !== '—' ? ` ${view.table.totalUnit}` : ''} · ${r.cells.sets} sets · ${r.cells.e1rm}`}</AppText>
                  </>
                ) : (
                  <>
                    {cell(r.cells.date, { width: COLS.date })}
                    <AppText variant="callout" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ flex: 1.6 }}>
                      {r.cells.topSet}
                    </AppText>
                    {cell(r.cells.total, { flex: 1, textAlign: 'right' })}
                    {cell(r.cells.sets, { width: COLS.sets, textAlign: 'right' })}
                    {cell(r.cells.e1rm, { flex: 1, textAlign: 'right' })}
                  </>
                )}
              </Pressable>
              {ts.map((t) =>
                t.verdict !== null ? (
                  <AppText key={t.sessionExerciseId} variant="callout" color="text.secondary" numeric accessibilityLabel={`Target ${t.target ?? ''}, did ${t.actual}. ${PLAN_VERDICT_WORD[t.verdict]}.`}>
                    {`Target ${t.target ?? ''} · ${t.actual} · ${PLAN_VERDICT_WORD[t.verdict]}`}
                  </AppText>
                ) : null,
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** The chart, with the lift target's dotted line when the measure is the target's (Est. 1RM or top set; Ben, 20 Oct). */
function ChartWithTarget({ view, selected, readout, onOpen }: { view: ExerciseTabView; selected: string | null; readout: string | null; onOpen: (sessionId: string) => void }) {
  const services = useServices();
  const [liftData] = useScreenData((s) => s.liftTargets.forExercise(view.exerciseId));
  const lift = liftData.state === 'ready' ? liftData.value : null;
  const metric = measureMetric(view.measure);
  const target = lift?.on === true && lift.target !== null && metric !== null ? services.liftTargets.chartValue(lift.target, view.seriesTerms, metric) : null;
  return <ExerciseLineChart chart={view.chart} selected={selected} readout={readout} target={target} onOpen={onOpen} />;
}

/** This exercise's lift target (Ben approved 20 Oct): its line, or `Add target`; nothing while the setting is off. */
function LiftTargetSection({ exerciseId }: { exerciseId: string }) {
  const [liftData, reloadLift] = useScreenData((s) => s.liftTargets.forExercise(exerciseId));
  const lift = liftData.state === 'ready' ? liftData.value : null;
  return <ExerciseLiftTarget data={lift} exerciseId={exerciseId} onChanged={reloadLift} />;
}

/** `BEST REPS` (by weight or by reps) for the period showing, or `BEST DISTANCE`; a row opens its workout. */
function BestReps({ extras, showAll, onShowAll, onBy, onOpen }: { extras: ExerciseExtrasView | null; showAll: boolean; onShowAll: () => void; onBy: (by: 'weight' | 'reps') => void; onOpen: (sessionId: string) => void }) {
  const theme = useTheme();
  if (extras === null) return null;
  if (extras.distanceTable !== null) {
    return (
      <View style={{ gap: theme.space['2'] }}>
        <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
          BEST DISTANCE
        </AppText>
        {extras.distanceTable.rows.length === 0 ? (
          <AppText variant="callout" color="text.secondary">
            None in this period.
          </AppText>
        ) : (
          <RepTable table={extras.distanceTable} showAll={showAll} onShowAll={onShowAll} onOpen={onOpen} />
        )}
      </View>
    );
  }
  const table = extras.repTable;
  if (table === null) return null;
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
        BEST REPS
      </AppText>
      <Segmented
        options={[
          { key: 'weight' as const, label: 'By weight' },
          { key: 'reps' as const, label: 'By reps' },
        ]}
        selected={table.by}
        onSelect={onBy}
        label="Best reps"
      />
      {table.rows.length === 0 ? (
        <AppText variant="callout" color="text.secondary">
          None in this period.
        </AppText>
      ) : (
        <RepTable table={table} showAll={showAll} onShowAll={onShowAll} onOpen={onOpen} />
      )}
    </View>
  );
}

/** `RECORDS` (all time): each opens the workout it was set in (Ben, 26 Oct). */
function Records({ extras, showAll, onShowAll, onOpen }: { extras: ExerciseExtrasView | null; showAll: boolean; onShowAll: () => void; onOpen: (sessionId: string) => void }) {
  const theme = useTheme();
  const records = extras?.records ?? null;
  if (records === null) return null;
  const rows = showAll ? records.items : records.items.slice(0, 5);
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
        RECORDS
      </AppText>
      {records.empty !== null ? (
        <AppText variant="callout" color="text.secondary">
          {records.empty}
        </AppText>
      ) : (
        rows.map((r) => (
          <Pressable
            key={r.key}
            accessibilityRole="button"
            accessibilityLabel={r.words}
            accessibilityHint="Opens the workout"
            onPress={() => {
              onOpen(r.sessionId);
            }}
            style={({ pressed }) => ({ minHeight: theme.target.min.height, paddingVertical: theme.space['2'], flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
          >
            <AppText variant="body" numeric style={{ flex: 1 }}>{`${r.label}  ${r.value} · ${r.date}`}</AppText>
            <Icon name="chevron.right" color="text.tertiary" size={14} />
          </Pressable>
        ))
      )}
      {!showAll && records.items.length > 5 ? <TextButton label={`Show all (${String(records.items.length)})`} onPress={onShowAll} /> : null}
    </View>
  );
}
