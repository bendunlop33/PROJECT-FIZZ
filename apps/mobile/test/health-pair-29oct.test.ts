import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toMs } from '@fizz/domain';

import { pairedDaySheetRows, daySheetRows } from '../src/today/today-view';
import type { ImportDraft } from '../src/import/import-service';
import type { AppServices } from '../src/services/app-services';
import { FakeHealth, OWN } from './fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 29 Oct, build 484: "These two strength sessions should be linkable? Why no option to pair workouts
 * together") Real SQLite and a fake HealthKit. Ben's Monday 26: `Legs · Back squat` (22 sets) and a 59 min Garmin
 * Connect `Strength` that started a few minutes before it. Read on Thursday 29.
 *
 * What kept them apart: the day sheet never offered a link (its Health row only opened a second sheet while the day
 * sheet was still closing), and the auto-link counted the app's own Health copy of the workout as a second strength
 * workout that day whenever that copy's source wasn't this build's bundle (an older build's): two that day, so nothing
 * automatic. An imported FitNotes workout (date only, no end) could not be linked anywhere.
 */

let h: Harness;
let fake: FakeHealth;
beforeEach(() => {
  // Monday 26 Oct 2026, 18:00 in London (GMT).
  h = createHarness('2026-10-26T18:00:00.000Z');
  fake = new FakeHealth();
});
afterEach(async () => {
  await h.cleanup();
});

const THU = Date.parse('2026-10-29T08:00:00.000Z');
const MON = '2026-10-26';
const sets = (n: number) => Array.from({ length: n }, () => ({ load: 100, reps: 5 }));

async function launch(): Promise<AppServices> {
  return (await h.launch({ health: { port: fake, buildIncludesHealth: true } })).services;
}

/** Ben's Monday: 22 sets of legs, logged live. Returns its ID and start. */
async function bensMonday(s: AppServices, gymId: string): Promise<{ id: string; startMs: number }> {
  const startMs = h.clockMs;
  const id = await logWorkout(h, s, gymId, [
    { exercise: 'Back squat', sets: sets(8) },
    { exercise: 'Romanian deadlift', sets: sets(7) },
    { exercise: 'Leg press', sets: sets(7) },
  ]);
  return { id, startMs };
}

/** Garmin Connect's 59 min Strength (HKWorkoutActivityType 50), starting `offsetMin` from `startMs`. */
const garminStrength = (startMs: number, offsetMin = -4) => fake.addGarmin({ activityType: 50, startMs: startMs + offsetMin * 60_000, endMs: startMs + (offsetMin + 59) * 60_000, sourceName: 'Connect' });

async function readHealth(s: AppServices): Promise<void> {
  await s.health.setSwitch('readActivities', true);
  await s.health.setSwitch('readHeartRate', true);
  await s.health.readNow();
}

/** Today's week tiles, Mon 26 – Sun 1, as `26 dot:legs` (marks). */
async function monTile(s: AppServices): Promise<string[]> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  const t = s.todaySession.week(d, null).find((x) => x.date === MON);
  return t?.marks.map((m) => `${m.shape}:${m.planned ? 'planned' : 'done'}`) ?? [];
}

/** The day sheet's rows on Monday, as Today builds them, with the pairing. */
async function mondayRows(s: AppServices) {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  const tile = s.todaySession.week(d, null).find((x) => x.date === MON);
  if (tile === undefined) throw new Error('no tile');
  return pairedDaySheetRows(daySheetRows(tile, d.week.feed, () => null), await s.health.dayPairs(MON));
}

