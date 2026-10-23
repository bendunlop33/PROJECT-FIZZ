import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import type { BuilderEditOp, RestKind } from '@fizz/domain';

import type { BuilderSnapshot, BuilderWriteResult } from '../../builder/builder-service';
import { popupView, REST_STEP_S, WORKOUT_COPY } from '../../builder/builder-view';
import { countText, reviewHeaderWord, type BuilderReview } from '../../builder/review';
import type { ProposalCardView } from '../../coach/builder-coach-view';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Eyebrow, Icon, PrimaryButton, SecondaryButton, StatusLine, TextButton } from '../../ui';
import { ExercisePopup } from '../../ui/exercise-popup';

/**
 * The builder's sheets (workout-builder-v3 §2.4, §2.5, §2.7, §2.9).
 * Each one shows values from the service and sends Ben's edits back to it;
 * none works out a load, a rest default or a count itself.
 */

const REST_KINDS: readonly (RestKind | 'round')[] = ['warmup', 'top', 'backoff', 'working', 'drop', 'before_drop', 'round'];
const restKindOf = (k: string): RestKind | 'round' | null => REST_KINDS.find((x) => x === k) ?? null;

/**
 * The exercise pop-up (§2.4) on Your workout: the shared `ExercisePopup` (the
 * active workout uses the same one, workout-table-v3 §7) over this slot's
 * `popupView`; every edit goes to the builder service as one `BuilderEditOp`.
 */
export function ExerciseSheet({
  snap,
  slotKey,
  onEdit,
  onSwap,
  onDelete,
  onClose,
  why,
  kgStep,
  onHowTo,
  onHistory,
  toast,
}: {
  snap: BuilderSnapshot;
  slotKey: string | null;
  /** An edit, or one worked out from the snapshot when it runs (edits run one at a time, review S4). */
  onEdit: (op: BuilderEditOp | ((now: BuilderSnapshot) => BuilderEditOp | null)) => Promise<BuilderWriteResult | null>;
  onSwap: () => void;
  onDelete: () => void;
  onClose: () => void;
  why: (slotKey: string) => Promise<string[]>;
  /** The next weight this gym can load for the item, up or down (§2.7). */
  kgStep: (slotKey: string, value: number | null, dir: 1 | -1) => Promise<number | null>;
  /** (22 Oct) `How to` / `History` for this slot; absent: no link. */
  onHowTo?: (() => void) | undefined;
  onHistory?: (() => void) | undefined;
  toast?: ReactNode;
}) {
  const view = slotKey === null ? null : popupView(snap, slotKey, (k) => snap.rests[slotKey]?.[k] ?? 0);
  const refusal = (r: BuilderWriteResult | null): string | null => (r?.status === 'refused' ? r.message : null);
  const send = async (op: BuilderEditOp | ((now: BuilderSnapshot) => BuilderEditOp | null)): Promise<string | null> => refusal(await onEdit(op));
  return (
    <ExercisePopup
      view={view}
      resetKey={slotKey}
      onEditCell={(row, field, value) =>
        slotKey === null ? Promise.resolve(null) : send({ kind: 'edit_row', slotKey, index: row.index, patch: field === 'reps' ? { kind: 'reps', reps: value } : field === 'rpe' ? { kind: 'rpe', rpe: value } : { kind: 'load', value } })
      }
      onType={(row, type) => (slotKey === null ? Promise.resolve(null) : send({ kind: 'set_type', slotKey, index: row.index, type }))}
      onDeleteRow={(row) => {
        if (slotKey !== null) void onEdit({ kind: 'delete_set', slotKey, index: row.index });
      }}
      onAddWarmup={() => (slotKey === null ? Promise.resolve(null) : send({ kind: 'add_warmup', slotKey }))}
      onAddSet={() => {
        if (slotKey !== null) void onEdit({ kind: 'add_set', slotKey });
      }}
      onRestStep={(x, d) => {
        const kind = restKindOf(x.kind);
        if (slotKey === null || kind === null) return;
        void onEdit((now) => {
          // From the rest as it is when this step runs, so quick taps add up (review S4).
          const cur = now.rests[slotKey]?.[kind] ?? x.seconds;
          return { kind: 'rest', slotKey, restKind: kind, seconds: cur + d * REST_STEP_S };
        });
      }}
      onMove={(dir) => {
        if (slotKey !== null) void onEdit({ kind: 'move', slotKey, dir });
      }}
      onSupersetNext={() => {
        if (slotKey !== null) void onEdit({ kind: 'superset_next', slotKey });
      }}
      onUnlink={() => {
        if (slotKey !== null) void onEdit({ kind: 'unlink', slotKey });
      }}
      onSwap={onSwap}
      onDelete={onDelete}
      onClose={onClose}
      why={() => (slotKey === null ? Promise.resolve([]) : why(slotKey))}
      kgStep={(_row, value, dir) => (slotKey === null ? Promise.resolve(null) : kgStep(slotKey, value, dir))}
      onHowTo={onHowTo}
      onHistory={onHistory}
      toast={toast}
    />
  );
}

