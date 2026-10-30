import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { ActionRecord } from '@fizz/schemas';

import { planSwapLines } from '../../coach/sheet-view';
import { newUuid } from '../../device/runtime';
import { PLAN_SWAP_COPY, type PlanSwapCardState } from '../../services/plan-swap-service';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, TextButton } from '../../ui';
import { CardActions, CoachCardFrame } from './CoachCardFrame';

/**
 * (Ben, 30 Oct, build 486) One exercise swapped in every plan day: `Leg extension → Leg press`, then each day it
 * changes, `Every week`. `Skip` · `Apply` (rule 3: a structural change is a proposal), then `Undo`. `Today too` swaps the
 * live workout's row when none of it is done (its own change, its own Undo). The coach's card in the thread and
 * Settings' Replace show the same card. Every value is from the record.
 */
export function PlanSwapCard({ record, onChanged }: { record: ActionRecord; onChanged?: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const [state, setState] = useState<PlanSwapCardState | { kind: 'skipped'; today: null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const undoOp = useRef(newUuid());

  useEffect(() => {
    const screen = { alive: true };
    void services.planSwap
      .card(record.actionId)
      .catch((): PlanSwapCardState => ({ kind: 'gone' }))
      .then((s) => {
        if (screen.alive) setState(s);
      });
    return () => {
      screen.alive = false;
    };
  }, [services, record.actionId]);

  const lines = planSwapLines(record);
  if (lines === null || state === null || state.kind === 'gone') return null;
  const today = state.today;

  async function run(write: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await write();
      const next = await services.planSwap.card(record.actionId).catch((): PlanSwapCardState => ({ kind: 'gone' }));
      setState((s) => (s?.kind === 'skipped' ? { ...s } : next));
      onChanged?.();
    } catch {
      setNotice(PLAN_SWAP_COPY.failed);
    } finally {
      busy.current = false;
    }
  }

  return (
    <CoachCardFrame>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <Icon name="arrow.triangle.2.circlepath" color="text.secondary" size={18} />
        <AppText variant="label" color="text.secondary">
          Every week
        </AppText>
      </View>
      <AppText variant="callout">{lines.head}</AppText>
      {lines.days.map((l) => (
        <AppText key={l} variant="callout" color="text.secondary">
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
              label={PLAN_SWAP_COPY.skip}
              onPress={() => {
                setState({ kind: 'skipped', today: null });
              }}
            />
            <TextButton
              label={PLAN_SWAP_COPY.apply}
              onPress={() =>
                void run(async () => {
                  const r = await services.planSwap.apply(record.actionId);
                  setNotice(r.ok ? null : r.line);
                })
              }
            />
          </>
        ) : null}
        {state.kind === 'applied' ? (
          <>
            <AppText variant="callout" color="text.secondary">
              {PLAN_SWAP_COPY.applied}
            </AppText>
            <TextButton
              label={PLAN_SWAP_COPY.undo}
              onPress={() =>
                void run(async () => {
                  const ok = await services.planSwap.undo(record.actionId, undoOp.current);
                  setNotice(ok ? null : 'Not undone.');
                })
              }
            />
          </>
        ) : null}
        {state.kind === 'skipped' || state.kind === 'undone' ? (
          <AppText variant="callout" color="text.secondary">
            {state.kind === 'skipped' ? PLAN_SWAP_COPY.skipped : PLAN_SWAP_COPY.undone}
          </AppText>
        ) : null}
        {today === 'open' ? (
          <TextButton
            label={PLAN_SWAP_COPY.todayToo}
            onPress={() =>
              void run(async () => {
                const ok = await services.planSwap.today(record.actionId);
                setNotice(ok ? null : PLAN_SWAP_COPY.stale);
              })
            }
          />
        ) : null}
        {today === 'done' ? (
          <>
            <AppText variant="callout" color="text.secondary">
              {PLAN_SWAP_COPY.todayDone}
            </AppText>
            <TextButton
              label={PLAN_SWAP_COPY.undo}
              onPress={() =>
                void run(async () => {
                  const ok = await services.planSwap.undoToday(record.actionId);
                  setNotice(ok ? null : 'Not undone.');
                })
              }
            />
          </>
        ) : null}
      </CardActions>
    </CoachCardFrame>
  );
}
