import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { REVIEW_COPY, type GoalSection, type ReviewCardView, type ReviewProposalView } from '@fizz/domain';

import { haptic } from '../device/haptics';
import { newUuid } from '../device/runtime';
import type { LiftChoice, ProposalOutcome, ReviewsData } from './weekly-review-service';
import { useDataChanged, useScreenData, useServices } from '../shell/context';
import { useTheme } from '../theme';
import { AppText, BottomCard, Card, ChecklistRow, Icon, PrimaryButton, SecondaryButton, TextButton } from '../ui';
import { ConsistencyBlock, HistorySpark, LiftTrend, SetsBars } from './charts';

/**
 * Progress › Reviews (workout-builder-v3 §6.2; Ben 20–21 Oct; the approved `progress-reviews.html` look):
 * the Latest weekly review (verdict, 3–5 facts, open proposals with Apply / Skip), the Goal view
 * (consistency first, then sets per muscle and the lifts Ben chose, in the order his training goal sets),
 * and past weeks with sparklines. Lays out the service's view models; computes nothing. Local data only:
 * identical offline, where the verdict reads `Not reviewed · Offline` (rule 1).
 */

function Label({ text, right }: { text: string; right?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: theme.space['2'] }}>
      <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
        {text.toUpperCase()}
      </AppText>
      {right}
    </View>
  );
}

export function ProposalRow({ p, onApply, onSkip, onUndo }: { p: ReviewProposalView; onApply: () => void; onSkip: () => void; onUndo: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, padding: theme.space['3'], gap: theme.space['2'] }} accessible={p.status !== 'open'} {...(p.status !== 'open' ? { accessibilityLabel: p.accessibilityLabel } : {})}>
      <AppText variant="body" numeric>
        {p.text}
      </AppText>
      {p.reason !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {p.reason}
        </AppText>
      ) : null}
      {p.status === 'open' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
          <View style={{ flexGrow: 1 }}>
            <PrimaryButton label={REVIEW_COPY.apply} onPress={onApply} accessibilityHint={p.text} />
          </View>
          <View style={{ flexGrow: 1 }}>
            <SecondaryButton label={REVIEW_COPY.skip} onPress={onSkip} accessibilityLabel={`${REVIEW_COPY.skip}: ${p.text}`} grow />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space['2'] }}>
          <AppText variant="callout" color="text.secondary">
            {p.statusText}
          </AppText>
          {p.canUndo ? <TextButton label={REVIEW_COPY.undo} onPress={onUndo} accessibilityLabel={`${REVIEW_COPY.undo}: ${p.text}`} /> : null}
        </View>
      )}
    </View>
  );
}

/** The proposal taps (Ben's, rule 3): one op ID per tap, so a double tap writes once. */
export function useProposalActions(reviewId: string | null, after: () => void) {
  const services = useServices();
  const changed = useDataChanged();
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);
  const run = (fn: () => Promise<ProposalOutcome>) => {
    if (busy.current || reviewId === null) return;
    busy.current = true;
    haptic('step');
    void fn()
      .then((r) => {
        setMessage(r.ok ? null : r.message);
        changed();
        after();
      })
      .finally(() => {
        busy.current = false;
      });
  };
  return {
    message,
    apply: (p: ReviewProposalView) => {
      run(() => services.reviews.applyProposal({ reviewId: reviewId ?? '', proposalId: p.id, opId: newUuid() }));
    },
    skip: (p: ReviewProposalView) => {
      run(() => services.reviews.skipProposal({ reviewId: reviewId ?? '', proposalId: p.id, opId: newUuid() }));
    },
    undo: (p: ReviewProposalView) => {
      run(() => services.reviews.undoProposal({ reviewId: reviewId ?? '', proposalId: p.id, opId: newUuid() }));
    },
  };
}

export function ReviewCard({ card, onReload }: { card: ReviewCardView; onReload: () => void }) {
  const theme = useTheme();
  const actions = useProposalActions(card.reviewId, onReload);
  return (
    <Card>
      <View accessible accessibilityLabel={card.accessibilityLabel} style={{ gap: theme.space['2'] }}>
        <AppText variant="label" color="text.secondary" numeric>
          {card.week}
        </AppText>
        <AppText variant="headline" color={card.reviewed ? 'text.primary' : 'text.secondary'}>
          {card.verdict}
        </AppText>
        {card.lines.map((l) => (
          <AppText key={l} variant="callout" numeric>
            {l}
          </AppText>
        ))}
        {card.facts.map((f) => (
          <AppText key={f} variant="callout" color="text.secondary" numeric>
            {f}
          </AppText>
        ))}
      </View>
      {card.proposals.map((p) => (
        <ProposalRow
          key={p.id}
          p={p}
          onApply={() => {
            actions.apply(p);
          }}
          onSkip={() => {
            actions.skip(p);
          }}
          onUndo={() => {
            actions.undo(p);
          }}
        />
      ))}
      {actions.message !== null ? (
        <AppText variant="callout" color="text.secondary" accessibilityLiveRegion="polite">
          {actions.message}
        </AppText>
      ) : null}
    </Card>
  );
}

function GoalSectionView({ section, onEditLifts }: { section: GoalSection; onEditLifts: (() => void) | null }) {
  const theme = useTheme();
  switch (section.kind) {
    case 'consistency':
      return <ConsistencyBlock view={section.view} />;
    case 'sets':
      return <SetsBars view={section.view} />;
    case 'lifts':
      return (
        <View style={{ gap: theme.space['4'] }}>
          <Label text={REVIEW_COPY.lifts} right={onEditLifts === null ? null : <TextButton label={REVIEW_COPY.editLifts} onPress={onEditLifts} accessibilityLabel={`${REVIEW_COPY.liftsShown}: ${REVIEW_COPY.editLifts}`} />} />
          {section.empty !== null ? (
            <AppText variant="callout" color="text.secondary">
              {section.empty}
            </AppText>
          ) : null}
          {section.charts.map((c) => (
            <LiftTrend key={c.exerciseId} chart={c} />
          ))}
        </View>
      );
  }
}

