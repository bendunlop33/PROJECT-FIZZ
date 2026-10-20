import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { renderActionResult } from '@fizz/coach';
import type { ActionRecord } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import type { WeekCard as WeekCardData } from '../../services/week-services';
import { WEEK_COPY } from '../../services/week-services';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, TextButton } from '../../ui';
import { CardActions, CoachCardFrame } from './CoachCardFrame';

/**
 * (Ben, 20 Oct) The coach's week proposal: the days left before and after,
 * scope `This week`, `Apply`, then `Undo`. Always a proposal (rule 3):
 * nothing changes until Ben taps Apply; a card whose week moved on says so
 * and applies nothing (rule 5). Every value comes from `services.week`.
 */
export function WeekProposalCard({ record, onChanged }: { record: ActionRecord; onChanged: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const [card, setCard] = useState<WeekCardData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const busy = useRef(false);
  // One op ID per card: a double tap on Apply applies once.
  const applyOp = useRef(newUuid());

  useEffect(() => {
    const screen = { alive: true };
    void services.week.card(record.actionId).then((c) => {
      if (screen.alive) setCard(c);
    });
    return () => {
      screen.alive = false;
    };
  }, [record.actionId, tick]);

  if (card === null) return null;
  const state = card.state;
  const row = (r: { name: string; note: string | null }) => (r.note === null ? r.name : `${r.name} (${r.note})`);

  async function run(write: () => Promise<{ ok: boolean; message?: string }>) {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await write();
      setNotice(r.ok ? null : (r.message ?? null));
      setTick((t) => t + 1);
      onChanged();
    } finally {
      busy.current = false;
    }
  }

  return (
    <CoachCardFrame>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <Icon name="calendar" color="text.secondary" size={18} />
        <AppText variant="label" color="text.secondary">
          {card.scope}
        </AppText>
      </View>
      <AppText variant="callout" color="text.secondary">{`Before: ${card.before.map(row).join(', ')}`}</AppText>
      <AppText variant="callout">{`After: ${card.after.map(row).join(', ')}`}</AppText>
      {state.kind === 'stale' || state.kind === 'expired' ? (
        <AppText variant="callout" color="text.secondary">
          {WEEK_COPY.stale}
        </AppText>
      ) : null}
      {notice !== null ? (
        <AppText variant="callout" color="text.secondary">
          {notice}
        </AppText>
      ) : null}
      <CardActions>
        {state.kind === 'open' ? <TextButton label={WEEK_COPY.apply} onPress={() => void run(() => services.week.apply({ actionId: record.actionId, opId: applyOp.current }))} /> : null}
        {state.kind === 'applied' ? <TextButton label={WEEK_COPY.undo} onPress={() => void run(() => services.week.undo({ weekPlanId: state.weekPlanId, expectedVersion: state.version, opId: newUuid() }))} /> : null}
        {state.kind === 'undone' ? (
          <AppText variant="callout" color="text.secondary">
            {WEEK_COPY.undone}
          </AppText>
        ) : null}
      </CardActions>
    </CoachCardFrame>
  );
}

/**
 * (Ben, 20 Oct) An activity the coach offered to log (Ben didn't ask, rule
 * 3): its line and `Log`; once logged, `Logged` with Undo. The fields are
 * exactly the offer's.
 */
export function ActivityOfferCard({ record, onChanged }: { record: ActionRecord; onChanged: () => void }) {
  const services = useServices();
  const [logged, setLogged] = useState<ActionRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    const screen = { alive: true };
    void services.coach.activityOffer(record.actionId).then((s) => {
      if (screen.alive) setLogged(s.kind === 'logged' ? s.record : null);
    });
    return () => {
      screen.alive = false;
    };
  }, [record.actionId, tick]);

  async function act(write: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await write();
      setTick((t) => t + 1);
      onChanged();
    } finally {
      busy.current = false;
    }
  }

  const undone = logged?.undoneBy != null;
  return (
    <CoachCardFrame>
      <AppText variant="callout" numeric>
        {renderActionResult(logged ?? record, 'sheet').text}
      </AppText>
      {notice !== null ? (
        <AppText variant="callout" color="text.secondary">
          {notice}
        </AppText>
      ) : null}
      <CardActions>
        {logged === null ? (
          <TextButton
            label="Log"
            onPress={() =>
              void act(async () => {
                const r = await services.coach.logOfferedActivity(record.actionId);
                setNotice(r.kind === 'refused' ? r.line : null);
              })
            }
          />
        ) : !undone ? (
          <TextButton
            label="Undo"
            onPress={() =>
              void act(async () => {
                await services.coach.undo(logged.actionId, `undo:${logged.actionId}`);
              })
            }
          />
        ) : (
          <AppText variant="callout" color="text.secondary">
            Undone
          </AppText>
        )}
      </CardActions>
    </CoachCardFrame>
  );
}
