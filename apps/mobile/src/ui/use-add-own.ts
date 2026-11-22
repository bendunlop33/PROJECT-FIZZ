import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useRef } from 'react';

import { newUuid } from '../device/runtime';
import { takeCreated } from '../library/exercise-form-handoff';

/**
 * (Ben, 25 Oct) `＋ Add your own` on the Swap / Add sheet: the sheet closes, the custom-exercise form opens (the
 * search text as its name), and after a Save the sheet comes back for the same row searching for the new exercise
 * (`reopen`), where Ben picks it with the usual checks. Cancel on the form: nothing changes. The form opens once
 * the sheet's modal has gone (`onDismissed`), or after a short wait if that never comes.
 */
export function useAddOwn<C>(reopen: (ctx: C, name: string) => void) {
  const navigation = useNavigation();
  const pending = useRef<{ token: string; ctx: C } | null>(null);
  const toOpen = useRef<{ token: string; name: string | null } | null>(null);
  const reopenRef = useRef(reopen);
  reopenRef.current = reopen;

  const go = useCallback(() => {
    const o = toOpen.current;
    if (o === null) return;
    toOpen.current = null;
    navigation.navigate('ExerciseForm', { ...(o.name === null || o.name === '' ? {} : { name: o.name }), pickFor: o.token });
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      const p = pending.current;
      if (p === null || toOpen.current !== null) return;
      pending.current = null;
      const c = takeCreated(p.token);
      if (c !== null) reopenRef.current(p.ctx, c.name);
    }, []),
  );

  return {
    /** Call, then close the sheet. */
    start: (ctx: C, name: string | null) => {
      const token = newUuid();
      pending.current = { token, ctx };
      toOpen.current = { token, name };
      setTimeout(go, 600);
    },
    /** The sheet's modal has gone: open the form now. */
    onDismissed: go,
  };
}
