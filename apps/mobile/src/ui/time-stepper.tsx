import { Pressable, View, type AccessibilityActionEvent } from 'react-native';

import { TODAY_V2_COPY } from '@fizz/domain';

import { useTheme } from '../theme';
import { TIME_COPY } from '../builder/builder-view';
import { TIME_LABELS } from '../today/today-view';
import { PrimaryButton, TextButton } from './buttons';
import { BottomCard } from './sheet';
import { AppText } from './Text';

const HIT = { top: 5, bottom: 5, left: 4, right: 4 } as const;

/**
 * The Time control `[−] 45 min [+]` (workout-builder-v3 §2.0.2 control 3), one for Today's card and Your workout
 * (22 Oct, Ben: "add option to reduce time"): 5-minute steps, a 34 pt circle with a 5 pt slop each side, and one
 * adjustable VoiceOver element for the value. It shows a length and reports a step; the page's service fits the
 * workout to it.
 */
export function TimeStepper({ minutes, onStep }: { minutes: number; onStep: (d: -1 | 1) => void }) {
  const theme = useTheme();
  const btn = (d: -1 | 1) => (
    <Pressable accessibilityRole="button" accessibilityLabel={d < 0 ? TIME_LABELS.less : TIME_LABELS.more} hitSlop={HIT} onPress={() => { onStep(d); }} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}>
      <AppText variant="label">{d < 0 ? '−' : '+'}</AppText>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
      {btn(-1)}
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={TIME_LABELS.value(minutes)}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e: AccessibilityActionEvent) => {
          onStep(e.nativeEvent.actionName === 'increment' ? 1 : -1);
        }}
      >
        <AppText variant="label" numeric style={{ minWidth: 64, textAlign: 'center' }}>
          {TODAY_V2_COPY.minutesValue(minutes)}
        </AppText>
      </View>
      {btn(1)}
    </View>
  );
}

/**
 * `Time · −1 exercise ›   [−] 45 min [+]` (fit-to-time 22 Oct revision, item 4), one row for Today's card and Your
 * workout: the note after the label (light orange) is the biggest change the fit made, and a tap opens everything it
 * changed (`TimeDetailSheet`). Nothing moves when the note comes or goes; the row stays ≥ 44 pt.
 */
export function TimeNoteRow({ minutes, note, noteLabel, onStep, onNote }: { minutes: number; note: string | null; noteLabel: string | null; onStep: (d: -1 | 1) => void; onNote: () => void }) {
  const theme = useTheme();
  const label = (
    <AppText variant="callout" color="text.secondary" style={{ fontSize: 15 }}>
      {TIME_COPY.label}
    </AppText>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], minHeight: 44, flexWrap: 'wrap' }}>
      {note === null ? (
        label
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={noteLabel ?? note} onPress={onNote} style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', flexShrink: 1, opacity: pressed ? 0.7 : 1 })}>
          {label}
          <AppText variant="callout" color="status.warning" numeric style={{ flexShrink: 1, fontSize: 15 }}>
            {` · ${note} ›`}
          </AppText>
        </Pressable>
      )}
      <TimeStepper minutes={minutes} onStep={onStep} />
    </View>
  );
}

/** What the Time row's note opens: `Time · 45 min`, every change the fit made, its `Undo` (when there is one) and `Done`. */
export function TimeDetailSheet({ visible, minutes, lines, undoMinutes, onUndo, onClose }: { visible: boolean; minutes: number; lines: readonly string[]; undoMinutes: number | null; onUndo: (minutes: number) => void; onClose: () => void }) {
  const theme = useTheme();
  return (
    <BottomCard visible={visible} onClose={onClose} footer={<PrimaryButton label={TIME_COPY.done} onPress={onClose} />}>
      <AppText variant="title2" accessibilityRole="header" numeric>
        {`${TIME_COPY.label} · ${TODAY_V2_COPY.minutesValue(minutes)}`}
      </AppText>
      {lines.map((l, i) => (
        // An exercise listed twice can give the same line twice: keyed by place.
        <AppText key={`${String(i)}:${l}`} variant="body" numeric>
          {l}
        </AppText>
      ))}
      {undoMinutes !== null ? (
        <View style={{ alignSelf: 'flex-start', marginTop: theme.space['1'] }}>
          <TextButton
            label={TIME_COPY.undo}
            accessibilityLabel={`Undo, back to ${String(undoMinutes)} minutes`}
            onPress={() => {
              onClose();
              onUndo(undoMinutes);
            }}
          />
        </View>
      ) : null}
    </BottomCard>
  );
}
