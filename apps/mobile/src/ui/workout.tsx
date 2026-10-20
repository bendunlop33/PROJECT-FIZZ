import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { Animated, InputAccessoryView, Keyboard, Pressable, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { StepTarget } from '@fizz/domain';

import { haptic } from '../device/haptics';
import { useTheme } from '../theme';
import { PrimaryButton } from './buttons';
import { Icon, type SymbolName } from './Icon';
import { FadeIn, TEXT_PRESSED_OPACITY, usePressScale } from './motion';
import { AppText } from './Text';
import { accessoryAction, bottomBarPadding } from './keyboard-state';
import { CARDIO_TIME_FORMAT, NUMBER_FORMAT, nextFieldText } from './number-text';
import { effortInfoLabel, effortInfoLines, type EffortScale } from '../workout/effort-info';
import { AX_FONT_SCALE } from '../workout/overview';
import { stepperNumeralSize, stepperTexts, tileFit, tileRowLayout, type TileSpec } from '../workout/tile-fit';

/** Shared keyboard toolbar for number fields (the system decimal pad has no Done key). */
export const NUMBER_ACCESSORY_ID = 'fizz-number-done';

export function NumberAccessory({ onNext, onDone }: { onNext?: (() => void) | null; onDone?: (() => void) | null } = {}) {
  return <KeyboardDoneAccessory nativeID={NUMBER_ACCESSORY_ID} onNext={onNext ?? null} onDone={onDone ?? null} />;
}

/**
 * A `Done` bar above the keyboard (iOS `InputAccessoryView`) for a field whose keyboard has no
 * Done key: number pads, and multiline text where Return adds a line (the coach sheet, build 131).
 * With `onNext` it shows `Next ›` instead (weight then reps without the keypad dropping; 0.7);
 * `Done` closes the keyboard, then runs `onDone` (closing an inline editor with it).
 */
export function KeyboardDoneAccessory({ nativeID, onNext = null, onDone = null }: { nativeID: string; onNext?: (() => void) | null; onDone?: (() => void) | null }) {
  const theme = useTheme();
  const action = accessoryAction(onNext);
  return (
    <InputAccessoryView nativeID={nativeID} backgroundColor={theme.colors['bg.surface']}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: theme.space['4'], paddingVertical: theme.space['1'] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel}
          onPress={() => {
            if (onNext) {
              // Moves to the next field; the keypad stays up.
              onNext();
              return;
            }
            // Closes the keyboard (and the editor it belongs to); nothing is logged or sent.
            Keyboard.dismiss();
            onDone?.();
          }}
          style={{ minHeight: theme.target.min.height, justifyContent: 'center', paddingHorizontal: theme.space['3'] }}
        >
          <AppText variant="headline" color="accent">
            {action.label}
          </AppText>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

/** D tile − / +: a light glyph with a full 44 × 52 pt target. */
function TileStep({ glyph, target, onStep, describe, size, grow = false }: { glyph: string; target: StepTarget; onStep: (v: number) => void; describe: string; size?: number | undefined; /** Compact tile (F11): half the tile's width, full height. */ grow?: boolean }) {
  const theme = useTheme();
  const enabled = target.enabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={enabled ? `${describe} to ${target.label}` : describe}
      accessibilityState={{ disabled: !enabled }}
      {...(!enabled ? { accessibilityHint: target.reason } : {})}
      disabled={!enabled}
      hitSlop={6}
      onPress={() => {
        if (target.enabled) {
          haptic('step');
          onStep(target.value);
        }
      }}
      style={({ pressed }) => ({
        ...(grow ? { flex: 1, minWidth: theme.target.min.width } : { width: size ?? theme.target.min.width }),
        height: size ?? theme.target.workout.height,
        borderRadius: theme.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
        opacity: enabled ? 1 : 0.35,
      })}
    >
      <AppText variant="title2" color="text.tertiary" style={{ fontWeight: '400' }} maxFontSizeMultiplier={1.4}>
        {glyph}
      </AppText>
    </Pressable>
  );
}

function StepButton({ icon, target, onStep, describe, size }: { icon: SymbolName; target: StepTarget; onStep: (v: number) => void; describe: string; size?: number | undefined }) {
  const theme = useTheme();
  const enabled = target.enabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={enabled ? `${describe} to ${target.label}` : describe}
      accessibilityState={{ disabled: !enabled }}
      {...(!enabled ? { accessibilityHint: target.reason } : {})}
      disabled={!enabled}
      onPress={() => {
        if (target.enabled) {
          haptic('step');
          onStep(target.value);
        }
      }}
      style={({ pressed }) => ({
        width: size ?? theme.target.workout.width,
        minHeight: size ?? theme.target.workout.height,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.sm,
        backgroundColor: pressed ? theme.colors['accent.subtle'] : theme.colors['bg.raised'],
        opacity: enabled ? 1 : 0.4,
      })}
    >
      <Icon name={icon} color={enabled ? 'text.primary' : 'text.tertiary'} size={22} />
    </Pressable>
  );
}


