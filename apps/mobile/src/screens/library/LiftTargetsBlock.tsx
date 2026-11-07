import { useState } from 'react';
import { View } from 'react-native';

import { LIFT_TARGET_COPY as C } from '@fizz/domain';
import type { LiftTarget } from '@fizz/schemas';

import { LiftTargetRow } from '../../lift-targets/LiftTargetRow';
import { LiftTargetSheet, type LiftTargetToast } from '../../lift-targets/LiftTargetSheet';
import { useDataChanged, useScreenData } from '../../shell/context';
import { useTheme } from '../../theme';
import { Eyebrow, TextButton } from '../../ui';

/**
 * Your plan › Lift targets (Ben approved 20 Oct): his targets with where he is now, `Add target`
 * while there is room. Nothing at all while the Lift targets setting is off. Every value comes
 * from `services.liftTargets.view()`; this draws it. Local only (rule 1).
 */
export function LiftTargetsBlock({ onToast }: { onToast: (t: { text: string; action?: string; onAction?: () => void } | null) => void }) {
  const theme = useTheme();
  const changed = useDataChanged();
  const [data, reload] = useScreenData((s) => s.liftTargets.view());
  const [editing, setEditing] = useState<{ existing: LiftTarget | null } | null>(null);
  if (data.state !== 'ready' || data.value === null || !data.value.on) return null;
  const v = data.value;

  const done = (t: LiftTargetToast | null) => {
    setEditing(null);
    changed();
    reload();
    if (t === null) {
      onToast(null);
      return;
    }
    const undo = t.undo;
    onToast(
      undo === undefined
        ? { text: t.text }
        : {
            text: t.text,
            action: C.undo,
            onAction: () => {
              onToast(null);
              undo();
            },
          },
    );
  };

  return (
    <View style={{ gap: theme.space['1'] }}>
      <Eyebrow color="text.secondary">{C.label}</Eyebrow>
      {v.lines.map((line, i) => (
        <LiftTargetRow
          key={line.exerciseId}
          line={line}
          first={i === 0}
          onPress={() => {
            setEditing({ existing: v.targets.find((t) => t.exerciseId === line.exerciseId) ?? null });
          }}
        />
      ))}
      {v.canAdd && v.choices.length > 0 ? (
        <TextButton
          label={C.add}
          icon="plus"
          onPress={() => {
            setEditing({ existing: null });
          }}
        />
      ) : null}
      <LiftTargetSheet
        visible={editing !== null}
        choices={editing?.existing == null ? v.choices.filter((c) => !v.targets.some((t) => t.exerciseId === c.exerciseId)) : v.choices}
        existing={editing?.existing ?? null}
        exerciseId={null}
        version={v.version}
        onClose={() => {
          setEditing(null);
        }}
        onDone={done}
      />
    </View>
  );
}
