import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyTrainingChange, newTrainingProfile } from '@fizz/domain';
import type { TrainingChange, TrainingProfile } from '@fizz/schemas';

import { birthYearPicker, bodyPartChoices, customStartDays, heightPicker, readWeightEntry, splitView, TRAINING_COPY, trainingDetailsView } from '../src/training/training-view';
import type { ModelRequest } from '@fizz/coach';

import { CONNECTED, replyWith, StepModel } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/** Profile › Training details and Split (Ben 13 Oct: D5, D7, D8; F19). */

const OWNER = '00000000-0000-4000-8000-0000000000aa';
function profileWith(changes: TrainingChange[]): TrainingProfile {
  let p = newTrainingProfile({ id: '00000000-0000-4000-8000-0000000000ab', ownerId: OWNER, atUtc: '2026-10-13T08:00:00.000Z' });
  changes.forEach((c, i) => {
    const r = applyTrainingChange(p, c, { opId: `v${String(i)}`, expectedVersion: p.version, atUtc: `2026-10-13T08:0${String(i)}:00.000Z`, nowYear: 2026 });
    if (!r.ok) throw new Error(r.error);
    p = r.profile;
  });
  return p;
}

describe('Training details view (values only)', () => {
  it('a new profile reads Not set, check-in every 6 weeks, 45 min, next-time targets Off', () => {
    const v = trainingDetailsView(profileWith([]), { nowYear: 2026, unit: 'kg' });
    expect(v.about.map((r) => [r.title, r.value])).toEqual([
      ['Birth year', 'Not set'],
      ['Gender', 'Not set'],
      ['Height', 'Not set'],
      ['Lifting experience', 'Not set'],
    ]);
    expect(v.training.map((r) => [r.title, r.value])).toEqual([
      ['Goal', 'Not set'],
      ['Check-in', 'Every 6 weeks'],
      ['Days a week', 'Not set'],
      ['Session length', '45 min'],
    ]);
    expect(v.self).toEqual([{ key: 'nextTargets', title: 'Next-time targets', value: 'Off' }]);
    expect(v.weights).toEqual([]);
    expect(v.summary).toBe('Not set');
  });

  it('set values show; weights newest first in Ben’s unit (lb entry shown in kg); summary is age · weight · goal', () => {
    const p = profileWith([
      { kind: 'birth_year', year: 1992 },
      { kind: 'gender', gender: 'male' },
      { kind: 'height', cm: 180 },
      { kind: 'experience', level: 'pro' },
      { kind: 'add_weight', entry: { id: 'a', date: '2026-09-01', value: 84, unit: 'kg' } },
      { kind: 'add_weight', entry: { id: 'b', date: '2026-10-10', value: 180, unit: 'lb' } },
      { kind: 'goal', goal: 'muscle' },
      { kind: 'days_per_week', days: 4 },
      { kind: 'self_next_targets', on: true },
    ]);
    const v = trainingDetailsView(p, { nowYear: 2026, unit: 'kg' });
    expect(v.about.map((r) => r.value)).toEqual(['1992', 'Male', '180 cm · 5′11″', 'Pro']);
    expect(v.weights.map((w) => [w.id, w.title, w.value])).toEqual([
      ['b', 'Sat 10 Oct 2026', '81.6 kg'],
      ['a', 'Tue 1 Sep 2026', '84 kg'],
    ]);
    expect(v.summary).toBe('34 · 81.6 kg · Muscle');
    expect(v.self[0]?.value).toBe('On');
  });

  it('pickers: birth year bounded to 1920…now−10, starting at the stored year; height shows ft/in', () => {
    expect(birthYearPicker(undefined, 2026)).toEqual({ min: 1920, max: 2016, start: 1996 });
    expect(birthYearPicker(1988, 2026).start).toBe(1988);
    expect(heightPicker(175).label).toBe('175 cm · 5′9″');
  });

  it('Add weight reads a typed number (comma or point) and a date; nonsense is refused', () => {
    expect(readWeightEntry('82,5', '2026-10-13')).toEqual({ value: 82.5, date: '2026-10-13' });
    expect(readWeightEntry('abc', '2026-10-13')).toBeNull();
    expect(readWeightEntry('80', '13/10/2026')).toBeNull();
    expect(readWeightEntry('-3', '2026-10-13')).toBeNull();
  });

  it('minimal copy: no explanations or reassurance', () => {
    for (const s of Object.values(TRAINING_COPY)) expect(s).not.toMatch(/nothing changes|unless you|built-in rule|snapped|don't worry|so the coach/i);
  });
});

describe('Split view', () => {
  it('default Push/Pull/Legs; preset days aren’t editable; main lift Ben’s or Recommended', () => {
    const v = splitView(null, { push: { exerciseId: 'b', name: 'Bench press', source: 'recommended' }, legs: { exerciseId: 's', name: 'Squat', source: 'yours' } });
    expect(v.choices.find((c) => c.selected)?.label).toBe('Push/Pull/Legs');
    expect(v.days.map((d) => [d.name, d.bodyParts, d.mainLift, d.mainLiftNote])).toEqual([
      ['Push', 'Chest, Shoulders, Triceps', 'Bench press', 'Recommended'],
      ['Pull', 'Back, Biceps', 'None yet', null],
      ['Legs', 'Quads, Hamstrings, Glutes, Calves', 'Squat', null],
    ]);
    expect(v.editable).toBe(false);
  });

  it('custom: named days, editable, up to 7; body parts without forearms', () => {
    const p = profileWith([{ kind: 'custom_split', days: [{ id: 'a', name: 'Arms', bodyParts: ['Biceps', 'Triceps'] }] }]);
    const v = splitView(p, {});
    expect(v).toMatchObject({ editable: true, canAddDay: true, summary: 'Arms' });
    expect(bodyPartChoices(['Biceps']).map((c) => c.part)).not.toContain('Forearms');
    expect(bodyPartChoices(['Biceps']).filter((c) => c.checked).map((c) => c.part)).toEqual(['Biceps']);
    expect(customStartDays(null).map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs']);
  });
});

describe('training service, end to end on the phone’s store', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('reads defaults without writing; a change is versioned; a double tap writes once; a stale version is refused', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const before = await s.training.snapshot();
    expect(before?.profile.version).toBe(1);
    const owner = await s.yourData.profile();
    const first = await s.training.change({ kind: 'birth_year', year: 1990 }, 1, 'tap-1');
    expect(first).toMatchObject({ ok: true, profile: { version: 2 } });
    expect(await s.training.change({ kind: 'birth_year', year: 1990 }, 1, 'tap-1')).toMatchObject({ ok: true, profile: { version: 2 } });
    expect(await s.training.change({ kind: 'gender', gender: 'female' }, 1, 'tap-2')).toMatchObject({ ok: false, reason: 'stale', profile: { version: 2 } });
    expect(await s.training.change({ kind: 'check_in_weeks', weeks: 20 }, 2, 'tap-3')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(owner).not.toBeNull();
  });

  it('survives a force-close (restart recovery)', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    await s.training.change({ kind: 'add_weight', entry: { id: 'w1', date: '2026-10-13', value: 82, unit: 'kg' } }, 1, 'tap-1');
    await h.forceClose();
    const { services: again } = await h.launch();
    expect((await again.training.snapshot())?.profile.weights.map((w) => w.value)).toEqual([82]);
  });

  it('main lift recommended from history; Ben’s choice wins; the Build card pre-selects the next split day (F19)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 5 }, { load: 80, reps: 5 }] }]);
    const snap = await s.training.snapshot();
    expect(snap?.mainLifts.push).toMatchObject({ name: 'Bench press', source: 'recommended' });
    expect(snap?.nextDayId).toBe('pull');
    const card = await s.training.buildCard();
    expect(card.days.map((d) => d.day.name)).toEqual(['Push', 'Pull', 'Legs']);
    expect(card.nextDayId).toBe('pull');
    expect(card.sessionMinutes).toBe(45);

    const ohp = snap?.options.push?.find((o) => o.name === 'Overhead press');
    if (ohp === undefined) throw new Error('no option');
    expect((await s.training.change({ kind: 'main_lift', dayId: 'push', exerciseId: ohp.id }, 1, 'pick'))).toMatchObject({ ok: true });
    expect((await s.training.snapshot())?.mainLifts.push).toMatchObject({ name: 'Overhead press', source: 'yours' });

    await s.training.change({ kind: 'preset_split', split: 'clsb' }, 2, 'split');
    const clsb = await s.training.buildCard();
    expect(clsb.days.map((d) => d.focus)).toEqual(['chest', 'legs', 'shoulders', 'back']);
    expect(clsb.nextDayId).toBe('legs');
  });

  it('the coach’s planning context gets the training details as Your data; nothing invented before they’re set', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const empty = await s.training.coachInput();
    expect(empty?.profile).toBeNull();
    await s.training.change({ kind: 'birth_year', year: 1990 }, 1, 't1');
    await s.training.change({ kind: 'add_weight', entry: { id: 'w', date: '2026-10-13', value: 80, unit: 'kg' } }, 2, 't2');
    const input = await s.training.coachInput();
    expect(input?.profile?.about.birthYear).toBe(1990);
    expect(input?.nextDayId).toBe('push');
  });
});

