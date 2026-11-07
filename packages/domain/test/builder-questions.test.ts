import { describe, expect, it } from 'vitest';

import { AskBuildQuestionArgsSchema, type AskBuildQuestionArgs, type TrainingProfile } from '@fizz/schemas';

import { checkBuildQuestion, knownHash, knownPreferences, newTrainingProfile, parseBuildRequest, QUESTION_NOT_ALLOWED, type QuestionContext } from '../src/index';
import { OWNER, T0 } from './fixtures';

/**
 * Clarifying questions and known preferences (workout-builder v2.1 BD17–BD20,
 * WB-Q1, WB-Q2, WB-Q4, WB-Q8, WB-P1, WB-P2, WB-P3): code checks every
 * question's text, whatever its topic label, and never asks what is known.
 */

const profile = (over: Partial<TrainingProfile> = {}): TrainingProfile => ({ ...newTrainingProfile({ id: 'tp-1', ownerId: OWNER, atUtc: T0 }), goal: 'strength', goalSetAtUtc: '2026-10-02T08:00:00.000Z', sessionMinutes: 45, ...over });

const KNOWN_FULL = knownPreferences({
  profile: profile(),
  goalDate: '2026-10-02',
  day: { name: 'Chest', mainLift: { exerciseId: 'ex-bench', name: 'Bench press' } },
  recentSplits: [{ date: '2026-10-06', day: 'Push' }],
  memories: [{ text: 'Prefers dumbbells for incline', savedOn: '2026-10-01' }],
});
const KNOWN_LEGS = knownPreferences({ profile: profile(), goalDate: '2026-10-02', day: { name: 'Legs', mainLift: null }, recentSplits: [], memories: [] });
const NO_PROFILE = knownPreferences({ profile: null, goalDate: null, day: null, recentSplits: [], memories: [] });

const LEGS: Readonly<Record<string, string>> = { 'barbell-back-squat': 'Squat', 'leg-press': 'Leg press', 'barbell-front-squat': 'Front squat', 'hack-squat': 'Hack squat', 'barbell-bench-press': 'Bench press' };
const req = (over: Partial<QuestionContext> = {}): QuestionContext => ({
  requestMinutes: null,
  dayName: null,
  mainNamed: false,
  // Usable here, not flagged, in the Legs list: not the hack squat (not here) or bench (not Legs).
  mainLiftOk: (id) => ['barbell-back-squat', 'leg-press', 'barbell-front-squat'].includes(id),
  nameOf: (id) => LEGS[id] ?? null,
  ...over,
});
const q = (topic: AskBuildQuestionArgs['topic'], question: string, answers: [string, string | null][]): AskBuildQuestionArgs => ({ topic, question, answers: answers.map(([label, catalogueId]) => ({ label, catalogueId })) });

describe('knownPreferences (WB-P1, WB-P2)', () => {
  it('the KNOWN block: goal and date, length, the day’s main lift, recent split days and confirmed memories; missing listed', () => {
    expect(KNOWN_FULL).toMatchObject({ goal: { value: 'strength', word: 'Strength', since: '2026-10-02' }, sessionMinutes: 45, mainLift: { day: 'Chest', name: 'Bench press' }, recentSplits: [{ day: 'Push' }], missing: [] });
    expect(KNOWN_LEGS.missing).toEqual(['main lift (Legs)']);
    expect(NO_PROFILE.missing).toEqual(['goal', 'session length']);
  });

  it('is deterministic: the same inputs give the same block and hash', () => {
    const again = knownPreferences({ profile: profile(), goalDate: '2026-10-02', day: { name: 'Chest', mainLift: { exerciseId: 'ex-bench', name: 'Bench press' } }, recentSplits: [{ date: '2026-10-06', day: 'Push' }], memories: [{ text: 'Prefers dumbbells for incline', savedOn: '2026-10-01' }] });
    expect(again).toEqual(KNOWN_FULL);
    expect(knownHash(again)).toBe(knownHash(KNOWN_FULL));
    expect(knownHash(KNOWN_LEGS)).not.toBe(knownHash(KNOWN_FULL));
  });
});

