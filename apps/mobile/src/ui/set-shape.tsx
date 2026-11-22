import { useEffect, useState } from 'react';
import { Pressable, useWindowDimensions, View, type AccessibilityActionEvent } from 'react-native';

import type { StepTarget } from '@fizz/domain';

import { useTheme } from '../theme';
import { AX_FONT_SCALE } from '../workout/screen-rules';
import { cardioDraftWith, repsDraftValid, repsDraftWith, repsSteps, type RepsDraft } from '../workout/reps-draft';
import { countSteps, effortChoices, SET_SHAPE_COPY, setShapeStacked } from '../workout/set-shape-view';
import { TextButton } from './buttons';
import { Icon } from './Icon';
import { BottomCard } from './sheet';
import { AppText } from './Text';
import { Chip, ChipRow, NumberStepper } from './workout';

/**
 * The one "how many sets" control (exercise-library §10.5, design-system
 * §9.88): `CountStepper` rows, `SetShapeControl` (Sets, Warm-ups, Reps,
 * Target RPE) and `SetCountBar` (the pick sheets' 64pt `Sets` bar), plus
 * `EffortSheet` (§9.91) and the shape's `RepsSheet`. They show values the
 * domain gave them and compute nothing. Every control is ≥ 44pt; values are
 * tabular; no toast per tap; no animation.
 */

function Circle({ glyph, label, disabled, onPress }: { glyph: 'minus' | 'plus'; label: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.colors['border.control'],
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
      })}
    >
      <Icon name={glyph} color={disabled ? 'text.tertiary' : 'text.primary'} size={16} weight="semibold" />
    </Pressable>
  );
}

/**
 * `Sets [−] 3 [+]`: one adjustable VoiceOver element ("Sets, 3,
 * adjustable"; swipe up/down) plus the two buttons ("Fewer sets", "More
 * sets"). At a limit a button is dimmed.
 */
export function CountStepper({ label, value, limits, onChange, fewerLabel, moreLabel, stacked = false, valueText, steps: given }: { label: string; value: number; limits: { min: number; max: number }; onChange: (n: number) => void; fewerLabel: string; moreLabel: string; stacked?: boolean; /** Shown instead of the number (e.g. `3:00`). */ valueText?: string; /** The values − and + go to, from the domain (null: off); absent: ±1 within `limits`. */ steps?: { down: number | null; up: number | null } }) {
  const theme = useTheme();
  const steps = given ?? countSteps(value, limits);
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment' && steps.up !== null) onChange(steps.up);
    if (e.nativeEvent.actionName === 'decrement' && steps.down !== null) onChange(steps.down);
  };
  return (
    <View style={{ flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'flex-start' : 'center', minHeight: 52, gap: theme.space['2'] }}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: valueText ?? String(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAction}
        style={{ flex: stacked ? 0 : 1, minHeight: 44, justifyContent: 'center' }}
      >
        <AppText variant="body">{label}</AppText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
        <Circle glyph="minus" label={fewerLabel} disabled={steps.down === null} onPress={() => { if (steps.down !== null) onChange(steps.down); }} />
        <AppText variant="headline" numeric align="center" style={{ minWidth: valueText === undefined ? 32 : 48 }} accessibilityElementsHidden importantForAccessibility="no">
          {valueText ?? String(value)}
        </AppText>
        <Circle glyph="plus" label={moreLabel} disabled={steps.up === null} onPress={() => { if (steps.up !== null) onChange(steps.up); }} />
      </View>
    </View>
  );
}