/**
 * `NumberStepper` (design-system §9.4): [−] value [+]. The steps come from the
 * domain (achievable loads, or ±1 rep); the field accepts typing too.
 */
export function NumberStepper({
  label,
  unit,
  value,
  decimals: decimalsProp,
  down,
  up,
  onChange,
  warning = false,
  hint,
  inputRef,
  flex = 1,
  onSurface = false,
  stepSize,
  numeralSize,
  compact = false,
  onFocus,
  onBlur,
  onLayout,
  time = false,
  variant = 'tile',
  autoFocus = false,
  onStep,
  resetTextOnBlur = false,
}: {
  label: string;
  unit: string | null;
  value: number | null;
  decimals: boolean;
  /** A cardio time (review cardio S5): the value is seconds, typed and shown as `20:34`. */
  time?: boolean;
  down: StepTarget;
  up: StepTarget;
  onChange: (v: number | null) => void;
  warning?: boolean;
  hint?: string | null;
  /** So `Enter load` can focus the empty field (audit F2). */
  inputRef?: Ref<TextInput>;
  /** Share of the row (D-ActiveSet: LOAD 1.4, REPS 1); null when stacked full width (no flex in a column). */
  flex?: number | null;
  /** Shown on `bg.surface` (a sheet): the D tile uses `bg.raised` so it still reads as a tile. */
  onSurface?: boolean;
  /** − / + button size (Table open row: 52 pt, 60 pt at AX1+; design-system §9.75). Default 44 × 52. */
  stepSize?: number;
  /**
   * The numeral's rendered size (pt), Dynamic Type already applied, from
   * `tileFit` (WT-D13: shrinks to fit, never clipped). Rendered with font
   * scaling off so the measured fit holds. Default: `type.loadDisplay`.
   */
  numeralSize?: number;
  /** F11: − / + under the numeral so tiles sit side by side in a narrow row (`tileFit().compact`, D tile only). */
  compact?: boolean;
  /** The field took focus (the keypad is opening or moving to it): the Table anchors this tile (WT39). */
  onFocus?: () => void;
  /** The field lost focus (Edit set fits a typed load then). */
  onBlur?: () => void;
  /** The tile's frame in its parent, so the Table knows where the focused tile ends. */
  onLayout?: (e: LayoutChangeEvent) => void;
  /**
   * `inline` (design pass 1.1): one `− value +` line in a table row's editor, ≤ 60 pt with
   * its padding. The label is read by VoiceOver only; the numeral fits its measured width.
   */
  variant?: 'tile' | 'inline';
  /** Focus on mount: a field opened while the keypad is up keeps it up (Next ›, another cell). */
  autoFocus?: boolean;
  /** − / + taps go here instead of `onChange` (review B2: the reps range clamps on a step, not on each keystroke). */
  onStep?: (v: number) => void;
  /** On blur the field shows the saved value again, for a parent that holds back a typed value it can't take yet. */
  resetTextOnBlur?: boolean;
}) {
  const theme = useTheme();
  const format = time ? CARDIO_TIME_FORMAT : NUMBER_FORMAT;
  // A cardio time is typed `20.34` on the number pad (it has no colon), so it takes the decimal pad.
  const decimals = decimalsProp || time;
  const [text, setText] = useState(value === null ? '' : format.show(value));
  const [focused, setFocused] = useState(false);
  const [tileWidth, setTileWidth] = useState<number | null>(null);
  const { fontScale } = useWindowDimensions();
  useEffect(() => {
    setText((t) => nextFieldText(t, value, format));
  }, [value, time]);
  const flat = theme.components.cardBorderWidth === 0;
  const inline = variant === 'inline';
  // F9: without a fitted size from the caller, the numeral shrinks to its measured tile so `10` never shows as `1`.
  const fitted =
    numeralSize ??
    (tileWidth === null
      ? undefined
      : stepperNumeralSize({
          tileWidth,
          texts: [text, ...(time ? [value === null ? '—' : format.show(value), '0:00:00'] : stepperTexts(value, down, up, decimals ? 3 : 2))],
          unit: flat || inline ? unit : null,
          // The bordered variant's − / + are wider and sit 8 pt apart from the field.
          stepSize: flat || inline ? (stepSize ?? theme.target.min.width) : (stepSize ?? theme.target.workout.width) + theme.space['2'] + 2,
          fontScale,
        }));
  const step = onStep ?? onChange;
  const layout = (e: LayoutChangeEvent) => {
    setTileWidth(e.nativeEvent.layout.width);
    onLayout?.(e);
  };
  // Review S6: the inline editor's label is `Assist kg`, so match the start.
  const assist = label.startsWith('Assist');
  const describe = assist ? 'Assistance' : label;
  const decrease = assist ? 'Less assistance (harder)' : `Decrease ${describe.toLowerCase()}`;
  const increase = assist ? 'More assistance (easier)' : `Increase ${describe.toLowerCase()}`;
  const input = (
    <TextInput
      ref={inputRef}
      value={text}
      onChangeText={(t) => {
        setText(t);
        onChange(format.parse(t));
      }}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur?.();
        // A value the parent then commits replaces this through the effect above.
        if (resetTextOnBlur) setText(value === null ? '' : format.show(value));
      }}
      keyboardType={decimals ? 'decimal-pad' : 'number-pad'}
      inputAccessoryViewID={NUMBER_ACCESSORY_ID}
      autoFocus={autoFocus}
      selectTextOnFocus
      accessibilityLabel={`${label}${unit ? `, ${unit}` : ''}`}
      {...(hint ? { accessibilityHint: hint } : {})}
      placeholder="—"
      placeholderTextColor={theme.colors['text.tertiary']}
      {...(fitted !== undefined ? { allowFontScaling: false } : { maxFontSizeMultiplier: theme.type.loadDisplay.maxFontSizeMultiplier })}
      style={{
        minWidth: 36,
        textAlign: 'center',
        fontSize: fitted ?? theme.type.loadDisplay.fontSize,
        fontWeight: theme.type.loadDisplay.fontWeight,
        letterSpacing: theme.type.loadDisplay.letterSpacing,
        fontVariant: ['tabular-nums'],
        color: theme.colors['text.primary'],
        paddingVertical: 0,
      }}
    />
  );
  const unitText = unit ? (
    <AppText variant="body" color="text.secondary" style={{ fontSize: 18 }} maxFontSizeMultiplier={1.4}>
      {` ${unit}`}
    </AppText>
  ) : null;
  if (inline) {
    // 1.1: `[−] numeral [+]` on one line; the 1.5 pt focus / warning border and the max reason stay.
    return (
      <View onLayout={layout} style={flex === null ? { alignSelf: 'stretch', gap: theme.space['1'] } : { flex, minWidth: 0, gap: theme.space['1'] }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: stepSize ?? theme.target.workout.height,
            backgroundColor: onSurface ? theme.colors['bg.raised'] : theme.colors['bg.surface'],
            borderRadius: theme.radius.md,
            borderWidth: focused || warning ? 1.5 : 0,
            borderColor: warning ? theme.colors['status.warning'] : theme.colors['border.control'],
            paddingVertical: 0,
          }}
        >
          <TileStep glyph="−" target={down} onStep={step} describe={decrease} size={stepSize} />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', flexShrink: 1 }}>
            {input}
            {unitText}
          </View>
          <TileStep glyph="+" target={up} onStep={step} describe={increase} size={stepSize} />
        </View>
        {!up.enabled && value !== null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {up.reason}
          </AppText>
        ) : null}
      </View>
    );
  }
  if (flat) {
    // D-ActiveSet: a borderless tile with a tracked label, − value unit +.
    return (
      <View onLayout={layout} style={flex === null ? { alignSelf: 'stretch', gap: theme.space['1'] } : { flex, minWidth: 0, gap: theme.space['1'] }}>
        <View
          style={{
            backgroundColor: onSurface ? theme.colors['bg.raised'] : theme.colors['bg.surface'],
            borderRadius: theme.radius.lg,
            borderWidth: focused || warning ? 1.5 : 0,
            borderColor: warning ? theme.colors['status.warning'] : theme.colors['border.control'],
            paddingVertical: theme.space['4'],
            paddingHorizontal: theme.space['2'],
            gap: theme.space['2'],
          }}
        >
          <AppText variant="sectionLabel" color="text.tertiary" style={{ paddingHorizontal: theme.space['2'] }}>
            {label}
          </AppText>
          {compact ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' }}>
                {input}
                {unitText}
              </View>
              <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
                <TileStep glyph="−" target={down} onStep={step} describe={decrease} size={stepSize} grow />
                <TileStep glyph="+" target={up} onStep={step} describe={increase} size={stepSize} grow />
              </View>
            </>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <TileStep glyph="−" target={down} onStep={step} describe={decrease} size={stepSize} />
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', flexShrink: 1 }}>
                {input}
                {unitText}
              </View>
              <TileStep glyph="+" target={up} onStep={step} describe={increase} size={stepSize} />
            </View>
          )}
        </View>
        {!up.enabled && value !== null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {up.reason}
          </AppText>
        ) : null}
      </View>
    );
  }
  return (
    <View onLayout={layout} style={{ flex: 1, minWidth: 150, gap: theme.space['1'] }}>
      <AppText variant="label" color="text.secondary">
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <StepButton icon="minus" target={down} onStep={step} describe={decrease} size={stepSize} />
        <View
          style={{
            flex: 1,
            minHeight: theme.target.workout.height,
            borderRadius: theme.radius.sm,
            borderWidth: focused || warning ? 2 : 1,
            borderColor: warning ? theme.colors['status.warning'] : focused ? theme.colors.accent : theme.colors['border.control'],
            backgroundColor: theme.colors['bg.raised'],
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: theme.space['2'],
          }}
        >
          {input}
          {unit ? (
            <AppText variant="label" color="text.secondary">
              {` ${unit}`}
            </AppText>
          ) : null}
        </View>
        <StepButton icon="plus" target={up} onStep={step} describe={increase} size={stepSize} />
      </View>
      {!up.enabled && value !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {up.reason}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * A row of `NumberStepper` tiles on Focus and Edit set (review B1, WT-D13):
 * `tileFit` keeps numerals ≥ 28 pt, then goes compact (F11) or stacks. Each
 * tile takes `numeralSize`, `compact` and `flexOf(share)` from `children`.
 */
export function StepperTileRow({
  tiles,
  estimate,
  children,
  step,
  gap: gapProp,
}: {
  tiles: readonly TileSpec[];
  /** The row's width before it's measured. */
  estimate: number;
  children: (row: { numeralSize: number; compact: boolean; flexOf: (share: number) => number | null }) => ReactNode;
  /** The tiles' − / + size when not the default 44 pt (the Table: 52 pt, 60 pt at AX). */
  step?: number;
  gap?: number;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const [measured, setMeasured] = useState<number | null>(null);
  const flat = theme.components.cardBorderWidth === 0;
  const gap = gapProp ?? theme.space['3'];
  // The bordered variant's − / + are wider and sit 8 pt apart from the field (as `stepperNumeralSize`).
  const stepSize = flat ? (step ?? theme.target.min.width) : (step ?? theme.target.workout.width) + theme.space['2'] + 2;
  const fit = tileFit({ rowWidth: measured ?? estimate, tiles, stepSize, fontScale, ax: fontScale >= AX_FONT_SCALE, gap });
  const { compact, stacked } = tileRowLayout(fit, flat);
  return (
    <View
      onLayout={(e) => {
        setMeasured(e.nativeEvent.layout.width);
      }}
      style={{ flexDirection: stacked ? 'column' : 'row', gap }}
    >
      {children({ numeralSize: fit.numeralSize, compact, flexOf: (share) => (stacked ? null : share) })}
    </View>
  );
}

/**
 * `ParamChip` (§9.17): selected shows a check icon as well as the fill. A 52pt choice pill. `disabled` (design pass 4.5): dimmed to 0.45, a tertiary label, no press scale,
 * and read as dimmed by VoiceOver; a tap runs `onDisabledPress` (say, to show `Needs the coach`) if given.
 * `onSurface`: on a card, so an unselected chip is `bg.raised` with a `border.control` edge and reads as tappable.
 */
export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  grow = false,
  disabled = false,
  onDisabledPress,
  onSurface = false,
  size = 'workout',
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  grow?: boolean;
  disabled?: boolean;
  onDisabledPress?: () => void;
  onSurface?: boolean;
  /** `min`: 44pt, for filter rows away from the workout (design pass 6.6); default 52pt. */
  size?: 'workout' | 'min';
}) {
  const theme = useTheme();
  const press = usePressScale('pill');
  const filled = theme.components.cardBorderWidth === 0;
  const idle = onSurface ? theme.colors['bg.raised'] : theme.colors['bg.surface'];
  const edge = onSurface ? theme.colors['border.control'] : theme.colors['border.divider'];
  const height = size === 'min' ? theme.target.min.height : theme.target.workout.height;
  return (
    <Animated.View style={[grow ? { flex: 1 } : null, disabled ? null : press.style]}>
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={disabled ? onDisabledPress : onPress}
      {...(disabled ? {} : { onPressIn: press.onPressIn, onPressOut: press.onPressOut })}
      style={({ pressed }) => ({
        opacity: disabled ? 0.45 : 1,
        ...(filled
          ? {
              // D-Rest: selected is a full accent pill with a check; others sit on the surface. 52 pt (target.workout, D7).
              minHeight: height,
              minWidth: theme.target.min.width,
              paddingHorizontal: theme.space['3'],
              borderRadius: theme.radius.pill,
              borderWidth: selected ? 0 : 1,
              borderColor: edge,
              backgroundColor: selected ? (pressed && !disabled ? theme.colors['accent.pressed'] : theme.colors.accent) : pressed && !disabled ? theme.colors['bg.raised'] : idle,
              flexDirection: 'row' as const,
              alignItems: 'center' as const,
              justifyContent: 'center' as const,
              gap: theme.space['1'],
            }
          : {
              minHeight: height,
              minWidth: theme.target.workout.width,
              paddingHorizontal: theme.space['3'],
              borderRadius: theme.radius.pill,
              borderWidth: selected ? theme.components.selectedBorderWidth : 1,
              borderColor: selected ? theme.colors.accent : theme.colors['border.control'],
              backgroundColor: selected || (pressed && !disabled) ? theme.colors['accent.subtle'] : theme.colors['bg.raised'],
              flexDirection: 'row' as const,
              alignItems: 'center' as const,
              justifyContent: 'center' as const,
              gap: theme.space['1'],
            }),
      })}
    >
      {selected ? <Icon name="checkmark" color={filled ? 'on.accent' : 'accent'} size={14} /> : null}
      <AppText variant="label" numeric color={filled && selected ? 'on.accent' : disabled ? 'text.tertiary' : 'text.primary'} style={filled && selected ? { fontWeight: '600' } : undefined}>
        {label}
      </AppText>
    </Pressable>
    </Animated.View>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>{children}</View>;
}

/** `TalkButton` in its honest "not in this build" state (60 × 60, action bar left). */
export function TalkButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Talk, not in this build"
      accessibilityHint="Voice and the coach aren’t in this build yet"
      onPress={onPress}
      style={({ pressed }) => ({
        width: 60,
        height: 60,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors['border.control'],
        backgroundColor: pressed ? theme.colors['accent.subtle'] : theme.colors['bg.raised'],
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Icon name="mic.slash" color="text.secondary" size={20} />
      <AppText variant="label" color="text.secondary" maxFontSizeMultiplier={1.2}>
        Off
      </AppText>
    </Pressable>
  );
}

/**
 * `ActionBar` (§9.1): the one primary action, fixed at the bottom, on the
 * keyboard when open. Talk is passed only once voice exists; until then the
 * bar has no dead control (critic T3).
 */
export function ActionBar({
  talk = null,
  primary,
  guard,
  keypadOpen = false,
  surface = false,
}: {
  talk?: ReactNode;
  primary: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; lead?: string | null };
  guard?: boolean;
  /** On the keyboard: no room for the home indicator, a small gap only (0.2). */
  keypadOpen?: boolean;
  /** In a sheet on `bg.surface` (Edit set): the bar matches it. */
  surface?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
        backgroundColor: theme.components.barOnCanvas && !surface ? theme.colors['bg.canvas'] : theme.colors['bg.surface'],
        borderTopWidth: theme.components.barOnCanvas ? 0 : theme.dividerWidth,
        borderTopColor: theme.colors['border.divider'],
        paddingHorizontal: theme.components.barOnCanvas ? theme.space['5'] : theme.space['4'],
        paddingTop: theme.space['3'],
        paddingBottom: bottomBarPadding({ keypadOpen, insetBottom: insets.bottom, space2: theme.space['2'], space3: theme.space['3'], minInset: theme.components.barOnCanvas ? theme.space['4'] : 0 }),
      }}
    >
      {talk}
      <View style={{ flex: 1 }}>
        {guard ? (
          <View
            accessibilityRole="button"
            accessibilityLabel="Saved"
            accessibilityState={{ disabled: true }}
            style={{
              minHeight: theme.target.primary.height,
              borderRadius: theme.radius[theme.components.primaryButtonRadius],
              backgroundColor: theme.colors['status.done.subtle'],
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: theme.space['2'],
            }}
          >
            <Icon name="checkmark.circle.fill" color="status.done" />
            <AppText variant="headline">Saved</AppText>
          </View>
        ) : (
          <PrimaryButton label={primary.label} lead={primary.lead ?? null} onPress={primary.onPress} disabled={primary.disabled ?? false} busy={primary.busy ?? false} />
        )}
      </View>
    </View>
  );
}

