import { View } from 'react-native';

import type { ActivityView, TimeSheetRow } from '@fizz/domain';

import { useTheme } from '../../theme';
import { AppText, BottomCard, OutlinePill, TextButton } from '../../ui';

/**
 * The two Progress sheets (progress.md §2.3, §2.4): `Time in gym` lists only
 * what was left out of time, and `How this is counted`, the one place the
 * muscle method is explained (minimal copy: nowhere else).
 */

function Heading({ title, onDone }: { title: string; onDone: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <AppText variant="title2" accessibilityRole="header">
        {title}
      </AppText>
      <TextButton label="Done" onPress={onDone} />
    </View>
  );
}

function LeftOutRow({ row, onCount, onEdit }: { row: TimeSheetRow; onCount?: (r: TimeSheetRow) => void; onEdit: (r: TimeSheetRow) => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="body" numeric>
        {row.text}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
        {onCount ? (
          <OutlinePill
            label="Count it"
            accessibilityLabel={`Count it: ${row.text}`}
            onPress={() => {
              onCount(row);
            }}
          />
        ) : null}
        <OutlinePill
          label="Edit times"
          accessibilityLabel={`Edit times: ${row.text}`}
          onPress={() => {
            onEdit(row);
          }}
        />
      </View>
    </View>
  );
}

export function TimeSheet({ visible, sheet, onClose, onCount, onEdit }: { visible: boolean; sheet: ActivityView['sheet']; onClose: () => void; onCount: (r: TimeSheetRow) => void; onEdit: (r: TimeSheetRow) => void }) {
  const theme = useTheme();
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <Heading title="Time in gym" onDone={onClose} />
      <AppText variant="body" numeric>
        {sheet.countLine}
      </AppText>
      {sheet.overCap.length > 0 ? (
        <View style={{ gap: theme.space['3'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            OVER 4 H
          </AppText>
          {sheet.overCap.map((r) => (
            <LeftOutRow key={r.sessionId} row={r} onCount={onCount} onEdit={onEdit} />
          ))}
        </View>
      ) : null}
      {sheet.noEnd.length > 0 ? (
        <View style={{ gap: theme.space['3'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            NO END TIME
          </AppText>
          {sheet.noEnd.map((r) => (
            <LeftOutRow key={r.sessionId} row={r} onEdit={onEdit} />
          ))}
        </View>
      ) : null}
      {sheet.imported !== null ? (
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            NO TIMES
          </AppText>
          <AppText variant="body" numeric>
            {sheet.imported}
          </AppText>
        </View>
      ) : null}
      <AppText variant="callout" color="text.secondary">
        Time is start to finish, minus pauses, the same as each workout’s summary.
      </AppText>
    </BottomCard>
  );
}

export function HowCountedSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const lines = [
    'Sets are completed working sets rated RPE 6 or harder, or not rated. Warm-ups and easier sets aren’t counted.',
    'Body parts: a set counts 1 for the muscles an exercise mainly works and ½ for helpers. Bench press: 1 chest, ½ shoulders, ½ triceps.',
    'Push/Pull/Legs: each exercise belongs to one group, and each set counts 1 there.',
    'Sessions are workouts with at least 1 counted set for that group.',
    'Sets you marked spotted, painful or with form breaking still count here, because you did the work.',
    'This counts work done. It doesn’t measure recovery or fatigue.',
  ];
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <Heading title="How this is counted" onDone={onClose} />
      <View style={{ gap: theme.space['3'] }}>
        {lines.map((l) => (
          <AppText key={l} variant="body">
            {l}
          </AppText>
        ))}
      </View>
    </BottomCard>
  );
}
