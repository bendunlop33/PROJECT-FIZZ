import { useNavigation } from '@react-navigation/native';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActionSheetIOS } from 'react-native';

import { newUuid } from '../device/runtime';
import type { RepeatCandidate } from '../services/workout-services';
import { useDataChanged, useServices } from '../shell/context';
import { TextButton } from '../ui';
import { DELETE_COPY, deletedToastText, keepSelection, restoredToastText, selectAllLabel, selectTitle, toggleAll, toggleOne } from './delete-view';
import { IntentOps } from './intent-ops';
import type { DeleteToastState } from './useDeleteToast';

export interface SelectDeleteLine {
  tone: 'info' | 'warning';
  text: string;
  retry?: () => void;
}

/**
 * Select and delete in a list of past workouts (delete-workouts §2.3, §2.1:
 * Past workouts and an import's workout list). Owns select mode and its
 * nav bar (`Select all` · `n selected` · `Cancel`), the confirm sheet, the
 * one all-or-nothing write, the stale reload and `Try again`, and the
 * toast. One op ID per intent (review S4, N2).
 */
export function useSelectDelete(opts: { rows: readonly RepeatCandidate[]; loaded: boolean; title: string; reload: () => void; toast: DeleteToastState }) {
  const { rows, loaded, title, reload, toast } = opts;
  const navigation = useNavigation();
  const services = useServices();
  const changed = useDataChanged();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [line, setLine] = useState<SelectDeleteLine | null>(null);
  const ops = useRef(new IntentOps(newUuid)).current;
  const tz = services.now().tz;

  // After a reload (stale, or a change elsewhere) the selection keeps only what is still listed.
  useEffect(() => {
    if (loaded) setSelected((s) => keepSelection(s, rows));
  }, [loaded, rows]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: selecting ? selectTitle(selected.size) : title,
      headerLeft: selecting
        ? () => (
            <TextButton
              label={selectAllLabel(selected, rows)}
              onPress={() => {
                setSelected(toggleAll(selected, rows));
              }}
            />
          )
        : undefined,
      headerRight: () =>
        rows.length === 0 ? null : (
          <TextButton
            label={selecting ? DELETE_COPY.cancel : DELETE_COPY.select}
            onPress={() => {
              setSelecting(!selecting);
              setSelected(new Set());
              setLine(null);
            }}
          />
        ),
    });
  }, [navigation, selecting, selected, rows, title]);

  async function remove(target: readonly RepeatCandidate[]) {
    const items = target.map((t) => ({ sessionId: t.sessionId, expectedVersion: t.version }));
    const r = await services.history.deleteWorkouts(items, ops.for('delete', items));
    if (r.ok) {
      setSelecting(false);
      setSelected(new Set());
      setLine(null);
      toast.showDeleted({ text: deletedToastText(target, tz), undo: r.refs.map((x) => ({ sessionId: x.sessionId, expectedVersion: x.version })), restoredText: restoredToastText(target, tz) });
      changed();
      return;
    }
    if (r.kind === 'stale') {
      // Nothing was deleted; the list reloads and the selection keeps what is still listed.
      setLine({ tone: 'info', text: r.message });
      reload();
      return;
    }
    // `Try again` reuses the same op ID (§3.1 Write failed).
    setLine({ tone: 'warning', text: r.message, retry: () => void remove(target) });
  }

  function confirmSelected() {
    const target = rows.filter((r) => selected.has(r.sessionId));
    const view = services.history.confirmView(target);
    if (view === null) return;
    ActionSheetIOS.showActionSheetWithOptions(
      { title: view.title, message: [view.range, view.importedLine].filter((x) => x !== null).join('\n'), options: [view.confirmLabel, DELETE_COPY.cancel], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => {
        if (i === 0) void remove(target);
      },
    );
  }

  return {
    selecting,
    selected,
    line,
    toggle: (sessionId: string) => {
      setSelected(toggleOne(selected, sessionId));
    },
    /** A row's own `Delete` (VoiceOver custom action): one workout, no alert (DW-D2). */
    removeOne: (row: RepeatCandidate) => void remove([row]),
    confirmSelected,
  };
}
