import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId } from '@fizz/domain';
import type { RoutineExercise } from '@fizz/schemas';

import type { TextFile } from '../src/backup/backup-service';
import { PERSONAL_DOCUMENTS } from '../src/device/personal-files';
import { createEditorDraftStore, editorDraftKey, editorDraftToOffer, EDITOR_DRAFTS_MAX, parseEditorDrafts, type EditorDraft } from '../src/workout/editor-draft';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 26 Oct; app review finding 6) The one editor: `Time ±` like Your workout's (the template's sets and rests
 * fitted to the length, as edits he saves), and unsaved edits kept on the phone through a force-close
 * (`Resume edits` / `Discard`), the Save still one versioned write against the version they started from.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const memFile = (): TextFile & { text: string | null } => {
  const f = {
    text: null as string | null,
    read: () => Promise.resolve(f.text),
    write: (t: string) => {
      f.text = t;
      return Promise.resolve();
    },
  };
  return f;
};

describe('the editor’s Time ± (services.routines.fitTemplate)', () => {
  it('fits a saved workout’s sets to a shorter length and back up, the main lift untouched; nothing is written', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const slot = (key: string, n: number, sets: number): RoutineExercise => ({
      id: h.ids(),
      exerciseId: catalogueExerciseId(key),
      equipmentId: null,
      order: n,
      supersetGroup: null,
      setTemplates: Array.from({ length: sets }, () => ({ id: h.ids(), setType: 'working' as const, targetLoad: null, targetReps: { min: 8, max: 10 }, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS: null })),
      restBySetType: {},
      transitionRestS: null,
      progressionRuleId: null,
    });
    const exercises = [slot('barbell-bench-press', 0, 4), slot('cable-fly', 1, 4), slot('cable-triceps-pushdown', 2, 4), slot('dumbbell-lateral-raise', 3, 4)];
    const made = await s.routines.create({ edit: { name: 'Push A', exercises }, opId: 'new-push' });
    if (!made.ok) throw new Error(made.message);
    const stored = made.routine.exercises;
    const before = await s.routines.estimate({ exercises: stored, gymId });
    expect(before).not.toBeNull();
    const target = Math.max(15, Math.floor(((before ?? 60) - 15) / 5) * 5);

    const shorter = await s.routines.fitTemplate({ exercises: stored, gymId, minutes: target, defaultRestS: 120 });
    expect(shorter?.status).not.toBe('fits');
    if (shorter === null) return;
    // The main lift (bench, first compound) keeps every set; accessories keep at least 2 or go.
    const bench = shorter.exercises.find((e) => e.exerciseId === catalogueExerciseId('barbell-bench-press'));
    expect(bench?.setTemplates.filter((t) => t.setType === 'working')).toHaveLength(4);
    for (const e of shorter.exercises) expect(e.setTemplates.filter((t) => t.setType === 'working').length).toBeGreaterThanOrEqual(2);
    const after = await s.routines.estimate({ exercises: shorter.exercises, gymId });
    expect(after ?? 999).toBeLessThan(before ?? 0);
    if (shorter.status === 'fitted') expect(after ?? 999).toBeLessThanOrEqual(target);
    // Nothing written: the stored workout is as it was.
    expect((await s.routines.editor({ routineId: made.routine.id, gymId }))?.routine?.version).toBe(made.routine.version);

    const longer = await s.routines.fitTemplate({ exercises: shorter.exercises, gymId, minutes: (before ?? 60) + 30, defaultRestS: 120 });
    expect(longer?.status === 'fitted' || longer?.status === 'fits').toBe(true);
    for (const e of longer?.exercises ?? []) expect(e.setTemplates.filter((t) => t.setType === 'working').length).toBeLessThanOrEqual(4);
  });

  it('no gym or nothing to fit: null (the page says No change)', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    expect(await s.routines.fitTemplate({ exercises: [], gymId: null, minutes: 30, defaultRestS: 120 })).toBeNull();
  });
});

