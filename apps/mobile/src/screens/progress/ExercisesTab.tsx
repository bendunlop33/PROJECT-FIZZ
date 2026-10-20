import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { parseTrailing, PLAN_VERDICT_WORD, TRAILING_OPTIONS, type DateRange, type ExerciseMeasure, type ExerciseTabView, type ExerciseTargetHistory } from '@fizz/domain';
import type { ProgressPeriodKey } from '@fizz/schemas';

import { DropdownButton, DropdownPanel, PeriodPicker, useAx } from '../../progress/components';
import { ExerciseLineChart } from '../../progress/exercise-line-chart';
import { unreadableText } from '../../progress/copy';
import { useScreenData } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, InfoLine, StatStrip, StatusLine, TextButton, TextField } from '../../ui';

/**
 * Progress › Exercises (Ben, 13–14 Oct 2026; ideas-2026-10-12 D3): an
 * exercise dropdown (searchable), Measure and Period dropdowns, one stat
 * line, a large line chart with a dashed trailing average, and the sessions
 * table under it. The tab keeps its own period. Lays out the service's view
 * model and computes nothing. Local only.
 */

type Open = 'exercise' | 'measure' | 'period' | 'series' | 'trailing' | null;

const DEFAULT_PERIOD: ProgressPeriodKey = '6m';

/** Open on this exercise and workout (a home record); a new `n` re-opens it. */
export interface ExercisesFocus {
  exerciseId: string;
  sessionId: string;
  sessionExerciseId: string | null;
  n: number;
}

export function ExercisesTab({ focus = null }: { focus?: ExercisesFocus | null } = {}) {
  const theme = useTheme();
  const ax = useAx();
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [period, setPeriod] = useState<ProgressPeriodKey>(DEFAULT_PERIOD);
  const [range, setRange] = useState<DateRange | null>(null);
  const [measure, setMeasure] = useState<ExerciseMeasure | null>(null);
  const [trailing, setTrailing] = useState<number | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  // The record's workout: picks its series and widens the period until Ben picks another exercise, series or period.
  const [opened, setOpened] = useState<{ sessionId: string; sessionExerciseId: string | null } | null>(null);
  const [data, reload] = useScreenData((s) => s.progress.exerciseTab({ exerciseId, period, range, measure, trailing, seriesId, open: opened }));
  useEffect(() => {
    if (focus === null) return;
    setExerciseId(focus.exerciseId);
    setSeriesId(null);
    setMeasure(null);
    setOpened({ sessionId: focus.sessionId, sessionExerciseId: focus.sessionExerciseId });
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

  return (
    <View style={{ gap: theme.space['4'] }}>
      {tab.unreadable > 0 ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={unreadableText(tab.unreadable)} /> : null}
      <ExercisePicker
        name={view.title}
        open={open === 'exercise'}
        onToggle={() => {
          toggle('exercise');
        }}
        onPick={(id) => {
          setOpen(null);
          setExerciseId(id);
          setOpened(null);
          setSeriesId(null);
          setMeasure(null);
          setSelected(null);
          reload();
        }}
        selectedId={view.exerciseId}
      />

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

      <StatStrip items={view.stats} accessibilityLabel={view.statsWords} ax={ax} />

      {view.empty !== null ? (
        <AppText variant="body" color="text.secondary">
          {view.empty}
        </AppText>
      ) : (
        <ExerciseLineChart
          chart={view.chart}
          selected={selected}
          readout={selectedRow?.readout ?? null}
          onSelect={(id) => {
            setSelected(id);
          }}
        />
      )}

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

      <SessionsTable
        view={view}
        targets={tab.targets ?? null}
        selected={selected}
        onSelect={(id) => {
          setSelected((cur) => (cur === id ? null : id));
        }}
      />
    </View>
  );
}

function ExercisePicker({ name, open, onToggle, onPick, selectedId }: { name: string; open: boolean; onToggle: () => void; onPick: (id: string) => void; selectedId: string }) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [data, reload] = useScreenData((s) => s.progress.exercises({ query }));
  const rows = data.state === 'ready' ? (data.value?.view.rows ?? []) : [];
  const noMatches = data.state === 'ready' ? (data.value?.view.noMatches ?? null) : null;
  return (
    <View style={{ gap: theme.space['2'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Exercise, ${name}`}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => ({ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['3'], borderRadius: theme.radius.sm, backgroundColor: pressed ? theme.colors['accent.subtle'] : theme.colors['bg.raised'] })}
      >
        <AppText variant="headline" style={{ flex: 1 }} numberOfLines={1}>
          {name}
        </AppText>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} color="text.secondary" size={14} />
      </Pressable>
      {open ? (
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
      ) : null}
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
          {head('TOP SET', { flex: 1 })}
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
                    {cell(r.cells.topSet, { flex: 1 })}
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
