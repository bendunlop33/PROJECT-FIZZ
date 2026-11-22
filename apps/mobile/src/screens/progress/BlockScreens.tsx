import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { BLOCKS_COPY, type BlocksListRow, type LiftBlockDetailView } from '@fizz/domain';
import { readTextCoachState } from '@fizz/providers';

import { coachConnectionPorts } from '../../ai/coach-connection-ports';
import { summaryCoachView } from '../../ai/coach-connection-view';
import type { NextTimeTap } from '../../coach/next-time-view';
import type { ProgressStackParams } from '../../navigation/types';
import { Pill, ThisBlockSection } from '../../progress/ThisBlockSection';
import { useReloadOn } from '../../progress/use-reload-on';
import type { BlockLiftDetail } from '../../services/block-progress-service';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Chip, Icon, StatusLine, TextButton } from '../../ui';

/**
 * (Ben, 31 Oct; docs/design/block-progress.md) Block progress screens in the Progress stack. Each lays out the block
 * service's view and computes nothing; local reads only (rule 1).
 * - `BlockScreen`: one block's `This block` view (Library › Plan's `5 lifts up · 1 stalled ›`, a past block from Blocks).
 * - `LiftBlockScreen`: a lift's block detail: status pill and line, the weekly best-set chart, Week · Top set · Sets ·
 *   Est. 1RM (est., rule 6), and for a stalled lift `Next week` with one fix (Why?, Skip, Apply, then Undo).
 * - `BlocksScreen`: every block kept and one lift compared across them.
 */

const SCROLL = { contentInsetAdjustmentBehavior: 'automatic' as const };

