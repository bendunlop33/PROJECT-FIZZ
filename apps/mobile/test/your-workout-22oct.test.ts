import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, slotsOf } from '@fizz/domain';
import type { Routine } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import { popupLinks } from '../src/builder/builder-view';
import type { AppServices } from '../src/services/app-services';
import { swapPainConfirm } from '../src/ui/swap-sheet-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Your workout, Ben's 22 Oct batch (the Workout overview's retirement follow-ups), on real SQLite, offline:
 * - the `May hurt` confirm before swapping to a flagged exercise (rule 9), as the overview had it;
 * - `How to` and `History` in the row pop-up, where the overview's rows had them.
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

describe('`How to` and `History` in the row pop-up', () => {
  it('History only for an exercise Ben has logged (with this gym’s item and gym); How to only when it has a guide', async () => {
    const { services: s } = await h.launch();
    const { routine } = await pushA(s);
    let snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-links'));
    // A never-logged exercise added on the page: no History.
    const added = await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: catalogueExerciseId('cable-fly') }, { opId: 'add-fly', basis: { version: snap.version } });
    snap = opened(added);
    const slotOf = (name: string) => slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.name === name);
    const bench = slotOf('Bench press');
    const fly = slotOf('Cable fly');
    expect(bench).toBeDefined();
    expect(fly).toBeDefined();
    expect(snap.facts[bench?.exerciseId ?? '']?.hasHistory).toBe(true);
    expect(snap.facts[fly?.exerciseId ?? '']?.hasHistory).toBe(false);
    const guides = new Set([fly?.exerciseId]);
    const howToOf = (x: { exerciseId: string; exerciseName: string }) => (guides.has(x.exerciseId) ? { catalogueKey: 'cable-fly', name: x.exerciseName } : null);
    const benchLinks = popupLinks(snap, bench?.key ?? '', howToOf);
    expect(benchLinks.howTo).toBeNull();
    expect(benchLinks.history).toEqual({ exerciseId: bench?.exerciseId, name: 'Bench press', ...(snap.items[bench?.key ?? ''] ? { equipmentId: snap.items[bench?.key ?? ''] } : {}), gymId: snap.gymId });
    expect(benchLinks.history?.equipmentId).toBeDefined();
    const flyLinks = popupLinks(snap, fly?.key ?? '', howToOf);
    expect(flyLinks).toEqual({ howTo: { catalogueKey: 'cable-fly', name: 'Cable fly' }, history: null });
    expect(popupLinks(snap, 'no-such-slot', howToOf)).toEqual({ howTo: null, history: null });
  });

  it('the pop-up shows the links only when given; Your workout closes the pop-up, then opens the guide or the history (source)', () => {
    const popup = read('ui/exercise-popup.tsx');
    expect(popup).toContain('label={POPUP_COPY.howTo}');
    expect(popup).toContain('label={POPUP_COPY.history}');
    expect(popup).toContain('{p.onHowTo !== undefined || p.onHistory !== undefined ? (');
    const page = read('screens/builder/BuilderWorkoutScreen.tsx');
    expect(page).toContain('popupLinks(snap, popupSlot, (x) => howToRouteFor(x, bundledHowToSources()))');
    expect(page).toMatch(/setPopup\(null\);\s*navigation\.navigate\('HowTo', howTo\);/);
    expect(page).toMatch(/setPopup\(null\);\s*navigation\.navigate\('ExerciseProgress', history\);/);
    // The active workout's pop-up is unchanged: it has its own menu's How to and History.
    expect(read('screens/workout/WorkoutScreen.tsx')).not.toContain('onHowTo=');
  });
});
