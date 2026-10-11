import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { newUuid } from '../device/runtime';
import { useDataChanged, useServices } from '../shell/context';
import { TIMING } from '../theme/tokens';
import { DELETE_COPY } from './delete-view';
import { takeDeleteToast, type DeleteToast } from './toast-handoff';

export interface ToastState {
  text: string;
  action?: string;
  onAction?: () => void;
}

export interface DeleteToastState {
  toast: ToastState | null;
  show: (t: ToastState) => void;
  showDeleted: (t: DeleteToast) => void;
  dismiss: () => void;
  /** VoiceOver is on: the toast stays until dismissed, so it shows a close button (§4; review S3). */
  persistent: boolean;
}

/**
 * The delete / restore toast (`UndoToast`, `timing.undoToast`): shown for
 * 8 s, or until dismissed while VoiceOver is on (§4). `Undo` restores
 * exactly that operation's workouts; the restored toast's `Undo` deletes
 * them again (§7). A toast handed off by the screen Ben left (Summary,
 * Past workout) is taken when this screen comes into focus.
 */
export function useDeleteToast(): DeleteToastState {
  const services = useServices();
  const changed = useDataChanged();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [reader, setReader] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      if (alive) setReader(on);
    });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setReader);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  useEffect(() => {
    if (!toast || reader) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast, reader]);

  const showDeleted = useCallback(
    (t: DeleteToast) => {
      // One op ID per toast: a double tap on Undo restores once.
      const opId = newUuid();
      setToast({
        text: t.text,
        action: DELETE_COPY.undo,
        onAction: () => {
          void services.history.restoreWorkouts(t.undo, opId).then((r) => {
            changed();
            if (!r.ok) {
              setToast({ text: r.message });
              return;
            }
            // `Push A · Thu 8 Oct restored` [Undo] (§7, review N7): Undo deletes them again.
            const againOp = newUuid();
            const restoredItems = r.refs.map((x) => ({ sessionId: x.sessionId, expectedVersion: x.version }));
            setToast({
              text: t.restoredText,
              action: DELETE_COPY.undo,
              onAction: () => {
                void services.history.deleteWorkouts(restoredItems, againOp, { from: 'opened' }).then((d) => {
                  changed();
                  if (d.ok) showDeleted({ ...t, undo: d.refs.map((x) => ({ sessionId: x.sessionId, expectedVersion: x.version })) });
                  else setToast({ text: d.message });
                });
              },
            });
          });
        },
      });
    },
    [services, changed],
  );

  useFocusEffect(
    useCallback(() => {
      const handed = takeDeleteToast();
      if (handed) showDeleted(handed);
    }, [showDeleted]),
  );

  const dismiss = useCallback(() => {
    setToast(null);
  }, []);
  return { toast, show: setToast, showDeleted, dismiss, persistent: reader };
}
