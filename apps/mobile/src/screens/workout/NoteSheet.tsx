import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useTheme } from '../../theme';
import { AppText, BottomCard, PrimaryButton, StatusLine, TextField } from '../../ui';
import { NOTE_MAX, noteChanged, noteValue } from '../../workout/notes';

/**
 * `Notes` on an exercise (active-workout §4.4): Ben's own words for this
 * workout (seat settings, how it felt). An empty field clears the note.
 * A failed write keeps the sheet open with a warning.
 */
export function NoteSheet(props: {
  visible: boolean;
  title: string;
  initial: string | null;
  /** Null when saved; otherwise the message to show. */
  onSave: (note: string | null) => Promise<string | null>;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(props.initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!props.visible) return;
    setText(props.initial ?? '');
    setError(null);
    setBusy(false);
  }, [props.visible, props.initial]);

  async function save() {
    if (busy) return;
    setBusy(true);
    const message = await props.onSave(noteValue(text)).catch(() => 'Couldn’t save. Try again.');
    setBusy(false);
    if (message !== null) setError(message);
  }

  return (
    <BottomCard visible={props.visible} onClose={props.onClose}>
      <AppText variant="title2" accessibilityRole="header">
        {props.title}
      </AppText>
      <View style={{ gap: theme.space['2'] }}>
        <TextField accessibilityLabel="Note" value={text} onChangeText={setText} autoFocus multiline maxLength={NOTE_MAX} style={{ minHeight: 88, textAlignVertical: 'top' }} />
      </View>
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      <PrimaryButton label="Save" busy={busy} disabled={!noteChanged(props.initial, text)} onPress={() => void save()} />
    </BottomCard>
  );
}
