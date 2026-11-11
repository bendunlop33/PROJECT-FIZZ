import { StackActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { newUuid } from '../../device/runtime';
import type { NotePreview } from '../../import/note-service';
import { takeCreated } from '../../library/exercise-form-handoff';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Group, Icon, KeyboardScrollView, PrimaryButton, StatusLine, TextButton, TextField, TEXT_PRESSED_OPACITY } from '../../ui';
import { SwapSheet } from '../../ui/swap-sheet';
import { useExercisePicker, usePickerView } from '../../ui/use-exercise-picker';
import { canOpenPaste, PASTE_COPY, pasteRows, pasteWhen } from '../../workout/paste-view';

/**
 * (Ben, 11 Nov) `Paste` from Log a past workout: a workout written in Apple Notes. Paste, `Read` (code reads it, no
 * network), review (each name → the exercise it will be; tap to choose another or `＋ Add your own`), `Open
 * workout`: the past log opens with every set done, editable before Finish. When the coach is connected, one request
 * checks the names in the background; what it changed is marked `Coach`. The text is data, never instructions.
 */
export function PasteWorkoutScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { params } = useRoute<RouteProp<RootStackParams, 'PasteWorkout'>>();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<NotePreview | null>(null);
  const [nothing, setNothing] = useState(false);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gymName, setGymName] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const openOp = useRef(newUuid());
  const askOp = useRef(newUuid());
  const readToken = useRef(0);
  const own = useRef<{ token: string; index: number; name: string | null; go: boolean } | null>(null);
  const picker = useExercisePicker();
  const pickerView = usePickerView(picker, [], []);

  useEffect(() => {
    void services.yourData
      .currentGym()
      .then((g) => {
        setGymName((n) => n ?? g?.name ?? null);
      })
      .catch(() => null);
  }, [services]);

  // `＋ Add your own`: back from the form with a saved exercise, it is this row's pick.
  useFocusEffect(
    useCallback(() => {
      const o = own.current;
      if (o === null || o.go) return;
      own.current = null;
      const made = takeCreated(o.token);
      if (made === null) return;
      setPicks((p) => ({ ...p, [o.index]: made.exerciseId }));
      setNames((n) => ({ ...n, [made.exerciseId]: made.name }));
    }, []),
  );

  async function read() {
    const t = (readToken.current += 1);
    setError(null);
    setNothing(false);
    setPicks({});
    openOp.current = newUuid();
    askOp.current = newUuid();
    const r = await services.notes.read({ text, sheetStartMs: params.sheetStartMs, startPicked: params.startPicked });
    if (readToken.current !== t) return;
    if (r.kind === 'nothing') {
      setPreview(null);
      setNothing(true);
      return;
    }
    setPreview(r.preview);
    if (r.preview.gym !== null) setGymName(r.preview.gym.name);
    // The coach's check, if it's connected: one request; the review is usable meanwhile.
    setAsking(true);
    const c = await services.notes.askCoach({ preview: r.preview, opId: askOp.current }).catch(() => null);
    if (readToken.current !== t) return;
    setAsking(false);
    if (c?.kind === 'answered') setPreview(c.preview);
  }

  async function open() {
    if (preview === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      let gymId = preview.gym?.id ?? (await services.yourData.currentGym().catch(() => null))?.id ?? null;
      if (gymId === null) {
        const made = await services.setup.useTypicalGym();
        gymId = made.ok ? (made.gymId ?? null) : null;
      }
      if (gymId === null) {
        setError(PASTE_COPY.failed);
        return;
      }
      const r = await services.notes.open({ preview, picks, gymId, opId: openOp.current });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      changed();
      navigation.dispatch(StackActions.replace('Workout'));
    } finally {
      setBusy(false);
    }
  }

  function choose(index: number, query: string) {
    setPickFor(index);
    picker.open(() => services.exercisePicker.forTemplate(preview?.gym?.id ?? null), query);
  }

  function closePicker() {
    setPickFor(null);
    picker.close();
  }

  function goToForm() {
    const o = own.current;
    if (o === null || !o.go) return;
    o.go = false;
    navigation.navigate('ExerciseForm', { ...(o.name === null || o.name === '' ? {} : { name: o.name }), pickFor: o.token });
  }

  const rows = preview === null ? [] : pasteRows(preview, picks, names);
  const pickRow = rows.find((r) => r.index === pickFor) ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <KeyboardScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom, gap: theme.space['4'] }}>
        <AppText variant="title2" accessibilityRole="header">
          {PASTE_COPY.title}
        </AppText>
        <TextField
          value={text}
          onChangeText={(t) => {
            setText(t);
            setNothing(false);
          }}
          placeholder={PASTE_COPY.placeholder}
          accessibilityLabel={PASTE_COPY.placeholder}
          multiline
          autoCorrect={false}
          autoCapitalize="none"
          style={{ minHeight: preview === null ? 200 : 96, maxHeight: 280, textAlignVertical: 'top' }}
        />
        {preview === null ? <PrimaryButton label={PASTE_COPY.read} disabled={text.trim() === ''} onPress={() => void read()} /> : <TextButton label={PASTE_COPY.read} onPress={() => void read()} />}
        {nothing ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={PASTE_COPY.nothing} /> : null}
        {preview !== null ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <AppText variant="body" numeric>
                {pasteWhen(preview, gymName)}
              </AppText>
              {asking ? (
                <AppText variant="label" color="text.tertiary">
                  {PASTE_COPY.checking}
                </AppText>
              ) : null}
            </View>
            <Group>
              {rows.map((r) => (
                <Pressable
                  key={r.key}
                  accessibilityRole="button"
                  accessibilityLabel={r.accessibilityLabel}
                  accessibilityHint={PASTE_COPY.pick}
                  onPress={() => {
                    choose(r.index, r.needsPick ? (r.ownName ?? r.header) : '');
                  }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', columnGap: theme.space['2'], minHeight: 60, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['3'], opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="label" color="text.tertiary" numberOfLines={1}>
                      {r.header}
                    </AppText>
                    <AppText variant="body" color={r.needsPick ? 'accent' : 'text.primary'} numberOfLines={1}>
                      {r.check ? `${r.name}?` : r.name}
                    </AppText>
                    <AppText variant="label" color="text.secondary" numeric numberOfLines={2}>
                      {r.detail}
                    </AppText>
                  </View>
                  {r.coach ? (
                    <AppText variant="label" color="text.tertiary">
                      {PASTE_COPY.coach}
                    </AppText>
                  ) : null}
                  <Icon name="chevron.right" size={14} color="text.tertiary" />
                </Pressable>
              ))}
            </Group>
            {error !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
            <PrimaryButton label={PASTE_COPY.open} busy={busy} disabled={!canOpenPaste(preview, picks)} onPress={() => void open()} />
          </>
        ) : null}
        <TextButton label="Cancel" tone="secondary" onPress={() => {
            navigation.goBack();
          }}
        />
      </KeyboardScrollView>
      <SwapSheet
        visible={pickFor !== null}
        title={pickRow === null ? '' : PASTE_COPY.pickTitle(pickRow.header)}
        sections={[]}
        actionWord={PASTE_COPY.pick}
        onPick={(exerciseId) => {
          const index = pickFor;
          const name = picker.index?.entries.find((e) => e.exercise.id === exerciseId)?.exercise.name ?? null;
          if (index !== null) setPicks((p) => ({ ...p, [index]: exerciseId }));
          if (name !== null) setNames((n) => ({ ...n, [exerciseId]: name }));
          closePicker();
        }}
        onClose={closePicker}
        onDismissed={goToForm}
        picker={{
          view: pickerView,
          query: picker.query,
          onQuery: picker.setQuery,
          index: picker.index,
          equipment: picker.equipment,
          onEquipment: picker.setEquipment,
          onChip: picker.setGroup,
          onAddOwn: (name) => {
            if (pickFor === null) return;
            own.current = { token: newUuid(), index: pickFor, name, go: true };
            closePicker();
            setTimeout(goToForm, 600);
          },
        }}
      />
    </View>
  );
}