describe('a coach turn carries the training details (D8, rule 10)', () => {
  let h: Harness;
  let model: StepModel;
  beforeEach(() => {
    model = new StepModel([]);
    h = createHarness('2026-10-13T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
  });
  afterEach(async () => {
    await h.cleanup();
  });

  const block = (req: ModelRequest | undefined, head: string): string => {
    const b = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith(head));
    return b?.type === 'message' ? b.content : '';
  };

  it('YOUR DATA has age, gender, height, latest weight, experience, goal, length and split; never Coaching knowledge; unset ones are NOT AVAILABLE', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const ask = async () => {
      model = new StepModel([() => replyWith('Ok.')]);
      await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Plan my week', spoken: false }, turnId: h.ids() });
      return model.requests[0];
    };
    const before = await ask();
    expect(block(before, 'NOT AVAILABLE')).toContain('Age (birth year): not set');
    expect(block(before, 'YOUR DATA')).not.toContain('"age"');

    let v = 1;
    for (const c of [
      { kind: 'birth_year', year: 1990 },
      { kind: 'gender', gender: 'male' },
      { kind: 'height', cm: 183 },
      { kind: 'add_weight', entry: { id: 'w', date: '2026-10-13', value: 85, unit: 'kg' } },
      { kind: 'experience', level: 'intermediate' },
      { kind: 'goal', goal: 'strength' },
    ] as const) {
      expect(await s.training.change(c, v, `t${String(v)}`)).toMatchObject({ ok: true });
      v += 1;
    }
    const after = await ask();
    const mine = JSON.parse(block(after, 'YOUR DATA').split('\n').slice(1).join('\n')) as { training?: Record<string, unknown> };
    expect(mine.training).toMatchObject({ age: { years: 36, fromBirthYear: 1990 }, gender: 'male', heightCm: 183, bodyweight: { value: 85, unit: 'kg' }, liftingExperience: 'intermediate', goal: 'strength', sessionMinutes: 45, split: { kind: 'ppl' } });
    expect(block(after, 'COACHING KNOWLEDGE')).not.toContain('1990');
    expect(block(after, 'NOT AVAILABLE')).not.toContain('Age (birth year)');
    expect(block(after, 'NOT AVAILABLE')).toContain('Days a week: not set');
  });
});
