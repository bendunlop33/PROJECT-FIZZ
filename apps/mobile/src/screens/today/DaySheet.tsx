import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { DAY_SHEET_COPY, TODAY_V2_COPY, type WorkoutListRow } from '@fizz/domain';
import type { PlanWeekExerciseEdit } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { HEALTH_COPY, NO_DAY_PAIRS, type DayPairsView } from '../../health/health-view';
import type { TodayDaySheet, TodaySessionData } from '../../services/today-session';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Group, Icon, PrimaryButton, TextButton } from '../../ui';
import { TextField } from '../../ui/layout';
import { SwapSheet } from '../../ui/swap-sheet';
import type { ChoiceSection } from '../../ui/swap-sheet-model';
import { useExercisePicker, usePickerView } from '../../ui/use-exercise-picker';
import { WorkoutList } from '../../ui/workout-list';
import { Chip } from '../../ui/workout';
import { pairedDaySheetRows, type DaySheetOpen, type DaySheetRow, type PairedDaySheetRow } from '../../today/today-view';
import { createAfterDismiss } from '../../workout/after-dismiss';

/**
 * The day sheet (Ben, 29 Oct; docs/design/day-sheet.md): tap a day on Today's week (or a day row on Library › Plan)
 * → `Thu · Push B`, its status, the day's exercises as Today's card lists them, and this week's actions: `Start`
 * (today), `Do today instead`, `Move to…`, `Skip this week`, `Edit`. Edit lists the exercises: tap one for `Swap` or
 * `Remove`, or `Add exercise`, with the scope `This week only` (from Today) or `Every week` (from Library). Every
 * change is one versioned write with one Undo (the toast); the tiles and Up next follow on the next read. Values and
 * actions only (minimal copy); every value is the services'. Self-contained, so Today and Library open the same flow.
 */

export type DaySheetTarget = { date: string } | { dayKey: string };
type Toast = { text: string; action?: string; onAction?: () => void };