describe('editor drafts survive a force-close (editor-draft.ts)', () => {
  const U: Record<string, string> = { a: '00000000-0000-4000-8000-00000000000a', b: '00000000-0000-4000-8000-00000000000b', c: '00000000-0000-4000-8000-00000000000c' };
  const ex = (key: string): RoutineExercise => ({ id: U[key] ?? key, exerciseId: U[key] ?? key, equipmentId: null, order: 0, supersetGroup: null, setTemplates: [{ id: (U[key] ?? key).replace(/.$/, 'f'), setType: 'working', targetLoad: null, targetReps: { min: 8, max: 8 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null }], restBySetType: {}, transitionRestS: null, progressionRuleId: null });
  const draft = (key: string, edit: RoutineExercise[], base: RoutineExercise[] = [ex('a')]): EditorDraft => ({ key, savedAtUtc: '2026-10-26T10:00:00.000Z', baseVersion: 3, base: { name: 'Push A', exercises: base }, edit: { name: 'Push A', exercises: edit }, opId: 'save-op-1' });

  it('keys: a saved workout or plan day by its ID, New workout as `new`; a Save-sheet copy isn’t kept', () => {
    expect(editorDraftKey({ kind: 'edit', routineId: 'r1' })).toBe('edit:r1');
    expect(editorDraftKey({ kind: 'new' })).toBe('new');
    expect(editorDraftKey({ kind: 'save_as' })).toBeNull();
  });

  it('put / get / remove through a file, a relaunch reading the same file; newest first, at most 10', async () => {
    const file = memFile();
    const store = createEditorDraftStore(file);
    await store.put(draft('edit:r1', [ex('a'), ex('b')]));
    // A relaunch: a new store over the same file.
    const again = createEditorDraftStore(file);
    expect((await again.get('edit:r1'))?.edit.exercises.map((e) => e.id)).toEqual([U.a, U.b]);
    expect(await again.get('edit:r2')).toBeNull();
    for (let i = 0; i < 12; i += 1) await again.put(draft(`edit:x${String(i)}`, [ex('c')]));
    expect(parseEditorDrafts(file.text)).toHaveLength(EDITOR_DRAFTS_MAX);
    await again.remove('edit:x11');
    expect(await again.get('edit:x11')).toBeNull();
  });

  it('a damaged or hand-edited file is data: unreadable entries are dropped, never applied', () => {
    expect(parseEditorDrafts('not json')).toEqual([]);
    expect(parseEditorDrafts(JSON.stringify({ v: 2, drafts: [] }))).toEqual([]);
    const ok = draft('edit:r1', [ex('a'), ex('b')]);
    expect(parseEditorDrafts(JSON.stringify({ v: 1, drafts: [{ key: 'edit:r9', edit: 'drop table' }, ok] }))).toEqual([ok]);
  });

  it('offered back only when it changes something, and not once the save landed', () => {
    const d = draft('edit:r1', [ex('a'), ex('b')]);
    expect(editorDraftToOffer(null, { name: 'Push A', exercises: [ex('a')] })).toBeNull();
    expect(editorDraftToOffer(d, { name: 'Push A', exercises: [ex('a')] })).toBe(d);
    expect(editorDraftToOffer(draft('edit:r1', [ex('a')]), { name: 'Push A', exercises: [ex('a')] })).toBeNull();
    // The save went through before the app closed: the workout opens as the edits.
    expect(editorDraftToOffer(d, { name: 'Push A', exercises: [ex('a'), ex('b')] })).toBeNull();
  });

  it('Your data: Delete my data removes the file', () => {
    expect(PERSONAL_DOCUMENTS).toContain('editor-drafts.json');
  });

  const screen = readFileSync(join(import.meta.dirname, '../src/screens/builder/EditWorkoutScreen.tsx'), 'utf8');
  it('the screen: Resume / Discard on open; Save against the version the edits started from, with their op ID; Time ± as edits', () => {
    expect(screen).toContain('editorDraftToOffer(kept, { name: o.name, exercises: o.list })');
    expect(screen).toContain('text: EDITOR_DRAFT_COPY.resume');
    expect(screen).toContain('expected.current = kept.baseVersion;');
    expect(screen).toContain('opId.current = kept.opId;');
    expect(screen).toContain('async function save(next: RoutineEdit = edit, expectedVersion: number | null = expected.current)');
    // Autosave waits for the answer, so a kept draft is never overwritten by the workout as opened.
    expect(screen).toContain('if (draftKey === null || !draftReady || data === \'loading\' || data === null) return;');
    // Save and Cancel forget it.
    expect(screen.match(/forgetDraft\(\);/g)?.length).toBeGreaterThanOrEqual(4);
    expect(screen).toContain('<TimeNoteRow');
    expect(screen).toContain('services.routines.fitTemplate(');
    expect(screen).not.toContain('Edits are lost on Cancel or a\n * force-close');
  });
});
