import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Switch, View } from 'react-native';

import type { RoutineNameCheck } from '@fizz/domain';
import type { Routine, RoutineExercise } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { beginSaveEdit } from '../../workout/save-edit-handoff';
import type { SaveFrom } from '../../services/workout-services';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, PrimaryButton, StatusLine, TextButton, TextField } from '../../ui';
import { LIBRARY_COPY_UI } from '../../workout/library-view';

/**
 * `SaveWorkoutSheet` (routines.md §A2.5, WL6): one sheet everywhere a
 * workout can be saved. Name prefilled and selected, what will be saved,
 * `Add to rotation` (off by default) and `Save` above the keyboard. A
 * duplicate name is a note, never a block. One opId per opening, so two
 * quick taps save one workout; a failed save keeps the sheet and retries
 * with the same opId. Local only: never waits on network or AI.
 *
 * `Edit ›` on the summary line (2026-10-12, WL-A18) hands the name, the
 * rotation choice and this opening's opId to `onEdit`; the sheet keeps them
 * while it is hidden, so it shows again unchanged after the editor's Cancel.
 * A new opening (`openKey`) starts afresh.
 */
export function SaveWorkoutSheet({
  visible,
  from,
  initialName,
  detail,
  notSaved = null,
  openKey = 0,
  onEdit,
  onSaved,
  onClose,
  onDismissed,
}: {
  visible: boolean;
  from: SaveFrom | null;
  initialName: string;
  /** `5 exercises · 15 sets`. */
  detail: string;
  /** `Not copied: 3 distance sets (Sled push)` (review S1); null when nothing is left out. */
  notSaved?: string | null;
  /** Changes on each new opening: name, rotation and opId start afresh. Hiding and showing again keeps them. */
  openKey?: number;
  /** `Edit ›`: open the editor on the unsaved copy with what the sheet holds now. */
  onEdit?: (held: { name: string; addToRotation: boolean; opId: string }) => void;
  onSaved: (routine: Routine) => void;
  onClose: () => void;
  onDismissed?: () => void;
}) {
  const theme = useTheme();
  const services = useServices();
  const [name, setName] = useState(initialName);
  const [rotation, setRotation] = useState(false);
  const [check, setCheck] = useState<RoutineNameCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opId = useRef(newUuid());

  useEffect(() => {
    setName(initialName);
    setRotation(false);
    setError(null);
    setBusy(false);
    opId.current = newUuid();
  }, [openKey, initialName]);

  useEffect(() => {
    let live = true;
    void services.routines.checkName(name).then((r) => {
      if (live) setCheck(r);
    });
    return () => {
      live = false;
    };
  }, [services, name]);

  async function save() {
    if (from === null || busy || check?.ok !== true) return;
    setBusy(true);
    setError(null);
    const r = await services.routines.saveFrom({ from, name: name.trim(), addToRotation: rotation, opId: opId.current }).catch(() => null);
    setBusy(false);
    if (r === null) {
      setError(LIBRARY_COPY_UI.saveFailed);
      return;
    }
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onSaved(r.routine);
  }

  return (
    <BottomCard visible={visible} onClose={onClose} {...(onDismissed ? { onDismissed } : {})} closeLabel={LIBRARY_COPY_UI.cancel}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'] }}>
        <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
          {LIBRARY_COPY_UI.saveToWorkouts}
        </AppText>
        <TextButton label={LIBRARY_COPY_UI.cancel} tone="secondary" onPress={onClose} />
      </View>
      <View style={{ gap: theme.space['2'] }}>
        <AppText variant="label" color="text.secondary">
          Name
        </AppText>
        <TextField accessibilityLabel="Name" value={name} onChangeText={setName} autoFocus selectTextOnFocus returnKeyType="done" maxLength={160} onSubmitEditing={() => void save()} />
        {check && !check.ok && name.length > 0 ? (
          <AppText variant="callout" color="status.warning">
            {check.message}
          </AppText>
        ) : check?.ok && check.note !== null ? (
          <AppText variant="callout" color="text.secondary">
            {check.note}
          </AppText>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'] }}>
        <AppText variant="callout" color="text.secondary" numeric style={{ flex: 1 }}>
          {detail}
        </AppText>
        {onEdit ? (
          <TextButton
            label={`${LIBRARY_COPY_UI.edit} ›`}
            accessibilityLabel={LIBRARY_COPY_UI.editBeforeSaving}
            disabled={busy || from === null}
            onPress={() => {
              onEdit({ name: name.trim(), addToRotation: rotation, opId: opId.current });
            }}
          />
        ) : null}
      </View>
      {notSaved !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {notSaved}
        </AppText>
      ) : null}
      <SwitchRow label={LIBRARY_COPY_UI.addToRotation} value={rotation} onChange={setRotation} />
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      <PrimaryButton label={LIBRARY_COPY_UI.save} busy={busy} disabled={check?.ok !== true || from === null} onPress={() => void save()} />
    </BottomCard>
  );
}

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }): ReactNode {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: theme.space['3'] }}>
      <AppText variant="body" style={{ flex: 1 }}>
        {label}
      </AppText>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: theme.colors.accent, false: theme.colors['bg.raised'] }} />
    </View>
  );
}