export function DaySheetFlow({
  target,
  from,
  chosenKey,
  doneRows,
  dateTitle,
  onOpen,
  onStart,
  onPick,
  onClose,
  onChanged,
  onToast,
  onMore,
}: {
  /** The tile's date or Library's plan day; null: closed. */
  target: DaySheetTarget | null;
  /** Today defaults the scope to This week only; Library to Every week. */
  from: 'today' | 'library';
  /** Today's card's day (Any days: it holds today). */
  chosenKey: string | null;
  /** Done workouts and activities on the tile's date (their Summary or page). */
  doneRows: readonly DaySheetRow[];
  dateTitle: (date: string) => string;
  onOpen: (open: NonNullable<DaySheetOpen>) => void;
  /** `Start` on today's day. */
  onStart: (dayKey: string) => void;
  /** Any days `Do today instead`: the day on Today's card (nothing written). */
  onPick: (dayKey: string) => void;
  onClose: () => void;
  /** A write landed: re-read the screen. */
  onChanged: () => void;
  onToast: (t: Toast | null) => void;
  /** (Library) The plan day's own page (Open, Make next, Ask coach). */
  onMore?: (() => void) | undefined;
}) {
  const theme = useTheme();
  const services = useServices();
  const [data, setData] = useState<TodaySessionData | null>(null);
  const [mode, setMode] = useState<'day' | 'edit' | 'to_swap' | 'swap' | 'from_swap'>('day');
  const [moving, setMoving] = useState(false);
  const [scope, setScope] = useState<'week' | 'every'>(from === 'today' ? 'week' : 'every');
  const [row, setRow] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [swap, setSwap] = useState<{ rowId: string | null; exerciseId: string | null; sections: ChoiceSection[] } | null>(null);
  const busy = useRef(false);
  const picker = useExercisePicker();
  const [afterDismiss] = useState(() => createAfterDismiss());
  const [swapAfter] = useState(() => createAfterDismiss());
  const open = target !== null;
  const targetKey = target === null ? null : 'date' in target ? `d:${target.date}` : `k:${target.dayKey}`;

  // Read once the sheet opens (and after each write): Today's data, local only.
  const [readN, setReadN] = useState(0);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void services.todaySession.load().then(
      (d) => {
        if (alive) setData(d);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [services, open, readN]);
  // (Ben, 29 Oct) The day's Health pairs: read with the sheet (and after each write), local only.
  const [pairs, setPairs] = useState<DayPairsView>(NO_DAY_PAIRS);
  const [choosing, setChoosing] = useState<string | null>(null);
  const pairDate = target !== null && 'date' in target ? target.date : null;
  useEffect(() => {
    setPairs(NO_DAY_PAIRS);
    if (pairDate === null) return;
    let alive = true;
    void services.health.dayPairs(pairDate).then(
      (p) => {
        if (alive) setPairs(p);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [services, pairDate, readN]);
  useEffect(() => {
    setChoosing(null);
    setMode('day');
    setMoving(false);
    setRow(null);
    setWeight('');
    setScope(from === 'today' ? 'week' : 'every');
  }, [targetKey, from]);

  const sheet: TodayDaySheet | null = data === null || target === null ? null : services.todaySession.daySheet(data, target, chosenKey, dateTitle);
  const exclude = sheet?.list.map((r) => r.exerciseId) ?? [];
  const suggested = swap?.sections.flatMap((s) => s.items.map((i) => i.exerciseId)) ?? [];
  const pickerView = usePickerView(picker, exclude, suggested);
  const day = sheet?.day ?? null;
  const rows = day === null || data === null ? null : (data.dayRows[day.key] ?? null);
  const planId = sheet?.planId ?? null;

  function reread() {
    setReadN((n) => n + 1);
    onChanged();
  }

  /** One this-week write against the plan as read, then its toast with Undo (rule 5: Undo against what it wrote). */
  async function weekWrite(change: Parameters<typeof services.plans.weekChange>[0]['change'], text: string) {
    if (busy.current || planId === null || data?.planVersion == null) return;
    busy.current = true;
    try {
      const r = await services.plans.weekChange({ planId, expectedVersion: data.planVersion, opId: newUuid(), change });
      reread();
      if (!r.ok) {
        onToast({ text: DAY_SHEET_COPY.stale });
        return;
      }
      const after = r.plan;
      const learned = r.learned ?? null;
      const drafts = r.draftEdits ?? [];
      onToast({
        text,
        action: DAY_SHEET_COPY.undo,
        onAction: () => {
          onToast(null);
          void services.plans.undoWeekChange({ planId: after.id, expectedVersion: after.version, opId: newUuid() }).then(async (u) => {
            if (u.ok && learned !== null) await services.gyms.undoEdit(learned).catch(() => null);
            // The same change on today's Your workout comes back out with it.
            if (u.ok) for (const d of drafts) await services.builder.undo(d.draftId, d.opId, newUuid()).catch(() => null);
            reread();
            if (!u.ok) onToast({ text: u.message });
          });
        },
      });
    } finally {
      busy.current = false;
    }
  }

  /** One exercise change in the chosen scope: this week's (the plan) or every week's (the template). */
  async function exerciseWrite(edit: Omit<PlanWeekExerciseEdit, 'week' | 'opId' | 'atUtc' | 'dayIndex'>, text: string) {
    if (day?.dayIndex == null || rows === null) return;
    if (scope === 'week') {
      await weekWrite({ kind: 'exercise', edit: { ...edit, dayIndex: day.dayIndex } }, text);
      return;
    }
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await services.plans.editDayEveryWeek({ routineId: rows.routineId, expectedVersion: rows.version, opId: newUuid(), edit });
      reread();
      if (!r.ok) {
        onToast({ text: DAY_SHEET_COPY.stale });
        return;
      }
      const actionId = r.actionId;
      const learned = r.learned ?? null;
      onToast({
        text,
        action: DAY_SHEET_COPY.undo,
        onAction: () => {
          onToast(null);
          void services.routines.revert({ actionId, opId: newUuid() }).then(async (u) => {
            if (u.ok && learned !== null) await services.gyms.undoEdit(learned).catch(() => null);
            reread();
            if (!u.ok) onToast({ text: u.message });
          });
        },
      });
    } finally {
      busy.current = false;
    }
  }

  /** `Pair`: one versioned link (the workout's sets never change, rule 2), its toast with Undo (unlink on what it wrote). */
  async function pair(healthUuid: string, sessionId: string) {
    if (busy.current) return;
    busy.current = true;
    setChoosing(null);
    try {
      const r = await services.health.link({ healthUuid, sessionId, opId: newUuid() });
      reread();
      if (!r.ok) {
        onToast({ text: r.message });
        return;
      }
      onToast({
        text: HEALTH_COPY.paired,
        action: DAY_SHEET_COPY.undo,
        onAction: () => {
          onToast(null);
          void services.health.unlink({ healthUuid: r.healthUuid, expectedVersion: r.version, opId: newUuid() }).then((u) => {
            reread();
            if (!u.ok) onToast({ text: u.message });
          });
        },
      });
    } finally {
      busy.current = false;
    }
  }

  /** `Unpair`, on the version the row showed; Undo pairs them again. */
  async function unpair(healthUuid: string, linkVersion: number, sessionId: string) {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await services.health.unlink({ healthUuid, expectedVersion: linkVersion, opId: newUuid() });
      reread();
      if (!r.ok) {
        onToast({ text: r.message });
        return;
      }
      onToast({
        text: HEALTH_COPY.unpaired,
        action: DAY_SHEET_COPY.undo,
        onAction: () => {
          onToast(null);
          void services.health.link({ healthUuid, sessionId, opId: newUuid() }).then((u) => {
            reread();
            if (!u.ok) onToast({ text: u.message });
          });
        },
      });
    } finally {
      busy.current = false;
    }
  }

  /** A row's own page: a Health activity's sheet opens once this one has gone (one sheet at a time on iOS). */
  function openRow(o: NonNullable<DaySheetOpen>) {
    if (o.kind !== 'activity') {
      onOpen(o);
      return;
    }
    afterDismiss.arm(() => {
      onOpen(o);
    });
    onClose();
  }

  // One sheet at a time on iOS: the day sheet closes, then Swap / Add opens once it has gone (and back the same way).
  async function openSwap(rowId: string | null, exerciseId: string | null) {
    const gymId = data?.gymId ?? null;
    picker.open(() => services.exercisePicker.forTemplate(gymId));
    const choices = await services.builder.templateChoices({ gymId, inWorkout: exclude, exerciseId }).catch(() => ({ sections: [] as ChoiceSection[] }));
    setSwap({ rowId, exerciseId, sections: choices.sections.map((x) => ({ focus: x.focus, items: x.items.map((i) => ({ ...i })) })) });
    afterDismiss.arm(() => {
      setMode('swap');
    });
    setMode('to_swap');
  }

  function leaveSwap() {
    swapAfter.arm(() => {
      setMode('edit');
    });
    setMode('from_swap');
  }

  function picked(exerciseId: string) {
    const s = swap;
    setSwap(null);
    picker.close();
    leaveSwap();
    if (s === null || rows === null) return;
    if (s.rowId === null) {
      const last = rows.rows.at(-1)?.rowId ?? null;
      void exerciseWrite({ kind: 'add', rowId: newUuid(), fromExerciseId: null, toExerciseId: exerciseId, afterRowId: last, sets: 3, reps: { min: 8, max: 12 } }, DAY_SHEET_COPY.added);
      return;
    }
    void exerciseWrite({ kind: 'swap', rowId: s.rowId, fromExerciseId: s.exerciseId, toExerciseId: exerciseId }, DAY_SHEET_COPY.swapped);
  }

  /** A typed target for a changed row, kept as typed (the gym learns it). */
  function keepWeight(r: WorkoutListRow, rowId: string) {
    const v = Number(weight.replace(',', '.'));
    if (!(v > 0) || data === null) return;
    // The convention is the exercise's own (the service's); the number is kept as typed.
    void exerciseWrite({ kind: 'swap', rowId, fromExerciseId: r.exerciseId, toExerciseId: r.exerciseId, load: { value: v, unit: data.unit, convention: 'total' } }, `${r.name} ${String(v)}`);
    setWeight('');
  }

  const changed = new Set(sheet?.changed ?? []);
  const shownRows = pairedDaySheetRows(doneRows, pairs);
  const rowIdOf = (exerciseId: string) => rows?.rows.find((x) => x.exerciseId === exerciseId)?.rowId ?? null;
  const a = sheet?.actions;
  const status = sheet === null ? null : (
    <AppText variant="callout" color={sheet.status === 'today' ? 'accent' : 'text.secondary'}>
      {sheet.statusText}
    </AppText>
  );

  const dayContent =
    sheet === null || a === undefined ? null : (
      <>
        <View accessible accessibilityLabel={sheet.accessibilityLabel} style={{ gap: 2 }}>
          <AppText variant="title2" accessibilityRole="header">
            {sheet.title}
          </AppText>
          {status}
        </View>
        {sheet.list.length > 0 ? <WorkoutList rows={sheet.list} target={sheet.listTarget} changed={changed} /> : null}
        {shownRows.length > 0 ? (
          <Group>
            {shownRows.map((r) => (
              <DoneRow
                key={r.key}
                row={r}
                choosing={choosing === r.pair?.healthUuid}
                onOpen={openRow}
                onPair={(p) => {
                  const [only] = p.choices;
                  if (p.choices.length === 1 && only !== undefined) void pair(p.healthUuid, only.sessionId);
                  else setChoosing((c) => (c === p.healthUuid ? null : p.healthUuid));
                }}
                onChoose={(healthUuid, sessionId) => void pair(healthUuid, sessionId)}
                onUnpair={(u, sessionId) => void unpair(u.healthUuid, u.linkVersion, sessionId)}
              />
            ))}
          </Group>
        ) : null}
        {a.start && day !== null ? <PrimaryButton label={DAY_SHEET_COPY.start} onPress={() => { onStart(day.key); }} /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['5'] }}>
          {a.doToday !== null && day !== null ? (
            <TextButton
              label={DAY_SHEET_COPY.doToday}
              onPress={() => {
                const d = a.doToday;
                if (d === null || day.dayIndex === null) {
                  if (d?.kind === 'pick') onPick(day.key);
                  return;
                }
                if (d.kind === 'pick') onPick(day.key);
                else if (d.kind === 'swap_days') void weekWrite({ kind: 'swap_days', dayIndex: day.dayIndex, withDayIndex: d.withDayIndex }, DAY_SHEET_COPY.doingToday(day.name));
                else void weekWrite({ kind: 'move', dayIndex: day.dayIndex, weekday: d.weekday }, DAY_SHEET_COPY.doingToday(day.name));
              }}
            />
          ) : null}
          {a.moveTo.length > 0 ? <TextButton label={DAY_SHEET_COPY.moveTo} onPress={() => { setMoving((m) => !m); }} /> : null}
          {a.edit ? <TextButton label={DAY_SHEET_COPY.edit} onPress={() => { setMode('edit'); }} /> : null}
          {a.skip && day?.dayIndex != null ? <TextButton label={DAY_SHEET_COPY.skip} tone="secondary" onPress={() => void weekWrite({ kind: 'skip', dayIndex: day.dayIndex ?? 0 }, DAY_SHEET_COPY.skipped(day.name))} /> : null}
          {onMore !== undefined ? <TextButton label={DAY_SHEET_COPY.more} tone="secondary" onPress={onMore} /> : null}
          {a.unskip && day?.dayIndex != null ? <TextButton label={DAY_SHEET_COPY.unskip} onPress={() => void weekWrite({ kind: 'unskip', dayIndex: day.dayIndex ?? 0 }, DAY_SHEET_COPY.unskipped(day.name))} /> : null}
        </View>
        {moving && day?.dayIndex != null ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            {a.moveTo.map((m) => (
              <Chip key={m.weekday} size="min" label={m.label} selected={false} onPress={() => { setMoving(false); void weekWrite({ kind: 'move', dayIndex: day.dayIndex ?? 0, weekday: m.weekday }, DAY_SHEET_COPY.movedTo(day.name, m.label)); }} />
            ))}
          </View>
        ) : null}
      </>
    );

  const selected = sheet?.list.find((r) => r.key === row) ?? null;
  const editContent =
    sheet === null ? null : (
      <>
        <AppText variant="title2" accessibilityRole="header">
          {sheet.title}
        </AppText>
        <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          <Chip size="min" label={DAY_SHEET_COPY.thisWeek} selected={scope === 'week'} onPress={() => { setScope('week'); }} />
          <Chip size="min" label={DAY_SHEET_COPY.everyWeek} selected={scope === 'every'} onPress={() => { setScope('every'); }} />
        </View>
        <WorkoutList rows={sheet.list} target={sheet.listTarget} changed={changed} onRow={(r) => { setRow((cur) => (cur === r.key ? null : r.key)); setWeight(''); }} />
        {selected !== null ? (
          <View style={{ gap: theme.space['2'] }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['5'] }}>
              <TextButton label={DAY_SHEET_COPY.swap} onPress={() => void openSwap(rowIdOf(selected.exerciseId), selected.exerciseId)} />
              <TextButton
                label={DAY_SHEET_COPY.remove}
                tone="secondary"
                onPress={() => {
                  const rid = rowIdOf(selected.exerciseId);
                  setRow(null);
                  if (rid !== null) void exerciseWrite({ kind: 'remove', rowId: rid, fromExerciseId: selected.exerciseId, toExerciseId: null }, DAY_SHEET_COPY.removed);
                }}
              />
            </View>
            {changed.has(selected.exerciseId) ? (
              <TextField
                accessibilityLabel={`${selected.fullName} target`}
                keyboardType="decimal-pad"
                placeholder={selected.target}
                value={weight}
                onChangeText={setWeight}
                onSubmitEditing={() => {
                  const rid = rowIdOf(selected.exerciseId);
                  if (rid !== null) keepWeight(selected, rid);
                }}
              />
            ) : null}
          </View>
        ) : null}
        <TextButton label={`＋ ${DAY_SHEET_COPY.add}`} onPress={() => void openSwap(null, null)} />
      </>
    );

  return (
    <>
      <BottomCard
        visible={open && (mode === 'day' || mode === 'edit') && sheet !== null}
        onClose={() => {
          if (mode === 'edit') setMode('day');
          else onClose();
        }}
        onDismissed={afterDismiss.dismissed}
        footer={<TextButton label={mode === 'edit' ? DAY_SHEET_COPY.done : TODAY_V2_COPY.close} tone="secondary" onPress={() => { if (mode === 'edit') setMode('day'); else onClose(); }} />}
      >
        {mode === 'edit' ? editContent : dayContent}
      </BottomCard>
      <SwapSheet
        visible={open && mode === 'swap'}
        title={swap?.rowId === null ? DAY_SHEET_COPY.add : DAY_SHEET_COPY.swap}
        sections={swap?.sections ?? []}
        actionWord={swap?.rowId === null ? DAY_SHEET_COPY.add : DAY_SHEET_COPY.swap}
        onPick={picked}
        onClose={() => {
          setSwap(null);
          picker.close();
          leaveSwap();
        }}
        onDismissed={swapAfter.dismissed}
        picker={{
          view: pickerView,
          query: picker.query,
          onQuery: picker.setQuery,
          index: picker.index,
          equipment: picker.equipment,
          onEquipment: picker.setEquipment,
          onChip: (g) => {
            picker.setGroup(g);
          },
          onAddOwn: () => undefined,
        }}
      />
    </>
  );
}

