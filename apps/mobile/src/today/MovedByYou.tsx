import { useRef } from 'react';
import { View } from 'react-native';

import { PB_MOVED_COPY } from '@fizz/domain';

import { newUuid } from '../device/runtime';
import { useReloadOn } from '../progress/use-reload-on';
import { useDataChanged, useScreenData, useServices } from '../shell/context';
import { useTheme } from '../theme';
import { AppText, TextButton } from '../ui';

/**
 * (Ben, 31 Oct: "it should move everything") Up next is a plan day Ben moved onto today (`Move to…`, `Do today
 * instead`): `Moved by you · Undo` under it, on Today's card and Library's NEXT. Undo puts the move back: the day
 * sheet's own Undo when that move was its last change, else this week's move of the day taken back (`unmove`); both
 * against the plan's version as read (rule 5), one op ID per tap. Nothing when not moved.
 */
export function MovedByYou({ dayIndex, onResult }: { dayIndex: number | null; onResult?: (text: string) => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const busy = useRef(false);
  const [data, reload] = useScreenData((s) => (dayIndex === null ? Promise.resolve(null) : s.plans.movedToday(dayIndex).catch(() => null)));
  useReloadOn(String(dayIndex), reload);
  const moved = data.state === 'ready' ? data.value : null;
  if (moved === null) return null;
  const undo = () => {
    if (busy.current) return;
    busy.current = true;
    const req = { planId: moved.planId, expectedVersion: moved.version, opId: newUuid() };
    void (moved.undo === 'last' ? services.plans.undoWeekChange(req) : services.plans.weekChange({ ...req, change: { kind: 'unmove', dayIndex: moved.dayIndex } }))
      .then((r) => {
        changed();
        onResult?.(r.ok ? PB_MOVED_COPY.undone : r.message);
      })
      .finally(() => {
        busy.current = false;
      });
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'] }}>
      <AppText variant="callout" color="text.secondary">{`${PB_MOVED_COPY.movedByYou} ·`}</AppText>
      <TextButton label={PB_MOVED_COPY.undo} tone="secondary" accessibilityLabel={`${PB_MOVED_COPY.undo} move`} onPress={undo} />
    </View>
  );
}
