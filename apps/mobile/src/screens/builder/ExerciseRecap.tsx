import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { ExerciseRecap } from '@fizz/domain';

import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, TextButton } from '../../ui';

/**
 * (Redesign 27 Oct, D6; Ben: what the old pop-up showed) Above an expanded card's sets: `Last · 20 Oct` with that
 * workout's sets (`80 × 8, 8, 7, 6`) and `Best 82.5 × 6`, with `History ›` to the exercise's history. Values from
 * `routines.exerciseRecaps` (logged results only, rule 6); nothing while it reads or with no history.
 */
export function useExerciseRecap(exerciseId: string | null): ExerciseRecap | null {
  const services = useServices();
  const [recap, setRecap] = useState<{ id: string; value: ExerciseRecap | null } | null>(null);
  useEffect(() => {
    if (exerciseId === null) return;
    let live = true;
    void services.routines
      .exerciseRecaps([exerciseId])
      .catch((): Record<string, ExerciseRecap | null> => ({}))
      .then((r) => {
        if (live) setRecap({ id: exerciseId, value: r[exerciseId] ?? null });
      });
    return () => {
      live = false;
    };
  }, [services, exerciseId]);
  return recap !== null && recap.id === exerciseId ? recap.value : null;
}

export function RecapLines({ recap, onHistory }: { recap: ExerciseRecap | null; onHistory?: (() => void) | undefined }) {
  const theme = useTheme();
  if (recap === null) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
      <View accessible accessibilityLabel={recap.accessibilityLabel} style={{ flex: 1, gap: 2 }}>
        <AppText variant="callout" color="text.secondary" numeric>
          {`${recap.lastLabel}  `}
          <AppText variant="callout" numeric>
            {recap.lastText}
          </AppText>
        </AppText>
        {recap.bestText !== null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {'Best  '}
            <AppText variant="callout" numeric>
              {recap.bestText}
            </AppText>
          </AppText>
        ) : null}
      </View>
      {onHistory !== undefined ? <TextButton label="History" icon="chevron.right" tone="secondary" onPress={onHistory} /> : null}
    </View>
  );
}
