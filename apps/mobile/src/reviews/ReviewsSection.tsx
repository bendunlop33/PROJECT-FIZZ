import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { CHANGE_TAP_LABEL, changeRowTaps, PROGRESS_COPY, REVIEW_COPY, type ChangeRowView, type ChangeTap, type CoachChangesView } from '@fizz/domain';

import { haptic } from '../device/haptics';
import { newUuid } from '../device/runtime';
import { useDataChanged, useScreenData, useServices } from '../shell/context';
import { useTheme } from '../theme';
import { AppText, BottomCard, ChecklistRow, PrimaryButton, SecondaryButton } from '../ui';
import { ChangeRow, LiftsCard, MusclesCard, PROGRESS_TEXT, ProgressCard, SectionHead, WeekCard, WeekHead, type WeekMode } from './charts';
import { runChangeTap } from './change-taps';
import type { LiftChoice, ProgressData, ProposalOutcome } from './weekly-review-service';

/**
 * Progress v3 (agreed with Ben 21 Oct; progress-goals.md "Progress v3 (agreed)", prototype
 * `progress-simple.html`): one page for every goal (the goal shapes the coach, not the page). This week →
 * Trends (Lifts, Muscles) → Coach's changes at the bottom. Lays out the service's view models; computes
 * nothing. Local data only: identical offline, where Coach's changes read `Not reviewed · Offline` (rule 1).
 */

/** The change taps (Ben's): one op ID per tap, so a double tap writes once (rule 5). */
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
  // Each button calls its own action (`changeRowTaps`, `runChangeTap`; review v5offers B2).
  const tap = (p: { id: string }, t: ChangeTap) => {
    run(() => runChangeTap(services.reviews, t, { reviewId: reviewId ?? '', proposalId: p.id, opId: newUuid() }));
  };
  return { message, tap };
}

/**
 * An offer, asked: Apply / Skip (rule 3, D2: never applied before Ben says). Answered (applied, undone, skipped, out of
 * date): a change row with its own buttons (Undo, Redo).
 */
export function AskRow({ row, onTap }: { row: ChangeRowView; onTap: (t: ChangeTap) => void }) {
  const theme = useTheme();
  if (row.status !== 'open') return <ChangeRow row={row} first={false} onTap={onTap} />;
  const taps = changeRowTaps(row);
  return (
    <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, gap: 10 }}>
      <AppText variant="headline" numeric style={{ fontSize: 15, lineHeight: 21, fontWeight: '600' }}>
        {`${row.exercise}: ${row.before} → ${row.after}`}
      </AppText>
      <AppText variant="callout" color="text.secondary" numeric style={PROGRESS_TEXT.why}>
        {[row.when, row.why, row.statusText].filter((x): x is string => x !== null).join(' · ')}
      </AppText>
      {taps.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {taps.map((t) =>
            t === 'apply' ? (
              <View key={t} style={{ flexGrow: 1 }}>
                <PrimaryButton
                  label={CHANGE_TAP_LABEL[t]}
                  onPress={() => {
                    onTap(t);
                  }}
                  accessibilityHint={row.accessibilityLabel}
                />
              </View>
            ) : (
              <SecondaryButton
                key={t}
                label={CHANGE_TAP_LABEL[t]}
                onPress={() => {
                  onTap(t);
                }}
                accessibilityLabel={`${CHANGE_TAP_LABEL[t]}: ${row.exercise}`}
              />
            ),
          )}
        </View>
      ) : null}
    </View>
  );
}