/**
 * The toast's place (0.6): floating over the bottom of the screen at
 * `bottom` (the measured bottom chrome, `toastBottom`), so it never scrolls
 * away, never sits under a bar and doesn't reflow the list. `onHeight` lets
 * the screen pad its scroll while it shows.
 */
export function ToastHost({ children, bottom, onHeight }: { children: ReactNode; bottom: number; onHeight?: (h: number) => void }) {
  const empty = children === null || children === undefined || children === false;
  useEffect(() => {
    if (empty) onHeight?.(0);
  }, [empty]);
  if (empty) return null;
  return (
    <View
      pointerEvents="box-none"
      onLayout={(e) => {
        onHeight?.(e.nativeEvent.layout.height);
      }}
      style={{ position: 'absolute', left: 0, right: 0, bottom }}
    >
      {children}
    </View>
  );
}

/** `UndoToast` (§9.10): above the action bar, never over it (in a `ToastHost`). */
export function Toast({
  icon = 'checkmark.circle.fill',
  text,
  action,
  onAction,
  onDismiss,
  showClose = false,
  secondary,
  onSecondary,
}: {
  icon?: SymbolName;
  text: string;
  action?: string;
  onAction?: () => void;
  /** A quieter second action before the main one (`Why?`). */
  secondary?: string;
  onSecondary?: () => void;
  /** Dismisses the toast: the VoiceOver escape gesture, and the close button when `showClose`. */
  onDismiss?: () => void;
  /** A close button (an Undo toast that stays until dismissed while VoiceOver is on; delete-workouts review S3). */
  showClose?: boolean;
}) {
  const theme = useTheme();
  return (
    // Toast in: timing.fast with a small rise; at once under Reduce Motion.
    <FadeIn motion={theme.a11y.reduceMotion ? null : { durationMs: theme.timing.fast, delayMs: 0, risePt: 6 }}>
    <View
      {...(onDismiss ? { onAccessibilityEscape: onDismiss } : {})}
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: theme.space['4'],
        marginBottom: theme.space['2'],
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['2'],
        paddingLeft: theme.space['3'],
        paddingRight: theme.space['1'],
        minHeight: theme.target.min.height + 8,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.colors['border.control'],
        backgroundColor: theme.colors['bg.surface'],
      }}
    >
      <Icon name={icon} color={icon === 'checkmark.circle.fill' ? 'status.done' : 'text.secondary'} />
      <AppText variant="callout" numeric style={{ flex: 1 }}>
        {text}
      </AppText>
      {secondary && onSecondary ? (
        <Pressable accessibilityRole="button" accessibilityLabel={secondary} onPress={onSecondary} style={{ minHeight: theme.target.min.height, minWidth: theme.target.min.width, justifyContent: 'center', paddingHorizontal: theme.space['2'] }}>
          <AppText variant="callout" color="text.secondary">
            {secondary}
          </AppText>
        </Pressable>
      ) : null}
      {action && onAction ? (
        <Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onAction} style={{ minHeight: theme.target.min.height, minWidth: theme.target.min.width, justifyContent: 'center', paddingHorizontal: theme.space['3'] }}>
          <AppText variant="headline" color="accent">
            {action}
          </AppText>
        </Pressable>
      ) : null}
      {onDismiss && showClose ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} style={{ minHeight: theme.target.min.height, minWidth: theme.target.min.width, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="xmark" color="text.secondary" />
        </Pressable>
      ) : null}
    </View>
    </FadeIn>
  );
}