function ValueRow({ label, value, onPress, stacked }: { label: string; value: string; onPress: () => void; stacked: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value.replace('–', ' to ')}`}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'flex-start' : 'center', minHeight: 52, gap: theme.space['2'], opacity: pressed ? 0.7 : 1 })}
    >
      <AppText variant="body" style={{ flex: stacked ? 0 : 1 }}>
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
        <AppText variant="body" color="text.secondary" numeric>
          {value}
        </AppText>
        <Icon name="chevron.right" color="text.tertiary" size={14} />
      </View>
    </Pressable>
  );
}

export interface SetShapeControlProps {
  workingSets: number;
  /** Null: no warm-ups row (the overview's add, a pick sheet). */
  warmups: number | null;
  setsLimits: { min: number; max: number };
  warmupLimits: { min: number; max: number };
  onSets: (n: number) => void;
  onWarmups: (n: number) => void;
  /** `Reps` / `Work time` row; null hides it. */
  reps: { label: string; text: string; onPress: () => void } | null;
  /** `Target RPE` / `Target RIR`; null hides it (effort scale off). */
  effort: { label: string; text: string; onPress: () => void } | null;
  /** Label above its control. Default: stacked at AX1 and above (EL-B24, review S3). */
  stacked?: boolean;
}

/** AX1 and above (Dynamic Type): labels go above their controls, so the two 44pt circles and the value keep a row of their own. */
function useStacked(asked: boolean | undefined): boolean {
  const { fontScale } = useWindowDimensions();
  return setShapeStacked(asked, fontScale, AX_FONT_SCALE);
}

/** `SetShapeControl` (§9.88): up to four rows, ≥ 52pt, hairlines between. */
export function SetShapeControl(p: SetShapeControlProps) {
  const theme = useTheme();
  const stacked = useStacked(p.stacked);
  const rows = [
    <CountStepper key="sets" label={SET_SHAPE_COPY.sets} value={p.workingSets} limits={p.setsLimits} onChange={p.onSets} fewerLabel={SET_SHAPE_COPY.fewerSets} moreLabel={SET_SHAPE_COPY.moreSets} stacked={stacked} />,
    ...(p.warmups === null ? [] : [<CountStepper key="warm" label={SET_SHAPE_COPY.warmups} value={p.warmups} limits={p.warmupLimits} onChange={p.onWarmups} fewerLabel={SET_SHAPE_COPY.fewerWarmups} moreLabel={SET_SHAPE_COPY.moreWarmups} stacked={stacked} />]),
    ...(p.reps === null ? [] : [<ValueRow key="reps" label={p.reps.label} value={p.reps.text} onPress={p.reps.onPress} stacked={stacked} />]),
    ...(p.effort === null ? [] : [<ValueRow key="effort" label={p.effort.label} value={p.effort.text} onPress={p.effort.onPress} stacked={stacked} />]),
  ];
  return (
    <View>
      {rows.map((r, i) => (
        <View key={String(i)} style={{ borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
          {r}
        </View>
      ))}
    </View>
  );
}

/** `SetCountBar` (§9.88): one `Sets` row in a fixed 64pt bar above the keyboard and the sheet's primary. */
export function SetCountBar({ value, limits, onChange }: { value: number; limits: { min: number; max: number }; onChange: (n: number) => void }) {
  const theme = useTheme();
  const stacked = useStacked(undefined);
  return (
    <View style={{ minHeight: 64, justifyContent: 'center', backgroundColor: theme.colors['bg.surface'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], paddingVertical: theme.space['2'] }}>
      <CountStepper label={SET_SHAPE_COPY.sets} value={value} limits={limits} onChange={onChange} fewerLabel={SET_SHAPE_COPY.fewerSets} moreLabel={SET_SHAPE_COPY.moreSets} stacked={stacked} />
    </View>
  );
}

/** `EffortSheet` (§9.91): `Target RPE · <exercise>`, single-select chips, `None` first. */
export function EffortSheet({ visible, scale, title, value, onPick, onClose }: { visible: boolean; scale: 'rpe' | 'rir'; title: string; value: number | null | 'mixed'; onPick: (v: number | null) => void; onClose: () => void }) {
  const theme = useTheme();
  return (
    <BottomCard visible={visible} onClose={onClose} closeLabel={SET_SHAPE_COPY.done}>
      <View style={{ gap: theme.space['4'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
          <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </AppText>
          <TextButton label={SET_SHAPE_COPY.done} onPress={onClose} />
        </View>
        <ChipRow>
          {effortChoices(scale).map((c) => (
            <Chip key={c.label} label={c.label} selected={value === c.value} onPress={() => { onPick(c.value); }} />
          ))}
        </ChipRow>
      </View>
    </BottomCard>
  );
}

/**
 * The shape's `Reps` sheet (§9.84 layout): Range / Exact with `From` / `To`,
 * or `Work time` for a timed exercise. `Done` sends one value.
 */
export function ShapeRepsSheet({ visible, title, start, onDone, onClose }: { visible: boolean; title: string; start: RepsDraft; onDone: (v: { reps: { min: number; max: number } } | { durationS: number } | { cardio: { durationS: number | null; distanceM: number | null } }) => void; onClose: () => void }) {
  const theme = useTheme();
  const [d, setD] = useState<RepsDraft>(start);
  useEffect(() => {
    if (visible) setD(start);
  }, [visible]);
  const steps = repsSteps(d);
  const off: StepTarget = { enabled: false, reason: '' };
  return (
    <BottomCard visible={visible} onClose={onClose} closeLabel={SET_SHAPE_COPY.done}>
      <View style={{ gap: theme.space['4'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
          <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </AppText>
          <TextButton
            label={SET_SHAPE_COPY.done}
            disabled={!repsDraftValid(d)}
            onPress={() => {
              onDone(d.kind === 'cardio' ? { cardio: { durationS: d.seconds, distanceM: d.distanceM } } : d.kind === 'time' ? { durationS: d.seconds } : { reps: { min: d.min, max: d.max } });
            }}
          />
        </View>
        {d.kind === 'cardio' ? (
          // Cardio (review S1): a time up to 4 h, typed as the machine shows it, and a distance.
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            <NumberStepper label="Time" unit={null} value={d.seconds} decimals={false} time onSurface down={steps.time?.down ?? off} up={steps.time?.up ?? off} onChange={(v) => { setD(cardioDraftWith(d, 'time', v)); }} />
            <NumberStepper label="Distance" unit="m" value={d.distanceM} decimals onSurface down={steps.distance?.down ?? off} up={steps.distance?.up ?? off} onChange={(v) => { setD(cardioDraftWith(d, 'distance', v)); }} />
          </View>
        ) : d.kind === 'time' ? (
          <NumberStepper label={SET_SHAPE_COPY.workTime} unit="s" value={d.seconds} decimals={false} onSurface down={steps.time?.down ?? off} up={steps.time?.up ?? off} onChange={(v) => { setD(repsDraftWith(d, 'time', v ?? 0)); }} />
        ) : (
          <>
            <ChipRow>
              <Chip label="Range" selected={!d.exact} onPress={() => { setD(repsDraftWith(d, 'range')); }} />
              <Chip label="Exact" selected={d.exact} onPress={() => { setD(repsDraftWith(d, 'exact')); }} />
            </ChipRow>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
              <NumberStepper label={d.exact ? 'Reps' : 'From'} unit={null} value={d.min} decimals={false} onSurface down={steps.from?.down ?? off} up={steps.from?.up ?? off} onChange={(v) => { setD(repsDraftWith(d, 'from', v ?? 1)); }} />
              {!d.exact ? <NumberStepper label="To" unit={null} value={d.max} decimals={false} onSurface down={steps.to?.down ?? off} up={steps.to?.up ?? off} onChange={(v) => { setD(repsDraftWith(d, 'to', v ?? d.min)); }} /> : null}
            </View>
          </>
        )}
      </View>
    </BottomCard>
  );
}