describe('checkBuildQuestion (WB-Q1, WB-Q2, WB-Q4, WB-Q8)', () => {
  it('WB-Q1: a main-lift question for Legs with no stored main lift passes; chips show catalogue names', () => {
    const r = checkBuildQuestion(q('main_lift', 'Main lift for legs?', [['squat', 'barbell-back-squat'], ['LP', 'leg-press'], ['front', 'barbell-front-squat']]), KNOWN_LEGS, req());
    expect(r).toEqual({ ok: true, topic: 'main_lift', question: 'Main lift for legs?', answers: [{ label: 'Squat', catalogueId: 'barbell-back-squat' }, { label: 'Leg press', catalogueId: 'leg-press' }, { label: 'Front squat', catalogueId: 'barbell-front-squat' }] });
  });

  it('WB-Q2: main-lift answers not usable here, flagged or outside the split are dropped; fewer than 2 left is not allowed', () => {
    const r = checkBuildQuestion(q('main_lift', 'Main lift for legs?', [['Squat', 'barbell-back-squat'], ['Hack', 'hack-squat'], ['Bench', 'barbell-bench-press'], ['Leg press', 'leg-press']]), KNOWN_LEGS, req());
    expect(r.ok && r.answers.map((a) => a.catalogueId)).toEqual(['barbell-back-squat', 'leg-press']);
    expect(checkBuildQuestion(q('main_lift', 'Main lift for legs?', [['Squat', 'barbell-back-squat'], ['Hack', 'hack-squat']]), KNOWN_LEGS, req())).toEqual({ ok: false, line: QUESTION_NOT_ALLOWED });
  });

  it('WB-Q4: known topics are refused whatever the label: length, goal, split, the stored main lift', () => {
    expect(checkBuildQuestion(q('other', 'How long have you got?', [['30', null], ['45', null]]), KNOWN_FULL, req())).toEqual({ ok: false, line: 'known: 45 min' });
    expect(checkBuildQuestion(q('other', 'Still going for strength?', [['Yes', null], ['No', null]]), KNOWN_FULL, req())).toEqual({ ok: false, line: 'known: Strength' });
    expect(checkBuildQuestion(q('other', 'Strength or size today?', [['Strength', null], ['Size', null]]), NO_PROFILE, req())).toEqual({ ok: false, line: QUESTION_NOT_ALLOWED });
    expect(checkBuildQuestion(q('split', 'Which split?', [['Push', null], ['Pull', null]]), KNOWN_FULL, req({ dayName: 'Chest' }))).toEqual({ ok: false, line: 'known: Chest' });
    expect(checkBuildQuestion(q('equipment_today', 'Is the bench press free?', [['Yes', null], ['No', null]]), KNOWN_FULL, req())).toEqual({ ok: false, line: 'known: Bench press' });
    expect(checkBuildQuestion(q('main_lift', 'Main for chest?', [['A', 'barbell-back-squat'], ['B', 'leg-press']]), KNOWN_FULL, req())).toEqual({ ok: false, line: 'known: Bench press' });
    // The tool can't even name the goal as a topic (schema).
    expect(AskBuildQuestionArgsSchema.safeParse({ topic: 'goal', question: 'Goal?', answers: [{ label: 'A', catalogueId: null }, { label: 'B', catalogueId: null }] }).success).toBe(false);
  });

  it('WB-Q8: pain and medical questions are never asked, under any topic', () => {
    for (const text of ['Is your shoulder still sore?', 'Any injuries I should know about?', 'Does your knee hurt?']) {
      expect(checkBuildQuestion(q('equipment_today', text, [['Yes', null], ['No', null]]), KNOWN_FULL, req())).toEqual({ ok: false, line: QUESTION_NOT_ALLOWED });
    }
  });

  it('answers are trimmed to 2–4 of at most 24 characters with no duplicates; the question to 80', () => {
    const r = checkBuildQuestion(q('other', 'Finish with core?', [['Yes', null], ['yes', null], ['No', null], ['A very long answer that goes on', null], ['Maybe', null], ['Later', null], ['Skip core', null]]), KNOWN_FULL, req());
    expect(r.ok && r.answers.map((a) => a.label)).toEqual(['Yes', 'No', 'Maybe', 'Later']);
    expect(checkBuildQuestion(q('other', `${'x'.repeat(81)}?`, [['Yes', null], ['No', null]]), KNOWN_FULL, req())).toEqual({ ok: false, line: QUESTION_NOT_ALLOWED });
  });
});

describe('parseBuildRequest (BD19, BD16, WB-Q6)', () => {
  it('reads variety or another main lift, heavier, and the length from Ben’s words', () => {
    expect(parseBuildRequest('something different today').skipMainInsert).toBe(true);
    expect(parseBuildRequest('no bench today please').skipMainInsert).toBe(true);
    expect(parseBuildRequest('incline as main today').skipMainInsert).toBe(true);
    expect(parseBuildRequest('build me a chest workout').skipMainInsert).toBe(false);
    expect(parseBuildRequest('heavier on pull-ups').askedHeavier).toBe(true);
    expect(parseBuildRequest('bench, under 40 min').minutes).toBe(40);
  });
});


describe('training details are known, never asked (review S6)', () => {
  const withAbout = knownPreferences({
    profile: profile({
      about: { experience: 'intermediate', birthYear: 1990, gender: 'male', heightCm: 180 },
      weights: [
        { id: 'w1', date: '2026-09-01', value: 84, unit: 'kg', recordedAtUtc: '2026-09-01T07:00:00.000Z' },
        { id: 'w2', date: '2026-10-03', value: 82.5, unit: 'kg', recordedAtUtc: '2026-10-03T07:00:00.000Z' },
      ],
    }),
    goalDate: '2026-10-02',
    day: null,
    recentSplits: [],
    memories: [],
  });

  it('KNOWN carries experience, birth year, gender, height and the latest bodyweight', () => {
    expect(withAbout.about).toEqual({ experience: 'intermediate', birthYear: 1990, gender: 'male', heightCm: 180, bodyweight: { value: 82.5, unit: 'kg', date: '2026-10-03' } });
    expect(KNOWN_FULL.about).toEqual({ experience: null, birthYear: null, gender: null, heightCm: null, bodyweight: null });
  });

  it('a question on any of them is refused with the known value, or not allowed when unset, whatever its topic', () => {
    const ask = (text: string, k = withAbout) => checkBuildQuestion(q('other', text, [['Yes', null], ['No', null]]), k, req());
    expect(ask('Are you a beginner or experienced?')).toEqual({ ok: false, line: 'known: intermediate' });
    expect(ask('How long have you been lifting?')).toEqual({ ok: false, line: 'known: intermediate' });
    expect(ask('What do you weigh right now?')).toEqual({ ok: false, line: 'known: 82.5 kg' });
    expect(ask('How tall are you?')).toEqual({ ok: false, line: 'known: 180 cm' });
    expect(ask('How old are you?')).toEqual({ ok: false, line: 'known: born 1990' });
    expect(ask('Male or female?')).toEqual({ ok: false, line: 'known: male' });
    expect(ask('What do you weigh right now?', KNOWN_FULL)).toEqual({ ok: false, line: QUESTION_NOT_ALLOWED });
    // An ordinary question still passes.
    expect(ask('Cables busy today?').ok).toBe(true);
  });
});
