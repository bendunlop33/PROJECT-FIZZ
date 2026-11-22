import { useState } from 'react';
import { View } from 'react-native';

import { LIFT_TARGET_COPY as C } from '@fizz/domain';

import type { ExerciseLiftTarget as Data } from '../services/lift-target-service';
import { useDataChanged } from '../shell/context';
import { useTheme } from '../theme';
import { Eyebrow, TextButton, Toast } from '../ui';
import { LiftTargetRow } from './LiftTargetRow';
import { LiftTargetSheet, type LiftTargetToast } from './LiftTargetSheet';

/**
 * Progress › exercise detail's lift target (Ben approved 20 Oct): its line, or `Add target` for an
 * exercise logged with a load while there is room. Nothing at all while the setting is off. The
 * chart's dotted line is drawn by `TrendChart` from the same target.
 */
export function ExerciseLiftTarget({ data, exerciseId, onChanged }: { data: Data | null; exerciseId: string; onChanged: () => void }) {
  const theme = useTheme();
  const changed = useDataChanged();
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<LiftTargetToast | null>(null);
  if (data === null || !data.on) return null;
  if (data.line === null && !data.canAdd && toast === null) return null;

  const done = (t: LiftTargetToast | null) => {
    setEditing(false);
    setToast(t);
    changed();
    onChanged();
  };
  const undo = toast?.undo;

  return (
    <View style={{ gap: theme.space['1'] }}>
      <Eyebrow color="text.secondary">{C.label}</Eyebrow>
      {data.line !== null ? (
        <LiftTargetRow
          line={data.line}
          first
          onPress={() => {
            setEditing(true);
          }}
        />
      ) : data.canAdd ? (
        <TextButton
          label={C.add}
          icon="plus"
          onPress={() => {
            setEditing(true);
          }}
        />
      ) : null}
      {toast !== null ? (
        <Toast
          text={toast.text}
          {...(undo === undefined
            ? {}
            : {
                action: C.undo,
                onAction: () => {
                  setToast(null);
                  undo();
                },
              })}
          onDismiss={() => {
            setToast(null);
          }}
          showClose
        />
      ) : null}
      <LiftTargetSheet
        visible={editing}
        choices={data.choice === null ? [] : [data.choice]}
        existing={data.target}
        exerciseId={exerciseId}
        version={data.version}
        onClose={() => {
          setEditing(false);
        }}
        onDone={done}
      />
    </View>
  );
}