/** The editor's modal dismissal, before the sheet slides back in. */
const REOPEN_AFTER_EDITOR_MS = 450;

/**
 * Open the save sheet for a source (§A2.5): reads what would be saved
 * first; with nothing to save the sheet doesn't open and the caller shows
 * `Nothing to save` (an out-of-date overview: `Targets updated`).
 *
 * `Edit ›` (WL-A18): the sheet hides, and once it is gone the workout
 * editor opens on the unsaved copy. The editor's `Save` creates the workout
 * with this sheet's opId and comes back through `onSaved` (one toast, one
 * Undo); its `Cancel` shows the sheet again, unchanged, with nothing saved.
 */
export function useSaveToWorkouts(onSaved: (routine: Routine) => void, onNothing: () => void, onStale: () => void = onNothing) {
  const services = useServices();
  const navigation = useNavigation();
  const [state, setState] = useState<{ from: SaveFrom; name: string; detail: string; notSaved: string | null; exercises: RoutineExercise[] } | null>(null);
  const [visible, setVisible] = useState(false);
  const [openKey, setOpenKey] = useState(0);
  // `Edit ›` tapped: the editor opens when the sheet has gone (iOS presents one modal at a time).
  const editing = useRef<{ key: string; name: string } | null>(null);
  async function open(from: SaveFrom, fallbackName: string | null = null): Promise<void> {
    const src = await services.routines.saveSource(from, fallbackName).catch(() => null);
    if (src === 'stale') {
      onStale();
      return;
    }
    if (src === null) {
      onNothing();
      return;
    }
    setState({ from, name: src.name, detail: src.detail, notSaved: src.notSaved, exercises: src.exercises });
    setOpenKey((k) => k + 1);
    setVisible(true);
  }
  function openEditor() {
    const e = editing.current;
    editing.current = null;
    if (e === null || state === null) return;
    navigation.navigate('WorkoutEditor', { routineId: null, from: 'SaveSheet', draft: { name: e.name, exercises: state.exercises }, saveAs: e.key });
  }
  const sheet = (
    <SaveWorkoutSheet
      visible={visible}
      from={state?.from ?? null}
      initialName={state?.name ?? ''}
      detail={state?.detail ?? ''}
      notSaved={state?.notSaved ?? null}
      openKey={openKey}
      onEdit={(held) => {
        if (state === null) return;
        beginSaveEdit(held.opId, { from: state.from, addToRotation: held.addToRotation, opId: held.opId }, (o) => {
          if (o.kind === 'saved') onSaved(o.routine);
          // Shown again once the editor has gone (one modal at a time on iOS). Needs a real-device check.
          else
            setTimeout(() => {
              setVisible(true);
            }, REOPEN_AFTER_EDITOR_MS);
        });
        editing.current = { key: held.opId, name: held.name };
        setVisible(false);
      }}
      onDismissed={openEditor}
      onSaved={(r) => {
        setVisible(false);
        onSaved(r);
      }}
      onClose={() => {
        setVisible(false);
      }}
    />
  );
  return { open, sheet };
}
