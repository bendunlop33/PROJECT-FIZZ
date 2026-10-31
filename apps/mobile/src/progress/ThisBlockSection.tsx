import { useNavigation } from '@react-navigation/native';
import { Pressable, View } from 'react-native';

import { BLOCKS_COPY, type BlockBarState, type BlockWeekBar, type ThisBlockRow, type ThisBlockView } from '@fizz/domain';

import { useScreenData } from '../shell/context';
import { useTheme, type ColorToken } from '../theme';
import { AppText, Icon, TextButton } from '../ui';
import { useReloadOn } from './use-reload-on';

/**
 * (Ben, 31 Oct; docs/design/block-progress.md §1) `This block` at the top of Progress › Lifts (and a past block's same
 * view from Blocks): `This block` · `Week 3 of 6` · `Blocks ›`, one row per main lift of the plan in use (name,
 * week-1 best → this block's best, six mini week bars, the change or `Stalled`), and the legend. A row opens the lift's
 * block detail. Lays out the service's view; computes nothing. Nothing when there is no block (no plan applied yet).
 */

/** Bar heights (pt): a trained week 10–24 by its level; grey 6; the deload dashed 8. */
const BAR = { min: 10, max: 24, none: 6, deload: 8, width: 7, gap: 3, box: 26 } as const;

const BAR_COLOR: Readonly<Record<BlockBarState, ColorToken>> = { up: 'status.done', stalled: 'status.warning', deload: 'border.control', none: 'border.divider' };

export function WeekBars({ bars }: { bars: readonly BlockWeekBar[] }) {
  const theme = useTheme();
  return (
    <View accessible={false} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: BAR.gap, height: BAR.box }}>
      {bars.map((b) => {
        const height = b.state === 'deload' ? BAR.deload : b.state === 'none' || b.level === null ? BAR.none : Math.round(BAR.min + (BAR.max - BAR.min) * b.level);
        const dashed = b.state === 'deload';
        return <View key={b.week} style={{ width: BAR.width, height, borderRadius: 2, ...(dashed ? { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors[BAR_COLOR.deload] } : { backgroundColor: theme.colors[BAR_COLOR[b.state]] }) }} />;
      })}
    </View>
  );
}

export function Pill({ text, tone }: { text: string; tone: 'stalled' | 'up' | 'neutral' }) {
  const theme = useTheme();
  const bg: ColorToken = tone === 'stalled' ? 'status.warning.subtle' : tone === 'up' ? 'status.done.subtle' : 'bg.raised';
  const fg: ColorToken = tone === 'stalled' ? 'status.warning' : tone === 'up' ? 'status.done' : 'text.secondary';
  return (
    <View style={{ backgroundColor: theme.colors[bg], borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
      <AppText variant="sectionLabel" color={fg} numeric>
        {text}
      </AppText>
    </View>
  );
}

function Row({ row, first, onPress }: { row: ThisBlockRow; first: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], paddingHorizontal: theme.space['4'], paddingVertical: theme.space['3'], borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
          {row.name}
        </AppText>
        {row.line !== null ? (
          <AppText variant="callout" color="text.secondary" numeric numberOfLines={1}>
            {row.line}
          </AppText>
        ) : null}
      </View>
      <WeekBars bars={row.bars} />
      {row.stalled ? (
        <Pill text={BLOCKS_COPY.legendStalled} tone="stalled" />
      ) : row.delta !== null ? (
        <AppText variant="callout" color={row.gain ? 'status.done' : 'text.secondary'} numeric style={{ fontWeight: '600' }}>
          {row.delta}
        </AppText>
      ) : null}
      <Icon name="chevron.right" color="text.tertiary" size={14} />
    </Pressable>
  );
}

function Legend({ view }: { view: ThisBlockView }) {
  const theme = useTheme();
  const swatch = (s: BlockBarState) => <View style={{ width: 8, height: 8, borderRadius: 2, ...(s === 'deload' ? { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors['border.control'] } : { backgroundColor: theme.colors[BAR_COLOR[s]] }) }} />;
  const item = (s: BlockBarState, label: string) => (
    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {swatch(s)}
      <AppText variant="callout" color="text.tertiary" style={{ fontSize: 12, lineHeight: 16 }}>
        {label}
      </AppText>
    </View>
  );
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>{[item('up', view.legend.up), item('stalled', view.legend.stalled), item('deload', view.legend.deload)]}</View>;
}

/** The section itself, from a loaded view (render tests and the Block screen share it). */
export function ThisBlockList({ view, blocksLink, onOpen, onBlocks }: { view: ThisBlockView; blocksLink: boolean; onOpen: (row: ThisBlockRow) => void; onBlocks: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['3'] }}>
      <View style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
        <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
          {view.title}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
          <AppText variant="callout" color="text.secondary" numeric>
            {view.meta}
          </AppText>
          {blocksLink ? <TextButton label={`${BLOCKS_COPY.blocksLink} ›`} tone="secondary" onPress={onBlocks} /> : null}
        </View>
      </View>
      {view.rows.length > 0 ? (
        <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, overflow: 'hidden' }}>
          {view.rows.map((r, i) => (
            <Row
              key={r.exerciseId}
              row={r}
              first={i === 0}
              onPress={() => {
                onOpen(r);
              }}
            />
          ))}
        </View>
      ) : null}
      {view.rows.length > 0 ? <Legend view={view} /> : null}
    </View>
  );
}

/** Progress › Lifts' section (`blockKey` null: the current block), reading its own data. */
export function ThisBlockSection({ blockKey = null, active = true, blocksLink = true }: { blockKey?: string | null; active?: boolean; blocksLink?: boolean }) {
  const navigation = useNavigation();
  const [data, reload] = useScreenData((s) => s.blockProgress.thisBlock(blockKey).catch(() => null), { enabled: active });
  useReloadOn(blockKey ?? '', reload);
  const view = data.state === 'ready' ? data.value : null;
  if (view === null) return null;
  return (
    <ThisBlockList
      view={view}
      blocksLink={blocksLink}
      onOpen={(r) => {
        navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressLiftBlock', params: { blockKey: view.current ? null : view.blockKey, exerciseId: r.exerciseId, name: r.name } } });
      }}
      onBlocks={() => {
        navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressBlocks' } });
      }}
    />
  );
}
