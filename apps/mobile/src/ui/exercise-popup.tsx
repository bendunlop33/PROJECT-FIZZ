import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TextInput } from 'react-native';
import { ActionSheetIOS, InputAccessoryView, Pressable, View, type AccessibilityActionEvent } from 'react-native';

import type { SetType } from '@fizz/schemas';

import { useTheme } from '../theme';
import { DangerTextButton, PrimaryButton, SecondaryButton, TextButton } from './buttons';
import { Eyebrow, StatusLine, TextField } from './layout';
import { BottomCard } from './sheet';
import { AppText } from './Text';
import { Divider, Stepper, SwipeRow, Table } from './table-parts';
import { EFFORT_HEADER, effortCellText, holdMenu, KEY_STEPS, shownRir, stepRir, storedEffort, nextFieldByKey, popupRowActions, popupRowByKey, POPUP_COPY, typeMenu, type PopupField, type PopupRestRow, type PopupSetRow, type PopupView } from './exercise-popup-model';

/**
 * The exercise pop-up (workout-builder-v3 §2.4), one component for the
 * builder's Your workout and the active workout (workout-table-v3 §7, "same
 * functionality as when building them"): name and works line, `Swap
 * exercise` top right, the per-set table `# · Type · Reps · Kg · RPE` with
 * the keyboard bar (− + Next Done), a Type picker per set, `＋ Warm-up`,
 * `＋ Set`, rest per set type, Move up / Move down, Superset with next /
 * Unlink, `Why this weight?`. Each page maps its own data into `PopupView`
 * and sends Ben's edits through its own service; nothing here works out a
 * load, a rest default or a count.
 *
 * Each set row: tap `# Type` for the Type picker; swipe left to Delete;
 * press and hold for its menu (Change type, Move up, Move down, Delete); the
 * same actions are VoiceOver actions on the row.
 */

export const POPUP_SET_BAR_ID = 'exercise-popup-set-bar';

/** One width for the Reps, Kg and RPE headers and their cells, so they stay lined up at any text size (N2). */
const VALUE_COL_W = 56;

export interface ExercisePopupProps {
  view: PopupView | null;
  /** Changes when another exercise opens: typed drafts, the note and `Why?` reset. */
  resetKey: string | null;
  /** A typed value, sent when the field closes. Resolves to a refusal line, or null. */
  onEditCell: (row: PopupSetRow, field: PopupField, value: number) => Promise<string | null>;
  onType: (row: PopupSetRow, type: SetType) => Promise<string | null>;
  onDeleteRow: (row: PopupSetRow) => void;
  /** Move up / Move down for a set (sets not done yet). Absent: the page keeps sets in type order. */
  onMoveRow?: (row: PopupSetRow, dir: 'up' | 'down') => void;
  onAddWarmup: () => Promise<string | null>;
  onAddSet: () => void;
  onRestStep: (rest: PopupRestRow, dir: 1 | -1) => void;
  onMove: (dir: 'up' | 'down') => void;
  onSupersetNext: () => void;
  onUnlink: () => void;
  onSwap: () => void;
  /** `Delete` (builder) / `Remove` (workout). */
  onDelete: () => void;
  onClose: () => void;
  /** `Why this weight?`; absent: no link (a saved workout's loads are `Auto` or Ben's own). */
  why?: (() => Promise<string[]>) | undefined;
  /** (Ben, 23 Oct: one editor) A row's `extraActions` item picked (hold menu or VoiceOver). */
  onRowExtra?: ((row: PopupSetRow, name: string) => void) | undefined;
  /** (Ben, 23 Oct: one editor) `Default` on a rest the workout sets itself. */
  onRestDefault?: ((rest: PopupRestRow) => void) | undefined;
  /** (Ben, 23 Oct: one editor) More for this exercise, under the rest (a saved workout's `Main`, `Reps`, `Target RPE`). */
  options?: ReactNode;
  /** The next weight this gym can load for the set's item, up or down (§2.7). */
  kgStep: (row: PopupSetRow, value: number | null, dir: 1 | -1) => Promise<number | null>;
  /** (22 Oct) `How to`: the exercise guide; absent when it has none (or the page doesn't link it). */
  onHowTo?: (() => void) | undefined;
  /** (22 Oct) `History`: the exercise's history; absent when it was never logged (or the page doesn't link it). */
  onHistory?: (() => void) | undefined;
  /** (Ben, 26 Oct) A read-only `History` section (mid-workout: the last 3 comparable sessions and a top-set chart). */
  history?: ReactNode;
  toast?: ReactNode;
}

