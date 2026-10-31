import { useCallback, useMemo, useRef, useState } from 'react';

import { buildExercisePickerView, type BroadMuscleGroup, type EquipmentFilter, type PickerIndex, type PickerView } from '@fizz/domain';

/**
 * (Ben, 25 Oct) The Swap / Add sheet's full list: the index is read once when the sheet opens (`open`), then every
 * keystroke and chip is the pure `buildExercisePickerView` over it, in render, with no read (the perf budget's
 * `Swap sheet, a search keystroke`). A slower read for an earlier open never lands on a newer one.
 */
export function useExercisePicker() {
  const [index, setIndex] = useState<PickerIndex | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<BroadMuscleGroup | null>(null);
  /** (Ben, 26 Oct) The equipment chip that is on, or null. */
  const [equipment, setEquipment] = useState<EquipmentFilter | null>(null);
  const token = useRef(0);

  const open = useCallback((load: () => Promise<PickerIndex>, initialQuery = '') => {
    const t = (token.current += 1);
    setIndex(null);
    setQuery(initialQuery);
    setGroup(null);
    setEquipment(null);
    void load()
      .catch((): PickerIndex => ({ entries: [], gym: null }))
      .then((ix) => {
        if (token.current === t) setIndex(ix);
      });
  }, []);

  const close = useCallback(() => {
    token.current += 1;
    setIndex(null);
    setQuery('');
    setGroup(null);
    setEquipment(null);
  }, []);

  return { index, query, setQuery, group, setGroup, equipment, setEquipment, open, close };
}

/** The view for the sheet now; null while the index is being read. */
export function usePickerView(p: { index: PickerIndex | null; query: string; group: BroadMuscleGroup | null; equipment?: EquipmentFilter | null }, exclude: readonly string[], suggested: readonly string[]): PickerView | null {
  const excludeKey = exclude.join('|');
  const suggestedKey = suggested.join('|');
  return useMemo(
    () => (p.index === null ? null : buildExercisePickerView({ index: p.index, query: p.query, group: p.group, equipment: p.equipment ?? null, exclude: excludeKey === '' ? [] : excludeKey.split('|'), suggested: suggestedKey === '' ? [] : suggestedKey.split('|') })),
    [p.index, p.query, p.group, p.equipment, excludeKey, suggestedKey],
  );
}
