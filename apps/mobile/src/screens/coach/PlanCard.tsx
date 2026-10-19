import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { ActionRecord } from '@fizz/schemas';

import { PLAN_COPY, planCardView, planDayView, type PlanCardView, type PlanDayView } from '../../coach/plan-view';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, SecondaryButton, TextButton } from '../../ui';

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
      <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors['border.control'], padding: theme.space['3'], gap: theme.space['2'] }}>
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
              style={{ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}
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
                  <View key={r.key} accessible accessibilityLabel={r.accessibilityLabel} style={{ flexDirection: 'row', gap: theme.space['2'] }}>
                    <AppText variant="callout" style={{ flex: 1 }}>
                      {r.name}
                    </AppText>
                    <AppText variant="callout" numeric color="text.secondary">
                      {r.scheme}
                    </AppText>
                    <AppText variant="callout" numeric>
                      {[r.load, ...r.marks].join(' · ')}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
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
            ) : card.action.kind === 'undo' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
                <AppText variant="callout" color="text.secondary">
                  {card.action.text}
                </AppText>
                <TextButton label={PLAN_COPY.undo} disabled={busy} onPress={() => void undo()} />
              </View>
            ) : (
              <AppText variant="callout" color="text.secondary">
                {card.action.text}
              </AppText>
            )}
          </View>
        )}
        {why ? record.guardNotes.map((n) => <AppText key={n.text} variant="callout" color="text.secondary">{n.text}</AppText>) : null}
      </View>
      {card.rationale !== null ? <AppText variant="body">{card.rationale}</AppText> : null}
    </View>
  );
}