/** Coach's changes (bottom): the coach's sentence, the small changes it already made (Undo), offers asked (Apply / Skip); `NEW` until `Got it`. */
export function ChangesSection({ view, hasPast, onReload, onPast }: { view: CoachChangesView; hasPast: boolean; onReload: () => void; onPast: (() => void) | null }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const actions = useProposalActions(view.reviewId, onReload);
  const [expanded, setExpanded] = useState(false);
  const seenOp = useRef(newUuid());
  const gotIt = () => {
    haptic('step');
    setExpanded(false);
    void services.reviews.markSeen({ reviewId: view.reviewId, expectedVersion: view.version, opId: seenOp.current, contentKey: view.contentKey }).then(() => {
      seenOp.current = newUuid();
      changed();
      onReload();
    });
  };
  const head = <SectionHead title={PROGRESS_COPY.changes} right={view.right} badge={view.isNew ? PROGRESS_COPY.new : null} />;
  if (!view.isNew && !expanded) {
    return (
      <>
        {head}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${view.collapsed}. Show`}
          onPress={() => {
            setExpanded(true);
          }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 16, borderRadius: 18, backgroundColor: theme.colors['bg.surface'], opacity: pressed ? 0.7 : 1 })}
        >
          <AppText variant="headline" numeric style={{ fontSize: 15, lineHeight: 20, fontWeight: '600' }}>
            {view.collapsed}
          </AppText>
          <AppText variant="headline" color="text.tertiary">
            ›
          </AppText>
        </Pressable>
      </>
    );
  }
  return (
    <>
      {head}
      <ProgressCard>
        <AppText variant="body" style={PROGRESS_TEXT.note}>
          {view.note ?? ''}
          <AppText variant="callout" color="text.tertiary" style={PROGRESS_TEXT.tag}>
            {view.note === null ? view.tag : `  ${view.tag}`}
          </AppText>
        </AppText>
        {view.rows.length > 0 ? (
          <View>
            {view.rows.map((r, i) => (
              <ChangeRow
                key={r.id}
                row={r}
                first={i === 0}
                onTap={(t) => {
                  actions.tap(r, t);
                }}
              />
            ))}
          </View>
        ) : null}
        {view.asks.map((r) => (
          <AskRow
            key={r.id}
            row={r}
            onTap={(t) => {
              actions.tap(r, t);
            }}
          />
        ))}
        {actions.message !== null ? (
          <AppText variant="callout" color="text.secondary" accessibilityLiveRegion="polite" style={PROGRESS_TEXT.why}>
            {actions.message}
          </AppText>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {hasPast && onPast !== null ? <LinkText label={PROGRESS_COPY.pastWeeks} onPress={onPast} accessibilityLabel="Past weeks" /> : <View />}
          {view.isNew || expanded ? <LinkText label={PROGRESS_COPY.gotIt} onPress={gotIt} /> : null}
        </View>
      </ProgressCard>
    </>
  );
}

function LinkText({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
      <AppText variant="callout" style={{ fontSize: 15, lineHeight: 20, fontWeight: '600', textDecorationLine: 'underline', textDecorationColor: theme.colors['text.tertiary'] }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const REP_CHOICES = [3, 5, 6, 8, 10, 12, 15] as const;

/** `Edit` lifts: any exercise Ben logs, up to 6; adding one that isn't in the plan asks its reps once. */
export function LiftsShownSheet({ visible, onClose, version, onSaved }: { visible: boolean; onClose: () => void; version: number | null; onSaved: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const [choices, setChoices] = useState<LiftChoice[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [reps, setReps] = useState<Record<string, number>>({});
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
      setReps(Object.fromEntries(c.filter((x) => x.needsReps && x.reps !== null).map((x) => [x.exerciseId, x.reps ?? 8])));
    });
    return () => {
      alive = false;
    };
  }, [visible, services]);
  const full = picked.length >= 6;
  const save = () => {
    if (version === null) return;
    const chosenReps = Object.fromEntries(Object.entries(reps).filter(([id]) => picked.includes(id) && choices?.find((c) => c.exerciseId === id)?.needsReps === true));
    void services.training.change({ kind: 'progress_lifts', exerciseIds: picked, reps: chosenReps }, version, opId.current).then((r) => {
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
          {PROGRESS_COPY.lifts}
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
          const n = reps[c.exerciseId] ?? c.reps ?? 8;
          return (
            <View key={c.exerciseId}>
              <ChecklistRow
                title={c.name}
                checked={on}
                onToggle={() => {
                  setPicked((p) => (on ? p.filter((x) => x !== c.exerciseId) : p.length >= 6 ? p : [...p, c.exerciseId]));
                  if (!on && c.needsReps && reps[c.exerciseId] === undefined) setReps((r) => ({ ...r, [c.exerciseId]: n }));
                }}
              />
              {on && c.needsReps ? (
                <View accessibilityRole="radiogroup" accessibilityLabel={`${c.name}: reps to track`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'], paddingHorizontal: theme.space['4'], paddingBottom: theme.space['2'] }}>
                  <AppText variant="callout" color="text.secondary" style={{ alignSelf: 'center' }}>
                    Reps
                  </AppText>
                  {REP_CHOICES.map((k) => {
                    const sel = n === k;
                    return (
                      <Pressable
                        key={k}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: sel }}
                        accessibilityLabel={`${String(k)} reps`}
                        onPress={() => {
                          setReps((r) => ({ ...r, [c.exerciseId]: k }));
                        }}
                        style={{ minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: sel ? 0 : 1.5, borderColor: theme.colors['border.divider'], backgroundColor: sel ? theme.colors.accent : 'transparent' }}
                      >
                        <AppText variant="callout" numeric color={sel ? 'on.accent' : 'text.primary'}>
                          {String(k)}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </BottomCard>
  );
}

/**
 * Progress › Overview (v3): This week (Week | Month), Trends (Lifts, Muscles), Coach's changes. Nothing at all
 * until there is something to show. `onOpenLifts`: the Lifts tab (on one lift's page, or its list);
 * `onOpenTraining`: the Training tab.
 */
export function ReviewsSection({ onOpenLifts, onOpenTraining, active = true }: { onOpenLifts: (exerciseId: string | null) => void; onOpenTraining: () => void; /** Showing now: a hidden Overview doesn't read (Ben, 26 Oct). */ active?: boolean }) {
  const navigation = useNavigation();
  const [data, reload] = useScreenData((s) => s.reviews.progress(), { enabled: active });
  const [liftsOpen, setLiftsOpen] = useState(false);
  const [mode, setMode] = useState<WeekMode>('week');
  if (data.state === 'error') {
    // One honest line when it can't be read, never nothing (review b3-wave3-ux N7).
    return (
      <AppText variant="callout" color="text.secondary">
        Progress couldn’t be read.
      </AppText>
    );
  }
  if (data.state !== 'ready' || data.value === null) return null;
  const d: ProgressData = data.value;
  const showWeek = !d.week.empty;
  const showGoal = !d.lifts.empty || !d.muscles.empty || showWeek;
  if (!showWeek && !showGoal && d.changes === null) return null;
  const openReview = (reviewId: string) => {
    navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressReview', params: { reviewId } } });
  };
  return (
    <View style={{ gap: 14 }}>
      {showWeek ? (
        <>
          <WeekHead
            mode={mode}
            range={d.week.range}
            weeksOnPlan={d.week.month.weeksOnPlan}
            onMode={(m) => {
              haptic('step');
              setMode(m);
            }}
          />
          <WeekCard
            view={d.week}
            mode={mode}
            onOpenSession={(sessionId) => {
              navigation.navigate('Summary', { sessionId, back: true });
            }}
            onOpenReview={openReview}
          />
        </>
      ) : null}
      {showGoal ? (
        <>
          <SectionHead title={PROGRESS_COPY.trends} right={PROGRESS_COPY.last8} />
          <LiftsCard
            view={d.lifts}
            onEdit={() => {
              setLiftsOpen(true);
            }}
            onOpen={onOpenLifts}
          />
          {!d.muscles.empty ? <MusclesCard view={d.muscles} onDetails={onOpenTraining} /> : null}
        </>
      ) : null}
      {d.changes !== null ? (
        <ChangesSection
          view={d.changes}
          hasPast={d.hasPast}
          onReload={reload}
          onPast={() => {
            navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressPastWeeks' } });
          }}
        />
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
