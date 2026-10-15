import { useState, type ReactNode } from 'react';
import { Animated, Pressable, useWindowDimensions, View } from 'react-native';

import type { MarkerWords, OverviewRow as OverviewRowData, PanelLine } from '@fizz/domain';
import type { CheckInScore } from '@fizz/schemas';

import { useTheme } from '../theme';
import { coachPill, statStripStacked, tileLabel, type StripWrap } from '../workout/overview';
import type { EditPill, EditPillKey, RowCustomAction } from '../workout/overview-edits';
import { Icon } from './Icon';
import { usePressScale } from './motion';
import { AppText } from './Text';

/**
 * Workout overview components (workout-overview.md §3, §10; design-system
 * follow-up): `StatStrip`, `ChangeMarker`, `OverviewRow`, `SupersetBracket`
 * and the inline `CheckInScale`. Direction D tokens only; no new colours.
 * They show what they're given and compute nothing.
 */

export interface StatItem {
  /** `55`, `19:05`, `15`. */
  value: string;
  /** `≈` before the value (estimates only, rule 6). */
  approx?: boolean;
  /** `min` after the value. */
  suffix?: string;
  label: string;
  /** A `clock` icon before the label (`TIME · FIT 45`). */
  clock?: boolean;
  /** A quiet line under the label (`1 of 3 timed`, F17). */
  note?: string;
  /**
   * The column is a button (fit-to-time FT1: the TIME tile opens `How long?`):
   * a caret after the value, ≥ 44 pt, its own VoiceOver element.
   */
  button?: { onPress: () => void; accessibilityLabel: string };
  /** This column's words for VoiceOver when the strip isn't read as one element (a column is a button). */
  spoken?: string;
}

/**
 * Three equal columns between hairlines; one VoiceOver element. Stacks
 * (value + label per line) at AX sizes (`ax`), or when a value is measured
 * wrapping in its column (review r2 S2), so no number breaks mid-way.
 */
