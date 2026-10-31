import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, ChoiceCard, Group, Row, Screen, SecondaryButton, SectionHeader } from '../../ui';
import { appleSpeaker, installedVoices, phoneLocale, voiceCapability } from '../../voice/speaker';
import { CUE_MODE_LABEL, cueModeOf, RATE_STEPS, rateLabel, READ_REPLIES_LABEL, withCueMode, type CueMode, type ReadReplies, type VoicePrefs } from '../../voice/settings';
import { BETTER_VOICES_HINT, defaultVoice, needsBetterVoiceHint, resolveVoice, voiceLabel, voicesForLanguage, type VoiceOption } from '../../voice/voices';

/**
 * Settings › Voice (Ben, 19 Oct 2026): spoken cues (Off / Timer only / Timer
 * and set details), reading coach replies aloud, the Apple voice and its
 * speed, and Test. Saved on this phone (device prefs). Apple voices only,
 * never a paid one (rule 7). Without the audio-coach module (Expo Go, an old
 * build) Voice shows as unavailable (rule 1).
 */

const CUE_MODES: readonly CueMode[] = ['off', 'timer', 'timer_and_set'];
const CUE_EXAMPLE: Record<CueMode, string | null> = { off: null, timer: '“15 seconds” · “Rest over”', timer_and_set: '+ “Next: bench press, set 3, 80 kilos for 8”' };
const READ_MODES: readonly ReadReplies[] = ['workout', 'always', 'off'];
const TEST_LINE = '15 seconds. Next: bench press, set 3, 80 kilos for 8.';

export function VoiceSettingsScreen() {
  const theme = useTheme();
  const { prefs, update } = useDevicePrefs();
  const voice = prefs.voice;
  const capability = voiceCapability();
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [testFailed, setTestFailed] = useState(false);

  // Read again on every visit: Ben may have downloaded a voice in iOS Settings meanwhile.
  useFocusEffect(
    useCallback(() => {
      setVoices(installedVoices(true));
    }, []),
  );

  const save = (patch: Partial<VoicePrefs>) => {
    update({ voice: { ...voice, ...patch } });
  };

  if (!capability.speech) {
    return (
      <Screen>
        <Group>
          <Row title="Voice" icon="speaker.slash" subtitle="Not in this build" />
        </Group>
      </Screen>
    );
  }

  const locale = phoneLocale();
  const list = voices === null ? null : voicesForLanguage(voices, locale);
  const resolved = voices === null ? null : resolveVoice(voices, voice.voiceId);
  const fallback = voices === null ? null : defaultVoice(voices);

  async function test() {
    setTesting(true);
    setTestFailed(false);
    try {
      await appleSpeaker.speak(TEST_LINE, 'cue');
    } catch {
      setTestFailed(true);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Screen
      footer={
        <View style={{ gap: theme.space['2'] }}>
          <SecondaryButton label={testing ? 'Playing…' : 'Test'} disabled={testing} onPress={() => void test()} />
          {testFailed ? (
            <AppText variant="callout" color="text.secondary">
              Couldn’t play
            </AppText>
          ) : null}
        </View>
      }
    >
      <SectionHeader title="Spoken cues" />
      <View style={{ gap: theme.space['2'] }} accessibilityRole="radiogroup">
        {CUE_MODES.map((m) => (
          <ChoiceCard
            key={m}
            title={CUE_MODE_LABEL[m]}
            subtitle={CUE_EXAMPLE[m]}
            selected={cueModeOf(voice) === m}
            onPress={() => {
              save(withCueMode(voice, m));
            }}
          />
        ))}
      </View>

      <SectionHeader title="Read coach replies" />
      <View style={{ gap: theme.space['2'] }} accessibilityRole="radiogroup">
        {READ_MODES.map((m) => (
          <ChoiceCard
            key={m}
            title={READ_REPLIES_LABEL[m]}
            selected={voice.readReplies === m}
            onPress={() => {
              save({ readReplies: m });
            }}
          />
        ))}
      </View>

      {/* Design pass 6.9: Speed above the voice list, wrapping chips. */}
      <SectionHeader title="Speed" />
      <View accessibilityRole="radiogroup">
        <ChipRow>
          {RATE_STEPS.map((r) => (
            <Chip
              key={r}
              label={rateLabel(r)}
              accessibilityLabel={r === 1 ? 'Normal speed' : `${String(r)} times speed`}
              selected={voice.rate === r}
              onPress={() => {
                save({ rate: r });
              }}
            />
          ))}
        </ChipRow>
      </View>

      <SectionHeader title="Voice" />
      {list === null ? (
        <Group>
          <Row title="System voice" subtitle="Voice list not in this build" />
        </Group>
      ) : (
        <View style={{ gap: theme.space['2'] }} accessibilityRole="radiogroup">
          <ChoiceCard
            title="Default"
            subtitle={fallback === null ? 'System voice' : voiceLabel(fallback)}
            selected={voice.voiceId === null}
            onPress={() => {
              save({ voiceId: null });
            }}
          />
          {resolved?.missing === true ? (
            <AppText variant="callout" color="text.secondary">
              Chosen voice not on this phone · using default
            </AppText>
          ) : null}
          {list.map((v) => (
            <ChoiceCard
              key={v.id}
              title={voiceLabel(v)}
              subtitle={v.language}
              selected={voice.voiceId === v.id}
              onPress={() => {
                save({ voiceId: v.id });
              }}
            />
          ))}
          {voices !== null && needsBetterVoiceHint(voices, locale) ? (
            <AppText variant="callout" color="text.secondary">
              {BETTER_VOICES_HINT}
            </AppText>
          ) : null}
        </View>
      )}

    </Screen>
  );
}
