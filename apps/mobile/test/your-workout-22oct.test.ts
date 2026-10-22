import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, slotsOf } from '@fizz/domain';
import type { Routine } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { swapPainConfirm } from '../src/ui/swap-sheet-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Your workout, Ben's 22 Oct batch (the Workout overview's retirement follow-ups), on real SQLite, offline:
 * - the `May hurt` confirm before swapping to a flagged exercise (rule 9), as the overview had it.
 */

const DAY = 86_400_000;
const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-05T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const opened = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status === 'written' || r.status === 'replayed') return r.snapshot;
  throw new Error(`open ${r.status}: ${r.message}`);
};

async function saved(s: AppServices, sessionId: string, name: string): Promise<Routine> {
  const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name, addToRotation: true, opId: `save-${name}` });
  if (!r.ok) throw new Error(r.message);
  return r.routine;
}

async function pushA(s: AppServices) {
  const gymId = await setUpGym(h, s);
  const sid = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }, { load: 60, reps: 8, rpe: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 8, reps: 12 }] },
  ]);
  h.clockMs += DAY;
  return { gymId, routine: await saved(s, sid, 'Push A') };
}

describe('the `May hurt` confirm before a swap (rule 9)', () => {
  it('a flagged pick asks first, naming the flag; `Choose another` / `Swap anyway` (`Add anyway` when adding); an unflagged pick goes straight through', () => {
    expect(swapPainConfirm({ name: 'Overhead press', mayHurt: true, painLine: 'Shoulder pain flagged 6 Oct.' }, 'Swap')).toEqual({ title: 'Overhead press may hurt', message: 'Shoulder pain flagged 6 Oct.', cancel: 'Choose another', confirm: 'Swap anyway' });
    expect(swapPainConfirm({ name: 'Overhead press', mayHurt: true }, 'Add')).toEqual({ title: 'Overhead press may hurt', message: null, cancel: 'Choose another', confirm: 'Add anyway' });
    expect(swapPainConfirm({ name: 'Cable fly', mayHurt: false, painLine: null }, 'Swap')).toBeNull();
  });

  it('Your workout’s Swap list marks a flagged exercise `May hurt` with its flag line; the sheet confirms before picking it', async () => {
    const { services: s } = await h.launch();
    const { routine } = await pushA(s);
    const fly = catalogueExerciseId('cable-fly');
    expect((await s.pain.flagMovement({ exerciseId: fly, exerciseName: 'Cable fly', opId: 'pain-fly' })).ok).toBe(true);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-push'));
    const bench = slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.name === 'Bench press');
    const choices = await s.builder.exerciseChoices(snap.draftId, { slotKey: bench?.key ?? null, group: 'Chest' });
    const items = choices?.sections.flatMap((sec) => sec.items) ?? [];
    const flagged = items.find((i) => i.exerciseId === fly);
    expect(flagged).toMatchObject({ name: 'Cable fly', mayHurt: true, painLine: 'Pain flagged 6\u00a0Oct.' });
    expect(swapPainConfirm(flagged ?? { name: '', mayHurt: false }, 'Swap')).toMatchObject({ title: 'Cable fly may hurt', message: 'Pain flagged 6\u00a0Oct.', confirm: 'Swap anyway', cancel: 'Choose another' });
    for (const other of items.filter((i) => i.exerciseId !== fly)) expect(other).toMatchObject({ mayHurt: false, painLine: null });
  });

  it('the shared Swap sheet asks with that confirm before `onPick` (source)', () => {
    const sheet = read('ui/swap-sheet.tsx');
    expect(sheet).toContain('const c = swapPainConfirm(it, actionWord);');
    expect(sheet).toContain('Alert.alert(c.title, c.message ?? undefined, [');
    expect(sheet).toContain("{ text: c.cancel, style: 'cancel' },");
  });
});
