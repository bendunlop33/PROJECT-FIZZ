import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { LIFT_TARGET_COPY as C, readLiftTargetNumber, type LiftTargetChoice } from '@fizz/domain';
import type { LiftTarget, LiftTargetKind, WeightUnit } from '@fizz/schemas';

import { useServices } from '../shell/context';
import { AppText, BottomCard, Chip, ChipRow, CountStepper, KeyboardDoneAccessory, PrimaryButton, TextButton, TextField } from '../ui';
import type { LiftTargetWrite } from '../services/lift-target-service';

/** The Done bar on the weight keypad. */
const LIFT_TARGET_ACCESSORY_ID = 'lift-target-weight';

/** A toast after a lift-target write: the words, and Undo when there is one. */
export type LiftTargetToast = { text: string; undo?: () => void };

const FAILED: Record<Extract<LiftTargetWrite, { ok: false }>['reason'], string> = {
  stale: 'Changed elsewhere. Showing the latest.',
  invalid: 'Couldn’t save that value.',
  full: C.full,
  unknown_exercise: 'Couldn’t save that value.',
  no_profile: 'Couldn’t save. Try again.',
  failed: 'Couldn’t save. Try again.',
};

/**
 * Add or edit a lift target (Ben approved 20 Oct): the exercise (one he logs, his own included),
 * 1RM or weight × reps, the weight in kg or lb, the reps, an optional date. Save is one versioned
 * write with the sheet's operation ID (a double tap writes once); Remove and Save both toast Undo.
 * Values only (minimal copy). The service checks everything; nothing is computed here.
 */
export function LiftTargetSheet({
  visible,
  choices,
  existing,
  exerciseId,
  version,
  onClose,
  onDone,
}: {
  visible: boolean;
  choices: readonly LiftTargetChoice[];
  /** Editing this target. */
  existing: LiftTarget | null;
  /** Fixed exercise (exercise detail); null: Ben picks one. */
  exerciseId: string | null;
  version: number;
  onClose: () => void;
  onDone: (toast: LiftTargetToast | null) => void;
}) {
  return (
    <BottomCard visible={visible} onClose={onClose} scroll={false}>
      {visible ? <Body key={existing?.id ?? exerciseId ?? 'new'} choices={choices} existing={existing} exerciseId={exerciseId} version={version} onClose={onClose} onDone={onDone} /> : null}
    </BottomCard>
  );
}

function Body({ choices, existing, exerciseId, version, onClose, onDone }: { choices: readonly LiftTargetChoice[]; existing: LiftTarget | null; exerciseId: string | null; version: number; onClose: () => void; onDone: (toast: LiftTargetToast | null) => void }) {
  const services = useServices();
  const first = existing?.exerciseId ?? exerciseId ?? choices[0]?.exerciseId ?? null;
  const [picked, setPicked] = useState<string | null>(first);
  const choice = choices.find((c) => c.exerciseId === picked) ?? null;
  const [kind, setKind] = useState<LiftTargetKind>(existing?.kind ?? 'one_rm');
  const [weight, setWeight] = useState(existing === null ? '' : String(existing.load.value));
  const [unit, setUnit] = useState<WeightUnit>(existing?.load.unit ?? choice?.unit ?? 'kg');
  const [reps, setReps] = useState(existing?.kind === 'weight_reps' ? existing.reps : 5);
  const [date, setDate] = useState(existing?.byDate ?? '');
  const op = useRef(services.newId());
  const busy = useRef(false);

  const value = readLiftTargetNumber(weight);
  const dateOk = date.trim() === '' || /^\d{4}-\d{2}-\d{2}$/.test(date.trim());
  const canSave = choice !== null && value !== null && dateOk;

  async function save() {
    if (busy.current || choice === null || value === null) return;
    busy.current = true;
    try {
      const r = await services.liftTargets.set({ exerciseId: choice.exerciseId, kind, value, unit, reps: kind === 'one_rm' ? 1 : reps, byDate: date.trim() === '' ? null : date.trim(), expectedVersion: version, opId: op.current });
      if (!r.ok) {
        onDone({ text: FAILED[r.reason] });
        return;
      }
      const undoOp = services.newId();
      onDone({ text: C.saved, undo: () => void undo(choice.exerciseId, r.before, r.version, undoOp) });
    } finally {
      busy.current = false;
    }
  }

  async function remove() {
    if (busy.current || existing === null) return;
    busy.current = true;
    try {
      const r = await services.liftTargets.remove(existing.exerciseId, version, op.current);
      if (!r.ok) {
        onDone({ text: FAILED[r.reason] });
        return;
      }
      const undoOp = services.newId();
      onDone({ text: C.removed, undo: () => void undo(existing.exerciseId, r.before, r.version, undoOp) });
    } finally {
      busy.current = false;
    }
  }

  async function undo(id: string, previous: LiftTarget | null, at: number, opId: string) {
    const r = await services.liftTargets.restore(id, previous, at, opId);
    onDone(r.ok ? null : { text: FAILED[r.reason] });
  }

  const fixed = existing !== null || exerciseId !== null;
  return (
    <>
      <KeyboardDoneAccessory nativeID={LIFT_TARGET_ACCESSORY_ID} />
      {/* The fields scroll when they don't fit; Save stays pinned under them. */}
      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ gap: 16 }}>
        <AppText variant="headline">{existing === null ? C.add : (choice?.name ?? existing.exerciseName)}</AppText>
        {fixed ? (
          existing === null && choice !== null ? <AppText variant="body">{choice.name}</AppText> : null
        ) : (
          <ChipRow>
            {choices.map((c) => (
              <Chip
                key={c.exerciseId}
                label={c.name}
                selected={c.exerciseId === picked}
                onPress={() => {
                  setPicked(c.exerciseId);
                  setUnit(c.unit);
                }}
              />
            ))}
          </ChipRow>
        )}
        <ChipRow>
          <Chip label={C.oneRm} selected={kind === 'one_rm'} onPress={() => { setKind('one_rm'); }} />
          <Chip label={C.weightReps} selected={kind === 'weight_reps'} onPress={() => { setKind('weight_reps'); }} />
        </ChipRow>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <TextField accessibilityLabel={`Weight in ${unit}${choice?.convention === 'per_hand' ? ', each' : ''}`} keyboardType="decimal-pad" inputAccessoryViewID={LIFT_TARGET_ACCESSORY_ID} placeholder={choice?.convention === 'per_hand' ? `${unit} each` : unit} value={weight} onChangeText={setWeight} />
          </View>
          {(['kg', 'lb'] as const).map((u) => (
            <Chip key={u} label={u} selected={unit === u} onPress={() => { setUnit(u); }} />
          ))}
        </View>
        {kind === 'weight_reps' ? <CountStepper label="Reps" value={reps} limits={{ min: 1, max: 30 }} fewerLabel="Fewer reps" moreLabel="More reps" onChange={setReps} /> : null}
        <TextField accessibilityLabel="Date, optional" placeholder="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      </ScrollView>
      <View style={{ gap: 8 }}>
        <PrimaryButton label="Save" disabled={!canSave} onPress={() => void save()} />
        {existing !== null ? <TextButton label={C.remove} tone="secondary" onPress={() => void remove()} /> : null}
        <TextButton label="Cancel" tone="secondary" onPress={onClose} />
      </View>
    </>
  );
}
