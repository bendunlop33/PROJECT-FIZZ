import { useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActionSheetIOS } from 'react-native';

import { DUMBBELL_STEPS, EQUIPMENT_KIND_LABEL, formatNumber, type EditableKind, type GymEdit } from '@fizz/domain';

import { haptic } from '../../device/haptics';
import { newUuid } from '../../device/runtime';
import { openWorkoutToCheckGym } from '../../navigation/actions';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { AppText, Group, Row, Screen, SectionHeader, StatusLine, TextButton, Toast } from '../../ui';

const KINDS: EditableKind[] = ['barbell', 'dumbbells', 'weight_stack', 'assisted_stack', 'plate_loaded_machine', 'bodyweight_station'];

const SETUP_WORD = { full: 'Full gym', small: 'Hotel / small', home: 'Home' } as const;

/**
 * Gym detail (gym-editor.md §2.2; ADR 0029): the gym's equipment with what
 * each can make, `Assumed` on items Ben hasn't confirmed, `Make full gym`
 * (keeps his items, adds the rest assumed; Undo), the exercises he marked
 * `Not at this gym` with `Put back`, and `Add equipment`.
 */
export function GymDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const { gymId } = useRoute<RouteProp<ProfileStackParams, 'GymDetail'>>().params;
  const services = useServices();
  const changed = useDataChanged();
  const [data, reload] = useScreenData((s) => s.gyms.detail(gymId));
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'error' || data.value === null) {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text={data.state === 'error' ? `Couldn’t open this gym. ${data.message}` : 'This gym wasn’t found.'} action={<TextButton label="Try again" onPress={reload} />} />
      </Screen>
    );
  }
  const { gym, equipment, inUseByWorkout, unit, makeFull, notHere } = data.value;

  function addEquipment() {
    const options = [...KINDS.map((k) => EQUIPMENT_KIND_LABEL[k]), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Add equipment', options, cancelButtonIndex: KINDS.length }, (i) => {
      const kind = KINDS[i];
      if (kind) navigation.navigate('EquipmentEditor', { gymId, equipmentId: newUuid(), kind, isNew: true });
    });
  }

  /** A gym edit's toast with Undo (versioned: refused once anything changed since). */
  function done(text: string, edit: GymEdit) {
    haptic('commit');
    changed();
    reload();
    setToast({
      text,
      undo: () => {
        void services.gyms.undoEdit(edit).then((r) => {
          setToast({ text: r.ok ? 'Undone' : r.message });
          changed();
          reload();
        });
      },
    });
  }

  function run(work: () => Promise<{ ok: true; edit: GymEdit } | { ok: false; message: string }>, text: string) {
    if (busy) return;
    setBusy(true);
    void work()
      .then((r) => {
        if (r.ok) done(text, r.edit);
        else setToast({ text: r.message });
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function makeFullGym() {
    if (makeFull === null) return;
    if (!makeFull.needsDumbbellStep) {
      run(() => services.gyms.makeFull({ gymId, dumbbellStep: unit === 'kg' ? 2.5 : 5 }), 'Full gym');
      return;
    }
    const steps = DUMBBELL_STEPS[unit];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Dumbbells go up in', options: [...steps.map((s) => `${formatNumber(s)} ${unit}`), 'Cancel'], cancelButtonIndex: steps.length }, (i) => {
      const step = steps[i];
      if (step !== undefined) run(() => services.gyms.makeFull({ gymId, dumbbellStep: step }), 'Full gym');
    });
  }

  const header = [gym.isDefault ? 'Default gym' : null, gym.setup === undefined ? null : SETUP_WORD[gym.setup]].filter((x) => x !== null).join(' · ');
  return (
    <Screen floating={toast ? <Toast text={toast.text} {...(toast.undo ? { action: 'Undo', onAction: toast.undo } : {})} /> : undefined}>
      {inUseByWorkout ? (
        <StatusLine
          icon="info.circle"
          tone="info"
          text="Your workout in progress uses this gym as it was when you started."
          action={
            <TextButton
              label="Use changes today"
              onPress={() => {
                // Opens `Use updated …` on the workout; nothing changes until Apply (gym-switch §2.3).
                navigation.dispatch(openWorkoutToCheckGym(gymId, newUuid()));
              }}
            />
          }
        />
      ) : null}
      {header !== '' ? (
        <AppText variant="callout" color="text.secondary">
          {header}
        </AppText>
      ) : null}
      <SectionHeader title={`Equipment (${String(equipment.length)})`} />
      {equipment.length === 0 ? (
        <AppText variant="callout" color="text.secondary">
          No equipment yet
        </AppText>
      ) : (
        <Group>
          {equipment.map((e) => (
            <Row
              key={e.equipment.id}
              title={e.equipment.name}
              subtitle={e.line}
              secondLine={e.tag}
              onPress={() => {
                navigation.navigate('EquipmentEditor', { gymId, equipmentId: e.equipment.id, kind: e.equipment.kind, isNew: false });
              }}
            />
          ))}
        </Group>
      )}
      <Group>
        {makeFull !== null ? <Row title="Make full gym" icon="sparkles" disabled={busy} onPress={makeFullGym} /> : null}
        <Row title="Add equipment" icon="plus" onPress={addEquipment} />
      </Group>
      {notHere.length > 0 ? (
        <>
          <SectionHeader title="Not at this gym" />
          <Group>
            {notHere.map((x) => (
              <Row
                key={x.exerciseId}
                title={x.name}
                trailing={
                  <TextButton
                    label="Put back"
                    disabled={busy}
                    onPress={() => {
                      run(() => services.gyms.putBack({ gymId, exerciseId: x.exerciseId }), `${x.name}: back`);
                    }}
                  />
                }
              />
            ))}
          </Group>
        </>
      ) : null}
    </Screen>
  );
}
