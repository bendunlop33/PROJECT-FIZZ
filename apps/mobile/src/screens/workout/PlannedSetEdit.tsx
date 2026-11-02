import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { View } from 'react-native';

import type { PlannedSetEdits } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { returnToWorkout } from '../../navigation/actions';
import type { ActiveWorkoutData } from '../../services/workout-services';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { WORKOUT_KEYBOARD } from '../../workout/keyboard';
import { ActionBar, AppText, Chip, ChipRow, NUMBER_ACCESSORY_ID, NumberAccessory, SecondaryButton, KeyboardScrollView, SheetKeyboardAvoidingView, StatusLine, TextButton, TextField, useKeyboardVisible } from '../../ui';
import { NOTE_MAX, noteChanged, noteValue } from '../../workout/notes';
import { plannedEditSave, setSheetTitle } from '../../workout/set-edit';
import { correctionToastText, UNDO_TOAST } from '../../workout/undo-op';

/**
 * The set sheet for a set not done yet, in a live workout (Ben, 2 Nov: "Maybe we only need set type, rest and
 * notes?"): Set type, Rest after and Note. Load, reps, time and distance are edited inline in the table; Target RIR,
 * + Weight and Delete set are in the set's hold menu; Make current is a tap on the row. `Save changes` is one
 * versioned `edit_planned_set` with `Set 3 updated` [Undo], then the note (its own versioned write). Every value
 * comes from `buildPlannedSetEditView`; nothing is computed here.
 */
export function PlannedSetEdit({ data, setId, error, onRefused }: { data: ActiveWorkoutData; setId: string; error: string | null; onRefused: (message: string) => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const keyboard = useKeyboardVisible();
  const [edits, setEdits] = useState<PlannedSetEdits>({});
  const [noteText, setNoteText] = useState<string | null>(null);
  const [saveOp] = useState(newUuid);
  const [noteOp] = useState(newUuid);
  const aggregate = data.aggregate;
  const view = services.workout.plannedEditView(data, setId, edits);
  const set = aggregate.sets.find((s) => s.id === setId);
  if (!view || !set) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'], padding: theme.space['4'] }}>
        <TextButton label="Close" onPress={() => { navigation.goBack(); }} />
      </View>
    );
  }
  const storedNote = set.note ?? null;
  const noteEdited = noteText !== null && noteChanged(storedNote, noteText);
  const sessionId = aggregate.session.id;

  async function save() {
    if (!view) return;
    const r = await plannedEditSave({
      patch: view.patch,
      note: noteEdited ? noteValue(noteText) : undefined,
      sessionVersion: aggregate.session.version,
      edit: (patch) => services.workout.editPlannedSet({ sessionId, setId, expectedSetVersion: view.setVersion, patch, opId: saveOp }),
      setNote: (note, expectedVersion) => services.workout.setNote({ sessionId, target: { kind: 'set', setId }, note, expectedVersion, opId: noteOp }),
    });
    if (r.kind === 'refused') {
      setEdits({});
      onRefused(r.message);
      return;
    }
    changed();
    if (r.kind === 'edited') {
      navigation.dispatch(returnToWorkout({ toast: { kind: 'undo_op', text: correctionToastText(UNDO_TOAST.correctedNamed(view.stepName), r.noteFailed), targetOpId: saveOp } }));
      return;
    }
    navigation.goBack();
  }

  return (
    // 2.1: the sheet avoids the keyboard; Save sits in a fixed bar on it, so a change saves without scrolling.
    // Review S1: the avoiding view alone lifts it (no automaticallyAdjustKeyboardInsets, or the inset counts twice).
    <SheetKeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }}>
      <NumberAccessory />
      <KeyboardScrollView contentContainerStyle={{ padding: theme.space['4'], gap: theme.space['4'], paddingBottom: theme.space['8'] }} {...WORKOUT_KEYBOARD}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>{setSheetTitle('planned', view.stepName, view.exerciseName)}</AppText>
          <TextButton label="Cancel" tone="secondary" icon="xmark" onPress={() => { navigation.goBack(); }} />
        </View>
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            Set type
          </AppText>
          <ChipRow>
            {view.setType.choices.map((c) => (
              <Chip
                key={c.type}
                label={c.label}
                selected={c.selected}
                onPress={() => {
                  setEdits({ ...edits, setType: c.type });
                }}
              />
            ))}
          </ChipRow>
        </View>
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            Rest after
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
            <SecondaryButton label="−15 s" accessibilityLabel="Rest 15 seconds shorter" disabled={!view.rest.down.enabled} onPress={() => { if (view.rest.down.enabled) setEdits({ ...edits, restS: view.rest.down.value }); }} />
            <AppText variant="title2" numeric style={{ minWidth: 72, textAlign: 'center' }} accessibilityLabel={`Rest after this set ${view.rest.text}`}>
              {view.rest.text}
            </AppText>
            <SecondaryButton label="+15 s" accessibilityLabel="Rest 15 seconds longer" disabled={!view.rest.up.enabled} onPress={() => { if (view.rest.up.enabled) setEdits({ ...edits, restS: view.rest.up.value }); }} />
          </View>
        </View>
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            Note
          </AppText>
          <TextField accessibilityLabel="Note" value={noteText ?? storedNote ?? ''} onChangeText={setNoteText} multiline maxLength={NOTE_MAX} inputAccessoryViewID={NUMBER_ACCESSORY_ID} />
        </View>
        {error ? <StatusLine icon="info.circle" tone="info" text={error} /> : null}
      </KeyboardScrollView>
      <ActionBar surface keypadOpen={keyboard} primary={{ label: 'Save changes', disabled: !view.changed && !noteEdited, onPress: () => void save() }} />
    </SheetKeyboardAvoidingView>
  );
}
