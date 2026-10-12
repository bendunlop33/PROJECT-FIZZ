import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { Animated, InputAccessoryView, Keyboard, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { StepTarget } from '@fizz/domain';

import { haptic } from '../device/haptics';
import { useTheme } from '../theme';
import { PrimaryButton } from './buttons';
import { Icon, type SymbolName } from './Icon';
import { FadeIn, TEXT_PRESSED_OPACITY, usePressScale } from './motion';
import { AppText } from './Text';
import { nextFieldText, parseNumber } from './number-text';

/** Shared keyboard toolbar for number fields (the system decimal pad has no Done key). */
export const NUMBER_ACCESSORY_ID = 'fizz-number-done';

export function NumberAccessory() {
  const theme = useTheme();
  return (
    <InputAccessoryView nativeID={NUMBER_ACCESSORY_ID} backgroundColor={theme.colors['bg.surface']}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: theme.space['4'], paddingVertical: theme.space['1'] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={() => {
            // Closes the keyboard only; nothing is logged.
            Keyboard.dismiss();
          }}
          style={{ minHeight: theme.target.min.height, justifyContent: 'center', paddingHorizontal: theme.space['3'] }}
        >
          <AppText variant="headline" color="accent">
            Done
          </AppText>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

/** D tile − / +: a light glyph with a full 44 × 52 pt target. */
function TileStep({ glyph, target, onStep, describe, size }: { glyph: string; target: StepTarget; onStep: (v: number) => void; describe: string; size?: number | undefined }) {
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
        width: size ?? theme.target.min.width,
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
  decimals,
  down,
  up,
  onChange,
  warning = false,
  hint,
  inputRef,
  flex = 1,
  onSurface = false,
  stepSize,
}: {
  label: string;
  unit: string | null;
  value: number | null;
  decimals: boolean;
  down: StepTarget;
  up: StepTarget;
  onChange: (v: number | null) => void;
  warning?: boolean;
  hint?: string | null;
  /** So `Enter load` can focus the empty field (audit F2). */
  inputRef?: Ref<TextInput>;
  /** Share of the row (D-ActiveSet: LOAD 1.4, REPS 1). */
  flex?: number;
  /** Shown on `bg.surface` (a sheet): the D tile uses `bg.raised` so it still reads as a tile. */
  onSurface?: boolean;
  /** − / + button size (Table open row: 52 pt, 60 pt at AX1+; design-system §9.75). Default 44 × 52. */
  stepSize?: number;
}) {
  const theme = useTheme();
  const [text, setText] = useState(value === null ? '' : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    setText((t) => nextFieldText(t, value));
  }, [value]);
  const describe = label === 'Assist' ? 'Assistance' : label;
  const decrease = label === 'Assist' ? 'Less assistance (harder)' : `Decrease ${describe.toLowerCase()}`;
  const increase = label === 'Assist' ? 'More assistance (easier)' : `Increase ${describe.toLowerCase()}`;
  const input = (
    <TextInput
      ref={inputRef}
      value={text}
      onChangeText={(t) => {
        setText(t);
        onChange(parseNumber(t));
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      keyboardType={decimals ? 'decimal-pad' : 'number-pad'}
      inputAccessoryViewID={NUMBER_ACCESSORY_ID}
      selectTextOnFocus
      accessibilityLabel={`${label}${unit ? `, ${unit}` : ''}`}
      {...(hint ? { accessibilityHint: hint } : {})}
      placeholder="—"
      placeholderTextColor={theme.colors['text.tertiary']}
      maxFontSizeMultiplier={theme.type.loadDisplay.maxFontSizeMultiplier}
      style={{
        minWidth: 36,
        textAlign: 'center',
        fontSize: theme.type.loadDisplay.fontSize,
        fontWeight: theme.type.loadDisplay.fontWeight,
        letterSpacing: theme.type.loadDisplay.letterSpacing,
        fontVariant: ['tabular-nums'],
        color: theme.colors['text.primary'],
        paddingVertical: 0,
      }}
    />
  );
  if (theme.components.cardBorderWidth === 0) {
    // D-ActiveSet: a borderless tile with a tracked label, − value unit +.
    return (
      <View style={{ flex, minWidth: 0, gap: theme.space['1'] }}>
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
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <TileStep glyph="−" target={down} onStep={onChange} describe={decrease} size={stepSize} />
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', flexShrink: 1 }}>
              {input}
              {unit ? (
                <AppText variant="body" color="text.secondary" style={{ fontSize: 18 }} maxFontSizeMultiplier={1.4}>
                  {` ${unit}`}
                </AppText>
              ) : null}
            </View>
            <TileStep glyph="+" target={up} onStep={onChange} describe={increase} size={stepSize} />
          </View>
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
    <View style={{ flex: 1, minWidth: 150, gap: theme.space['1'] }}>
      <AppText variant="label" color="text.secondary">
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <StepButton icon="minus" target={down} onStep={onChange} describe={decrease} size={stepSize} />
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
        <StepButton icon="plus" target={up} onStep={onChange} describe={increase} size={stepSize} />
      </View>
      {!up.enabled && value !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {up.reason}
        </AppText>
      ) : null}
    </View>
  );
}

/** `ParamChip` (§9.17): selected shows a check icon as well as the fill. */
export function Chip({ label, selected, onPress, accessibilityLabel, grow = false }: { label: string; selected: boolean; onPress: () => void; accessibilityLabel?: string; grow?: boolean }) {
  const theme = useTheme();
  const press = usePressScale('pill');
  const filled = theme.components.cardBorderWidth === 0;
  return (
    <Animated.View style={[grow ? { flex: 1 } : null, press.style]}>
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={({ pressed }) =>
        filled
          ? {
              // D-Rest: selected is a full accent pill with a check; others sit on the surface. 52 pt (target.workout, D7).
              minHeight: theme.target.workout.height,
              minWidth: theme.target.min.width,
              paddingHorizontal: theme.space['3'],
              borderRadius: theme.radius.pill,
              borderWidth: selected ? 0 : 1,
              borderColor: theme.colors['border.divider'],
              backgroundColor: selected ? (pressed ? theme.colors['accent.pressed'] : theme.colors.accent) : pressed ? theme.colors['bg.raised'] : theme.colors['bg.surface'],
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.space['1'],
            }
          : {
              minHeight: theme.target.workout.height,
              minWidth: theme.target.workout.width,
              paddingHorizontal: theme.space['3'],
              borderRadius: theme.radius.pill,
              borderWidth: selected ? theme.components.selectedBorderWidth : 1,
              borderColor: selected ? theme.colors.accent : theme.colors['border.control'],
              backgroundColor: selected || pressed ? theme.colors['accent.subtle'] : theme.colors['bg.raised'],
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.space['1'],
            }
      }
    >
      {selected ? <Icon name="checkmark" color={filled ? 'on.accent' : 'accent'} size={14} /> : null}
      <AppText variant="label" numeric color={filled && selected ? 'on.accent' : 'text.primary'} style={filled && selected ? { fontWeight: '600' } : undefined}>
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
export function ActionBar({ talk = null, primary, guard }: { talk?: ReactNode; primary: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; lead?: string | null }; guard?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
        backgroundColor: theme.components.barOnCanvas ? theme.colors['bg.canvas'] : theme.colors['bg.surface'],
        borderTopWidth: theme.components.barOnCanvas ? 0 : theme.dividerWidth,
        borderTopColor: theme.colors['border.divider'],
        paddingHorizontal: theme.components.barOnCanvas ? theme.space['5'] : theme.space['4'],
        paddingTop: theme.space['3'],
        paddingBottom: theme.space['3'] + Math.max(insets.bottom, theme.components.barOnCanvas ? theme.space['4'] : 0),
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

/** `UndoToast` (§9.10): above the action bar, never over it. */
export function Toast({
  icon = 'checkmark.circle.fill',
  text,
  action,
  onAction,
  onDismiss,
  showClose = false,
}: {
  icon?: SymbolName;
  text: string;
  action?: string;
  onAction?: () => void;
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
