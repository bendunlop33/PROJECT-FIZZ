import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TextInput} from 'react-native';
import { ActionSheetIOS, Alert, InputAccessoryView, Pressable, View } from 'react-native';

import type { BuilderEditOp } from '@fizz/domain';
import type { BuilderGroup, SetType } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../../builder/builder-service';
import { KEY_STEPS, nextField, popupView, promptView, PROMPT_COPY, SET_TYPE_LABEL, SET_TYPES, WORKOUT_COPY, type PromptView } from '../../builder/builder-view';
import { countText, reviewHeaderWord, type BuilderReview } from '../../builder/review';
import { useTheme } from '../../theme';
import { AppText, BottomCard, DangerTextButton, Eyebrow, PrimaryButton, SecondaryButton, StatusLine, TextButton, TextField } from '../../ui';
import { ChoiceRow, Divider, Stepper, SwipeRow, Table } from './BuilderParts';

/**
 * The builder's sheets (workout-builder-v3 §2.4, §2.5, §2.7, §2.8, §2.9).
 * Each one shows values from the service and sends Ben's edits back to it;
 * none works out a load, a rest default or a count itself.
 */

export const SET_BAR_ID = 'builder-set-bar';

type Field = 'reps' | 'kg' | 'rpe';

/** The exercise pop-up (§2.4): per-set table, + Warm-up / + Set, rest per set type, move and pair, Why this weight?. */
export function ExerciseSheet({
  snap,
  slotKey,
  onEdit,
  onSwap,
  onDelete,
  onClose,
  why,
  kgStep,
  toast,
}: {
  snap: BuilderSnapshot;
  slotKey: string | null;
  onEdit: (op: BuilderEditOp) => Promise<BuilderWriteResult | null>;
  onSwap: () => void;
  onDelete: () => void;
  onClose: () => void;
  why: (slotKey: string) => Promise<string[]>;
  /** The next weight this gym can load for the item, up or down (§2.7). */
  kgStep: (slotKey: string, value: number | null, dir: 1 | -1) => Promise<number | null>;
  toast?: ReactNode;
}) {
  const theme = useTheme();
  const [whyLines, setWhyLines] = useState<string[] | null>(null);
  const [focus, setFocus] = useState<{ row: number; field: Field } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const refs = useRef(new Map<string, TextInput | null>());
  useEffect(() => {
    setWhyLines(null);
    setDrafts({});
    setNote(null);
    setFocus(null);
  }, [slotKey]);
  const view = slotKey === null ? null : popupView(snap, slotKey, (k) => snap.rests[slotKey]?.[k] ?? 0);
  const keyOf = (row: number, field: Field) => `${String(row)}:${field}`;

  async function commit(row: number, field: Field, text: string) {
    if (slotKey === null || view === null) return;
    const r = view.rows[row];
    const value = Number(text.replace(',', '.'));
    const key = keyOf(row, field);
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)));
    if (r === undefined || text.trim() === '' || !Number.isFinite(value)) return;
    const same = field === 'reps' ? value === r.reps : field === 'rpe' ? value === r.rpe : value === r.load;
    if (same) return;
    const patch = field === 'reps' ? { kind: 'reps' as const, reps: value } : field === 'rpe' ? { kind: 'rpe' as const, rpe: value } : { kind: 'load' as const, value };
    const res = await onEdit({ kind: 'edit_row', slotKey, index: row, patch });
    setNote(res?.status === 'refused' ? res.message : null);
  }

  async function step(dir: 1 | -1) {
    if (focus === null || slotKey === null || view === null) return;
    const r = view.rows[focus.row];
    if (r === undefined) return;
    const k = keyOf(focus.row, focus.field);
    const cur = Number(drafts[k] ?? (focus.field === 'reps' ? r.reps : focus.field === 'rpe' ? (r.rpe ?? 8) : (r.load ?? 0)));
    let next: number | null;
    if (focus.field === 'reps') next = Math.max(1, cur + dir * KEY_STEPS.reps);
    else if (focus.field === 'rpe') next = Math.max(1, Math.min(10, cur + dir * KEY_STEPS.rpe));
    else next = await kgStep(slotKey, Number.isFinite(cur) ? cur : null, dir);
    if (next !== null) setDrafts((d) => ({ ...d, [k]: String(next) }));
  }

  function goNext() {
    if (focus === null || view === null) return;
    const n = nextField(focus.row, focus.field, view.rows.length, (i) => view.rows[i]?.type !== 'warmup');
    if (n === null) refs.current.get(keyOf(focus.row, focus.field))?.blur();
    else refs.current.get(keyOf(n.row, n.field))?.focus();
  }

  const cell = (row: number, field: Field, value: string, label: string, editable = true) => {
    const k = keyOf(row, field);
    return (
      <TextField
        ref={(el) => {
          refs.current.set(k, el);
        }}
        accessibilityLabel={label}
        editable={editable}
        value={drafts[k] ?? value}
        keyboardType={field === 'reps' ? 'number-pad' : 'decimal-pad'}
        inputAccessoryViewID={SET_BAR_ID}
        selectTextOnFocus
        onFocus={() => { setFocus({ row, field }); }}
        onChangeText={(t) => { setDrafts((d) => ({ ...d, [k]: t })); }}
        onEndEditing={(e) => void commit(row, field, e.nativeEvent.text)}
        style={{ minHeight: 44, minWidth: 52, textAlign: 'right', fontVariant: ['tabular-nums'] }}
      />
    );
  };

  const pickType = (row: number, current: SetType) => {
    if (slotKey === null) return;
    const options = [...SET_TYPES.map((t) => SET_TYPE_LABEL[t]), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1, title: 'Type' }, (i) => {
      const t = SET_TYPES[i];
      if (t !== undefined && t !== current) void onEdit({ kind: 'set_type', slotKey, index: row, type: t }).then((r) => { setNote(r?.status === 'refused' ? r.message : null); });
    });
  };

  return (
    <BottomCard
      visible={slotKey !== null && view !== null}
      onClose={onClose}
      footer={
        <View style={{ gap: theme.space['2'] }}>
          {toast}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton label={WORKOUT_COPY.done} onPress={onClose} />
            </View>
            <DangerTextButton label={WORKOUT_COPY.delete} onPress={onDelete} />
          </View>
        </View>
      }
    >
      {view === null || slotKey === null ? null : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['2'] }}>
            <View style={{ flex: 1, gap: theme.space['1'] }}>
              <AppText variant="title2" accessibilityRole="header">
                {view.name}
              </AppText>
              {view.works !== null ? (
                <AppText variant="label" color="text.secondary">
                  {view.works}
                </AppText>
              ) : null}
              {view.mayHurt ? (
                <AppText variant="label" color="status.warning">
                  {WORKOUT_COPY.mayHurt}
                </AppText>
              ) : null}
            </View>
            <TextButton label={WORKOUT_COPY.swapExercise} onPress={onSwap} />
          </View>
          <Table>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', paddingHorizontal: theme.space['3'], paddingTop: theme.space['2'], gap: theme.space['2'] }}>
              {['#', 'Type', 'Reps', view.kgHeader, 'RPE'].map((h, i) => (
                <AppText key={h} variant="label" color="text.secondary" style={{ width: i === 0 ? 24 : i === 1 ? undefined : 56, flex: i === 1 ? 1 : undefined, textAlign: i > 1 ? 'right' : 'left' }}>
                  {h}
                </AppText>
              ))}
            </View>
            {view.rows.map((r) => (
              <SwipeRow
                key={`${String(r.index)}:${r.type}`}
                onPress={() => { pickType(r.index, r.type); }}
                accessibilityLabel={r.accessibilityLabel}
                actions={r.canDelete ? [{ name: 'delete_set', label: 'Delete set' }, { name: 'type', label: 'Change type' }] : [{ name: 'type', label: 'Change type' }]}
                onAction={(name) => {
                  if (name === 'delete_set') void onEdit({ kind: 'delete_set', slotKey, index: r.index });
                  if (name === 'type') pickType(r.index, r.type);
                }}
                {...(r.canDelete ? { leftAction: { label: WORKOUT_COPY.delete, onPress: () => void onEdit({ kind: 'delete_set', slotKey, index: r.index }) } } : {})}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space['3'], gap: theme.space['2'], minHeight: 52 }}>
                  <AppText variant="callout" color="text.secondary" numeric style={{ width: 24 }}>
                    {r.mark}
                  </AppText>
                  <AppText variant="callout" style={{ flex: 1 }}>
                    {r.typeText}
                  </AppText>
                  {cell(r.index, 'reps', String(r.reps), `${r.mark} reps`)}
                  {cell(r.index, 'kg', r.load === null ? '' : String(r.load), `${r.mark} ${view.kgHeader}`)}
                  {r.type === 'warmup' ? (
                    <AppText variant="callout" color="text.tertiary" style={{ width: 52, textAlign: 'right' }}>
                      –
                    </AppText>
                  ) : (
                    cell(r.index, 'rpe', r.rpe === null ? '' : String(r.rpe), `${r.mark} target RPE`)
                  )}
                </View>
              </SwipeRow>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: theme.space['3'] }}>
              <TextButton label={WORKOUT_COPY.warmup} disabled={!view.canAddWarmup} onPress={() => void onEdit({ kind: 'add_warmup', slotKey })} />
              <TextButton label={WORKOUT_COPY.set} disabled={!view.canAddSet} onPress={() => void onEdit({ kind: 'add_set', slotKey })} />
            </View>
          </Table>
          {note !== null ? <StatusLine icon="info.circle" tone="info" text={note} /> : null}
          <Eyebrow>{WORKOUT_COPY.rest}</Eyebrow>
          <Table>
            {view.rests.map((x, i) => (
              <View key={x.kind}>
                {i > 0 ? <Divider /> : null}
                <View style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingLeft: theme.space['4'], paddingRight: theme.space['2'] }}>
                  <AppText variant="body" style={{ flex: 1 }}>
                    {x.label}
                  </AppText>
                  <Stepper label={x.label} valueText={x.text} canMinus={x.seconds > 0} canPlus={x.seconds < 360} onStep={(d) => void onEdit({ kind: 'rest', slotKey, restKind: x.kind, seconds: x.seconds + d * 15 })} />
                </View>
              </View>
            ))}
          </Table>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            {view.canMoveUp ? <SecondaryButton label={`↑ ${WORKOUT_COPY.moveUp}`} onPress={() => void onEdit({ kind: 'move', slotKey, dir: 'up' })} /> : null}
            {view.canMoveDown ? <SecondaryButton label={`↓ ${WORKOUT_COPY.moveDown}`} onPress={() => void onEdit({ kind: 'move', slotKey, dir: 'down' })} /> : null}
            {view.canSupersetNext ? <SecondaryButton label={WORKOUT_COPY.supersetNext} onPress={() => void onEdit({ kind: 'superset_next', slotKey })} /> : null}
            {view.canUnlink ? <SecondaryButton label={WORKOUT_COPY.unlink} onPress={() => void onEdit({ kind: 'unlink', slotKey })} /> : null}
          </View>
          <TextButton
            label={`${WORKOUT_COPY.whyWeight}${whyLines === null ? ' ›' : ''}`}
            tone="secondary"
            onPress={() => {
              if (whyLines !== null) setWhyLines(null);
              else void why(slotKey).then(setWhyLines);
            }}
          />
          {whyLines !== null
            ? whyLines.map((l) => (
                <AppText key={l} variant="label" color="text.secondary" numeric>
                  {l}
                </AppText>
              ))
            : null}
          <InputAccessoryView nativeID={SET_BAR_ID}>
            <View style={{ flexDirection: 'row', gap: theme.space['2'], padding: theme.space['2'], backgroundColor: theme.colors['bg.raised'] }}>
              <View style={{ flex: 1 }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Less" onPress={() => void step(-1)} style={{ minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'] }}>
                <AppText variant="headline">−</AppText>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={() => void step(1)} style={{ minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'] }}>
                <AppText variant="headline">+</AppText>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={WORKOUT_COPY.next} onPress={goNext} style={{ minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'] }}>
                <AppText variant="headline">{WORKOUT_COPY.next}</AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={WORKOUT_COPY.done}
                onPress={() => {
                  if (focus !== null) refs.current.get(keyOf(focus.row, focus.field))?.blur();
                }}
                style={{ minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: theme.colors.accent }}
              >
                <AppText variant="headline" color="on.accent">
                  {WORKOUT_COPY.done}
                </AppText>
              </Pressable>
            </View>
          </InputAccessoryView>
        </>
      )}
    </BottomCard>
  );
}

export interface ChoiceSection {
  focus: string;
  items: { exerciseId: string; name: string; works: string | null; mayHurt: boolean }[];
}

/** Swap / Add (§2.5): the group dropdown defaults to the exercise's group; exercises by focus with their works line. No estimated max. */
export function SwapSheet({
  visible,
  title,
  group,
  groups,
  sections,
  actionWord,
  onGroup,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  group: BuilderGroup;
  groups: readonly BuilderGroup[];
  sections: readonly ChoiceSection[];
  /** `Swap` or `Add` (the `May hurt` confirm's button). */
  actionWord: string;
  onGroup: (g: BuilderGroup) => void;
  onPick: (exerciseId: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const chooseGroup = () => {
    const options = [...groups, 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1, title: 'Muscle group' }, (i) => {
      const g = groups[i];
      if (g !== undefined) onGroup(g);
    });
  };
  return (
    <BottomCard visible={visible} onClose={onClose} footer={<TextButton label="Back" tone="secondary" onPress={onClose} />}>
      <AppText variant="title2" accessibilityRole="header">
        {title}
      </AppText>
      <Pressable accessibilityRole="button" accessibilityLabel={`Muscle group, ${group}`} onPress={chooseGroup} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="body">Muscle group</AppText>
        <AppText variant="body" color="text.secondary">{`${group}  ⌄`}</AppText>
      </Pressable>
      {sections.length === 0 ? <StatusLine icon="info.circle" tone="info" text="All of these are in the workout" /> : null}
      {sections.map((sec) => (
        <View key={sec.focus} style={{ gap: theme.space['1'] }}>
          {sections.length > 1 ? <Eyebrow>{sec.focus}</Eyebrow> : null}
          <Table>
            {sec.items.map((it, i) => (
              <View key={it.exerciseId}>
                {i > 0 ? <Divider /> : null}
                <ChoiceRow
                  title={it.name}
                  line={it.works}
                  tag={it.mayHurt ? WORKOUT_COPY.mayHurt : null}
                  onPress={() => {
                    if (!it.mayHurt) {
                      onPick(it.exerciseId);
                      return;
                    }
                    Alert.alert(WORKOUT_COPY.mayHurt, it.name, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: actionWord,
                        onPress: () => {
                          onPick(it.exerciseId);
                        },
                      },
                    ]);
                  }}
                />
              </View>
            ))}
          </Table>
        </View>
      ))}
    </BottomCard>
  );
}

