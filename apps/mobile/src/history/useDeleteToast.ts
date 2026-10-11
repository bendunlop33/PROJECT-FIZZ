import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * The delete / restore toast (`UndoToast`, `timing.undoToast`): shown for
 * 8 s, or until dismissed while VoiceOver is on (§4). `Undo` restores
 * exactly that operation's workouts. A toast handed off by the screen Ben
 * left (Summary, Past workout) is taken when this screen comes into focus.
 */
export function useDeleteToast(): { toast: ToastState | null; show: (t: ToastState) => void; showDeleted: (t: DeleteToast) => void; dismiss: () => void } {
  const services = useServices();
  const changed = useDataChanged();
  const [toast, setToast] = useState<ToastState | null>(null);
  const reader = useRef(false);
  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      reader.current = on;
    });
  }, []);
  useEffect(() => {
    if (!toast || reader.current) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  const showDeleted = useCallback(
    (t: DeleteToast) => {
      // One op ID per toast: a double tap on Undo restores once.
      const opId = newUuid();
      setToast({
        text: t.text,
        action: DELETE_COPY.undo,
        onAction: () => {
          void services.history.restoreWorkouts(t.undo, opId).then((r) => {
            setToast({ text: r.ok ? t.restoredText : r.message });
            changed();
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

  return { toast, show: setToast, showDeleted, dismiss: () => { setToast(null); } };
}
