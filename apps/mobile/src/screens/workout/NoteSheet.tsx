import { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { useTheme } from '../../theme';
import { AppText, BottomCard, KeyboardDoneAccessory, PrimaryButton, StatusLine, TextField } from '../../ui';
import { NOTE_MAX, noteSheetChanged, noteValue, PIN_COPY, type NotePin } from '../../workout/notes';

/** The note field's `Done` bar (multiline: Return adds a line). */
export const NOTE_DONE_ACCESSORY_ID = 'fizz-note-done';

/**
 * `Notes` on an exercise (active-workout §4.4): Ben's own words for this
 * workout (seat settings, how it felt). An empty field clears the note.
 * A failed write keeps the sheet open with a warning.
 * (Ben, 26 Oct) `Pin` (when `pin` is given): the note shows every time this
 * exercise is in a workout; `Only at <gym>` keeps it to this gym.
 */
export function NoteSheet(props: {
  visible: boolean;
  title: string;
  initial: string | null;
  /** (Ben, 26 Oct) The Pin switch's start, and the gym `Only at` names (null: no gym, no gym switch). Absent: no Pin. */
  pin?: { start: NotePin; gymName: string | null } | null;
  /** Null when saved; otherwise the message to show. */
  onSave: (note: string | null, pin: NotePin | null) => Promise<string | null>;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(props.initial ?? '');
  const [pin, setPin] = useState<NotePin | null>(props.pin?.start ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinStart = props.pin?.start ?? null;
  const startOn = pinStart?.on ?? null;
  const startGymOnly = pinStart?.gymOnly ?? false;
  useEffect(() => {
    if (!props.visible) return;
    setText(props.initial ?? '');
    setPin(startOn === null ? null : { on: startOn, gymOnly: startGymOnly });
    setError(null);
    setBusy(false);
  }, [props.visible, props.initial, startOn, startGymOnly]);

  const dirty = noteSheetChanged(props.initial, text, pinStart, pin);

  async function save() {
    if (busy) return;
    setBusy(true);
    const message = await props.onSave(noteValue(text), pin).catch(() => 'Couldn’t save. Try again.');
    setBusy(false);
    if (message !== null) setError(message);
  }

  // A tap outside never drops a changed note silently: it asks first.
  function close() {
    if (!dirty) {
      props.onClose();
      return;
    }
    Alert.alert('Discard note?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: props.onClose },
    ]);
  }

  return (
    <BottomCard visible={props.visible} onClose={close} footer={<PrimaryButton label="Save" busy={busy} disabled={!dirty} onPress={() => void save()} />}>
      <KeyboardDoneAccessory nativeID={NOTE_DONE_ACCESSORY_ID} />
      <AppText variant="title2" accessibilityRole="header">
        {props.title}
      </AppText>
      <View style={{ gap: theme.space['2'] }}>
        <TextField accessibilityLabel="Note" value={text} onChangeText={setText} autoFocus multiline maxLength={NOTE_MAX} inputAccessoryViewID={NOTE_DONE_ACCESSORY_ID} style={{ minHeight: 88, textAlignVertical: 'top' }} />
      </View>
      {pin !== null ? (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: theme.space['3'] }}>
            <AppText variant="body" style={{ flex: 1 }}>
              {PIN_COPY.pin}
            </AppText>
            <Switch accessibilityLabel={PIN_COPY.pin} value={pin.on} onValueChange={(on) => { setPin({ ...pin, on }); }} trackColor={{ true: theme.colors.accent, false: theme.colors['bg.raised'] }} />
          </View>
          {pin.on && props.pin?.gymName != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: theme.space['3'] }}>
              <AppText variant="body" style={{ flex: 1 }}>
                {PIN_COPY.gymOnly(props.pin.gymName)}
              </AppText>
              <Switch accessibilityLabel={PIN_COPY.gymOnly(props.pin.gymName)} value={pin.gymOnly} onValueChange={(gymOnly) => { setPin({ ...pin, gymOnly }); }} trackColor={{ true: theme.colors.accent, false: theme.colors['bg.raised'] }} />
            </View>
          ) : null}
        </View>
      ) : null}
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
    </BottomCard>
  );
}
