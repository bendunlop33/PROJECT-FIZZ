import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, AppState, Linking, Pressable, View } from 'react-native';

import type { BuilderCoachReach } from '@fizz/coach';

import { askBarView, type AskBarPage, type MicState } from '../coach/builder-coach-view';
import { useTheme } from '../theme';
import { createDictation, type SpeechInputPort } from '../voice/dictation';
import { Icon } from './Icon';
import { TextField } from './layout';
import { AppText } from './Text';

/**
 * The coach bar with its mic (workout-builder-v3 §2.0.2, §2.6): `✦ <label>`
 * opens the coach sheet (never full screen); the mic starts on-device
 * listening at once, shows the live words in the bar, stops on silence or a
 * second tap, then opens the sheet with what was heard. With no on-device
 * recogniser the mic shows `⊘` from the start (checked on mount and on
 * return to the app) and nothing listens (no audio leaves the phone); a tap
 * says why, with a Settings link when a permission is off.
 *
 * Set up with no coach (offline or not connected): the bar is a field, and
 * typed or spoken words go to `onSubmit` (code's Set up fill, §9 Q4): no
 * chat sheet, no chat bubble.
 *
 * `icons` (the active workout's action bar, workout-table-v3 §1.6): the
 * same `✦` entry and mic as two 44 pt buttons in place of the old Chat, so
 * the Log pill keeps its height; `✦` shows the one short status word
 * (`Coach`, `Offline`, `No coach`). Never disabled for a missing coach:
 * `✦` opens the coach sheet, which shows its own honest status.
 *
 * Accessibility: two controls (bar, mic), each ≥ 44 pt (48 here); labels
 * carry the status word; `Listening` and the words heard are announced
 * (VoiceOver on iOS has no live regions); Dynamic Type wraps the label,
 * never clips it.
 */
export interface CoachAskBarProps {
  page: AskBarPage;
  /** From the builder coach service (`status()`). */
  reach: BuilderCoachReach;
  /** Today's header bar: `✦ Coach`. */
  compact?: boolean;
  /** Open the coach sheet; `transcript` when the mic heard words. */
  onOpen: (transcript?: string) => void;
  /** Set up with no coach: the words go straight to code's fill (`askSetup`), never the sheet. */
  onSubmit?: (words: string) => void;
  /** `createOnDeviceSpeech()` in the app; a fake in tests. */
  speech: SpeechInputPort;
  /** A request is with the coach: `Asking…`, and the bar and mic wait (wiring S3). */
  asking?: boolean;
  /** The active workout's action bar: `✦` + mic as two 44 pt buttons (§1.6). */
  icons?: boolean;
}

const BAR_HEIGHT = 48;
/** `icons`: the minimum target (44 pt). */
const ICON_SIZE = 44;

export function CoachAskBar({ page, reach, compact = false, onOpen, onSubmit, speech, asking = false, icons = false }: CoachAskBarProps) {
  const theme = useTheme();
  const [mic, setMic] = useState<MicState>('idle');
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const view = askBarView(page, reach, mic, { compact, asking });
  const inline = view.inline && onSubmit !== undefined;
  const send = useRef<(text: string) => void>(onOpen);
  send.current = inline
    ? (text) => {
        onSubmit(text);
      }
    : (text) => {
        onOpen(text);
      };
  const dictation = useMemo(
    () =>
      createDictation(speech, {
        state: (s) => {
          setMic(s);
          if (s === 'listening') AccessibilityInfo.announceForAccessibility('Listening');
          if (s !== 'listening') setHeard('');
        },
        partial: setHeard,
        done: (text) => {
          AccessibilityInfo.announceForAccessibility(text);
          send.current(text);
        },
      }),
    [speech],
  );
  useEffect(() => {
    // `⊘` before any tap: checked on mount and each time the app comes back (a language installed since).
    void dictation.probe();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void dictation.probe();
    });
    return () => {
      sub.remove();
      dictation.cancel();
    };
  }, [dictation]);

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

  const micButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={view.mic.accessibilityLabel}
      accessibilityState={{ disabled: view.mic.disabled, selected: listening }}
      {...(view.mic.why === null ? {} : { accessibilityHint: view.mic.why })}
      disabled={view.mic.disabled}
      onPress={tapMic}
      style={({ pressed }) => ({
        width: icons ? ICON_SIZE : BAR_HEIGHT,
        minHeight: icons ? ICON_SIZE : BAR_HEIGHT,
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
  );

  if (icons) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={listening ? `Listening. ${heard}` : view.accessibilityLabel}
          accessibilityState={{ disabled: view.disabled || listening }}
          disabled={view.disabled || listening}
          onPress={() => {
            onOpen();
          }}
          style={({ pressed }) => ({
            minWidth: ICON_SIZE,
            minHeight: ICON_SIZE,
            paddingHorizontal: theme.space['1'],
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors['border.control'],
            backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
            opacity: view.disabled ? 0.6 : 1,
          })}
        >
          <AppText variant="callout" color={view.status === null ? 'accent' : 'text.secondary'} accessible={false} style={{ lineHeight: 18 }}>
            ✦
          </AppText>
          <AppText variant="label" color="text.secondary" accessible={false} style={{ fontSize: 11, lineHeight: 14 }}>
            {view.short}
          </AppText>
        </Pressable>
        {micButton}
      </View>
    );
  }

  if (inline && !listening) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: theme.space['2'] }}>
        <View style={{ flex: 1 }}>
          <TextField
            value={typed}
            onChangeText={setTyped}
            placeholder={view.label}
            accessibilityLabel={view.accessibilityLabel}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => {
              const words = typed.trim();
              if (words === '') return;
              setTyped('');
              send.current(words);
            }}
            style={{ minHeight: BAR_HEIGHT }}
          />
        </View>
        {view.status !== null ? (
          <View style={{ justifyContent: 'center' }}>
            <AppText variant="label" color="text.secondary" accessible={false}>
              {view.status}
            </AppText>
          </View>
        ) : null}
        {micButton}
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: theme.space['2'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={listening ? `Listening. ${heard}` : view.accessibilityLabel}
        accessibilityState={{ disabled: view.disabled }}
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
        <AppText variant="callout" color={view.disabled ? 'text.secondary' : 'text.primary'} style={{ flex: 1 }}>
          {barText}
        </AppText>
        {view.status !== null && !listening ? (
          <AppText variant="label" color="text.secondary">
            {view.status}
          </AppText>
        ) : null}
      </Pressable>
      {micButton}
    </View>
  );
}
