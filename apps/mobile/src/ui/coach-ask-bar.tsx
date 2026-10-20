import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';

import type { BuilderCoachReach } from '@fizz/coach';

import { askBarView, type AskBarPage, type MicState } from '../coach/builder-coach-view';
import { useTheme } from '../theme';
import { createDictation, type SpeechInputPort } from '../voice/dictation';
import { Icon } from './Icon';
import { AppText } from './Text';

/**
 * The coach bar with its mic (workout-builder-v3 §2.0.2, §2.6): `✦ <label>`
 * opens the coach sheet (never full screen); the mic starts on-device
 * listening at once, shows the live words in the bar, stops on silence or a
 * second tap, then opens the sheet with what was heard. With no on-device
 * recogniser the mic shows `⊘` and nothing listens (no audio leaves the
 * phone); a tap says why, with a Settings link when a permission is off.
 *
 * Accessibility: two buttons (bar, mic), each ≥ 44 pt (48 here); labels
 * carry the status word; listening is announced through a live region;
 * Dynamic Type wraps the label instead of clipping it.
 */
export interface CoachAskBarProps {
  page: AskBarPage;
  /** From the builder coach service (`status()`). */
  reach: BuilderCoachReach;
  /** Today's header bar: `✦ Coach`. */
  compact?: boolean;
  /** Open the coach sheet; `transcript` when the mic heard words. */
  onOpen: (transcript?: string) => void;
  /** `createOnDeviceSpeech()` in the app; a fake in tests. */
  speech: SpeechInputPort;
}

const BAR_HEIGHT = 48;

export function CoachAskBar({ page, reach, compact = false, onOpen, speech }: CoachAskBarProps) {
  const theme = useTheme();
  const [mic, setMic] = useState<MicState>('idle');
  const [heard, setHeard] = useState('');
  const open = useRef(onOpen);
  open.current = onOpen;
  const dictation = useMemo(
    () =>
      createDictation(speech, {
        state: (s) => {
          setMic(s);
          if (s !== 'listening') setHeard('');
        },
        partial: setHeard,
        done: (text) => {
          open.current(text);
        },
      }),
    [speech],
  );
  useEffect(
    () => () => {
      dictation.cancel();
    },
    [dictation],
  );

  const view = askBarView(page, reach, mic, { compact });
  const listening = mic === 'listening';
  const barText = listening ? (heard === '' ? 'Listening…' : heard) : view.label;

  const tapMic = (): void => {
    // Checked again on every tap: a language installed since, or permission given in Settings, clears ⊘.
    void dictation.tap().then((s) => {
      const why = askBarView(page, reach, s).mic.why;
      if (why === null) return;
      Alert.alert(why, undefined, s === 'denied' ? [{ text: 'Cancel', style: 'cancel' }, { text: 'Settings', onPress: () => void Linking.openSettings() }] : [{ text: 'OK' }]);
    });
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: theme.space['2'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={listening ? `Listening. ${heard}` : view.accessibilityLabel}
        accessibilityState={{ disabled: view.disabled }}
        accessibilityLiveRegion={listening ? 'polite' : 'none'}
        disabled={view.disabled || listening}
        onPress={() => {
          onOpen();
        }}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: BAR_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space['2'],
          paddingHorizontal: theme.space['4'],
          paddingVertical: theme.space['2'],
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors['bg.raised'],
          borderWidth: 1,
          borderColor: theme.colors['border.control'],
          opacity: view.disabled ? 0.6 : pressed ? 0.7 : 1,
        })}
      >
        <AppText variant="callout" color="accent" accessible={false}>
          ✦
        </AppText>
        <AppText variant="callout" color={view.disabled ? 'text.secondary' : 'text.primary'} style={{ flex: 1 }} numberOfLines={listening ? 3 : 2}>
          {barText}
        </AppText>
        {view.status !== null && !listening ? (
          <AppText variant="label" color="text.secondary">
            {view.status}
          </AppText>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={view.mic.accessibilityLabel}
        accessibilityState={{ disabled: view.mic.disabled, selected: listening }}
        {...(view.mic.why === null ? {} : { accessibilityHint: view.mic.why })}
        disabled={view.mic.disabled}
        onPress={tapMic}
        style={({ pressed }) => ({
          width: BAR_HEIGHT,
          minHeight: BAR_HEIGHT,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radius.md,
          backgroundColor: listening ? theme.colors['status.danger'] : theme.colors['bg.raised'],
          borderWidth: 1,
          borderColor: listening ? theme.colors['status.danger'] : theme.colors['border.control'],
          opacity: view.mic.disabled ? 0.6 : pressed ? 0.7 : 1,
        })}
      >
        <Icon name={view.mic.glyph === '⊘' ? 'nosign' : view.mic.glyph} color={listening ? 'on.accent' : view.mic.glyph === '⊘' ? 'text.secondary' : 'text.primary'} size={18} />
      </Pressable>
    </View>
  );
}
