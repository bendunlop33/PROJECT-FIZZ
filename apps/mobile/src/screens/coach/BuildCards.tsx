import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { ActionRecord, BuildFocus } from '@fizz/schemas';

import { BUILD_COPY, buildCardView, draftCardView, draftChangeView, pendingBuildView, type BuildDayChip, type DraftCardView, type DraftChangeView } from '../../coach/build-view';
import type { QuestionCardView } from '../../coach/sheet-view';
import { formatTime } from '../../format/dates';
import { toMs } from '@fizz/domain';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, Icon, SecondaryButton, TextButton } from '../../ui';
import { CardActions, CoachCardFrame } from './CoachCardFrame';

/**
 * The workout builder's cards in the coach sheet (workout-builder.md §4.1,
 * §4.2, §5.3; design-system §9.17, §9.20): the Build card (chips, gym line,
 * `Build`), the pending card, the draft card (`Open ›`) and the version card
 * (`Undo`). Every value comes from code and the stored draft; the sheet
 * never opens a screen by itself.
 */

const clock = (utc: string, tz: string): string => formatTime(toMs(utc), tz);

const Frame = CoachCardFrame;

/** `BuildRequestCard` (§4.1): one tap with defaults; `Build` is the card's own secondary button (the sheet's primary is `Send`). */
export function BuildRequestCard({ gymName, defaultMinutes, days, defaultDayId, disabled, onBuild }: { gymName: string | null; defaultMinutes: number | null; days: readonly BuildDayChip[]; defaultDayId: string | null; disabled: boolean; onBuild: (minutes: number | null, chip: BuildDayChip | null) => void }) {
  const theme = useTheme();
  const [minutes, setMinutes] = useState<number | null>(defaultMinutes);
  const [dayId, setDayId] = useState<string | null>(defaultDayId);
  useEffect(() => {
    setDayId(defaultDayId);
  }, [defaultDayId]);
  useEffect(() => {
    setMinutes(defaultMinutes);
  }, [defaultMinutes]);
  const v = buildCardView({ minutes, days, dayId, gymName });
  const chosen = days.find((d) => d.id === dayId) ?? days[0] ?? null;
  return (
    <Frame>
      <AppText variant="headline">{v.title}</AppText>
      <AppText variant="sectionLabel" color="text.secondary">
        {BUILD_COPY.length}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
        {v.lengths.map((l) => (
          <Chip key={l.minutes} onSurface label={l.label} selected={l.selected} accessibilityLabel={l.accessibilityLabel} onPress={() => { setMinutes(l.minutes); }} />
        ))}
      </View>
      <AppText variant="sectionLabel" color="text.secondary">
        {BUILD_COPY.focus}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
        {v.focuses.map((f) => (
          <Chip key={f.id} onSurface label={f.label} selected={f.selected} accessibilityLabel={f.accessibilityLabel} onPress={() => { setDayId(f.id); }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
        <Icon name={v.gym.warning ? 'exclamationmark.triangle' : 'house'} size={16} color={v.gym.warning ? 'status.warning' : 'text.secondary'} />
        <AppText variant="callout" color="text.secondary">
          {v.gym.text.replace(/^(?:⌂|⚠) /, '')}
        </AppText>
      </View>
      <SecondaryButton label={BUILD_COPY.build} accessibilityLabel={v.buildLabel} disabled={disabled} onPress={() => { onBuild(minutes, chosen); }} />
    </Frame>
  );
}

/** The pending card (§4.2): static icon, `Building Push · 45 min`, elapsed `m:ss`, `Cancel`. No spinner loop. */
export function PendingBuildCard({ focus, dayName, minutes, startedAtMs, nowMs, onCancel }: { focus: BuildFocus; dayName: string | null; minutes: number; startedAtMs: number; nowMs: number; onCancel: () => void }) {
  const theme = useTheme();
  const v = pendingBuildView({ focus, dayName, minutes, elapsedMs: nowMs - startedAtMs });
  return (
    <Frame>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <Icon name="ellipsis" size={16} color="text.secondary" />
        <AppText variant="callout" style={{ flex: 1 }}>
          {v.title}
        </AppText>
        <AppText variant="callout" numeric color="text.secondary">
          {v.elapsed}
        </AppText>
        <TextButton label={BUILD_COPY.cancel} tone="secondary" onPress={onCancel} />
      </View>
    </Frame>
  );
}

/**
 * `WorkoutDraftCard` (§4.2) for one version, read from the stored draft and
 * the overview's own estimate; `Open ›` while it can open, else its end
 * state. A newer version shows the `DraftChangeCard` (§5.3) too.
 */
export function WorkoutDraftCard({ record, gymId, onOpen, onOpenRoutine, onChanged }: { record: ActionRecord; gymId: string | null; onOpen: (draftId: string) => void; onOpenRoutine: (routineId: string) => void; onChanged: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const d = record.detail.kind === 'build_workout' ? record.detail : null;
  const [card, setCard] = useState<DraftCardView | null>(null);
  const [change, setChange] = useState<DraftChangeView | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (d === null) return;
    const screen = { alive: true };
    const alive = (): boolean => screen.alive;
    void (async () => {
      const now = await services.coachDrafts.card({ draftId: d.draftId, versionN: d.versionN, gymId });
      const before = d.parentN === null ? null : await services.coachDrafts.card({ draftId: d.draftId, versionN: d.parentN, gymId });
      if (!alive() || now === null) return;
      setCard(draftCardView(now, clock));
      setRationale(now.rationale);
      setChange(draftChangeView(record, { before: before?.estimateMinutes ?? null, after: now.estimateMinutes }, now.state));
    })();
    return () => {
      screen.alive = false;
    };
  }, [record.actionId, gymId, tick]);
  if (d === null || card === null) return null;

  async function undo() {
    if (d === null) return;
    const draft = await services.coachDrafts.get(d.draftId);
    if (draft === null) return;
    await services.coachDrafts.undoVersion({ draftId: d.draftId, versionN: d.versionN, expectedVersion: draft.version, opId: `undo-version:${record.actionId}` });
    onChanged();
    setTick((t) => t + 1);
  }

  return (
    <View style={{ gap: theme.space['2'] }}>
      {change !== null ? (
        <Frame>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <AppText variant="label" color="text.secondary">
              Coach
            </AppText>
            <AppText variant="headline" style={{ flex: 1 }}>
              {change.title}
            </AppText>
          </View>
          {change.minutes !== null ? (
            <AppText variant="callout" numeric color="text.secondary">
              {change.minutes}
            </AppText>
          ) : null}
          {change.lines.map((l) => (
            <View key={l.text} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
              <Icon name={l.icon} size={16} color="text.secondary" />
              <AppText variant="callout">{l.text}</AppText>
            </View>
          ))}
          {/* One order on every card (design pass 4.7): Why? left, Undo right. */}
          <CardActions>
            <TextButton label={BUILD_COPY.why} tone="secondary" onPress={() => { setWhy((w) => !w); }} />
            {change.canUndo ? <TextButton label={BUILD_COPY.undo} onPress={() => void undo()} /> : null}
          </CardActions>
          {why ? record.guardNotes.map((n) => <AppText key={n.text} variant="callout" color="text.secondary">{n.text}</AppText>) : null}
        </Frame>
      ) : null}
      <Frame label={card.accessibilityLabel}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            Coach
          </AppText>
          <AppText variant="headline" style={{ flex: 1 }}>
            {card.title}
          </AppText>
        </View>
        <AppText variant="callout" numeric color="text.secondary">
          {card.line}
        </AppText>
        {card.leftOut !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
            <Icon name="exclamationmark.triangle" size={16} color="status.warning" />
            <AppText variant="callout">{card.leftOut.replace('⚠ ', '')}</AppText>
          </View>
        ) : null}
        <View style={{ alignItems: 'flex-end' }}>
          {card.open ? (
            <SecondaryButton label={BUILD_COPY.open} onPress={() => { onOpen(d.draftId); }} />
          ) : card.routineId !== null ? (
            <Pressable accessibilityRole="button" onPress={() => { onOpenRoutine(card.routineId ?? ''); }} style={{ minHeight: 44, justifyContent: 'center' }}>
              <AppText variant="callout">{card.endText}</AppText>
            </Pressable>
          ) : (
            <AppText variant="callout" color="text.secondary">
              {card.endText}
            </AppText>
          )}
        </View>
      </Frame>
      {rationale !== null && change === null ? (
        <AppText variant="body">{rationale}</AppText>
      ) : null}
    </View>
  );
}

/**
 * `BuildQuestionCard` (workout-builder v2.1 §4.2): the coach's one question,
 * 2–4 tap answers (catalogue names for a main lift) and `Skip`. Typing in
 * the sheet's field answers it too. After Ben's reply it collapses to one
 * line; `Saved to Profile · Undo` only when a tapped main lift was saved for
 * a split day he hadn't set. No question count.
 */
export function BuildQuestionCard({
  view,
  disabled,
  saved,
  onAnswer,
  onSkip,
  onUndoSave,
  disabledReason = null,
}: {
  view: QuestionCardView;
  disabled: boolean;
  /** Why the answers are dimmed when it's the coach that can't answer (`Needs the coach`, WB-Q9); null while only busy. */
  disabledReason?: string | null;
  /** `Saved to Profile` with Undo, `Not undone · changed in Profile`, or nothing. */
  saved: { text: string; canUndo: boolean } | null;
  onAnswer: (answer: { label: string; catalogueId: string | null }) => void;
  onSkip: () => void;
  onUndoSave: () => void;
}) {
  const theme = useTheme();
  const [tappedDisabled, setTappedDisabled] = useState(false);
  const showReason = (): void => {
    setTappedDisabled(true);
  };
  if (view.state !== 'open') {
    return (
      <Frame label={`Coach question. ${view.collapsed ?? view.question}`}>
        <AppText variant="callout" color="text.secondary">
          {view.state === 'not_answered' ? `${view.question} · ${view.collapsed ?? ''}` : (view.collapsed ?? view.question)}
        </AppText>
        {saved !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <AppText variant="callout" color="text.secondary">
              {saved.text}
            </AppText>
            {saved.canUndo ? <TextButton label={BUILD_COPY.undo} onPress={onUndoSave} /> : null}
          </View>
        ) : null}
      </Frame>
    );
  }
  return (
    <Frame>
      <View accessible accessibilityLabel={`Coach question: ${view.question}`}>
        <AppText variant="headline">{view.question}</AppText>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
        {view.answers.map((a) => (
          <Chip key={a.catalogueId ?? a.label} onSurface disabled={disabled} onDisabledPress={showReason} label={a.label} selected={false} onPress={() => { onAnswer(a); }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
        <TextButton label={QUESTION_COPY.skip} disabled={disabled} onPress={onSkip} />
      </View>
      {disabled && tappedDisabled && disabledReason !== null ? (
        <AppText variant="callout" color="text.secondary">
          {disabledReason}
        </AppText>
      ) : null}
    </Frame>
  );
}

export const QUESTION_COPY = {
  skip: 'Skip',
  saved: 'Saved to Profile',
  notUndone: 'Not undone · changed in Profile',
} as const;
