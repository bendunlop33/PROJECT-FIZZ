import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, View } from 'react-native';

import { PLAN_VERDICT_WORD, type ExerciseDetailView, type ExerciseMetric, type PlanVerdict, type TrendRange } from '@fizz/domain';

import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { DeleteToastView } from '../../history/DeleteToastView';
import { useDeleteToast } from '../../history/useDeleteToast';
import type { ExerciseDetailParams } from '../../navigation/types';
import { Segmented, useAx } from '../../progress/components';
import { ChartTable, RepTable, TrendChart } from '../../progress/trend-chart';
import { chartSelection } from '../../progress/trend-select';
import { useScreenData, useServices } from '../../shell/context';
import { ExerciseLiftTarget } from '../../lift-targets/ExerciseLiftTarget';
import { useTheme } from '../../theme';
import { AppText, Chip, Icon, InfoLine, StatStrip, StatusLine, Tag, TextButton } from '../../ui';
import { AskPill } from '../coach/AskPill';
import { E1rmSheet } from './sheets';

/**
 * Exercise detail (progress.md §2.7, §3.4, §4.2, slice B): one series per
 * chart (series menu), all-time `StatStrip`, metric and range chips, the
 * Skia `TrendChart` (or its table), the selection panel, the rep table,
 * records and history. Every point, row and record opens that workout's
 * Summary. The screen lays out the service's view model and computes
 * nothing; it is identical offline and with no coach (check 41).
 */

type Route = RouteProp<{ ProgressExercise: ExerciseDetailParams; ExerciseProgress: ExerciseDetailParams }, 'ProgressExercise' | 'ExerciseProgress'>;

/** `Target 3 × 8–10 · Hit` under a history row (plan tracker v1): the word always with the numbers. */
/**
 * A sideways chip line (review S8): the scroll indicator shows and flashes once
 * when the chips are laid out, so chips past the edge read as more to scroll.
 */
function ChipScroll({ gap, children }: { gap: number; children: ReactNode }) {
  const ref = useRef<ScrollView>(null);
  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator
      onContentSizeChange={() => {
        ref.current?.flashScrollIndicators();
      }}
      contentContainerStyle={{ gap, paddingBottom: 6 }}
    >
      {children}
    </ScrollView>
  );
}

function targetLine(t: { target: string | null; verdict: PlanVerdict | null } | null) {
  if (t === null || t.target === null || t.verdict === null) return null;
  const word = PLAN_VERDICT_WORD[t.verdict];
  return (
    <AppText variant="callout" color="text.secondary" numeric accessibilityLabel={`Target ${t.target}. ${word}.`}>
      {`Target ${t.target} · ${word}`}
    </AppText>
  );
}

