import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { PB_EDIT_COPY, PLAN_MUSCLES_COPY } from '@fizz/domain';
import type { ActionRecord } from '@fizz/schemas';

import type { RebalanceCardData, RebalanceCoachState } from '../../services/plan-muscles-service';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, TextButton } from '../../ui';
import { RebalanceBody } from '../library/RebalanceBody';
import { CardActions, CoachCardFrame } from './CoachCardFrame';

/**
 * (Ben, 2 Nov) Plan › Muscles' Rebalance made by the coach: the screen's own body (`RebalanceBody`) from the screen's
 * own service, so the two never disagree. Open: each line can be skipped, `Skip` · `Apply`; then `Undo`. Out of date
 * when the plan moved on since (rule 5). After Apply or Undo the lines are the record's (what the coach proposed).
 */
export function RebalanceCard({ record, onChanged }: { record: ActionRecord; onChanged?: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set());
  const [state, setState] = useState<RebalanceCoachState | { kind: 'skipped' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const d = record.detail.kind === 'propose_rebalance' ? record.detail : null;

  useEffect(() => {
    if (d === null) return;
    const screen = { alive: true };
    void services.planMuscles
      .coachCard(d, record.actionId, rejected)
      .catch((): RebalanceCoachState => ({ kind: 'gone' }))
      .then((s) => {
        if (screen.alive) setState((was) => (was?.kind === 'skipped' ? was : s));
      });
    return () => {
      screen.alive = false;
    };
  }, [services, record.actionId, rejected]);

  if (d === null || state === null || state.kind === 'gone') return null;
  // Not open: the lines as the coach proposed them, read-only.
  const recorded: RebalanceCardData = {
    planId: d.planId,
    planVersion: d.planVersion,
    lines: d.lines.map((l) => ({ ...l, accepted: true })),
    bars: d.bars.map((b) => ({ group: b.group as RebalanceCardData['bars'][number]['group'], text: b.text, before: 0, after: 0, range: null, statusAfter: b.inRange ? 'in' : 'below' })),
    minutes: d.minutes.map((m) => ({ ...m, name: '', before: 0, after: 0, cap: null })),
    why: d.why,
    resolved: d.resolved,
    canApply: false,
    empty: d.lines.length === 0,
  };
  const card = state.kind === 'open' ? state.card : recorded;

  async function run(write: () => Promise<{ ok: boolean; message?: string }>) {
    if (busy.current || d === null) return;
    busy.current = true;
    try {
      const r = await write();
      setNotice(r.ok ? null : (r.message ?? 'Not undone.'));
      setState(await services.planMuscles.coachCard(d, record.actionId, rejected).catch((): RebalanceCoachState => ({ kind: 'gone' })));
      onChanged?.();
    } finally {
      busy.current = false;
    }
  }

  return (
    <CoachCardFrame>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <Icon name="arrow.triangle.2.circlepath" color="text.secondary" size={18} />
        <AppText variant="label" color="text.secondary">
          {PLAN_MUSCLES_COPY.rebalance}
        </AppText>
      </View>
      <RebalanceBody
        card={card}
        onToggle={
          state.kind === 'open'
            ? (id) => {
                setRejected((s) => {
                  const n = new Set(s);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                });
              }
            : null
        }
      />
      {notice !== null ? (
        <AppText variant="callout" color="text.secondary">
          {notice}
        </AppText>
      ) : null}
      <CardActions>
        {state.kind === 'open' ? (
          <>
            <TextButton
              label="Skip"
              onPress={() => {
                setState({ kind: 'skipped' });
              }}
            />
            <TextButton label={PB_EDIT_COPY.apply} disabled={!state.card.canApply} onPress={() => void run(() => services.planMuscles.applyCoach(d, record.actionId, [...rejected]))} />
          </>
        ) : null}
        {state.kind === 'applied' ? (
          <>
            <AppText variant="callout" color="text.secondary">
              {PB_EDIT_COPY.applied}
            </AppText>
            <TextButton label="Undo" onPress={() => void run(() => services.planMuscles.undoCoach(d, record.actionId))} />
          </>
        ) : null}
        {state.kind === 'undone' || state.kind === 'skipped' || state.kind === 'stale' ? (
          <AppText variant="callout" color="text.secondary">
            {state.kind === 'undone' ? PB_EDIT_COPY.undone : state.kind === 'skipped' ? 'Skipped' : 'Out of date. Ask again.'}
          </AppText>
        ) : null}
      </CardActions>
    </CoachCardFrame>
  );
}
