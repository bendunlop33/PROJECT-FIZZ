import { ActionSheetIOS, Alert, Pressable, View } from 'react-native';

import type { BuilderGroup } from '@fizz/schemas';

import { useTheme } from '../theme';
import { TextButton } from './buttons';
import { Eyebrow, StatusLine } from './layout';
import { BottomCard } from './sheet';
import { AppText } from './Text';
import { POPUP_COPY } from './exercise-popup-model';
import type { ChoiceSection } from './swap-sheet-model';
import { ChoiceRow, Divider, Table } from './table-parts';

/**
 * Swap / Add (workout-builder-v3 §2.5), one sheet for the builder and the active workout (workout-table-v3 §7,
 * today only there): the group dropdown defaults to the exercise's group; exercises by focus with their works line. No estimated max.
 */
export function SwapSheet({
  visible,
  title,
  group,
  groups,
  sections,
  actionWord,
  onGroup,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  group: BuilderGroup;
  groups: readonly BuilderGroup[];
  sections: readonly ChoiceSection[];
  /** `Swap` or `Add` (the `May hurt` confirm's button). */
  actionWord: string;
  onGroup: (g: BuilderGroup) => void;
  onPick: (exerciseId: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const chooseGroup = () => {
    const options = [...groups, 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1, title: 'Muscle group' }, (i) => {
      const g = groups[i];
      if (g !== undefined) onGroup(g);
    });
  };
  return (
    <BottomCard visible={visible} onClose={onClose} footer={<TextButton label="Back" tone="secondary" onPress={onClose} />}>
      <AppText variant="title2" accessibilityRole="header">
        {title}
      </AppText>
      <Pressable accessibilityRole="button" accessibilityLabel={`Muscle group, ${group}`} onPress={chooseGroup} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="body">Muscle group</AppText>
        <AppText variant="body" color="text.secondary">{`${group}  ⌄`}</AppText>
      </Pressable>
      {sections.length === 0 ? <StatusLine icon="info.circle" tone="info" text="All of these are in the workout" /> : null}
      {sections.map((sec) => (
        <View key={sec.focus} style={{ gap: theme.space['1'] }}>
          {sections.length > 1 ? <Eyebrow>{sec.focus}</Eyebrow> : null}
          <Table>
            {sec.items.map((it, i) => (
              <View key={it.exerciseId}>
                {i > 0 ? <Divider /> : null}
                <ChoiceRow
                  title={it.name}
                  line={it.works}
                  tag={it.mayHurt ? POPUP_COPY.mayHurt : null}
                  onPress={() => {
                    if (!it.mayHurt) {
                      onPick(it.exerciseId);
                      return;
                    }
                    Alert.alert(POPUP_COPY.mayHurt, it.name, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: actionWord,
                        onPress: () => {
                          onPick(it.exerciseId);
                        },
                      },
                    ]);
                  }}
                />
              </View>
            ))}
          </Table>
        </View>
      ))}
    </BottomCard>
  );
}

