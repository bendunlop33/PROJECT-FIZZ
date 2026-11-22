import { useEffect, useRef, useState } from 'react';

import type { ExercisePreference } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { EXERCISE_PREF_COPY as C, type ExercisePrefItem, type ExercisePrefsView } from '../../services/exercise-prefs-service';
import { useDataChanged, useServices } from '../../shell/context';
import { Group, Row, Screen, SectionHeader, StatusLine, TextButton } from '../../ui';
import { SwapSheet } from '../../ui/swap-sheet';
import { useExercisePicker, usePickerView } from '../../ui/use-exercise-picker';
import { NotPreferredInPlanLines } from '../plan/NotPreferredInPlan';

type ListKind = Extract<ExercisePreference, 'preferred' | 'not_preferred'>;

/**
 * Profile › Training › Likes & dislikes (Ben, 2 Nov). The plan in use's Any preferences as two lists, Liked and Not
 * preferred, each with Add (the exercise picker) and Remove. Every tap is the coach's own change through the same
 * service (`exercisePrefs.set`: one versioned write on the plan's answers, op ID, rule 5), so Profile, Plan setup and
 * the coach read and write one record. A newly not-preferred exercise his plan has shows the same `In your plan … ·
 * Replace` line as Plan setup. Values only (minimal copy).
 */
export function ExercisePrefsScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const [view, setView] = useState<ExercisePrefsView | null | 'error'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<ListKind | null>(null);
  const picker = useExercisePicker();
  const pickerView = usePickerView(picker, [], []);
  const busy = useRef(false);

  const load = () => {
    void services.exercisePrefs
      .view()
      .then((v) => {
        setView(v);
      })
      .catch(() => {
        setView('error');
      });
  };
  useEffect(load, [services]);

  async function set(exercise: string, preference: ExercisePreference) {
    if (view === null || view === 'error' || view.kind !== 'ready' || busy.current) return;
    busy.current = true;
    try {
      const r = await services.exercisePrefs.set({ exercise, preference, expectedVersion: view.version, opId: newUuid() });
      if (r.view !== null) setView(r.view);
      setNotice(r.ok ? null : r.line);
      if (r.ok) changed();
    } catch {
      setNotice(C.failed);
    } finally {
      busy.current = false;
    }
  }

  function openAdd(kind: ListKind) {
    setAdding(kind);
    picker.open(async () => {
      const gym = await services.yourData.currentGym().catch(() => null);
      return services.exercisePicker.forTemplate(gym?.id ?? null);
    });
  }

  function closeAdd() {
    setAdding(null);
    picker.close();
  }

  if (view === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text={C.failed} action={<TextButton label="Try again" onPress={load} />} />
      </Screen>
    );
  }
  if (view === null) return <Screen>{null}</Screen>;
  if (view.kind === 'none') {
    return (
      <Screen>
        <StatusLine icon="info.circle" tone="info" text={view.why === 'no_plan' ? C.noPlan : C.notThisPlan} />
      </Screen>
    );
  }

  const list = (kind: ListKind, title: string, items: readonly ExercisePrefItem[]) => (
    <>
      <SectionHeader title={title} />
      <Group>
        {items.map((it) => (
          <Row key={it.key} title={it.name} trailing={<TextButton label={C.remove} accessibilityLabel={`${C.remove} ${it.name}`} tone="secondary" onPress={() => void set(it.key, 'none')} />} />
        ))}
        <Row
          title={C.add}
          icon="plus"
          onPress={() => {
            openAdd(kind);
          }}
        />
      </Group>
    </>
  );

  return (
    <Screen>
      {notice !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={notice} /> : null}
      <NotPreferredInPlanLines answers={view.parts} />
      {list('preferred', C.liked, view.liked)}
      {list('not_preferred', C.notPreferred, view.notPreferred)}
      <SwapSheet
        visible={adding !== null}
        title={adding === 'not_preferred' ? C.notPreferred : C.liked}
        sections={[]}
        actionWord={C.add}
        onPick={(exerciseId) => {
          const kind = adding;
          closeAdd();
          if (kind !== null) void set(exerciseId, kind);
        }}
        onClose={closeAdd}
        picker={{
          view: pickerView,
          query: picker.query,
          onQuery: picker.setQuery,
          index: picker.index,
          equipment: picker.equipment,
          onEquipment: picker.setEquipment,
          onChip: (g) => {
            picker.setGroup(g);
          },
        }}
      />
    </Screen>
  );
}
