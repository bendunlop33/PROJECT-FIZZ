import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { LIBRARY_CHANGES_COPY as C, libraryChangeMarks, nextTimeCardRows, type ChangeTap, type LibraryChangeRow } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText } from '../../ui';
import { TweakRow } from './ChangesScreen';

/**
 * (Redesign 27 Oct, D5) A saved workout's `Next time` card: the coach's next-session changes for it (`Bench press
 * 80 → 82.5 kg` · Why? · Undo; a bigger one Apply / Skip). Nothing when there are none. Each tap is the change's own
 * versioned write (rule 5) through `services.libraryChanges`; local only (rule 1). `onMarks` hands the page the
 * exercises whose number carries the dot.
 */
export function NextTimeCard({ routineId, onMarks }: { routineId: string; onMarks?: (exerciseIds: ReadonlySet<string>) => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [data, reload] = useScreenData((s) => s.libraryChanges.read().catch(() => null));
  const [line, setLine] = useState<string | null>(null);
  const busy = useRef(false);
  const value = data.state === 'ready' ? data.value : null;
  const rows: LibraryChangeRow[] = value === null ? [] : nextTimeCardRows(value.view, routineId);
  const markKey = value === null ? '' : [...libraryChangeMarks(value.view, routineId).keys()].join(',');
  useEffect(() => {
    onMarks?.(new Set(markKey === '' ? [] : markKey.split(',')));
  }, [markKey]);
  useEffect(() => {
    if (line === null) return;
    const t = setTimeout(() => {
      setLine(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [line]);
  if (rows.length === 0 && line === null) return null;

  const tap = (row: LibraryChangeRow, t: ChangeTap) => {
    if (value === null || busy.current) return;
    busy.current = true;
    void services.libraryChanges
      .tap(value, row, t, newUuid())
      .then((r) => {
        changed();
        reload();
        setLine(r.ok ? r.text : r.message);
      })
      .finally(() => {
        busy.current = false;
      });
  };

  return (
    <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, paddingHorizontal: theme.space['4'], paddingTop: theme.space['3'] }}>
      <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <AppText variant="callout" color="accent">
          ✦
        </AppText>
        <AppText variant="headline">{C.nextTime}</AppText>
      </View>
      {rows.map((r, i) => (
        <TweakRow
          key={r.key}
          row={r}
          first={i === 0}
          onTap={(t) => {
            tap(r, t);
          }}
        />
      ))}
      {line !== null ? (
        <AppText variant="callout" color="text.secondary" accessibilityLiveRegion="polite" style={{ paddingBottom: theme.space['3'] }}>
          {line}
        </AppText>
      ) : null}
    </View>
  );
}
