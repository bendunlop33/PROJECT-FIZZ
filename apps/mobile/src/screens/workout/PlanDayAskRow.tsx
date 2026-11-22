import { useRef } from 'react';
import { View } from 'react-native';

import { haptic } from '../../device/haptics';
import { newUuid } from '../../device/runtime';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, TextButton } from '../../ui';
import { PLAN_DAY_ASK_COPY } from '../../workout/plan-day-ask';

/**
 * (Ben, 28 Oct) The one-time `Count as Pull?` on an imported or past-logged workout's Summary, when it couldn't be
 * matched to a plan day for sure: `Count` or `Not a plan day`. Ben's answer is one versioned write on the plan (op ID)
 * with Undo in the toast; the workout's sets never change (rule 2). Nothing shows once answered or when there is
 * nothing to ask. Values from the plan service only.
 */
export function PlanDayAskRow({ sessionId, onToast }: { sessionId: string; onToast: (t: { text: string; action?: string; onAction?: () => void } | null) => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const [data, reload] = useScreenData((s) => s.plans.dayLinkAsk(sessionId));
  const busy = useRef(false);
  if (data.state !== 'ready' || data.value === null) return null;
  const ask = data.value;
  const answer = (a: 'count' | 'not_plan_day') => {
    if (busy.current) return;
    busy.current = true;
    haptic('step');
    const opId = newUuid();
    void services.plans
      .answerDayLink({ planId: ask.planId, sessionId, answer: a, routineId: a === 'count' ? ask.routineId : null, expectedVersion: ask.planVersion, opId })
      .then((r) => {
        if (!r.ok) {
          onToast({ text: r.message });
          return;
        }
        onToast({
          text: a === 'count' ? PLAN_DAY_ASK_COPY.counted(ask.dayName) : PLAN_DAY_ASK_COPY.notPlanDay,
          action: PLAN_DAY_ASK_COPY.undo,
          onAction: () => {
            onToast(null);
            void services.plans.undoDayLink({ planId: ask.planId, targetOpId: opId, expectedVersion: r.plan.version, opId: newUuid() }).then((u) => {
              if (!u.ok) onToast({ text: u.message });
              changed();
              reload();
            });
          },
        });
      })
      .finally(() => {
        busy.current = false;
        changed();
        reload();
      });
  };
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="headline">{PLAN_DAY_ASK_COPY.question(ask.dayName)}</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', columnGap: theme.space['4'], rowGap: theme.space['2'] }}>
        <TextButton label={PLAN_DAY_ASK_COPY.no} tone="secondary" onPress={() => { answer('not_plan_day'); }} />
        <TextButton label={PLAN_DAY_ASK_COPY.yes} accessibilityLabel={`${PLAN_DAY_ASK_COPY.yes} as ${ask.dayName}`} onPress={() => { answer('count'); }} />
      </View>
    </View>
  );
}
