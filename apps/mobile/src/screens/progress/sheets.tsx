import { View } from 'react-native';

import type { ActivityView, TimeSheetRow } from '@fizz/domain';

import { E1RM_SHEET_LINES, HOW_COUNTED_LINES, TIME_SHEET_COPY } from '../../progress/copy';
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
            label={TIME_SHEET_COPY.countIt}
            accessibilityLabel={`${TIME_SHEET_COPY.countIt}: ${row.text}`}
            onPress={() => {
              onCount(row);
            }}
          />
        ) : null}
        <OutlinePill
          label={TIME_SHEET_COPY.editTimes}
          accessibilityLabel={`${TIME_SHEET_COPY.editTimes}: ${row.text}`}
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
      <Heading title={TIME_SHEET_COPY.title} onDone={onClose} />
      <AppText variant="body" numeric>
        {sheet.countLine}
      </AppText>
      {sheet.overCap.length > 0 ? (
        <View style={{ gap: theme.space['3'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            {TIME_SHEET_COPY.overCap}
          </AppText>
          {sheet.overCap.map((r) => (
            <LeftOutRow key={r.sessionId} row={r} onCount={onCount} onEdit={onEdit} />
          ))}
        </View>
      ) : null}
      {sheet.noEnd.length > 0 ? (
        <View style={{ gap: theme.space['3'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            {TIME_SHEET_COPY.noEnd}
          </AppText>
          {sheet.noEnd.map((r) => (
            <LeftOutRow key={r.sessionId} row={r} onEdit={onEdit} />
          ))}
        </View>
      ) : null}
      {sheet.imported !== null ? (
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            {TIME_SHEET_COPY.imported}
          </AppText>
          <AppText variant="body" numeric>
            {sheet.imported}
          </AppText>
        </View>
      ) : null}
      <AppText variant="callout" color="text.secondary">
        {TIME_SHEET_COPY.footer}
      </AppText>
    </BottomCard>
  );
}

export function HowCountedSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const lines = HOW_COUNTED_LINES;
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

/** Est. 1RM `ⓘ` (§2.7): how the estimate is worked out. */
export function E1rmSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <Heading title="Est. 1RM" onDone={onClose} />
      <View style={{ gap: theme.space['3'] }}>
        {E1RM_SHEET_LINES.map((l) => (
          <AppText key={l} variant="body">
            {l}
          </AppText>
        ))}
      </View>
    </BottomCard>
  );
}
