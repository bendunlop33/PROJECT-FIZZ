import { useState } from 'react';
import { Animated, Pressable, useWindowDimensions, View } from 'react-native';

import type { CheckInScore } from '@fizz/schemas';

import { useTheme } from '../theme';
import { statStripStacked, tileLabel, type StripWrap } from '../workout/screen-rules';
import { Icon } from './Icon';
import { usePressScale } from './motion';
import { AppText } from './Text';

/**
 * Shared components first made for the Workout overview (retired 22 Oct):
 * `StatStrip` (Progress, Summary), `OutlinePill` and the inline
 * `CheckInScale` (Your workout). Direction D tokens only; no new colours.
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
