import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { ActionRecord, PlanBuilderAnswers } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { PLAN_SWAP_COPY, type NotPreferredInPlan } from '../../services/plan-swap-service';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { StatusLine, TextButton } from '../../ui';
import { PlanSwapCard } from '../coach/PlanSwapCard';

/**
 * (Ben, 30 Oct, build 486: "my preferences to remove leg extension in setting as non preferred hasn't updated plan")
 * Any preferences on the plan in use: for each exercise the answers on screen mark not preferred that his plan still
 * has, one line `Leg extension · In your plan: Legs A, Legs B` with `Replace`. Replace makes the plan-wide swap
 * proposal (the replacement for the same muscles) and shows its card: Apply / Skip, then Undo. Nothing changes until
 * Apply (rule 2, a structural change is a proposal).
 */
export function NotPreferredInPlanLines({ answers }: { answers: Pick<PlanBuilderAnswers, 'prefs' | 'likes' | 'never'> }) {
  const theme = useTheme();
  const services = useServices();
  const [lines, setLines] = useState<NotPreferredInPlan[]>([]);
  const [card, setCard] = useState<ActionRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // One op per exercise: a double tap on Replace makes one proposal (rule 5).
  const ops = useRef(new Map<string, string>());
  const key = JSON.stringify([answers.prefs, answers.likes, answers.never]);

  useEffect(() => {
    const screen = { alive: true };
    void services.planSwap
      .inPlan(answers)
      .catch((): NotPreferredInPlan[] => [])
      .then((l) => {
        if (screen.alive) setLines(l);
      });
    return () => {
      screen.alive = false;
    };
    // `answers` is read through `key` (its preference parts), so other answers changing don't re-read.
  }, [services, key, tick]);

  async function replace(l: NotPreferredInPlan) {
    if (l.replacement === null) return;
    const opId = ops.current.get(l.key) ?? newUuid();
    ops.current.set(l.key, opId);
    const r = await services.planSwap.replace({ key: l.key, replacementKey: l.replacement.key, opId }).catch(() => ({ ok: false as const, line: PLAN_SWAP_COPY.failed }));
    if (!r.ok) {
      setNotice(r.line);
      return;
    }
    setNotice(null);
    setCard(await services.planSwap.record(r.actionId).catch(() => null));
  }

  if (lines.length === 0 && card === null && notice === null) return null;
  return (
    <View style={{ gap: theme.space['2'] }}>
      {lines.map((l) => (
        <StatusLine
          key={l.key}
          icon="info.circle"
          tone="info"
          text={`${l.name} · ${PLAN_SWAP_COPY.inPlan(l.days)}`}
          {...(l.replacement === null ? {} : { action: <TextButton label={PLAN_SWAP_COPY.replace} onPress={() => void replace(l)} /> })}
        />
      ))}
      {notice !== null ? <StatusLine icon="info.circle" tone="info" text={notice} /> : null}
      {card !== null ? (
        <PlanSwapCard
          record={card}
          onChanged={() => {
            setTick((t) => t + 1);
          }}
        />
      ) : null}
    </View>
  );
}
