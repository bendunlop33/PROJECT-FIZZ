import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { ActionRecord } from '@fizz/schemas';

import { planChangeLines } from '../../coach/sheet-view';
import { PLAN_CHANGE_COPY, type PlanChangeCardState } from '../../services/plan-change-service';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, TextButton } from '../../ui';
import { CardActions, CoachCardFrame } from './CoachCardFrame';

/**
 * (Ben, 2 Nov) A plan-level change the coach proposed (a lighter week, days a week, length, Set/Any days, End): the
 * plan, then each before → after line. `Skip` · `Apply` (rule 3: a proposal), then `Undo`. Apply and Undo are the plan's
 * own writes (the plan builder's `Apply changes`, or End), op IDs from the record. Every value is from the record.
 */
export function PlanChangeCard({ record, onChanged }: { record: ActionRecord; onChanged?: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const [state, setState] = useState<PlanChangeCardState | { kind: 'skipped' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    const screen = { alive: true };
    void services.planChange
      .card(record.actionId)
      .catch((): PlanChangeCardState => ({ kind: 'gone' }))
      .then((s) => {
        if (screen.alive) setState(s);
      });
    return () => {
      screen.alive = false;
    };
  }, [services, record.actionId]);

  const lines = planChangeLines(record);
  if (lines === null || state === null || state.kind === 'gone') return null;

  async function run(write: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await write();
      setState(await services.planChange.card(record.actionId).catch((): PlanChangeCardState => ({ kind: 'gone' })));
      onChanged?.();
    } catch {
      setNotice(PLAN_CHANGE_COPY.failed);
    } finally {
      busy.current = false;
    }
  }

  return (
    <CoachCardFrame>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <Icon name="calendar" color="text.secondary" size={18} />
        <AppText variant="label" color="text.secondary">
          {lines.head}
        </AppText>
      </View>
      {lines.lines.map((l) => (
        <AppText key={l} variant="callout">
          {l}
        </AppText>
      ))}
      {notice !== null ? (
        <AppText variant="callout" color="text.secondary">
          {notice}
        </AppText>
      ) : null}
      <CardActions>
        {state.kind === 'open' ? (
          <>
            <TextButton
              label={PLAN_CHANGE_COPY.skip}
              onPress={() => {
                setState({ kind: 'skipped' });
              }}
            />
            <TextButton
              label={PLAN_CHANGE_COPY.apply}
              onPress={() =>
                void run(async () => {
                  const r = await services.planChange.apply(record.actionId);
                  setNotice(r.ok ? null : r.line);
                })
              }
            />
          </>
        ) : null}
        {state.kind === 'applied' ? (
          <>
            <AppText variant="callout" color="text.secondary">
              {PLAN_CHANGE_COPY.applied}
            </AppText>
            <TextButton
              label={PLAN_CHANGE_COPY.undo}
              onPress={() =>
                void run(async () => {
                  const ok = await services.planChange.undo(record.actionId);
                  setNotice(ok ? null : PLAN_CHANGE_COPY.notUndone);
                })
              }
            />
          </>
        ) : null}
        {state.kind === 'skipped' || state.kind === 'undone' ? (
          <AppText variant="callout" color="text.secondary">
            {state.kind === 'skipped' ? PLAN_CHANGE_COPY.skipped : PLAN_CHANGE_COPY.undone}
          </AppText>
        ) : null}
      </CardActions>
    </CoachCardFrame>
  );
}
