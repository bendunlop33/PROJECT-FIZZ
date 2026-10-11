import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Switch, View } from 'react-native';

import type { RoutineNameCheck } from '@fizz/domain';
import type { Routine } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
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
 */
export function SaveWorkoutSheet({
  visible,
  from,
  initialName,
  detail,
  onSaved,
  onClose,
  onDismissed,
}: {
  visible: boolean;
  from: SaveFrom | null;
  initialName: string;
  /** `5 exercises · 15 sets`. */
  detail: string;
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
    if (!visible) return;
    setName(initialName);
    setRotation(false);
    setError(null);
    setBusy(false);
    opId.current = newUuid();
  }, [visible, initialName]);

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
      <AppText variant="callout" color="text.secondary" numeric>
        {detail}
      </AppText>
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

/**
 * Open the save sheet for a source (§A2.5): reads what would be saved
 * first; with nothing to save the sheet doesn't open and the caller shows
 * `Nothing to save` (an out-of-date overview: `Targets updated`).
 */
export function useSaveToWorkouts(onSaved: (routine: Routine) => void, onNothing: () => void, onStale: () => void = onNothing) {
  const services = useServices();
  const [state, setState] = useState<{ from: SaveFrom; name: string; detail: string } | null>(null);
  const [visible, setVisible] = useState(false);
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
    setState({ from, name: src.name, detail: src.detail });
    setVisible(true);
  }
  const sheet = (
    <SaveWorkoutSheet
      visible={visible}
      from={state?.from ?? null}
      initialName={state?.name ?? ''}
      detail={state?.detail ?? ''}
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