describe('Ben’s Monday (build 484): why it did not pair, and Pair in the day sheet', () => {
  it('root cause: the app’s own Health copy from an older build was counted as a second strength workout; now it auto-links, one dot', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    await s.health.setSwitch('writeWorkouts', true);
    h.clockMs += 60_000;
    const { id, startMs } = await bensMonday(s, gymId);
    expect((await s.workout.load(id))?.aggregate.sets.filter((x) => x.status === 'completed')).toHaveLength(22);
    await s.health.syncWrites();
    // The app's Health copy of Monday, as an older build (another bundle) wrote it.
    const [copy] = fake.ownWorkouts();
    if (copy === undefined) throw new Error('no copy');
    fake.workouts.set(copy.uuid, { ...copy, sourceBundleId: `${OWN}.olderbuild`.replace(OWN, 'com.projectfizz.fizz-old') });
    const g = garminStrength(startMs);
    h.clockMs = THU;
    await readHealth(s);
    expect(await s.health.forWorkout(id)).toMatchObject({ kind: 'linked', healthUuid: g });
    // One row, one dot: the app workout with Garmin's facts.
    expect(await monTile(s)).toEqual(['dot:done']);
    const rows = await mondayRows(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'Garmin', note: 'Paired with Garmin', pair: null, unpair: { healthUuid: g } });
    expect(rows[0]?.detail).toMatch(/· 22 sets · avg 128\u00a0bpm$/);
  });

  it('times close but not exact, nothing automatic (a `Not it` record): the day sheet’s Pair links with one tap; Undo; Unpair; sets untouched', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    h.clockMs += 60_000;
    const { id, startMs } = await bensMonday(s, gymId);
    const before = JSON.stringify((await s.workout.load(id))?.aggregate.sets);
    const g = garminStrength(startMs, -3);
    h.clockMs = THU;
    await s.health.setSwitch('readActivities', true);
    // Ben once said `Not it` (or unlinked it): never automatic again, still pairable by hand.
    expect((await s.health.notIt({ healthUuid: g, sessionId: id, opId: 'not-it' })).ok).toBe(true);
    await readHealth(s);
    expect((await s.health.forWorkout(id)).kind).toBe('none');
    // Before: a dot and a ring on Monday, two rows, and (now) Pair on the Health row.
    expect(await monTile(s)).toEqual(['dot:done', 'ring:done']);
    let rows = await mondayRows(s);
    expect(rows.map((r) => r.key)).toEqual([`w:${id}`, `a:${g}`]);
    const health = rows[1];
    expect(health?.pair?.choices.map((c) => c.sessionId)).toEqual([id]);
    expect(health?.pair?.choices[0]?.label).toMatch(/ · \d\d:\d\d/);
    // One tap: one versioned link; a replay of the same op is the same write.
    const r = await s.health.link({ healthUuid: g, sessionId: id, opId: 'pair-1' });
    if (!r.ok) throw new Error(r.message);
    expect(await s.health.link({ healthUuid: g, sessionId: id, opId: 'pair-1' })).toEqual(r);
    expect(await monTile(s)).toEqual(['dot:done']);
    rows = await mondayRows(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.unpair).toEqual({ healthUuid: g, linkVersion: r.version });
    expect(rows[0]?.detail).toContain('avg 128\u00a0bpm');
    // A stale Unpair (an older version) is refused; Undo (unlink on what Pair wrote) splits them again.
    expect((await s.health.unlink({ healthUuid: g, expectedVersion: r.version - 1, opId: 'stale' })).ok).toBe(false);
    const u = await s.health.unlink({ healthUuid: g, expectedVersion: r.version, opId: 'undo-1' });
    expect(u.ok).toBe(true);
    expect(await monTile(s)).toEqual(['dot:done', 'ring:done']);
    expect((await mondayRows(s))[1]?.pair).not.toBeNull();
    // Pair again, then Unpair from the paired row, then its Undo (pair again).
    const r2 = await s.health.link({ healthUuid: g, sessionId: id, opId: 'pair-2' });
    if (!r2.ok) throw new Error(r2.message);
    expect((await s.health.unlink({ healthUuid: g, expectedVersion: r2.version, opId: 'unpair-1' })).ok).toBe(true);
    expect((await s.health.link({ healthUuid: g, sessionId: id, opId: 'undo-unpair' })).ok).toBe(true);
    expect(await monTile(s)).toEqual(['dot:done']);
    // The workout's sets never changed (rule 2).
    expect(JSON.stringify((await s.workout.load(id))?.aggregate.sets)).toBe(before);
    // The same Pair is on the Summary (linked) and History (the linked mark).
    expect((await s.health.forWorkout(id)).kind).toBe('linked');
    const feed = await s.history.feed();
    expect(feed.items.find((i) => i.kind === 'workout' && i.sessionId === id)).toMatchObject({ linkedSource: 'Garmin' });
    // Survives a restart.
    await h.forceClose();
    const s2 = await launch();
    expect((await s2.health.forWorkout(id)).kind).toBe('linked');
  });

  it('two workouts that day: Pair offers a choice, nearest first; never a workout on another day', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    // Sunday evening, Monday 07:00 and Monday 18:00; Garmin's Strength on Monday evening.
    h.clockMs = Date.parse('2026-10-25T18:00:00.000Z');
    const sun = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: sets(3) }]);
    h.clockMs = Date.parse('2026-10-26T07:00:00.000Z');
    const am = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: sets(3) }]);
    h.clockMs = Date.parse('2026-10-26T18:00:00.000Z');
    const { id: pm, startMs } = await bensMonday(s, gymId);
    const g = garminStrength(startMs);
    // A Garmin Strength on Sunday too, with no workout near it that day but Sunday's.
    h.clockMs = THU;
    await readHealth(s);
    // Two that day: nothing automatic.
    expect((await s.health.forWorkout(pm)).kind).toBe('question');
    const rows = await mondayRows(s);
    const healthRow = rows.find((r) => r.key === `a:${g}`);
    expect(healthRow?.pair?.choices.map((c) => c.sessionId)).toEqual([pm, am]);
    expect(healthRow?.pair?.choices.map((c) => c.sessionId)).not.toContain(sun);
    expect((await s.health.dayPairs('2026-10-25')).unpaired).toEqual({});
    expect((await s.health.link({ healthUuid: g, sessionId: pm, opId: 'pair-pm' })).ok).toBe(true);
    // Paired: the other workout of the day stays as it was.
    const after = await mondayRows(s);
    expect(after.map((r) => [r.key, r.unpair === null ? null : 'unpair'])).toEqual(
      expect.arrayContaining([
        [`w:${pm}`, 'unpair'],
        [`w:${am}`, null],
      ]),
    );
    expect(after.some((r) => r.key === `a:${g}`)).toBe(false);
  });

  it('an imported FitNotes workout (date only) pairs by hand on its own date, never automatically; History offers Link too', async () => {
    const s = await launch();
    await setUpGym(h, s);
    h.clockMs = Date.parse('2026-10-27T20:00:00.000Z');
    const opened = await s.imports.open({ name: 'FitNotes_Export.csv', text: ['Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time', ...Array.from({ length: 22 }, () => '2026-10-26,Back Squat,Legs,100.0,5,,,')].join('\n') });
    if (opened.kind !== 'preview') throw new Error(`expected a preview, got ${opened.kind}`);
    let draft: ImportDraft = opened.draft;
    for (const n of draft.analysis.names.filter((x) => x.needsAnswer)) {
      if (!n.match.exerciseId) continue;
      const r = await s.imports.answer(draft.draftId, draft.mappingVersion, { kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId } });
      if (!r.ok) throw new Error(r.reason);
      draft = r.draft;
    }
    for (const change of [draft.analysis.total?.open ? ({ kind: 'total', answer: 'total' } as const) : null, draft.analysis.perHand?.open ? ({ kind: 'per_hand', answer: 'each' } as const) : null]) {
      if (change === null) continue;
      const r = await s.imports.answer(draft.draftId, draft.mappingVersion, change);
      if (!r.ok) throw new Error(r.reason);
      draft = r.draft;
    }
    const committed = await s.imports.commit(draft.draftId, draft.mappingVersion, 'import-1');
    if (!committed.ok) throw new Error(committed.reason);
    const feed = await s.history.feed();
    const imported = feed.items.find((i) => i.kind === 'workout' && i.source === 'import' && i.localDate === MON);
    if (imported?.kind !== 'workout') throw new Error('no import');
    const g = garminStrength(Date.parse('2026-10-26T18:00:00.000Z'));
    h.clockMs = THU;
    await readHealth(s);
    // Never automatic (no times).
    expect((await s.health.forWorkout(imported.sessionId)).kind).toBe('question');
    const rows = await mondayRows(s);
    const healthRow = rows.find((r) => r.key === `a:${g}`);
    expect(healthRow?.pair?.choices).toEqual([{ sessionId: imported.sessionId, label: imported.title }]);
    const h2 = (await s.history.feed()).items.find((i) => i.kind === 'activity' && i.activityId === g);
    expect(h2?.kind === 'activity' ? h2.linkTo?.sessionId : null).toBe(imported.sessionId);
    expect((await s.health.link({ healthUuid: g, sessionId: imported.sessionId, opId: 'pair-import' })).ok).toBe(true);
    expect((await s.health.forWorkout(imported.sessionId)).kind).toBe('linked');
    expect(await monTile(s)).toEqual(['dot:done']);
  });

  it('restored from a backup that predates the link: once reading is on again, the read links it; one dot', async () => {
    let s = await launch();
    const gymId = await setUpGym(h, s);
    h.clockMs += 60_000;
    const { id, startMs } = await bensMonday(s, gymId);
    const files = [...h.backupFiles.keys()].filter((n) => n.endsWith('-auto.json')).sort();
    const text = await s.restore.readOnPhone(files.at(-1) ?? '');
    if (text === null) throw new Error('no backup');
    const g = garminStrength(startMs, -2);
    h.clockMs = Date.parse('2026-10-27T09:00:00.000Z');
    await readHealth(s);
    expect((await s.health.forWorkout(id)).kind).toBe('linked');
    // Restore (27 Oct): the backup predates the link.
    const p = await s.restore.prepare(text);
    if (!p.ok) throw new Error('no preview');
    expect(await s.restore.restore(text, p.preview.stamp)).toMatchObject({ ok: true });
    await h.forceClose();
    s = await launch();
    h.clockMs = THU;
    // The Health switches are this install's own (not in backups): after a restore they are off until Ben turns them on.
    await s.health.readNow();
    expect((await s.health.forWorkout(id)).kind).toBe('none');
    await readHealth(s);
    expect(await s.health.forWorkout(id)).toMatchObject({ kind: 'linked', healthUuid: g });
    expect(await monTile(s)).toEqual(['dot:done']);
    expect(toMs((await s.workout.load(id))?.aggregate.session.startedAt.utc ?? '')).toBe(startMs);
  });
});
