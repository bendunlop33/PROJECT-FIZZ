import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import type { OverviewRow, StepTarget } from '@fizz/domain';

import type { AddSheet } from '../../services/workout-services';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Chip, ChipRow, Icon, NumberStepper, PrimaryButton, SetCountBar, SubstituteRowView, TextButton, TextField } from '../../ui';
import { SET_BAR } from '../../workout/set-shape-view';
import { cardioDraftWith, EDIT_MODE_COPY, repsDraftOf, repsDraftValid, repsDraftWith, repsPayload, repsSteps, TODAY_EDITS_COPY, type RepsDraft } from '../../workout/overview-edits';
import { OVERVIEW_COPY } from '../../workout/overview';

/**
 * Edit mode's small sheets (overview-today-edits §11.4): `Reps · Incline DB
 * press`, today's target load, and `Add exercise`. They hold only what Ben is
 * typing; every value they send is checked and fitted by the services and
 * domain (rule 4), and nothing here calls the coach. `BottomCard` fades
 * instead of sliding under Reduce Motion.
 */

/** `RepsSheet` (§11.4): Range / Exact, `[−] 8 [+] to [−] 10 [+]`, or Work time; `Use planned` only when edited; `Done` writes one edit. */
export function RepsSheet({ row, onDone, onUsePlanned, onClose }: { row: OverviewRow | null; onDone: (payload: ReturnType<typeof repsPayload>) => void; onUsePlanned: () => void; onClose: () => void }) {
  const theme = useTheme();
  const [draft, setDraft] = useState<RepsDraft | null>(null);
  useEffect(() => {
    setDraft(row === null ? null : repsDraftOf(row.editRow));
  }, [row?.slotKey, row?.editRow.repsText]);
  const d = draft;
  const steps = d === null ? null : repsSteps(d);
  const off: StepTarget = { enabled: false, reason: '' };
  return (
    <BottomCard visible={row !== null} onClose={onClose} closeLabel={EDIT_MODE_COPY.done}>
      {row !== null && d !== null && steps !== null ? (
        <View style={{ gap: theme.space['4'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
            <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
              {EDIT_MODE_COPY.repsTitle(row.name)}
            </AppText>
            <TextButton
              label={EDIT_MODE_COPY.done}
              disabled={!repsDraftValid(d)}
              onPress={() => {
                onDone(repsPayload(d, row.editRow.plannedReps));
              }}
            />
          </View>
          {d.kind === 'cardio' ? (
            // Cardio (review S1): a time up to 4 h, typed as the machine shows it, and a distance.
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
              <NumberStepper label="Time" unit={null} value={d.seconds} decimals={false} time onSurface down={steps.time?.down ?? off} up={steps.time?.up ?? off} onChange={(v) => { setDraft(cardioDraftWith(d, 'time', v)); }} />
              <NumberStepper label="Distance" unit="m" value={d.distanceM} decimals onSurface down={steps.distance?.down ?? off} up={steps.distance?.up ?? off} onChange={(v) => { setDraft(cardioDraftWith(d, 'distance', v)); }} />
            </View>
          ) : d.kind === 'time' ? (
            <NumberStepper
              label={EDIT_MODE_COPY.workTime}
              unit="s"
              value={d.seconds}
              decimals={false}
              onSurface
              down={steps.time?.down ?? off}
              up={steps.time?.up ?? off}
              onChange={(v) => {
                setDraft(repsDraftWith(d, 'time', v ?? 0));
              }}
            />
          ) : (
            <>
              <ChipRow>
                <Chip label={EDIT_MODE_COPY.range} selected={!d.exact} onPress={() => { setDraft(repsDraftWith(d, 'range')); }} />
                <Chip label={EDIT_MODE_COPY.exact} selected={d.exact} onPress={() => { setDraft(repsDraftWith(d, 'exact')); }} />
              </ChipRow>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
                <NumberStepper
                  label={d.exact ? 'Reps' : 'From'}
                  unit={null}
                  value={d.min}
                  decimals={false}
                  onSurface
                  down={steps.from?.down ?? off}
                  up={steps.from?.up ?? off}
                  onChange={(v) => {
                    setDraft(repsDraftWith(d, 'from', v ?? 1));
                  }}
                />
                {!d.exact ? (
                  <NumberStepper
                    label="To"
                    unit={null}
                    value={d.max}
                    decimals={false}
                    onSurface
                    down={steps.to?.down ?? off}
                    up={steps.to?.up ?? off}
                    onChange={(v) => {
                      setDraft(repsDraftWith(d, 'to', v ?? d.min));
                    }}
                  />
                ) : null}
              </View>
            </>
          )}
          {row.editRow.repsEdited ? <TextButton label={EDIT_MODE_COPY.usePlanned} tone="secondary" onPress={onUsePlanned} /> : null}
        </View>
      ) : null}
    </BottomCard>
  );
}

/**
 * Today's target load (§11.4): a stepper over this gym's achievable loads
 * with typed entry (the editor's Fixed load control), in the row's frame
 * (`kg each`, stack, assisted). A value the gym can't make shows its note
 * before saving (`Rounds to 97.5 kg here`, `Most here: 30 kg each`); the row
 * then shows the fitted value. `Set target` is the sheet's primary.
 */
export function LoadSheet({
  row,
  keypad,
  onValue,
  onSet,
  onUsePlanned,
  onClose,
}: {
  row: OverviewRow | null;
  keypad: { value: number | null; down: StepTarget; up: StepTarget; note: string | null } | null;
  onValue: (v: number | null) => void;
  onSet: () => void;
  onUsePlanned: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const frame = row?.editRow.keypad ?? null;
  const assist = frame?.convention === 'assistance';
  return (
    <BottomCard visible={row !== null && frame !== null} onClose={onClose}>
      {row !== null && frame !== null && keypad !== null ? (
        <View style={{ gap: theme.space['4'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
            <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
              {row.name}
            </AppText>
            <TextButton label={TODAY_EDITS_COPY.close} tone="secondary" onPress={onClose} />
          </View>
          <NumberStepper label={assist ? 'Assist' : OVERVIEW_COPY.target} unit={`${frame.unit}${frame.convention === 'per_hand' ? ' each' : ''}`} value={keypad.value} decimals down={keypad.down} up={keypad.up} onChange={onValue} warning={keypad.note !== null} onSurface />
          {keypad.note !== null ? (
            <View accessible accessibilityLabel={keypad.note} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="exclamationmark.triangle" color="status.warning" size={14} />
              <AppText variant="callout" color="text.secondary" numeric style={{ flex: 1 }}>
                {keypad.note}
              </AppText>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'] }}>
            {row.editRow.benLoad ? <TextButton label={EDIT_MODE_COPY.usePlanned} tone="secondary" onPress={onUsePlanned} /> : <View />}
            <View style={{ flex: 1 }}>
              <PrimaryButton label={EDIT_MODE_COPY.setTarget} disabled={keypad.value === null} onPress={onSet} />
            </View>
          </View>
        </View>
      ) : null}
    </BottomCard>
  );
}

/**
 * `Add exercise` (§11.4): pick one; this gym's exercises only (`Show all`
 * turns that off), today's plan hidden, `⚠ May hurt` marked and confirmed
 * (EL9). Each row shows the target the pick will plan. Empty here:
 * `Nothing else here at Main gym.` + `Show all`.
 */
export function AddExerciseSheet({
  visible,
  sheet,
  loading,
  query,
  onQuery,
  onShowAll,
  onPick,
  onClose,
  stacked,
  sets,
  onSets,
}: {
  visible: boolean;
  sheet: AddSheet | null;
  loading: boolean;
  query: string;
  onQuery: (q: string) => void;
  onShowAll: () => void;
  onPick: (row: AddSheet['rows'][number]) => void;
  onClose: () => void;
  stacked: boolean;
  /** The `Sets` bar (exercise-library §10.2): how many working sets a row tap adds. */
  sets: number;
  onSets: (n: number) => void;
}) {
  const theme = useTheme();
  return (
    <BottomCard visible={visible} onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'] }}>
        <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
          {EDIT_MODE_COPY.addExercise}
        </AppText>
        <TextButton label={TODAY_EDITS_COPY.close} tone="secondary" onPress={onClose} />
      </View>
      <TextField value={query} onChangeText={onQuery} placeholder={EDIT_MODE_COPY.search} accessibilityLabel={EDIT_MODE_COPY.search} autoCorrect={false} returnKeyType="search" />
      {sheet !== null && sheet.rows.length > 0 ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
          <View style={{ alignItems: 'flex-end', paddingBottom: theme.space['1'] }}>
            <AppText variant="sectionLabel" color="text.tertiary">
              {OVERVIEW_COPY.target}
            </AppText>
          </View>
          {sheet.rows.map((r) => (
            <SubstituteRowView key={r.exerciseId} row={r} stacked={stacked} onPress={() => { onPick(r); }} />
          ))}
          {!sheet.showAll ? <TextButton label={EDIT_MODE_COPY.showAll} tone="secondary" onPress={onShowAll} /> : null}
        </ScrollView>
      ) : sheet !== null ? (
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="body" color="text.secondary">
            {EDIT_MODE_COPY.nothingHere(sheet.gymName)}
          </AppText>
          {!sheet.showAll ? <TextButton label={EDIT_MODE_COPY.showAll} onPress={onShowAll} /> : null}
        </View>
      ) : !loading ? (
        <AppText variant="body" color="text.secondary">
          {OVERVIEW_COPY.loadFailed}
        </AppText>
      ) : null}
      <SetCountBar value={sets} limits={SET_BAR.limits} onChange={onSets} />
    </BottomCard>
  );
}