/** `Lifts shown`: any exercise Ben logs, up to 6; none ticked goes back to the plan's main lifts. */
export function LiftsShownSheet({ visible, onClose, version, onSaved }: { visible: boolean; onClose: () => void; version: number | null; onSaved: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const [choices, setChoices] = useState<LiftChoice[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const opId = useRef(newUuid());
  useEffect(() => {
    if (!visible) return;
    opId.current = newUuid();
    let alive = true;
    void services.reviews.liftChoices().then((c) => {
      if (!alive) return;
      setChoices(c);
      setPicked(c.filter((x) => x.shown).map((x) => x.exerciseId));
    });
    return () => {
      alive = false;
    };
  }, [visible, services]);
  const full = picked.length >= 6;
  const save = () => {
    if (version === null) return;
    void services.training.change({ kind: 'progress_lifts', exerciseIds: picked }, version, opId.current).then((r) => {
      if (r.ok) {
        onSaved();
        onClose();
      } else setError(r.reason === 'stale' ? REVIEW_COPY.outOfDate : 'Couldn’t save');
    });
  };
  return (
    <BottomCard visible={visible} onClose={onClose} footer={<PrimaryButton label="Done" onPress={save} disabled={version === null} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="title2" accessibilityRole="header">
          {REVIEW_COPY.liftsShown}
        </AppText>
        <AppText variant="callout" color="text.secondary" numeric>
          {`${String(picked.length)} of 6`}
        </AppText>
      </View>
      {full ? (
        <AppText variant="callout" color="text.secondary">
          {REVIEW_COPY.maxLifts}
        </AppText>
      ) : null}
      {error !== null ? (
        <AppText variant="callout" color="text.secondary">
          {error}
        </AppText>
      ) : null}
      <View style={{ marginHorizontal: -theme.space['4'] }}>
        {(choices ?? []).map((c) => {
          const on = picked.includes(c.exerciseId);
          return (
            <ChecklistRow
              key={c.exerciseId}
              title={c.name}
              checked={on}
              onToggle={() => {
                setPicked((p) => (on ? p.filter((x) => x !== c.exerciseId) : p.length >= 6 ? p : [...p, c.exerciseId]));
              }}
            />
          );
        })}
      </View>
    </BottomCard>
  );
}

/** The Reviews section at the top of Progress. Nothing at all until there is something to show. */
export function ReviewsSection() {
  const theme = useTheme();
  const navigation = useNavigation();
  const [data, reload] = useScreenData((s) => s.reviews.reviews());
  const [liftsOpen, setLiftsOpen] = useState(false);
  const [allWeeks, setAllWeeks] = useState(false);
  if (data.state !== 'ready' || data.value === null) return null;
  const d: ReviewsData = data.value;
  const goalHasData = d.goal.sections.some((s) => (s.kind === 'consistency' ? s.view.bars.some((b) => b.done > 0 || b.planned !== null) : s.kind === 'lifts' ? s.charts.length > 0 : s.view.rows.length > 0));
  if (d.latest === null && !goalHasData) return null;
  const history = allWeeks ? d.history : d.history.slice(0, 4);
  return (
    <View style={{ gap: theme.space['4'] }}>
      <Label text={REVIEW_COPY.section} />
      {d.latest !== null ? <ReviewCard card={d.latest} onReload={reload} /> : null}

      <Label
        text={REVIEW_COPY.goal}
        right={
          <AppText variant="callout" color="text.secondary">
            {d.goal.goal}
          </AppText>
        }
      />
      <Card>
        <View style={{ gap: theme.space['5'] }}>
          <AppText variant="label" color="text.secondary" numeric>
            {d.weekRange}
          </AppText>
          {d.goal.sections.map((s) => (
            <GoalSectionView
              key={s.kind}
              section={s}
              onEditLifts={
                d.trainingVersion === null
                  ? null
                  : () => {
                      setLiftsOpen(true);
                    }
              }
            />
          ))}
        </View>
      </Card>

      {d.history.length > 0 ? (
        <>
          <Label text={REVIEW_COPY.history} />
          <Card>
            {history.map((h, i) => (
              <Pressable
                key={h.reviewId}
                accessibilityRole="button"
                accessibilityLabel={h.accessibilityLabel}
                onPress={() => {
                  navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressReview', params: { reviewId: h.reviewId } } });
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], minHeight: 56, paddingVertical: theme.space['2'], borderTopWidth: i === 0 ? 0 : theme.dividerWidth, borderColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="body">{h.title}</AppText>
                  <AppText variant="callout" color="text.secondary" numeric>
                    {h.detail}
                  </AppText>
                </View>
                <HistorySpark values={h.spark} />
                <Icon name="chevron.right" size={14} color="text.tertiary" />
              </Pressable>
            ))}
            {!allWeeks && d.history.length > 4 ? (
              <TextButton
                label={`All weeks (${String(d.history.length)})`}
                onPress={() => {
                  setAllWeeks(true);
                }}
              />
            ) : null}
          </Card>
        </>
      ) : null}
      <LiftsShownSheet
        visible={liftsOpen}
        version={d.trainingVersion}
        onClose={() => {
          setLiftsOpen(false);
        }}
        onSaved={reload}
      />
    </View>
  );
}
