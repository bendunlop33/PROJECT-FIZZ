import { useState, type ReactNode } from 'react';
import { Animated, Pressable, useWindowDimensions, View } from 'react-native';

import type { MarkerWords, OverviewRow as OverviewRowData, PanelLine } from '@fizz/domain';
import type { CheckInScore } from '@fizz/schemas';

import { useTheme } from '../theme';
import { statStripStacked, tileLabel, type StripWrap } from '../workout/overview';
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
  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={[hair, { flexDirection: stacked ? 'column' : 'row' }]}>
      {items.map((it, i) => (
        <View
          key={it.label}
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
          </AppText>
          <AppText variant="sectionLabel" color="text.tertiary" style={{ marginTop: 2 }}>
            {it.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** The one-word change marker (§4): tracked caps, `text.secondary`; HELD and NO LOAD in `status.warning` with the warning icon. */
export function ChangeMarker({ marker }: { marker: MarkerWords }) {
  const color = marker.tone === 'warning' ? 'status.warning' : 'text.secondary';
  const glyph = marker.glyph === 'up' ? 'arrow.up' : marker.glyph === 'down' ? 'arrow.down' : marker.glyph === 'warning' ? 'exclamationmark.triangle' : null;
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
  onWhy: () => void;
  onStillHurts?: (() => void) | undefined;
  onEditGym?: (() => void) | undefined;
  /** The coach row's tap (§5): Undo on a coach target, `Use coach target` after an Undo. */
  onCoach?: (() => void) | undefined;
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
export function OverviewRow({ row, detail, open, stacked, last, first, onToggle, onHowTo, onWhy, onStillHurts, onEditGym, onCoach }: OverviewRowProps) {
  const theme = useTheme();
  const coachLabel = row.coach === null ? null : row.coach.state === 'coach' ? 'Undo' : 'Use coach target';
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
      </View>
    </View>
  );
  return (
    <View style={{ borderTopWidth: first ? 0 : theme.dividerWidth, borderBottomWidth: last ? theme.dividerWidth : 0, borderColor: theme.colors['border.divider'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.accessibilityLabel}
        accessibilityHint={open ? 'Collapses.' : 'Expands.'}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => ({ minHeight: 64, paddingVertical: theme.space['2'] + 2, flexDirection: 'row', gap: 6, backgroundColor: pressed ? theme.colors['bg.surface'] : 'transparent' })}
      >
        <View style={{ minWidth: 30 }}>
          <AppText numeric color="text.tertiary" style={{ fontSize: 16, lineHeight: 22, fontWeight: '500', fontVariant: ['tabular-nums'] }}>
            {row.indexText}
          </AppText>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <AppText variant="headline">{row.name}</AppText>
          <AppText variant="callout" color="text.secondary" numeric>
            {detail}
          </AppText>
          {stacked ? right : null}
        </View>
        {stacked ? null : right}
      </Pressable>
      {open ? (
        <View style={{ marginLeft: 36, marginBottom: theme.space['3'], backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md, paddingHorizontal: theme.space['3'] + 2, paddingTop: theme.space['3'], paddingBottom: theme.space['3'] + 2, gap: theme.space['3'] }}>
          {row.panel.length > 0 ? <PanelLines lines={row.panel} stacked={stacked} stillHurts={row.painFlag?.checkDue === true} onStillHurts={onStillHurts} onEditGym={onEditGym} /> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            <OutlinePill label="Why?" onPress={onWhy} accessibilityLabel={`Why this target for ${row.name}?`} />
            {onHowTo ? <OutlinePill label="How to" onPress={onHowTo} accessibilityLabel={`How to: ${row.name}`} /> : null}
            {coachLabel !== null && onCoach ? <OutlinePill label={coachLabel} onPress={onCoach} accessibilityLabel={`${coachLabel}: ${row.name}`} /> : null}
          </View>
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
