import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActionSheetIOS } from 'react-native';

import { EQUIPMENT_KIND_LABEL, type EditableKind } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { openWorkoutToCheckGym } from '../../navigation/actions';
import type { ProfileStackParams } from '../../navigation/types';
import { useScreenData } from '../../shell/context';
import { AppText, Group, Row, Screen, SectionHeader, StatusLine, TextButton } from '../../ui';

const KINDS: EditableKind[] = ['barbell', 'dumbbells', 'weight_stack', 'assisted_stack', 'plate_loaded_machine', 'bodyweight_station'];

/**
 * Gym detail (gym-editor.md §2.2), minimal: the gym's equipment with what
 * each can make, `Typical values, not checked` on preset items, and `Add
 * equipment`. Archive, duplicate, travel gyms and attachments come later.
 */
export function GymDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const { gymId } = useRoute<RouteProp<ProfileStackParams, 'GymDetail'>>().params;
  const [data, reload] = useScreenData((s) => s.gyms.detail(gymId));
  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'error' || data.value === null) {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text={data.state === 'error' ? `Couldn’t open this gym. ${data.message}` : 'This gym wasn’t found.'} action={<TextButton label="Try again" onPress={reload} />} />
      </Screen>
    );
  }
  const { gym, equipment, inUseByWorkout } = data.value;

  function addEquipment() {
    const options = [...KINDS.map((k) => EQUIPMENT_KIND_LABEL[k]), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Add equipment', options, cancelButtonIndex: KINDS.length }, (i) => {
      const kind = KINDS[i];
      if (kind) navigation.navigate('EquipmentEditor', { gymId, equipmentId: newUuid(), kind, isNew: true });
    });
  }

  return (
    <Screen>
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
      <AppText variant="callout" color="text.secondary">
        {`${gym.isDefault ? 'Default gym · ' : ''}Every target and step is limited to what this equipment can make.`}
      </AppText>
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
              secondLine={e.unchecked ? 'Typical values, not checked' : null}
              onPress={() => {
                navigation.navigate('EquipmentEditor', { gymId, equipmentId: e.equipment.id, kind: e.equipment.kind, isNew: false });
              }}
            />
          ))}
        </Group>
      )}
      <Group>
        <Row title="Add equipment" icon="plus" onPress={addEquipment} />
      </Group>
    </Screen>
  );
}