/**
 * One done row on the day sheet: its title and values (opens its Summary or page), and its pairing (Ben, 29 Oct):
 * `Pair` on a Health strength workout (a choice of the day's workouts when there are several), or on a paired workout
 * the Health facts after its own, the source small, and `Unpair`.
 */
export function DoneRow({
  row: r,
  choosing,
  onOpen,
  onPair,
  onChoose,
  onUnpair,
}: {
  row: PairedDaySheetRow;
  choosing: boolean;
  onOpen: (o: NonNullable<DaySheetOpen>) => void;
  onPair: (p: NonNullable<PairedDaySheetRow['pair']>) => void;
  onChoose: (healthUuid: string, sessionId: string) => void;
  onUnpair: (u: NonNullable<PairedDaySheetRow['unpair']>, sessionId: string) => void;
}) {
  const theme = useTheme();
  const open = r.open;
  const sessionId = open?.kind === 'summary' ? open.sessionId : null;
  return (
    <View>
      <View style={{ minHeight: 52, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['2'], flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
        <Pressable accessibilityRole={open === null ? 'text' : 'button'} accessibilityLabel={r.accessibilityLabel} disabled={open === null} onPress={() => { if (open !== null) onOpen(open); }} style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], opacity: pressed ? 0.7 : 1 })}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="body">{r.title}</AppText>
            {r.detail !== null ? (
              <AppText variant="callout" color="text.secondary" numeric>
                {r.detail}
              </AppText>
            ) : null}
            {r.note !== null ? (
              <AppText variant="callout" color="text.tertiary">
                {r.note}
              </AppText>
            ) : null}
          </View>
          {open !== null && r.pair === null && r.unpair === null ? <Icon name="chevron.right" size={14} color="text.tertiary" /> : null}
        </Pressable>
        {r.pair !== null ? <TextButton label={HEALTH_COPY.pair} accessibilityLabel={r.pair.choices.length === 1 ? `${HEALTH_COPY.pair} with ${r.pair.choices[0]?.label ?? ''}` : HEALTH_COPY.pair} onPress={() => { if (r.pair !== null) onPair(r.pair); }} /> : null}
        {r.unpair !== null && sessionId !== null ? <TextButton label={HEALTH_COPY.unpair} tone="secondary" onPress={() => { if (r.unpair !== null) onUnpair(r.unpair, sessionId); }} /> : null}
      </View>
      {choosing && r.pair !== null ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'], paddingHorizontal: theme.space['4'], paddingBottom: theme.space['2'] }}>
          {r.pair.choices.map((c) => (
            <Chip key={c.sessionId} size="min" label={c.label} selected={false} onPress={() => { if (r.pair !== null) onChoose(r.pair.healthUuid, c.sessionId); }} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