export function ExerciseDetailScreen() {
  const theme = useTheme();
  const ax = useAx();
  const navigation = useNavigation();
  const route = useRoute<Route>();
  // A workout deleted from a Summary opened here comes back with Undo (delete-workouts DW1).
  const deleted = useDeleteToast();
  const [toastHeight, setToastHeight] = useState(0);
  const { exerciseId } = route.params;
  // `sessionId` / `equipmentId` pick the series on the first load only; afterwards Ben's choices rule.
  const [opening, setOpening] = useState<{ sessionId?: string; sessionExerciseId?: string; equipmentId?: string; gymId?: string } | null>(() => ({
    ...(route.params.sessionId ? { sessionId: route.params.sessionId } : {}),
    ...(route.params.sessionExerciseId ? { sessionExerciseId: route.params.sessionExerciseId } : {}),
    ...(route.params.equipmentId ? { equipmentId: route.params.equipmentId } : {}),
    ...(route.params.gymId ? { gymId: route.params.gymId } : {}),
  }));
  // What the opening chose, sent on later fetches as non-remembered fields until Ben picks his own series or range (review progress-B r2 S2).
  const [held, setHeld] = useState<{ seriesId: string; range: TrendRange | null } | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [metric, setMetric] = useState<ExerciseMetric | null>(null);
  const [range, setRange] = useState<TrendRange | null>(null);
  const [repBy, setRepBy] = useState<'weight' | 'reps' | null>(null);
  const [historyMonths, setHistoryMonths] = useState(2);
  const [selectedId, setSelectedId] = useState<string | null>(route.params.sessionId ?? null);
  const [table, setTable] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [repAll, setRepAll] = useState(false);
  const [recordsAll, setRecordsAll] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const [data, reload] = useScreenData((s) =>
    s.progress.exerciseDetail({
      exerciseId,
      ...(opening ?? {}),
      ...(held ? { openedSeriesId: held.seriesId, ...(held.range ? { openedRange: held.range } : {}) } : {}),
      ...(seriesId ? { seriesId } : {}),
      ...(selectedId ? { selectSessionId: selectedId } : {}),
      ...(metric ? { metric } : {}),
      ...(range ? { range } : {}),
      ...(repBy ? { repBy } : {}),
      historyMonths,
    }),
  );
  const view: ExerciseDetailView | null = data.state === 'ready' ? (data.value?.view ?? null) : null;
  // Plan tracker v1 (19 Oct): target against actual per workout, and `Targets hit 5 of last 6` (main lifts, setting on; Ben 20 Oct).
  const { prefs } = useDevicePrefs();
  const [targetsData] = useScreenData((s) => s.progress.exerciseTargets(exerciseId, { targetsHit: prefs.targetsHit }));
  const targets = targetsData.state === 'ready' ? targetsData.value : null;
  const targetOf = (sessionId: string) => targets?.rows.find((t) => t.sessionId === sessionId && t.target !== null) ?? null;
  // (Ben approved 20 Oct) This exercise's lift target (null while the setting is off) and its dotted chart line.
  const services = useServices();
  const [liftData, reloadLift] = useScreenData((s) => s.liftTargets.forExercise(exerciseId));
  const lift = liftData.state === 'ready' ? liftData.value : null;

  useEffect(() => {
    // With VoiceOver running, the first open shows the table (§4.2).
    let alive = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      if (alive && on) setTable(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    // Once the series (and, for an older workout, the wider range) is chosen from the opening workout, keep it (and stop forcing it).
    if (view && opening !== null) {
      setHeld({ seriesId: view.seriesId, range: opening.sessionId ? view.range : null });
      setOpening(null);
    }
  }, [view, opening]);
  useLayoutEffect(() => {
    const title = view?.title ?? route.params.name ?? '';
    navigation.setOptions(
      route.name === 'ExerciseProgress'
        ? {
            title,
            headerRight: () => (
              <TextButton
                label="Done"
                onPress={() => {
                  navigation.goBack();
                }}
              />
            ),
          }
        : { title },
    );
  }, [navigation, route.name, route.params.name, view?.title]);

  const change = (f: () => void) => {
    f();
    reload();
  };
  const openWorkout = (sessionId: string) => {
    navigation.navigate('Summary', { sessionId, back: true });
  };

  // The delete Undo toast floats over every state: deleting the exercise's only workout leaves no chart, but the Undo must still show (review progress-merge S1).
  const deleteToast = deleted.toast ? (
    <View
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
      onLayout={(e) => {
        setToastHeight(e.nativeEvent.layout.height);
      }}
    >
      <DeleteToastView state={deleted} />
    </View>
  ) : null;

  if (data.state === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
        <View style={{ padding: theme.components.screenMargin }}>
          <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open your training data." info={data.message} infoLabel="Error details" action={<TextButton label="Try again" onPress={reload} />} />
        </View>
        {deleteToast}
      </View>
    );
  }
  if (data.state === 'ready' && view === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
        <View style={{ padding: theme.components.screenMargin }}>
          <AppText variant="body" color="text.secondary">
            No finished workouts with this exercise yet.
          </AppText>
        </View>
        {deleteToast}
      </View>
    );
  }
  if (view === null) return <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>{deleteToast}</View>;

  // The opened workout may sit inside a weekly-best point: the service says which point and what the panel shows.
  const picked = chartSelection(view.points, view.selection, selectedId);
  const sel = picked?.panel ?? null;
  const chartAction = view.chart.kind === 'too_few' || view.chart.kind === 'none_in_range' ? view.chart.action : null;
  const records = view.records;
  const recordRows = records === null ? [] : recordsAll ? records.items : records.items.slice(0, 5);

  const infoLink = (
    <TextButton
      label="Exercise info"
      onPress={() => {
        navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressExerciseInfo', params: { exerciseId, name: view.title } } });
      }}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['8'] + 56, gap: theme.space['5'] }}
      >
        {/* `Exercise info` (progress.md region 1, exercise-library §9.7): the Library's detail, in this stack. Design pass 6.6: beside the series pill when there is one. */}
        {route.name === 'ProgressExercise' && view.series.length <= 1 ? <View style={{ alignSelf: 'flex-start' }}>{infoLink}</View> : null}
        {view.pain ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={view.pain.words}
            onPress={() => {
              const flagId = view.pain?.flagId;
              if (flagId) navigation.navigate('PainFlag', { flagId });
            }}
            style={{ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['3'], borderRadius: theme.radius.md, backgroundColor: theme.colors['bg.raised'] }}
          >
            <Icon name="exclamationmark.triangle" color="status.warning" size={16} />
            <AppText variant="callout" numeric style={{ flex: 1 }}>
              {view.pain.text}
            </AppText>
            <Icon name="chevron.right" color="text.tertiary" size={14} />
          </Pressable>
        ) : null}

        {/* Kind menu (Ben, 20 Oct: gyms, equipment and imports are one series): only when the exercise has more than one kind (assisted and weighted). */}
        {view.series.length > 1 ? (
          <View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: theme.space['3'] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Type, ${view.seriesLabel}`}
            accessibilityState={{ expanded: seriesOpen }}
            onPress={() => {
              setSeriesOpen((o) => !o);
            }}
            style={{ alignSelf: 'flex-start', minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['4'], borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.control'] }}
          >
            <AppText variant="body">{view.seriesLabel}</AppText>
            <Icon name={seriesOpen ? 'chevron.up' : 'chevron.down'} color="text.secondary" size={12} />
          </Pressable>
          {route.name === 'ProgressExercise' ? infoLink : null}
          </View>
          {seriesOpen
            ? view.series.map((s) => (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: s.id === view.seriesId }}
                  accessibilityLabel={`${s.label}, ${String(s.sessionCount)} sessions`}
                  onPress={() => {
                    setSeriesOpen(false);
                    if (s.id === view.seriesId) return;
                    change(() => {
                      setSeriesId(s.id);
                      setHeld(null);
                      setSelectedId(null);
                      setHistoryMonths(2);
                    });
                  }}
                  style={{ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}
                >
                  <AppText variant="body" numeric style={{ flex: 1 }}>
                    {s.menuLabel}
                  </AppText>
                  {s.id === view.seriesId ? <Icon name="checkmark" color="text.primary" size={14} /> : null}
                </Pressable>
              ))
            : null}
          </View>
        ) : null}

        <StatStrip items={view.stats} accessibilityLabel={view.statsWords} ax={ax} />
        {view.info !== null ? <InfoLine info={view.info} infoLabel="Details" /> : null}

        <ExerciseLiftTarget data={lift} exerciseId={exerciseId} onChanged={reloadLift} />

        <View style={{ gap: theme.space['2'] }}>
          {/* Design pass 6.6: 44pt chips on one scrolling line each, so the chart starts higher. */}
          {view.metrics.length > 1 ? (
            <ChipScroll gap={theme.space['2']}>
              {view.metrics.map((m) => (
                <Chip
                  key={m.key}
                  size="min"
                  label={m.label}
                  selected={m.key === view.metric}
                  onPress={() => {
                    if (m.key !== view.metric) change(() => { setMetric(m.key); setSelectedId(null); });
                  }}
                />
              ))}
            </ChipScroll>
          ) : null}
          <ChipScroll gap={theme.space['2']}>
            {view.ranges.map((r) => (
              <Chip
                key={r.key}
                size="min"
                label={r.label}
                selected={r.key === view.range}
                onPress={() => {
                  if (r.key !== view.range) change(() => { setRange(r.key); });
                }}
              />
            ))}
          </ChipScroll>
        </View>

        <View style={{ gap: theme.space['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
            <AppText variant="callout" color="text.secondary" numeric style={{ flex: 1 }} accessibilityRole="header">
              {view.heading}
            </AppText>
            {view.estimateInfo ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="How Est. 1RM is worked out"
                onPress={() => {
                  setInfoOpen(true);
                }}
                style={{ minWidth: theme.target.min.width, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="info.circle" color="text.secondary" size={16} />
              </Pressable>
            ) : null}
          </View>

          {view.chart.kind !== 'chart' ? (
            <View style={{ gap: theme.space['2'] }} accessible={view.chart.kind === 'no_eligible'}>
              <AppText variant="body" color="text.secondary" numeric>
                {view.chart.message}
              </AppText>
              {chartAction ? (
                <TextButton
                  label={chartAction.label}
                  onPress={() => {
                    change(() => {
                      setRange(chartAction.range);
                    });
                  }}
                />
              ) : null}
            </View>
          ) : table ? (
            <ChartTable headers={view.table.headers} rows={view.table.rows} onOpen={openWorkout} />
          ) : (
            <TrendChart
              points={view.points}
              markers={view.markers}
              from={view.bounds.from}
              to={view.bounds.to}
              bars={view.bars}
              axisUnit={view.axisUnit}
              axisFormat={view.axisFormat}
              words={view.chartWords}
              selected={picked?.focus ?? null}
              onSelect={(i) => {
                setSelectedId(i === null ? null : (view.points[i]?.sessionId ?? null));
              }}
              onOpen={openWorkout}
              target={lift?.on === true && lift.target !== null ? services.liftTargets.chartValue(lift.target, view.seriesTerms, view.metric) : null}
            />
          )}

          {/* Selection panel (fixed place, never a floating callout). */}
          {view.chart.kind === 'chart' || view.chart.kind === 'too_few' ? (
            <View style={{ gap: theme.space['1'], minHeight: 96 }}>
              {sel ? (
                <>
                  <AppText variant="headline" numeric>
                    {sel.title}
                  </AppText>
                  <AppText variant="body" numeric>
                    {sel.detail}
                  </AppText>
                  {sel.notes.length > 0 || picked?.weekBest ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
                      {picked?.weekBest ? <Tag text={picked.weekBest} /> : null}
                      {sel.notes.map((n) => (
                        <Tag key={n} text={n} />
                      ))}
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <TextButton
                      label="Open workout ›"
                      accessibilityLabel={`Open workout, ${sel.title}`}
                      onPress={() => {
                        openWorkout(sel.sessionId);
                      }}
                    />
                    <TextButton
                      label="Clear ×"
                      tone="secondary"
                      accessibilityLabel="Clear selection"
                      onPress={() => {
                        setSelectedId(null);
                      }}
                    />
                  </View>
                </>
              ) : (
                view.panel.map((l) => (
                  <View key={l.label} accessible accessibilityLabel={l.words} style={{ flexDirection: ax ? 'column' : 'row', gap: ax ? 0 : theme.space['3'] }}>
                    <AppText variant="callout" color="text.secondary" style={ax ? undefined : { width: 64 }}>
                      {l.label}
                    </AppText>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
                      {l.direction === 'up' || l.direction === 'down' ? <Icon name={l.direction === 'up' ? 'arrow.up' : 'arrow.down'} color="text.secondary" size={12} /> : null}
                      <AppText variant="callout" numeric style={{ flex: 1 }}>
                        {l.value}
                      </AppText>
                    </View>
                  </View>
                ))
              )}
            </View>
          ) : null}
          {view.chart.kind === 'chart' ? (
            <TextButton
              label={table ? 'Show chart' : 'Show as table'}
              onPress={() => {
                setTable((t) => !t);
              }}
            />
          ) : null}
        </View>

        {view.repTable ? (
          <View style={{ gap: theme.space['2'] }}>
            <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
              BEST REPS
            </AppText>
            <Segmented
              options={[
                { key: 'weight' as const, label: 'By weight' },
                { key: 'reps' as const, label: 'By reps' },
              ]}
              selected={view.repTable.by}
              onSelect={(k) => {
                change(() => { setRepBy(k); });
              }}
              label="Best reps"
            />
            {view.repTable.rows.length === 0 ? (
              <AppText variant="callout" color="text.secondary">
                None in this range.
              </AppText>
            ) : (
              <RepTable
                table={view.repTable}
                showAll={repAll}
                onShowAll={() => {
                  setRepAll(true);
                }}
                onOpen={openWorkout}
              />
            )}
          </View>
        ) : null}

        {view.distanceTable ? (
          <View style={{ gap: theme.space['2'] }}>
            <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
              BEST DISTANCE
            </AppText>
            {view.distanceTable.rows.length === 0 ? (
              <AppText variant="callout" color="text.secondary">
                None in this range.
              </AppText>
            ) : (
              <RepTable
                table={view.distanceTable}
                showAll={repAll}
                onShowAll={() => {
                  setRepAll(true);
                }}
                onOpen={openWorkout}
              />
            )}
          </View>
        ) : null}

        {records === null ? null : (
          <View style={{ gap: theme.space['2'] }}>
            <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
              RECORDS
            </AppText>
            {records.empty !== null ? (
              <AppText variant="callout" color="text.secondary">
                {records.empty}
              </AppText>
            ) : (
              recordRows.map((r) => (
                <Pressable
                  key={r.key}
                  accessibilityRole="button"
                  accessibilityLabel={r.words}
                  accessibilityHint="Opens the workout"
                  onPress={() => {
                    openWorkout(r.sessionId);
                  }}
                  style={({ pressed }) => ({ minHeight: theme.target.min.height, paddingVertical: theme.space['2'], flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
                >
                  <AppText variant="body" numeric style={{ flex: 1 }}>{`${r.label}  ${r.value} · ${r.date}`}</AppText>
                  <Icon name="chevron.right" color="text.tertiary" size={14} />
                </Pressable>
              ))
            )}
            {!recordsAll && records.items.length > 5 ? (
              <TextButton
                label={`Show all (${String(records.items.length)})`}
                onPress={() => {
                  setRecordsAll(true);
                }}
              />
            ) : null}
          </View>
        )}

        <View style={{ gap: theme.space['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
              HISTORY
            </AppText>
            <AppText variant="label" color="text.secondary">
              {view.history.unit}
            </AppText>
          </View>
          {targets?.hitText != null ? (
            <AppText variant="callout" color="text.secondary" numeric>
              {targets.hitText}
            </AppText>
          ) : null}
          {view.history.months.map((m) => (
            <View key={m.month}>
              <AppText variant="headline" accessibilityRole="header">
                {m.title}
              </AppText>
              {m.rows.map((r) => (
                <Pressable
                  key={r.key}
                  accessibilityRole="button"
                  accessibilityLabel={r.words}
                  onPress={() => {
                    openWorkout(r.sessionId);
                  }}
                  style={({ pressed }) => ({ minHeight: theme.target.min.height, paddingVertical: theme.space['2'], flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="body" numeric>
                      {r.title}
                    </AppText>
                    <AppText variant="callout" color="text.secondary" numeric>
                      {r.sets}
                    </AppText>
                    {targetLine(targetOf(r.sessionId))}
                    {r.tags.length > 0 ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
                        {r.tags.map((t) => (
                          <Tag key={t} text={t} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <Icon name="chevron.right" color="text.tertiary" size={14} />
                </Pressable>
              ))}
            </View>
          ))}
          {view.history.more ? (
            <TextButton
              label={view.history.more.label}
              onPress={() => {
                const months = view.history.more?.months;
                if (months !== undefined) change(() => { setHistoryMonths(months); });
              }}
            />
          ) : null}
        </View>
      </ScrollView>
      <AskPill
        bottom={theme.space['4'] + (deleted.toast ? toastHeight : 0)}
        onPress={() => {
          navigation.navigate('Coach', { entry: { kind: 'progress_exercise', exerciseName: view.title, seriesLabel: view.seriesLabel, from: view.bounds.from, to: view.bounds.to } });
        }}
      />
      {deleteToast}
      <E1rmSheet
        visible={infoOpen}
        onClose={() => {
          setInfoOpen(false);
        }}
      />
    </View>
  );
}