export type { ChoiceSection } from '../../ui/swap-sheet-model';
export { SwapSheet } from '../../ui/swap-sheet';

/** Coach review (§2.9): code's counts and mix always; the coach's verdict, suggestions and notes only when it reviewed. */
export function ReviewSheet({ review, visible, onApply, onDone, onClose }: { review: BuilderReview | null; visible: boolean; onApply: (actionId: string) => void; onDone: (ticked: string[]) => void; onClose: () => void }) {
  const theme = useTheme();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [whyOpen, setWhyOpen] = useState(false);
  useEffect(() => {
    setTicked(new Set((review?.nextNotes ?? []).filter((n) => n.ticked).map((n) => n.id)));
    setWhyOpen(false);
  }, [review]);
  const done = () => {
    onDone([...ticked]);
  };
  return (
    <BottomCard visible={visible} onClose={done} footer={<PrimaryButton label={WORKOUT_COPY.done} onPress={done} />}>
      {review === null ? null : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText variant="title2" accessibilityRole="header">
              {WORKOUT_COPY.review}
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
              <AppText variant="label" color="text.secondary" accessibilityLiveRegion="polite">
                {reviewHeaderWord(review.status)}
              </AppText>
              {review.whyNot != null && !whyOpen ? <TextButton label={WORKOUT_COPY.why} tone="secondary" onPress={() => { setWhyOpen(true); }} /> : null}
            </View>
          </View>
          {review.whyNot != null && whyOpen ? (
            <AppText variant="label" color="text.secondary">
              {review.whyNot}
            </AppText>
          ) : null}
          {review.verdict !== null ? <AppText variant="headline">{review.verdict}</AppText> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            {review.counts.map((c) => (
              <View key={c.group} style={{ paddingHorizontal: theme.space['2'], paddingVertical: theme.space['1'], borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.raised'] }}>
                <AppText variant="label" color={c.trained ? 'text.primary' : 'text.tertiary'} numeric>
                  {countText(c)}
                </AppText>
              </View>
            ))}
          </View>
          {review.variety !== null ? (
            <AppText variant="label" color="text.secondary" numeric>
              {review.variety}
            </AppText>
          ) : null}
          {review.plan !== null ? (
            <View style={{ gap: theme.space['1'] }}>
              <Eyebrow>{review.plan.title}</Eyebrow>
              {review.plan.lines.map((l) => (
                <AppText key={l.text} variant="callout" numeric>{`${l.ok ? '✓' : '!'} ${l.text}`}</AppText>
              ))}
              {review.plan.actions.map((a) => (
                <ReviewActionRow key={a.id} text={a.text} reason={a.reason} apply={a.apply} outOfDate={a.outOfDate === true} onApply={() => { onApply(a.id); }} />
              ))}
            </View>
          ) : null}
          {review.suggestions.length > 0 ? (
            <View style={{ gap: theme.space['1'] }}>
              <Eyebrow>Suggested</Eyebrow>
              {review.suggestions.map((a) => (
                <ReviewActionRow key={a.id} text={a.text} reason={a.reason} apply={a.apply} outOfDate={a.outOfDate === true} onApply={() => { onApply(a.id); }} />
              ))}
            </View>
          ) : null}
          {review.nextNotes.length > 0 && review.nextNotesTitle !== null ? (
            <View style={{ gap: theme.space['1'] }}>
              <Eyebrow>{review.nextNotesTitle}</Eyebrow>
              {review.nextNotes.map((n) => (
                <Pressable
                  key={n.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={n.text}
                  accessibilityState={{ checked: ticked.has(n.id) }}
                  onPress={() => {
                    setTicked((s) => {
                      const next = new Set(s);
                      if (next.has(n.id)) next.delete(n.id);
                      else next.add(n.id);
                      return next;
                    });
                  }}
                  style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['2'], opacity: pressed ? 0.7 : 1 })}
                >
                  <Icon name={ticked.has(n.id) ? 'checkmark.square.fill' : 'square'} color={ticked.has(n.id) ? 'accent' : 'text.tertiary'} />
                  <AppText variant="callout" style={{ flex: 1 }}>
                    {n.text}
                  </AppText>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
      <TextButton label="Close" tone="secondary" onPress={onClose} />
    </BottomCard>
  );
}

function ReviewActionRow({ text, reason, apply, outOfDate, onApply }: { text: string; reason: string | null; apply: string; outOfDate: boolean; onApply: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, padding: theme.space['3'], gap: theme.space['1'] }}>
      <AppText variant="callout" numeric>
        {text}
      </AppText>
      {reason !== null ? (
        <AppText variant="label" color="text.secondary">
          {reason}
        </AppText>
      ) : null}
      {outOfDate ? <AppText variant="label" color="status.warning">Out of date</AppText> : <SecondaryButton label={apply} onPress={onApply} />}
    </View>
  );
}

/**
 * Your workout's coach proposal (§2.6): before/after lines, `⚠` advice, the coach's checked reason,
 * `about N min`, then `Apply` / `Skip`. The draft is written only on Apply (rule 3); `Out of date. Ask again.`
 * when a slot it touches moved since (rule 5).
 */
export function ProposalSheet({ card, busy, onApply, onSkip }: { card: ProposalCardView | null; busy: boolean; onApply: () => void; onSkip: () => void }) {
  const theme = useTheme();
  const [whyOpen, setWhyOpen] = useState(false);
  useEffect(() => {
    setWhyOpen(false);
  }, [card]);
  return (
    <BottomCard
      visible={card !== null}
      onClose={onSkip}
      footer={
        card?.actions != null ? (
          <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton label={card.actions.apply} onPress={onApply} busy={busy} disabled={busy} />
            </View>
            <SecondaryButton label={card.actions.skip} size="primary" onPress={onSkip} disabled={busy} />
          </View>
        ) : undefined
      }
    >
      {card === null ? null : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText variant="title2" accessibilityRole="header">
              {WORKOUT_COPY.bar}
            </AppText>
            {card.notes.length > 0 && !whyOpen ? <TextButton label={WORKOUT_COPY.why} tone="secondary" onPress={() => { setWhyOpen(true); }} /> : null}
          </View>
          {card.lines.length > 0 ? (
            <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, padding: theme.space['3'], gap: theme.space['1'] }}>
              {card.lines.map((l) => (
                <AppText key={l} variant="callout" numeric>
                  {l}
                </AppText>
              ))}
              <AppText variant="label" color="text.secondary" numeric>
                {card.minutes}
              </AppText>
            </View>
          ) : null}
          {card.warnings.map((w) => (
            <StatusLine key={w} icon="exclamationmark.triangle" tone="warning" text={w} />
          ))}
          {card.reason !== null ? (
            <AppText variant="callout" color="text.secondary">
              {card.reason}
            </AppText>
          ) : null}
          {whyOpen
            ? card.notes.map((n) => (
                <AppText key={n} variant="label" color="text.secondary">
                  {n}
                </AppText>
              ))
            : null}
          {card.state !== null ? (
            <AppText variant="label" color="status.warning" accessibilityLiveRegion="polite">
              {card.state}
            </AppText>
          ) : null}
        </>
      )}
    </BottomCard>
  );
}
