import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { ActionRecord } from '@fizz/schemas';

import { PLAN_COPY, planCardView, planDayView, type PlanCardView, type PlanDayView } from '../../coach/plan-view';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, SecondaryButton, TextButton } from '../../ui';
import { CardActions, CoachCardFrame } from './CoachCardFrame';

/**
 * The coach plan card (Ben, 19 Oct): one card with every day; tap a day to
 * see its exercises, sets and loads (after Apply, `Edit` opens that
 * workout); `Apply` asks `Replace my workouts` or `Add alongside`; `Undo`
 * after. Every value comes from the stored plan through `services.plans`;
 * the card computes nothing. A proposal (rule 3): nothing changes until
 * Ben taps Apply.
 */
export function PlanCard({ record, onOpenRoutine, onChanged }: { record: ActionRecord; onOpenRoutine: (routineId: string) => void; onChanged: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const d = record.detail.kind === 'build_plan' ? record.detail : null;
  const [card, setCard] = useState<PlanCardView | null>(null);
  const [planVersion, setPlanVersion] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [day, setDay] = useState<PlanDayView | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (d === null) return;
    const screen = { alive: true };
    void (async () => {
      const c = await services.plans.card({ planId: d.planId, versionN: d.versionN });
      if (!screen.alive || c === null) return;
      setCard(planCardView(c));
      setPlanVersion(c.planVersion);
    })();
    return () => {
      screen.alive = false;
    };
  }, [record.actionId, tick]);

  useEffect(() => {
    if (d === null || open === null) {
      setDay(null);
      return;
    }
    const screen = { alive: true };
    void (async () => {
      const v = await services.plans.day({ planId: d.planId, versionN: d.versionN, dayIndex: open });
      if (screen.alive) setDay(v === null ? null : planDayView(v));
    })();
    return () => {
      screen.alive = false;
    };
  }, [open, tick]);

  if (d === null || card === null) return null;

  async function apply(mode: 'replace' | 'add') {
    if (d === null || planVersion === null) return;
    setBusy(true);
    const r = await services.plans.apply({ planId: d.planId, versionN: d.versionN, expectedVersion: planVersion, mode, opId: `plan-apply:${d.planId}:${String(planVersion)}:${mode}` });
    setBusy(false);
    setChoosing(false);
    setNotice(r.ok ? null : r.message);
    setTick((t) => t + 1);
    onChanged();
  }

  /** `Use again` on an ended plan (review planview S4): the plan in use again, its days back in their places. */
  async function resume() {
    if (d === null || planVersion === null) return;
    setBusy(true);
    const r = await services.plans.resume({ planId: d.planId, expectedVersion: planVersion, opId: `plan-resume:${d.planId}:${String(planVersion)}` });
    setBusy(false);
    setNotice(r.ok ? null : r.message);
    setTick((t) => t + 1);
    onChanged();
  }

  async function undo() {
    if (d === null || planVersion === null) return;
    setBusy(true);
    const r = await services.plans.undo({ planId: d.planId, expectedVersion: planVersion, opId: `plan-undo:${d.planId}:${String(planVersion)}` });
    setBusy(false);
    setNotice(r.ok ? null : r.message);
    setTick((t) => t + 1);
    onChanged();
  }

  return (
    <View style={{ gap: theme.space['2'] }}>
      <CoachCardFrame>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            Coach
          </AppText>
          <AppText variant="headline" style={{ flex: 1 }}>
            {card.title}
          </AppText>
        </View>
        <AppText variant="callout" color="text.secondary">
          {card.subtitle}
        </AppText>
        {card.days.map((x) => (
          <View key={x.index} style={{ gap: theme.space['1'] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={x.accessibilityLabel}
              accessibilityState={{ expanded: open === x.index }}
              onPress={() => {
                setOpen((o) => (o === x.index ? null : x.index));
              }}
              style={{ minHeight: theme.target.min.height, paddingVertical: theme.space['2'], flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}
            >
              <View style={{ flex: 1 }}>
                <AppText variant="body">{x.name}</AppText>
                <AppText variant="callout" color="text.secondary" numeric>
                  {x.line}
                </AppText>
              </View>
              {x.leftOut !== null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
                  <Icon name="exclamationmark.triangle" size={14} color="status.warning" />
                  <AppText variant="callout">{x.leftOut}</AppText>
                </View>
              ) : null}
              <Icon name={open === x.index ? 'chevron.up' : 'chevron.down'} size={14} color="text.tertiary" />
            </Pressable>
            {open === x.index && day !== null ? (
              <View style={{ gap: theme.space['1'], paddingLeft: theme.space['2'] }}>
                {day.rows.map((r) => (
                  // Design pass 4.9: two lines (name / `3 × 8–10 · 100 kg`), so the values line up on the left edge.
                  <View key={r.key} accessible accessibilityLabel={r.accessibilityLabel}>
                    <AppText variant="callout">{r.name}</AppText>
                    <AppText variant="callout" numeric color="text.secondary">
                      {[r.scheme, r.load, ...r.marks].filter((x) => x !== '').join(' · ')}
                    </AppText>
                  </View>
                ))}
                {day.routineId !== null ? (
                  <View style={{ alignItems: 'flex-start' }}>
                    <TextButton
                      label={PLAN_COPY.edit}
                      onPress={() => {
                        if (day.routineId !== null) onOpenRoutine(day.routineId);
                      }}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ))}
        {notice !== null ? (
          <AppText variant="callout" color="text.secondary">
            {notice}
          </AppText>
        ) : null}
        {choosing ? (
          <View style={{ gap: theme.space['2'] }}>
            <SecondaryButton label={PLAN_COPY.replace} disabled={busy} {...(card.replaces === null ? {} : { accessibilityHint: card.replaces })} onPress={() => void apply('replace')} />
            {card.replaces !== null ? (
              <AppText variant="callout" color="text.secondary">
                {card.replaces}
              </AppText>
            ) : null}
            <SecondaryButton label={PLAN_COPY.add} disabled={busy} onPress={() => void apply('add')} />
            <View style={{ alignItems: 'flex-end' }}>
              <TextButton
                label={PLAN_COPY.cancel}
                tone="secondary"
                onPress={() => {
                  setChoosing(false);
                }}
              />
            </View>
          </View>
        ) : (
          <CardActions>
            <TextButton
              label={PLAN_COPY.why}
              tone="secondary"
              onPress={() => {
                setWhy((w) => !w);
              }}
            />
            {card.action.kind === 'apply' ? (
              <SecondaryButton
                label={PLAN_COPY.apply}
                disabled={busy}
                onPress={() => {
                  setChoosing(true);
                }}
              />
            ) : card.action.kind === 'undo' || card.action.kind === 'resume' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'] }}>
                <AppText variant="callout" color="text.secondary">
                  {card.action.text}
                </AppText>
                {card.action.kind === 'undo' ? <TextButton label={PLAN_COPY.undo} disabled={busy} onPress={() => void undo()} /> : <TextButton label={PLAN_COPY.useAgain} disabled={busy} onPress={() => void resume()} />}
              </View>
            ) : (
              <AppText variant="callout" color="text.secondary">
                {card.action.text}
              </AppText>
            )}
          </CardActions>
        )}
        {why ? record.guardNotes.map((n) => <AppText key={n.text} variant="callout" color="text.secondary">{n.text}</AppText>) : null}
      </CoachCardFrame>
      {card.rationale !== null ? <AppText variant="body">{card.rationale}</AppText> : null}
    </View>
  );
}
