import { useEffect, useState, type ReactNode } from 'react';
import { InputAccessoryView, Keyboard, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { StepTarget } from '@fizz/domain';

import { haptic } from '../device/haptics';
import { useTheme } from '../theme';
import { PrimaryButton } from './buttons';
import { Icon, type SymbolName } from './Icon';
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

function StepButton({ icon, target, onStep, describe }: { icon: SymbolName; target: StepTarget; onStep: (v: number) => void; describe: string }) {
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
        width: theme.target.workout.width,
        minHeight: theme.target.workout.height,
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
}) {
  const theme = useTheme();
  const [text, setText] = useState(value === null ? '' : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    setText((t) => nextFieldText(t, value));
  }, [value]);
  const describe = label === 'Assist' ? 'Assistance' : label;
  return (
    <View style={{ flex: 1, minWidth: 150, gap: theme.space['1'] }}>
      <AppText variant="label" color="text.secondary">
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <StepButton icon="minus" target={down} onStep={onChange} describe={label === 'Assist' ? 'Less assistance (harder)' : `Decrease ${describe.toLowerCase()}`} />
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
          <TextInput
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
              minWidth: 40,
              textAlign: 'center',
              fontSize: theme.type.loadDisplay.fontSize,
              fontWeight: theme.type.loadDisplay.fontWeight,
              fontVariant: ['tabular-nums'],
              color: theme.colors['text.primary'],
              paddingVertical: 0,
            }}
          />
          {unit ? (
            <AppText variant="label" color="text.secondary">
              {` ${unit}`}
            </AppText>
          ) : null}
        </View>
        <StepButton icon="plus" target={up} onStep={onChange} describe={label === 'Assist' ? 'More assistance (easier)' : `Increase ${describe.toLowerCase()}`} />
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
export function Chip({ label, selected, onPress, accessibilityLabel }: { label: string; selected: boolean; onPress: () => void; accessibilityLabel?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => ({
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
      })}
    >
      {selected ? <Icon name="checkmark" color="accent" size={16} /> : null}
      <AppText variant="label" numeric>
        {label}
      </AppText>
    </Pressable>
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

/** `ActionBar` (§9.1): Talk + the one primary action, fixed at the bottom, on the keyboard when open. */
export function ActionBar({ talk, primary, guard }: { talk: ReactNode; primary: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }; guard?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['2'],
        backgroundColor: theme.colors['bg.surface'],
        borderTopWidth: theme.dividerWidth,
        borderTopColor: theme.colors['border.divider'],
        paddingHorizontal: theme.space['4'],
        paddingTop: theme.space['3'],
        paddingBottom: theme.space['3'] + insets.bottom,
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
          <PrimaryButton label={primary.label} onPress={primary.onPress} disabled={primary.disabled ?? false} busy={primary.busy ?? false} />
        )}
      </View>
    </View>
  );
}

/** `UndoToast` (§9.10): above the action bar, never over it. */
export function Toast({ icon = 'checkmark.circle.fill', text, action, onAction }: { icon?: SymbolName; text: string; action?: string; onAction?: () => void }) {
  const theme = useTheme();
  return (
    <View
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
    </View>
  );
}

/** A tappable line (Last result, Rest after, check-in line): ≥ 44pt, the whole line is the target. */
export function LinkLine({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress: () => void; accessibilityLabel: string }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => ({ minHeight: theme.target.min.height, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      {children}
    </Pressable>
  );
}