export function ExercisePopup(p: ExercisePopupProps) {
  const theme = useTheme();
  const view = p.view;
  const [whyLines, setWhyLines] = useState<string[] | null>(null);
  const [focus, setFocus] = useState<{ key: string; field: PopupField } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const refs = useRef(new Map<string, TextInput | null>());
  useEffect(() => {
    setWhyLines(null);
    setDrafts({});
    setNote(null);
    setFocus(null);
  }, [p.resetKey]);
  // Every draft, ref and focus is keyed by the row's key (its set ID), never its position (review B1).
  const keyOf = (rowKey: string, field: PopupField) => `${rowKey}:${field}`;

  async function commit(rowKey: string, field: PopupField, text: string) {
    if (view === null) return;
    const r = popupRowByKey(view.rows, rowKey);
    const value = Number(text.replace(',', '.'));
    const key = keyOf(rowKey, field);
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)));
    if (r === undefined || text.trim() === '' || !Number.isFinite(value)) return;
    // (Ben, 26 Oct) The effort cell is typed as RIR; stored in the view's own scale.
    const stored = field === 'rpe' ? storedEffort(view, value) : value;
    if (stored === null) return;
    const same = field === 'reps' ? value === r.reps && r.repsText === String(r.reps) : field === 'rpe' ? stored === r.rpe : value === r.load;
    if (same) return;
    setNote(await p.onEditCell(r, field, stored));
  }

  async function step(dir: 1 | -1) {
    if (focus === null || view === null) return;
    const r = popupRowByKey(view.rows, focus.key);
    if (r === undefined) return;
    const k = keyOf(focus.key, focus.field);
    const cur = Number(drafts[k] ?? (focus.field === 'reps' ? (r.reps ?? 0) : focus.field === 'rpe' ? (shownRir(view, r.rpe) ?? 2) : (r.load ?? 0)));
    let next: number | null;
    if (focus.field === 'reps') next = Math.max(1, cur + dir * KEY_STEPS.reps);
    else if (focus.field === 'rpe') next = stepRir(view, cur, dir);
    else next = await p.kgStep(r, Number.isFinite(cur) ? cur : null, dir);
    if (next !== null) setDrafts((d) => ({ ...d, [k]: String(next) }));
  }

  function goNext() {
    if (focus === null || view === null) return;
    const n = nextFieldByKey(view.rows, focus.key, focus.field);
    if (n === null) refs.current.get(keyOf(focus.key, focus.field))?.blur();
    else refs.current.get(keyOf(n.key, n.field))?.focus();
  }

  const cell = (r: PopupSetRow, field: PopupField, value: string, label: string) => {
    const k = keyOf(r.key, field);
    return (
      <TextField
        ref={(el) => {
          refs.current.set(k, el);
        }}
        accessibilityLabel={label}
        editable={r.editable && !(field === 'reps' && r.reps === null) && !(field === 'kg' && r.kgEditable === false)}
        value={drafts[k] ?? value}
        {...(field === 'kg' && r.kgPlaceholder !== undefined ? { placeholder: r.kgPlaceholder } : {})}
        keyboardType={field === 'reps' ? 'number-pad' : 'decimal-pad'}
        inputAccessoryViewID={POPUP_SET_BAR_ID}
        selectTextOnFocus
        onFocus={() => {
          setFocus({ key: r.key, field });
        }}
        onChangeText={(t) => {
          setDrafts((d) => ({ ...d, [k]: t }));
        }}
        onEndEditing={(e) => void commit(r.key, field, e.nativeEvent.text)}
        style={{ minHeight: 44, width: VALUE_COL_W, textAlign: 'right', fontVariant: ['tabular-nums'], ...(r.done ? { color: theme.colors['status.done'] } : {}) }}
      />
    );
  };

  const pickType = (r: PopupSetRow) => {
    const m = typeMenu(r.type);
    ActionSheetIOS.showActionSheetWithOptions({ options: m.options, cancelButtonIndex: m.cancelButtonIndex, title: POPUP_COPY.type }, (i) => {
      const t = m.typeAt(i);
      if (t !== null) void p.onType(r, t).then(setNote);
    });
  };

  const rowAction = (r: PopupSetRow, name: string) => {
    switch (name) {
      case 'type':
        pickType(r);
        break;
      case 'move_up':
        p.onMoveRow?.(r, 'up');
        break;
      case 'move_down':
        p.onMoveRow?.(r, 'down');
        break;
      case 'delete_set':
        p.onDeleteRow(r);
        break;
      default:
        p.onRowExtra?.(r, name);
        break;
    }
  };

  const actionsOf = (r: PopupSetRow): { name: string; label: string }[] => [...popupRowActions(p.onMoveRow === undefined ? { ...r, canMoveUp: false, canMoveDown: false } : r), ...(p.onRowExtra === undefined ? [] : (r.extraActions ?? []))];
  /** Press and hold a set row: its menu (§7 "long-press menu fallback"; the same actions as VoiceOver's). */
  const openMenu = (r: PopupSetRow) => {
    const m = holdMenu(actionsOf(r));
    ActionSheetIOS.showActionSheetWithOptions({ title: `${r.spokenName} · ${r.typeText}`, options: m.options, cancelButtonIndex: m.cancelButtonIndex, destructiveButtonIndex: m.destructiveButtonIndex }, (i) => {
      const a = m.actionAt(i);
      if (a !== null) rowAction(r, a);
    });
  };

  return (
    <BottomCard
      visible={view !== null}
      onClose={p.onClose}
      footer={
        <View style={{ gap: theme.space['2'] }}>
          {p.toast}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton label={POPUP_COPY.done} onPress={p.onClose} />
            </View>
            {view === null || view.canDeleteExercise ? <DangerTextButton label={view?.deleteLabel ?? POPUP_COPY.delete} onPress={p.onDelete} /> : null}
          </View>
        </View>
      }
    >
      {view === null ? null : (
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
                  {POPUP_COPY.mayHurt}
                </AppText>
              ) : null}
            </View>
            {view.canSwap ? <TextButton label={POPUP_COPY.swapExercise} onPress={p.onSwap} /> : null}
          </View>
          <Table>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', paddingHorizontal: theme.space['3'], paddingTop: theme.space['2'], gap: theme.space['2'] }}>
              {['#', 'Type', 'Reps', view.kgHeader, EFFORT_HEADER].map((h, i) => (
                <AppText key={h} variant="label" color="text.secondary" style={{ width: i === 0 ? 24 : i === 1 ? undefined : VALUE_COL_W, flex: i === 1 ? 1 : undefined, textAlign: i > 1 ? 'right' : 'left' }}>
                  {h}
                </AppText>
              ))}
            </View>
            {view.rows.map((r) => {
              const actions = actionsOf(r);
              const onAction = (name: string) => {
                const a = actions.find((x) => x.name === name);
                if (a !== undefined) rowAction(r, a.name);
              };
              return (
                <SwipeRow
                  key={`${r.key}:${r.type}`}
                  container
                  onPress={() => {
                    pickType(r);
                  }}
                  accessibilityLabel={r.accessibilityLabel}
                  actions={actions}
                  onAction={onAction}
                  holdProps={{ onLongPress: () => { openMenu(r); } }}
                  {...(r.canDelete ? { leftAction: { label: POPUP_COPY.delete, onPress: () => { p.onDeleteRow(r); } } } : {})}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space['3'], gap: theme.space['2'], minHeight: 52 }}>
                    {/* `#` and Type are one VoiceOver element with the row's actions; the fields after it stay reachable (review B6). */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={r.accessibilityLabel}
                      accessibilityHint="Changes the set type"
                      accessibilityActions={actions}
                      onAccessibilityAction={(e: AccessibilityActionEvent) => {
                        onAction(e.nativeEvent.actionName);
                      }}
                      onPress={() => {
                        pickType(r);
                      }}
                      onLongPress={() => {
                        openMenu(r);
                      }}
                      style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}
                    >
                      <AppText variant="callout" color={r.done ? 'status.done' : 'text.secondary'} numeric style={{ width: 24 }}>
                        {r.mark}
                      </AppText>
                      <AppText variant="callout" style={{ flex: 1 }}>
                        {r.typeText}
                      </AppText>
                    </Pressable>
                    {cell(r, 'reps', r.repsText, `${r.spokenName}, reps`)}
                    {cell(r, 'kg', r.load === null ? '' : String(r.load), `${r.spokenName}, ${view.kgHeader}`)}
                    {r.noRpe ? (
                      <AppText variant="callout" color="text.tertiary" style={{ width: VALUE_COL_W, textAlign: 'right' }} accessibilityElementsHidden importantForAccessibility="no">
                        –
                      </AppText>
                    ) : (
                      cell(r, 'rpe', effortCellText(view, r.rpe), `${r.spokenName}, ${r.done ? 'reps in reserve' : 'target reps in reserve'}`)
                    )}
                  </View>
                </SwipeRow>
              );
            })}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: theme.space['3'] }}>
              <TextButton label={POPUP_COPY.warmup} disabled={!view.canAddWarmup} onPress={() => void p.onAddWarmup().then(setNote)} />
              <TextButton label={POPUP_COPY.set} disabled={!view.canAddSet} onPress={p.onAddSet} />
            </View>
          </Table>
          {note !== null ? <StatusLine icon="info.circle" tone="info" text={note} /> : null}
          {view.rests.length > 0 ? <Eyebrow>{POPUP_COPY.rest}</Eyebrow> : null}
          {view.rests.length > 0 ? (
            <Table>
              {view.rests.map((x, i) => (
                <View key={x.kind}>
                  {i > 0 ? <Divider /> : null}
                  <View style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingLeft: theme.space['4'], paddingRight: theme.space['2'] }}>
                    <AppText variant="body" style={{ flex: 1 }}>
                      {x.label}
                    </AppText>
                    {x.own === true && p.onRestDefault !== undefined ? <TextButton label={POPUP_COPY.restDefault} tone="secondary" accessibilityLabel={`${x.label}, ${POPUP_COPY.restDefault}`} onPress={() => { p.onRestDefault?.(x); }} /> : null}
                    <Stepper
                      label={x.label}
                      valueText={x.text}
                      canMinus={x.canMinus}
                      canPlus={x.canPlus}
                      repeat
                      onStep={(d) => {
                        p.onRestStep(x, d > 0 ? 1 : -1);
                      }}
                    />
                  </View>
                </View>
              ))}
            </Table>
          ) : null}
          {p.options}
          {p.history}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            {view.canMoveUp ? <SecondaryButton label={`↑ ${POPUP_COPY.moveUp}`} onPress={() => { p.onMove('up'); }} /> : null}
            {view.canMoveDown ? <SecondaryButton label={`↓ ${POPUP_COPY.moveDown}`} onPress={() => { p.onMove('down'); }} /> : null}
            {view.canSupersetNext ? <SecondaryButton label={POPUP_COPY.supersetNext} onPress={p.onSupersetNext} /> : null}
            {view.canUnlink ? <SecondaryButton label={POPUP_COPY.unlink} onPress={p.onUnlink} /> : null}
          </View>
          {p.onHowTo !== undefined || p.onHistory !== undefined ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['5'] }}>
              {p.onHowTo !== undefined ? <TextButton label={POPUP_COPY.howTo} icon="chevron.right" tone="secondary" accessibilityLabel={`How to, ${view.name}`} onPress={p.onHowTo} /> : null}
              {p.onHistory !== undefined ? <TextButton label={POPUP_COPY.history} icon="chevron.right" tone="secondary" accessibilityLabel={`History, ${view.name}`} onPress={p.onHistory} /> : null}
            </View>
          ) : null}
          {p.why !== undefined ? (
            <TextButton
              label={`${POPUP_COPY.whyWeight}${whyLines === null ? ' ›' : ''}`}
              tone="secondary"
              onPress={() => {
                if (whyLines !== null) setWhyLines(null);
                else void p.why?.().then(setWhyLines);
              }}
            />
          ) : null}
          {whyLines !== null
            ? whyLines.map((l) => (
                <AppText key={l} variant="label" color="text.secondary" numeric>
                  {l}
                </AppText>
              ))
            : null}
          <InputAccessoryView nativeID={POPUP_SET_BAR_ID}>
            <View style={{ flexDirection: 'row', gap: theme.space['2'], padding: theme.space['2'], backgroundColor: theme.colors['bg.raised'] }}>
              <View style={{ flex: 1 }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Less" onPress={() => void step(-1)} style={{ minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'] }}>
                <AppText variant="headline">−</AppText>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={() => void step(1)} style={{ minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'] }}>
                <AppText variant="headline">+</AppText>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={POPUP_COPY.next} onPress={goNext} style={{ minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'] }}>
                <AppText variant="headline">{POPUP_COPY.next}</AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={POPUP_COPY.done}
                onPress={() => {
                  if (focus !== null) refs.current.get(keyOf(focus.key, focus.field))?.blur();
                }}
                style={{ minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: theme.colors.accent }}
              >
                <AppText variant="headline" color="on.accent">
                  {POPUP_COPY.done}
                </AppText>
              </Pressable>
            </View>
          </InputAccessoryView>
        </>
      )}
    </BottomCard>
  );
}