/** A tappable line (Last result, Rest after, check-in line): ≥ 44pt, the whole line is the target. */
export function LinkLine({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress: () => void; accessibilityLabel: string }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => ({ minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}>
      {children}
    </Pressable>
  );
}

/** The effort label with an ⓘ that shows the scale (F4): `10 Nothing left`, `9 1 rep left` … */
export function EffortHeading({ scale, children }: { scale: EffortScale; children: ReactNode }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const lines = effortInfoLines(scale);
  return (
    <View style={{ gap: theme.space['1'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
        {children}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={effortInfoLabel(scale, open)}
          accessibilityState={{ expanded: open }}
          hitSlop={4}
          onPress={() => {
            setOpen((o) => !o);
          }}
          style={({ pressed }) => ({ width: theme.target.min.width, height: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
        >
          <Icon name="info.circle" color="text.secondary" size={16} />
        </Pressable>
      </View>
      {open ? (
        <View accessible accessibilityLabel={lines.map((l) => `${l.value}: ${l.meaning}`).join('. ')} style={{ gap: 2 }}>
          {lines.map((l) => (
            <View key={l.value} style={{ flexDirection: 'row', gap: theme.space['3'] }}>
              <AppText variant="callout" numeric style={{ minWidth: 28 }}>
                {l.value}
              </AppText>
              <AppText variant="callout" color="text.secondary">
                {l.meaning}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
