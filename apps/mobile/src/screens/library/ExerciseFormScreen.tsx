import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { newUuid } from '../../device/runtime';
import { handOffAdded } from '../../library/exercise-form-handoff';
import { canSaveForm, equipmentOptions, EXERCISE_FORM_COPY, loadOptions, measuredOptions, muscleOptions, newFormFields, selectedGroups, toggledMuscle, withEquipment, type ExerciseFormFields } from '../../library/exercise-form-view';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, DangerTextButton, Icon, PrimaryButton, StatusLine, TextButton, TextField } from '../../ui';

/**
 * Library › ＋ New exercise, a custom exercise's Edit, and the coach card's
 * Edit (exercise-library §2.6; Ben, 19 Oct). Values and actions only. Local
 * writes (rule 1), idempotent by one opId per open form (rule 5). A name
 * already in Ben's list shows that exercise instead of saving a second one.
 */
export function ExerciseFormScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParams, 'ExerciseForm'>>();
  const editing = params.exerciseId ?? null;
  const [fields, setFields] = useState<ExerciseFormFields>(() => (params.fields ? { ...params.fields } : newFormFields(params.name ?? '')));
  const [version, setVersion] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [clash, setClash] = useState<{ exerciseId: string; name: string; line: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opId = useRef(newUuid());

  useEffect(() => {
    if (editing === null) return;
    void services.customExercises.form(editing).then((f) => {
      if (f === null) {
        setNotice('Not found.');
        return;
      }
      setFields({ ...f.fields });
      setVersion(f.version);
      setLocked(f.locked);
    });
  }, [editing, services]);

  useEffect(() => {
    const t = setTimeout(() => {
      void services.customExercises.nameClash(fields.name, editing).then(setClash);
    }, 250);
    return () => {
      clearTimeout(t);
    };
  }, [fields.name, editing, services]);

  async function save() {
    // Review exlist N1: Edit never falls through to a new exercise while the form hasn't loaded (or is gone).
    if (busy || !canSaveForm(fields) || (editing !== null && version === null)) return;
    setBusy(true);
    setNotice(null);
    const f = fields;
    const r =
      params.proposalActionId !== undefined
        ? await services.coach.addProposedExercise({ actionId: params.proposalActionId, opId: opId.current, fields: f })
        : editing !== null && version !== null
          ? await services.customExercises.edit({ exerciseId: editing, fields: f, expectedVersion: version, opId: opId.current })
          : await services.customExercises.create({ fields: f, opId: opId.current });
    setBusy(false);
    if (!r.ok) {
      setNotice(r.message);
      return;
    }
    changed();
    if (params.proposalActionId !== undefined) handOffAdded(params.proposalActionId, r.exercise.name);
    navigation.goBack();
  }

  function confirmDelete() {
    if (editing === null || version === null) return;
    Alert.alert(EXERCISE_FORM_COPY.deleteConfirm(fields.name), undefined, [
      { text: EXERCISE_FORM_COPY.cancel, style: 'cancel' },
      {
        text: EXERCISE_FORM_COPY.delete,
        style: 'destructive',
        onPress: () => {
          void services.customExercises.remove({ exerciseId: editing, expectedVersion: version, opId: `${opId.current}:delete` }).then((r) => {
            if (!r.ok) {
              setNotice(r.message);
              return;
            }
            changed();
            navigation.goBack();
            navigation.goBack();
          });
        },
      },
    ]);
  }

  const groups = selectedGroups(fields);
  const section = (label: string, isLocked: boolean, children: ReactNode) => (
    <View style={{ gap: theme.space['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessible accessibilityLabel={isLocked ? `${label}, ${EXERCISE_FORM_COPY.locked}` : label}>
        <AppText variant="sectionLabel" color="text.tertiary">
          {label}
        </AppText>
        {isLocked ? <Icon name="lock.fill" color="text.tertiary" size={12} /> : null}
      </View>
      <View pointerEvents={isLocked ? 'none' : 'auto'} style={{ opacity: isLocked ? 0.5 : 1 }}>
        {children}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], minHeight: 52 }}>
        <TextButton label={EXERCISE_FORM_COPY.cancel} tone="secondary" onPress={() => { navigation.goBack(); }} />
        <AppText variant="headline" accessibilityRole="header" style={{ flex: 1, textAlign: 'center' }}>
          {editing === null ? EXERCISE_FORM_COPY.newTitle : EXERCISE_FORM_COPY.editTitle}
        </AppText>
        <View style={{ minWidth: 60 }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['8'] + insets.bottom, gap: theme.space['5'] }}>
        {section(
          EXERCISE_FORM_COPY.name,
          false,
          <TextField value={fields.name} onChangeText={(t) => { setFields((f) => ({ ...f, name: t.slice(0, 80) })); }} accessibilityLabel={EXERCISE_FORM_COPY.name} autoCorrect={false} autoFocus={editing === null && params.fields === undefined} />,
        )}
        {clash !== null ? (
          <StatusLine
            icon="info.circle"
            tone="info"
            text={clash.line}
            action={
              params.proposalActionId === undefined ? (
                <TextButton
                  label={EXERCISE_FORM_COPY.useIt}
                  onPress={() => {
                    navigation.goBack();
                    navigation.navigate('Tabs', { screen: 'Library', params: { screen: 'LibraryExercise', params: { exerciseId: clash.exerciseId, name: clash.name } } });
                  }}
                />
              ) : undefined
            }
          />
        ) : null}
        {section(
          EXERCISE_FORM_COPY.equipment,
          locked,
          <ChipRow>
            {equipmentOptions().map((o) => (
              <Chip key={o.key} label={o.label} selected={fields.equipment === o.key} onPress={() => { setFields((f) => withEquipment(f, o.key)); }} />
            ))}
          </ChipRow>,
        )}
        {section(
          EXERCISE_FORM_COPY.load,
          locked,
          <ChipRow>
            {loadOptions(fields.equipment).map((o) => (
              <Chip key={o.key} label={o.label} selected={fields.loadConvention === o.key} onPress={() => { setFields((f) => ({ ...f, loadConvention: o.key })); }} />
            ))}
          </ChipRow>,
        )}
        {section(
          EXERCISE_FORM_COPY.muscles,
          false,
          <ChipRow>
            {muscleOptions().map((o) => (
              <Chip key={o.key} label={o.label} selected={groups.includes(o.key)} onPress={() => { setFields((f) => toggledMuscle(f, o.key)); }} />
            ))}
          </ChipRow>,
        )}
        {section(
          EXERCISE_FORM_COPY.measured,
          locked,
          <ChipRow>
            {measuredOptions().map((o) => (
              <Chip key={o.key} label={o.label} selected={fields.measurement === o.key} onPress={() => { setFields((f) => ({ ...f, measurement: o.key })); }} />
            ))}
          </ChipRow>,
        )}
        {section(
          EXERCISE_FORM_COPY.sides,
          locked,
          <ChipRow>
            <Chip label={EXERCISE_FORM_COPY.both} selected={fields.laterality === 'bilateral'} onPress={() => { setFields((f) => ({ ...f, laterality: 'bilateral' })); }} />
            <Chip label={EXERCISE_FORM_COPY.each} selected={fields.laterality === 'unilateral'} onPress={() => { setFields((f) => ({ ...f, laterality: 'unilateral' })); }} />
          </ChipRow>,
        )}
        {notice !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={notice} /> : null}
        <PrimaryButton label={EXERCISE_FORM_COPY.save} onPress={() => { void save(); }} disabled={!canSaveForm(fields) || clash !== null || (editing !== null && version === null)} busy={busy} />
        {editing !== null ? (
          <Pressable accessibilityRole="none" style={{ alignItems: 'center' }}>
            <DangerTextButton label={EXERCISE_FORM_COPY.delete} onPress={confirmDelete} />
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