/** `Use these changes for` (§2.8): Today only / Update … in your plan / Save as new variation (name, then Save and start) / Cancel. */
export function PromptSheet({
  view,
  suggestedLabel,
  busy,
  error,
  onToday,
  onUpdate,
  onVariation,
  onClose,
}: {
  view: PromptView | null;
  suggestedLabel: string;
  busy: boolean;
  error: string | null;
  onToday: () => void;
  onUpdate: () => void;
  onVariation: (label: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState(suggestedLabel);
  useEffect(() => {
    setNaming(false);
    setLabel(suggestedLabel);
  }, [view, suggestedLabel]);
  return (
    <BottomCard visible={view !== null} onClose={onClose}>
      {view === null ? null : naming ? (
        <>
          <AppText variant="title2" accessibilityRole="header">
            {view.variation.label}
          </AppText>
          <TextField accessibilityLabel="Variation name" value={label} onChangeText={setLabel} maxLength={40} autoFocus selectTextOnFocus />
          {error !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
          <PrimaryButton
            label={PROMPT_COPY.saveAndStart}
            busy={busy}
            disabled={label.trim().length === 0}
            onPress={() => {
              onVariation(label.trim());
            }}
          />
          <TextButton label={view.cancel} tone="secondary" onPress={() => { setNaming(false); }} />
        </>
      ) : (
        <>
          <AppText variant="title2" accessibilityRole="header">
            {view.title}
          </AppText>
          <Table>
            {view.lines.map((l, i) => (
              <View key={l}>
                {i > 0 ? <Divider /> : null}
                <View style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.space['4'] }}>
                  <AppText variant="callout" numeric>
                    {l}
                  </AppText>
                </View>
              </View>
            ))}
          </Table>
          {error !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
          <PrimaryButton label={view.today} busy={busy} onPress={onToday} />
          {view.update !== null ? <TextButton label={view.update} onPress={onUpdate} disabled={busy} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <TextButton label={view.variation.label} disabled={!view.variation.enabled || busy} onPress={() => { setNaming(true); }} />
            {view.variation.note !== null ? (
              <AppText variant="label" color="text.secondary">
                {view.variation.note}
              </AppText>
            ) : null}
          </View>
          <TextButton label={view.cancel} tone="secondary" onPress={onClose} />
        </>
      )}
    </BottomCard>
  );
}

export { promptView };

/** Coach review (§2.9): code's counts and mix always; the coach's verdict, suggestions and notes only when it reviewed. */
export function ReviewSheet({ review, visible, onApply, onDone, onClose }: { review: BuilderReview | null; visible: boolean; onApply: (actionId: string) => void; onDone: (ticked: string[]) => void; onClose: () => void }) {
  const theme = useTheme();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    setTicked(new Set((review?.nextNotes ?? []).filter((n) => n.ticked).map((n) => n.id)));
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
            <AppText variant="label" color="text.secondary">
              {reviewHeaderWord(review.status)}
            </AppText>
          </View>
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
                <ChoiceRow
                  key={n.id}
                  title={`${ticked.has(n.id) ? '☑' : '☐'} ${n.text}`}
                  selected={false}
                  onPress={() => { setTicked((s) => {
                      const next = new Set(s);
                      if (next.has(n.id)) next.delete(n.id);
                      else next.add(n.id);
                      return next;
                    }); }
                  }
                />
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