export function BlockScreen() {
  const theme = useTheme();
  const route = useRoute<RouteProp<ProgressStackParams, 'ProgressBlock'>>();
  const key = route.params?.blockKey ?? null;
  return (
    <ScrollView {...SCROLL} style={{ backgroundColor: theme.colors['bg.canvas'] }} contentContainerStyle={{ padding: theme.components.screenMargin, paddingBottom: theme.space['8'] }}>
      <ThisBlockSection blockKey={key} blocksLink={key === null} />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// A lift's block detail

function Chart({ view }: { view: LiftBlockDetailView }) {
  const theme = useTheme();
  const H = 96;
  return (
    <View accessible accessibilityLabel={view.chart.map((c) => `${c.label} ${c.valueText ?? 'none'}`).join(', ')} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space['2'], height: H + 40 }}>
      {view.chart.map((c, i) => {
        const h = c.level === null ? 4 : Math.round(24 + (H - 24) * c.level);
        const color = c.state === 'stalled' ? 'status.warning' : c.state === 'up' ? 'status.done' : 'border.control';
        return (
          <View key={`${c.label}-${String(i)}`} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            {c.valueText !== null ? (
              <AppText variant="callout" color="text.secondary" numeric numberOfLines={1} style={{ fontSize: 11, lineHeight: 14 }}>
                {c.valueText}
              </AppText>
            ) : null}
            <View style={{ alignSelf: 'stretch', height: h, borderRadius: 3, ...(c.state === 'deload' ? { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors['border.control'] } : { backgroundColor: theme.colors[color] }) }} />
            <AppText variant="callout" color="text.tertiary" numberOfLines={1} style={{ fontSize: 11, lineHeight: 14 }}>
              {c.label}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

function Table({ view }: { view: LiftBlockDetailView }) {
  const theme = useTheme();
  const cell = (text: string, i: number, head = false) => (
    <AppText key={i} variant={head ? 'sectionLabel' : 'callout'} color={head ? 'text.tertiary' : 'text.primary'} numeric style={{ flex: i === 0 ? 1.1 : 1, textAlign: i === 0 ? 'left' : 'right' }}>
      {text}
    </AppText>
  );
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingVertical: 6 }}>{BLOCKS_COPY.tableHead.map((h, i) => cell(h, i, true))}</View>
      {view.table.map((r) => (
        <View key={r.week} style={{ flexDirection: 'row', paddingVertical: 10, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
          {[r.week, r.topSet, r.sets, r.e1rm].map((t, i) => cell(t, i))}
        </View>
      ))}
    </View>
  );
}

function NextWeekCard({ next, onTap }: { next: NonNullable<BlockLiftDetail['next']>; onTap: (tap: NextTimeTap) => void }) {
  const theme = useTheme();
  const [why, setWhy] = useState(false);
  const row = next.row;
  return (
    <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, padding: theme.space['4'], gap: theme.space['3'] }}>
      <AppText variant="headline" accessibilityRole="header">
        {BLOCKS_COPY.nextWeek}
      </AppText>
      <View accessible accessibilityLabel={`${row.exerciseName}, ${row.line.spoken}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
          {row.exerciseName}
        </AppText>
        <AppText variant="callout" numeric style={{ flexShrink: 0 }}>
          {row.line.text}
        </AppText>
      </View>
      {why && row.info.length > 0 ? (
        <AppText variant="callout" color="text.secondary">
          {row.info.join(' · ')}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['4'] }}>
        {row.info.length > 0 ? (
          <TextButton
            label="Why?"
            tone="secondary"
            onPress={() => {
              setWhy((w) => !w);
            }}
          />
        ) : null}
        {row.actions.map((a) => (
          <TextButton
            key={a.label}
            label={a.label}
            tone={a.tap === 'apply' ? 'accent' : 'secondary'}
            {...(a.accessibilityLabel === undefined ? {} : { accessibilityLabel: a.accessibilityLabel })}
            onPress={() => {
              onTap(a.tap);
            }}
          />
        ))}
        {next.pain ? (
          <AppText variant="callout" color="status.warning">
            Held · pain
          </AppText>
        ) : row.actions.length === 0 && row.trailing !== null ? (
          <AppText variant="callout" color="text.secondary">
            {row.trailing}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

export function LiftBlockScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const services = useServices();
  const changed = useDataChanged();
  const route = useRoute<RouteProp<ProgressStackParams, 'ProgressLiftBlock'>>();
  const { blockKey, exerciseId } = route.params;
  const busy = useRef(false);
  const [toast, setToast] = useState<string | null>(null);
  const [data, reload] = useScreenData(async (s) => {
    // Keychain + settings file only, no network; a read failure counts as not connected (as on the Summary).
    const coach = summaryCoachView(await readTextCoachState(coachConnectionPorts().ports).catch(() => null));
    return s.blockProgress.liftDetail(blockKey, exerciseId, coach.coach);
  });
  useReloadOn(`${blockKey ?? ''}|${exerciseId}`, reload);
  const detail = data.state === 'ready' ? data.value : null;
  const title = detail?.view.name ?? route.params.name ?? '';
  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  if (data.state === 'error') return <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open your training data." info={data.message} infoLabel="Error details" action={<TextButton label="Try again" onPress={reload} />} />;
  if (detail === null) return null;
  const v = detail.view;
  const next = detail.next;
  const tap = (t: NextTimeTap) => {
    if (next === null || busy.current) return;
    busy.current = true;
    void services.blockProgress
      .tapNext(next.sessionId, next.row, t)
      .then((r) => {
        changed();
        reload();
        setToast(r.ok ? null : r.message);
      })
      .finally(() => {
        busy.current = false;
      });
  };
  return (
    <ScrollView {...SCROLL} style={{ backgroundColor: theme.colors['bg.canvas'] }} contentContainerStyle={{ padding: theme.components.screenMargin, paddingBottom: theme.space['8'], gap: theme.space['5'] }}>
      <View style={{ gap: theme.space['2'] }}>
        {v.pill !== null ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <Pill text={v.pill.text} tone={v.pill.tone} />
          </View>
        ) : null}
        {v.line !== null ? (
          <AppText variant="body" color="text.secondary" numeric>
            {v.line}
          </AppText>
        ) : null}
      </View>
      {v.chart.length > 0 ? <Chart view={v} /> : null}
      {v.table.length > 0 ? <Table view={v} /> : null}
      {next !== null ? <NextWeekCard next={next} onTap={tap} /> : null}
      {toast !== null ? (
        <AppText variant="callout" color="text.secondary" accessibilityLiveRegion="polite">
          {toast}
        </AppText>
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Every block

function BlockRow({ row, first, onPress }: { row: BlocksListRow; first: boolean; onPress: () => void }) {
  const theme = useTheme();
  const body = (
    <View style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], paddingHorizontal: theme.space['4'], paddingVertical: theme.space['3'] }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <AppText variant="body" style={{ fontWeight: '600' }}>
          {row.title}
        </AppText>
        <AppText variant="callout" color="text.secondary" numeric>
          {row.sub}
        </AppText>
        {row.facts !== null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {row.facts}
          </AppText>
        ) : null}
      </View>
      {row.tag !== null ? <Pill text={row.tag} tone="up" /> : null}
      {row.opens ? <Icon name="chevron.right" color="text.tertiary" size={14} /> : null}
    </View>
  );
  const edge = { borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] };
  return row.opens ? (
    <Pressable accessibilityRole="button" accessibilityLabel={[row.title, row.sub, row.facts].filter((x) => x !== null).join(', ')} onPress={onPress} style={({ pressed }) => ({ ...edge, opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  ) : (
    <View style={edge}>{body}</View>
  );
}

export function BlocksScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const [lift, setLift] = useState<string | null>(null);
  const [data, reload] = useScreenData((s) => s.blockProgress.blocks(lift));
  useReloadOn(lift ?? '', reload);
  if (data.state === 'error') return <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open your training data." info={data.message} infoLabel="Error details" action={<TextButton label="Try again" onPress={reload} />} />;
  const v = data.state === 'ready' ? data.value : null;
  if (v === null) return null;
  const compare = v.compare;
  return (
    <ScrollView {...SCROLL} style={{ backgroundColor: theme.colors['bg.canvas'] }} contentContainerStyle={{ padding: theme.components.screenMargin, paddingBottom: theme.space['8'], gap: theme.space['5'] }}>
      {v.rows.length > 0 ? (
        <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, overflow: 'hidden' }}>
          {v.rows.map((r, i) => (
            <BlockRow
              key={r.key}
              row={r}
              first={i === 0}
              onPress={() => {
                navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressBlock', params: { blockKey: r.current ? null : r.key } } });
              }}
            />
          ))}
        </View>
      ) : (
        <AppText variant="body" color="text.secondary">
          No blocks yet.
        </AppText>
      )}
      {compare !== null ? (
        <View style={{ gap: theme.space['3'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            {compare.title}
          </AppText>
          {v.lifts.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space['2'] }}>
              {v.lifts.map((l) => (
                <Chip
                  key={l.exerciseId}
                  size="min"
                  label={l.name}
                  selected={l.selected}
                  onPress={() => {
                    setLift(l.exerciseId);
                  }}
                />
              ))}
            </ScrollView>
          ) : null}
          <View>
            <View style={{ flexDirection: 'row', paddingVertical: 6 }}>
              {BLOCKS_COPY.compareHead.map((h, i) => (
                <AppText key={h} variant="sectionLabel" color="text.tertiary" style={{ flex: i === 0 ? 1.3 : 1, textAlign: i === 0 ? 'left' : 'right' }}>
                  {h}
                </AppText>
              ))}
            </View>
            {compare.rows.map((r) => (
              <View key={r.block} style={{ flexDirection: 'row', paddingVertical: 10, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
                {[r.block, r.start, r.end, r.change].map((t, i) => (
                  <AppText key={i} variant="callout" numeric style={{ flex: i === 0 ? 1.3 : 1, textAlign: i === 0 ? 'left' : 'right' }}>
                    {t}
                  </AppText>
                ))}
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