export function StatStrip({ items, accessibilityLabel, ax }: { items: readonly StatItem[]; accessibilityLabel: string; ax: boolean }) {
  const theme = useTheme();
  // The window's width stands in for the strip's (the strip is the window less fixed margins), so it's known at the first layout.
  const { fontScale, width } = useWindowDimensions();
  const [wrappedAt, setWrappedAt] = useState<StripWrap | null>(null);
  const stacked = statStripStacked({ ax, width, fontScale, wrappedAt });
  const hair = { borderColor: theme.colors['border.divider'], borderTopWidth: theme.dividerWidth, borderBottomWidth: theme.dividerWidth };
  // With a button column, each column is its own VoiceOver element; else the strip reads as one.
  const split = items.some((it) => it.button !== undefined);
  return (
    <View accessible={!split} {...(split ? {} : { accessibilityLabel })} style={[hair, { flexDirection: stacked ? 'column' : 'row' }]}>
      {items.map((it, i) => {
        const column = (
        <View
          key={it.label}
          accessible={split && it.button === undefined}
          {...(split && it.button === undefined && it.spoken !== undefined ? { accessibilityLabel: it.spoken } : {})}
          style={{
            flex: stacked ? undefined : 1,
            paddingVertical: theme.space['2'] + 2,
            paddingLeft: !stacked && i > 0 ? theme.space['3'] + 2 : 0,
            borderLeftWidth: !stacked && i > 0 ? theme.dividerWidth : 0,
            borderTopWidth: stacked && i > 0 ? theme.dividerWidth : 0,
            borderColor: theme.colors['border.divider'],
          }}
        >
          <AppText
            numeric
            style={{ fontSize: 32, lineHeight: 36, fontWeight: '300', letterSpacing: -0.6, fontVariant: ['tabular-nums'] }}
            maxFontSizeMultiplier={1.6}
            onTextLayout={(e) => {
              // Measured in columns only: a wrapped value stacks the strip for this width and text size.
              if (!stacked && e.nativeEvent.lines.length > 1) setWrappedAt({ width, fontScale });
            }}
          >
            {it.approx ? (
              <AppText color="text.secondary" style={{ fontSize: 32, lineHeight: 36, fontWeight: '300' }} maxFontSizeMultiplier={1.6}>
                {'≈'}
              </AppText>
            ) : null}
            {it.value}
            {it.suffix ? (
              <AppText variant="callout" color="text.secondary">
                {` ${it.suffix}`}
              </AppText>
            ) : null}
            {it.button ? (
              <AppText variant="callout" color="text.secondary">
                {' ▾'}
              </AppText>
            ) : null}
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
            {it.clock ? <Icon name="clock" color="text.secondary" size={12} /> : null}
            <AppText variant="sectionLabel" color="text.tertiary">
              {it.label}
            </AppText>
          </View>
          {it.note !== undefined ? (
            <AppText variant="callout" color="text.secondary" numeric>
              {it.note}
            </AppText>
          ) : null}
        </View>
        );
        const b = it.button;
        if (b === undefined) return column;
        return (
          <Pressable key={it.label} accessibilityRole="button" accessibilityLabel={b.accessibilityLabel} onPress={b.onPress} style={({ pressed }) => ({ flex: stacked ? undefined : 1, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
            {column}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The one-word change marker (§4): tracked caps, `text.secondary`; HELD and NO LOAD in `status.warning` with the warning icon. */
export function ChangeMarker({ marker }: { marker: MarkerWords }) {
  const color = marker.tone === 'warning' ? 'status.warning' : 'text.secondary';
  const glyph =
    marker.glyph === 'up'
      ? 'arrow.up'
      : marker.glyph === 'down'
        ? 'arrow.down'
        : marker.glyph === 'warning'
          ? 'exclamationmark.triangle'
          : marker.glyph === 'swap'
            ? 'arrow.left.arrow.right'
            : marker.glyph === 'skip'
              ? 'minus.circle'
              : marker.glyph === 'add'
                ? 'plus.circle'
                : marker.glyph === 'edit'
                  ? 'pencil'
                  : marker.glyph === 'clock'
                    ? 'clock'
                    : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {glyph ? <Icon name={glyph} color={color} size={marker.glyph === 'warning' ? 13 : 11} weight="semibold" /> : null}
      <AppText variant="sectionLabel" color={color} style={{ lineHeight: 22 }}>
        {marker.word}
      </AppText>
    </View>
  );
}

/** A 3 pt `text.tertiary` bracket down the left of a superset's rows: a shape, never colour alone. */
export function SupersetBracket({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View>
      <View style={{ paddingLeft: 30, paddingTop: theme.space['2'] + 2, paddingBottom: 2, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
        <AppText variant="sectionLabel" color="text.tertiary">
          Superset
        </AppText>
      </View>
      <View>
        <View accessible={false} importantForAccessibility="no" style={{ position: 'absolute', left: 4, top: 12, bottom: 14, width: 3, borderRadius: 2, backgroundColor: theme.colors['text.tertiary'] }} />
        {children}
      </View>
    </View>
  );
}

/** A 44 pt outline pill for the row panel's actions (`How to`, `Why?`, `Undo`). */
export function OutlinePill({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  const theme = useTheme();
  const press = usePressScale('pill');
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => ({
          minHeight: theme.target.min.height,
          paddingHorizontal: theme.space['4'],
          borderRadius: theme.radius.pill,
          borderWidth: 1,
          borderColor: theme.colors['border.control'],
          backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
          justifyContent: 'center',
        })}
      >
        <AppText variant="label">{label}</AppText>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The panel's facts: label then value. The label column is a minimum, never
 * a fixed width, so a longer label pushes the value along or onto the next
 * line; at AX sizes each label sits over its value (OV14, review B2).
 */
function PanelLines({
  lines,
  onStillHurts,
  onEditGym,
  stillHurts,
  stacked,
}: {
  lines: readonly PanelLine[];
  stillHurts: boolean;
  stacked: boolean;
  onStillHurts?: (() => void) | undefined;
  onEditGym?: (() => void) | undefined;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: stacked ? theme.space['2'] : 6 }}>
      {lines.map((l) => (
        <View key={l.key} accessible accessibilityLabel={`${l.label}: ${l.value}`} style={{ flexDirection: stacked ? 'column' : 'row', columnGap: theme.space['2'] + 2, rowGap: 2, flexWrap: stacked ? 'nowrap' : 'wrap' }}>
          <View style={{ minWidth: stacked ? undefined : 80 }}>
            <AppText variant="sectionLabel" color="text.tertiary" style={{ lineHeight: 22 }}>
              {l.label}
            </AppText>
          </View>
          <View style={{ flex: stacked ? undefined : 1, minWidth: stacked ? undefined : 160, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6 }}>
            {l.tone === 'warning' ? <Icon name="exclamationmark.triangle" color="status.warning" size={13} /> : null}
            <AppText variant="callout" numeric color={l.tone === 'warning' ? 'status.warning' : 'text.primary'}>
              {l.value}
            </AppText>
            {l.key === 'flag' && stillHurts && onStillHurts ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Still hurts?" onPress={onStillHurts} hitSlop={12} style={{ minHeight: 22 }}>
                <AppText variant="callout" style={{ textDecorationLine: 'underline', textDecorationColor: theme.colors['border.control'] }}>
                  Still hurts?
                </AppText>
              </Pressable>
            ) : null}
            {l.key === 'gym' && onEditGym ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Edit gym" onPress={onEditGym} hitSlop={12} style={{ minHeight: 22 }}>
                <AppText variant="callout" style={{ textDecorationLine: 'underline', textDecorationColor: theme.colors['border.control'] }}>
                  Edit gym
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export interface OverviewRowProps {
  row: OverviewRowData;
  detail: string;
  open: boolean;
  stacked: boolean;
  last: boolean;
  /** The first row of a superset sits right under its eyebrow, with no rule above. */
  first: boolean;
  onToggle: () => void;
  onHowTo?: (() => void) | undefined;
  /** `History` (workout-overview §2.2 region 8): the exercise's Progress detail (progress.md §2.7). */
  onHistory?: (() => void) | undefined;
  onWhy: () => void;
  onStillHurts?: (() => void) | undefined;
  onEditGym?: (() => void) | undefined;
  /** The coach row's tap (§5): Undo on a coach target; `Use coach target` or `Apply` to put it back. */
  onCoach?: (() => void) | undefined;
  /** Today's edit pills, first in the panel (overview-today-edits §2.2). */
  editPills?: readonly EditPill[] | undefined;
  onEditPill?: ((key: EditPillKey) => void) | undefined;
  /** `Why?` is left out on a skipped row (§2.2). */
  showWhy?: boolean | undefined;
  /** VoiceOver custom actions for the row's edits (§4.5). */
  customActions?: readonly RowCustomAction[] | undefined;
  onCustomAction?: ((name: RowCustomAction['name']) => void) | undefined;
  /** After the pills: `Change Push A too ›` or its change-review card (§2.5). */
  footer?: ReactNode;
  /** (Ben, 14 Oct) A coach draft's short reason line under the row: data, never rule prose. */
  reason?: string | null;
  /** The target is an estimate: `est.` by the load (rule 6). */
  estimate?: boolean;
  /** A coach draft's panel `LOAD` line (workout-builder §4.4): `LOAD  12.5 kg · est.`; `Why?` is the panel's pill. */
  loadLine?: string | null;
}

/** `SourceTag` `Coach` (§5): the coach set this row's target. Icon and word, never colour alone. */
function CoachTag() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name="text.bubble" color="text.secondary" size={11} />
      <AppText variant="sectionLabel" color="text.secondary" style={{ lineHeight: 22 }}>
        Coach
      </AppText>
    </View>
  );
}

/**
 * One exercise (min 64 pt, one button): index, name, detail, then the change
 * marker over the large target load (`TARGET` column). The info glyph means
 * the snap changed the target here; the reason is in the panel. At AX sizes
 * the load stacks under the name.
 */
export function OverviewRow({ row, detail, open, stacked, last, first, onToggle, onHowTo, onHistory, onWhy, onStillHurts, onEditGym, onCoach, editPills = [], onEditPill, showWhy = true, customActions = [], onCustomAction, footer, reason = null, estimate = false, loadLine = null }: OverviewRowProps) {
  const theme = useTheme();
  const coachLabel = row.coach === null ? null : coachPill(row.coach).label;
  // Skipped variant (design-system §9.66): name and detail in text.tertiary, load `—`.
  const skipped = row.edit?.kind === 'skipped';
  const right = (
    <View style={{ alignItems: stacked ? 'flex-start' : 'flex-end' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {row.coach?.state === 'coach' ? <CoachTag /> : null}
        <ChangeMarker marker={row.marker} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
        <AppText numeric color={row.load.none ? 'text.tertiary' : 'text.primary'} style={{ fontSize: 22, lineHeight: 26, fontWeight: '500', letterSpacing: -0.3, fontVariant: ['tabular-nums'] }}>
          {row.load.value}
          {row.load.unit ? (
            <AppText variant="callout" color="text.secondary">
              {` ${row.load.unit}`}
            </AppText>
          ) : null}
        </AppText>
        {row.rounded ? <Icon name="info.circle" color="text.tertiary" size={14} /> : null}
        {estimate && !row.load.none ? (
          <AppText variant="sectionLabel" color="text.secondary">
            est.
          </AppText>
        ) : null}
      </View>
    </View>
  );
  return (
    <View style={{ borderTopWidth: first ? 0 : theme.dividerWidth, borderBottomWidth: last ? theme.dividerWidth : 0, borderColor: theme.colors['border.divider'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.accessibilityLabel}${estimate && !row.load.none ? ', estimate' : ''}${reason === null ? '' : `. ${reason}`}`}
        accessibilityHint={open ? 'Collapses.' : 'Expands.'}
        accessibilityState={{ expanded: open }}
        accessibilityActions={customActions.map((a) => ({ name: a.name, label: a.label }))}
        onAccessibilityAction={(e) => {
          const hit = customActions.find((a) => a.name === e.nativeEvent.actionName);
          if (hit && onCustomAction) onCustomAction(hit.name);
        }}
        onPress={onToggle}
        style={({ pressed }) => ({ minHeight: 64, paddingVertical: theme.space['2'] + 2, flexDirection: 'row', gap: 6, backgroundColor: pressed ? theme.colors['bg.surface'] : 'transparent' })}
      >
        <View style={{ minWidth: 30 }}>
          <AppText numeric color="text.tertiary" style={{ fontSize: 16, lineHeight: 22, fontWeight: '500', fontVariant: ['tabular-nums'] }}>
            {row.indexText}
          </AppText>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <AppText variant="headline" color={skipped ? 'text.tertiary' : 'text.primary'}>
            {row.name}
          </AppText>
          <AppText variant="callout" color={skipped ? 'text.tertiary' : 'text.secondary'} numeric>
            {detail}
          </AppText>
          {reason !== null && !skipped ? (
            <AppText variant="label" color="text.tertiary" numeric numberOfLines={2}>
              {reason}
            </AppText>
          ) : null}
          {stacked ? right : null}
        </View>
        {stacked ? null : right}
      </Pressable>
      {open ? (
        <View style={{ marginLeft: 36, marginBottom: theme.space['3'], backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md, paddingHorizontal: theme.space['3'] + 2, paddingTop: theme.space['3'], paddingBottom: theme.space['3'] + 2, gap: theme.space['3'] }}>
          {loadLine !== null && !skipped ? (
            <AppText variant="callout" color="text.secondary" numeric accessibilityLabel={loadLine.replace(/^LOAD\s+/, 'Load ').replace(' · est.', ', estimate').replace(' · ', ', ')}>
              {loadLine}
            </AppText>
          ) : null}
          {row.panel.length > 0 ? <PanelLines lines={row.panel} stacked={stacked} stillHurts={row.painFlag?.checkDue === true} onStillHurts={onStillHurts} onEditGym={onEditGym} /> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            {editPills.map((p) => (
              <OutlinePill
                key={p.key}
                label={p.label}
                accessibilityLabel={p.accessibilityLabel}
                onPress={() => {
                  onEditPill?.(p.key);
                }}
              />
            ))}
            {onHowTo ? <OutlinePill label="How to" onPress={onHowTo} accessibilityLabel={`How to: ${row.name}`} /> : null}
            {onHistory ? <OutlinePill label="History" onPress={onHistory} accessibilityLabel={`History: ${row.name}`} /> : null}
            {showWhy ? <OutlinePill label="Why?" onPress={onWhy} accessibilityLabel={`Why this target for ${row.name}?`} /> : null}
            {coachLabel !== null && onCoach ? <OutlinePill label={coachLabel} onPress={onCoach} accessibilityLabel={`${coachLabel}: ${row.name}`} /> : null}
          </View>
          {footer ?? null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The inline check-in (§3.9): five 50 × 52 outline tiles. Selected =
 * `accent.subtle` + 2 pt accent border + check, never an accent fill, so
 * Start stays the only filled pill (OV13).
 */
export function CheckInScale({ selected, onPick, disabled }: { selected: CheckInScore | null; onPick: (n: CheckInScore) => void; disabled: boolean }) {
  const theme = useTheme();
  const scores: readonly CheckInScore[] = [1, 2, 3, 4, 5];
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {scores.map((n) => {
        const on = selected === n;
        return (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={tileLabel(n)}
            accessibilityState={{ selected: on, disabled }}
            disabled={disabled}
            onPress={() => {
              onPick(n);
            }}
            style={({ pressed }) => ({
              width: 50,
              height: 52,
              borderRadius: theme.radius.pill,
              borderWidth: on ? 2 : 1,
              borderColor: on ? theme.colors.accent : theme.colors['border.control'],
              backgroundColor: on ? theme.colors['accent.subtle'] : pressed ? theme.colors['bg.raised'] : 'transparent',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
            })}
          >
            {on ? <Icon name="checkmark" color="accent" size={12} weight="bold" /> : null}
            <AppText numeric style={{ fontSize: 18, lineHeight: 22, fontWeight: '500' }} maxFontSizeMultiplier={1.4}>
              {String(n)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
