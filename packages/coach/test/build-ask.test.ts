import { describe, expect, it } from 'vitest';

import { OWNER } from '@fizz/domain/testing';
import type { ActionRecord, CoachMessage } from '@fizz/schemas';

import {
  asksForBuild,
  BUILD_ASK_LINE,
  buildFollowUp,
  buildFollowUpIn,
  buildRequestWords,
  buildWordsNewestFirst,
  buildTurnRegistry,
  claimsNoBuildTool,
  classifyBenRequest,
  createReplyFilter,
  describesWorkoutPlan,
  gateFor,
  offersToBuild,
  requestHas,
} from '../src/index';
import { words } from './turn-fixtures';

/**
 * Build 131 (Ben, 12 Oct): "Can you make me a push sess…" got a plan in text;
 * "Yes u can add in the app" got "I don't have access to a workout-creation
 * tool". The phrasing table from the diagnosis, run through the real
 * classifier and registry: what opens `propose_workout` in a general turn,
 * what stays out on purpose, the follow-up after a text plan, and the
 * no-tool sentence that is never shown.
 */

const opens = (text: string, buildFollowUpFlag = false): boolean =>
  buildTurnRegistry(gateFor({ kind: 'general', input: words(text), previousOffer: null, structuralSignals: [], ...(buildFollowUpFlag ? { buildFollowUp: true } : {}) })).tools.some((t) => t.name === 'propose_workout');

describe('build requests in a general turn (diagnosis table)', () => {
  const BUILD = [
    // Already worked before build 131 (kept).
    'Can you make me a push session',
    'Can you make me a push workout',
    'Can you make me a push day',
    'Can you make me a push session for today',
    'Can you make me a push session for today, 45 mins',
    'Can you make me a push session? 45 mins',
    'Can you make me a push session please',
    'Can you make me a push session x',
    'Can you make me a push session for this gym',
    'Can you make me a push session for tonight',
    'Can you make me a push session for tomorrow',
    'Can you make me a push session for next time',
    'Can you make me a push session for Monday',
    'Can you make me a push session with some legs',
    'Can you make me a push session with legs at the end',
    'Can you make me a push session and legs',
    'Can you make me a push session plus legs',
    'Can you make me a push session that also hits legs',
    'Can you make me a push session with lunges',
    'Can you make me a push session (with legs)',
    'Can you make me a push session but with legs too',
    'Can you make me a push/legs session',
    'Can you make me a push session, legs are a bit sore',
    'Can you make me a push session but not too long',
    'Can you make me a push session, nothing too heavy',
    'Can you make me a push session using dumbbells',
    'Can you make me a push session with no barbell',
    'Can you make me a push session with 3 sets of everything',
    'Can you make me a push session at home',
    'Can you make me a push session after my run',
    'Can you make me a push session - 45 mins',
    'make me a push session',
    'make a push session',
    'make me a session',
    'could you make me a push session',
    'can you build me a push session',
    'can you plan me a push session',
    'plan me a push workout',
    'build me a push workout',
    'Build a 45 min push workout',
    'give me a push workout',
    'give me a workout',
    'I want a push session',
    'I need a push session',
    "I'd like a push session",
    'i fancy a push session',
    'I want to do a push session',
    'write me a push session',
    'design a push day',
    'put together a push workout',
    'create a push session',
    'create me a new push routine',
    'make me a quick session',
    'make me a full body session',
    'make me a leg day',
    // Fixed in build 131.
    'Can you make me a push session with split squats',
    'Can you make me a push session with dumbbell split squats',
    'Can you make me a push session with some split squats and calf raises',
    'Can you make me a push and legs session',
    'make me a push and legs session',
    'Can you make me a push session if I only have 45 mins',
    'Can u make me a push session',
    'Can you make me a push sesh',
    'make me push session',
    'can I have a push session',
    'can I get a push workout',
    'push session please',
    'push workout for today please',
    "plan today's session",
    // Review S3.
    'can you do me a push session',
    'do me a push workout',
    'sort me out a push session',
    'could you knock up a push session',
    'can you create a chest and triceps workout',
    "can you make me today's workout",
    'new workout please',
    'set me up a push workout',
    'Can you program me a push day',
    'make me a pull workout for next week',
  ];

  it.each(BUILD)('%s → build, propose_workout offered, never a change to today’s sets', (t) => {
    const r = classifyBenRequest(t, 'general');
    expect(requestHas(r, 'build')).toBe(true);
    expect(requestHas(r, 'change')).toBe(false);
    expect(opens(t)).toBe(true);
    expect(asksForBuild({ turnKind: 'general', text: t, draftInContext: false, followUp: null })).toBe(true);
  });

  it('"… and add it to the app" in the same message is a build too', () => {
    expect(requestHas(classifyBenRequest('can you make me a push session and add it to the app', 'general'), 'build')).toBe(true);
  });

  // On purpose not a build on their own words: advice questions, a change to the session in hand
  // (review B1), Ben's records, and programmes or weeks (later, workout-builder §10). After the coach
  // answers with a session in text, "yes add it" builds it (the follow-up below).
  const NOT_BUILD = [
    'what should I do for push today',
    'what should I do today',
    'what should I train today?',
    'workout for today?',
    'I want to do push today',
    'plan my push session',
    'plan my workout for today',
    'plan my session',
    'make my session shorter',
    'get me a workout',
    'make me a lighter push session',
    'make me a push session that is easier on my shoulder',
    'make me a push session with ideas from my last one',
    'give me a lighter session',
    'give me a summary of my last session',
    'can you make me a push session for 2 weeks',
    'can you make me a push session for the next block',
    'can you make me a push session for this week',
    'can you make me a push session for my upper/lower split',
    'can you make me a push session from the PPL split',
    'build me a 6 week programme',
    'that workout was hard',
    'if it’s too easy',
    // Review S3: kept out on purpose.
    'can I do a push session today?',
    'sort out my session from yesterday',
    "make today's workout shorter",
    'program me a 6 week block',
    'make me a push session for each week',
  ];

  it.each(NOT_BUILD)('%s → no build on its own words', (t) => {
    expect(requestHas(classifyBenRequest(t, 'general'), 'build')).toBe(false);
    expect(opens(t)).toBe(false);
  });

  it('never in a workout or summary turn (§8.2)', () => {
    expect(asksForBuild({ turnKind: 'workout', text: 'make me a push session', draftInContext: false, followUp: null })).toBe(false);
    expect(buildTurnRegistry(gateFor({ kind: 'workout', input: words('make me a push session'), previousOffer: null, structuralSignals: [] })).tools.map((t) => t.name)).not.toContain('propose_workout');
  });
});

// ---------- Follow-ups ----------

let ord = 0;
const ben = (text: string): CoachMessage => {
  ord += 1;
  return { id: `m${String(ord)}`, ownerId: OWNER, threadId: 'th', turnId: `t${String(ord)}`, ordinal: ord, createdAt: { utc: '2026-10-12T08:00:00.000Z', tz: 'Europe/London' }, body: { role: 'ben', input: { kind: 'words', text, spoken: false } } };
};
const coach = (text: string, actionIds: string[] = []): CoachMessage => {
  ord += 1;
  return {
    id: `m${String(ord)}`,
    ownerId: OWNER,
    threadId: 'th',
    turnId: `t${String(ord)}`,
    ordinal: ord,
    createdAt: { utc: '2026-10-12T08:00:01.000Z', tz: 'Europe/London' },
    body: { role: 'coach', items: [{ kind: 'sentence', text }], actionIds, note: null, offer: null, hiddenLines: [], complete: true },
  };
};

/** The coach's text plan on build 131 (abridged from the device thread). */
const PLAN =
  'Bench press 3 × 6–8, overhead press 3 × 6–8, incline dumbbell press 2 × 8–10, dumbbell split squat 2 × 8–10 per leg, and calf raise 2 × 12–15.';

describe('follow-ups after the coach described a session in text', () => {
  const EXPLICIT = [
    'Yes u can add in the app',
    'yes add it',
    'add it',
    'add it to my workouts',
    'add that to the app',
    'can you add that',
    'can you add that to the app',
    'put that in the app',
    'put it in the app',
    'save that',
    'save it',
    'can you save that as a workout',
    'make it a workout',
    'make that into a workout',
    'turn that into a workout',
    'build that',
    'build it',
    'create it',
    'load it in',
    'add that session',
    'add this workout to the app',
    'can you create that workout in the app',
    'start it',
    'yes make it',
    'Yes please, add it!',
    'ok put it in the app thanks',
    // Review S2: a change in the same breath, and Ben's pushback.
    'yes add it to today',
    'Yes but make it 45 mins',
    'add it but drop the calf raises',
    'yes but swap calf raises for leg press',
    'you can add it to the app though',
    'the app can do it',
    'it has a workout builder',
  ];
  it.each(EXPLICIT)('%s → explicit; with the plan in the thread it builds', (t) => {
    expect(buildFollowUp(t)).toBe('explicit');
    const history = [ben('Can you make me a push sess with some legs'), coach(PLAN)];
    const f = buildFollowUpIn(history, t);
    expect(f).toEqual({ priorBenText: 'Can you make me a push sess with some legs', benTexts: ['Can you make me a push sess with some legs'] });
    expect(asksForBuild({ turnKind: 'general', text: t, draftInContext: false, followUp: f })).toBe(true);
    expect(opens(t, true)).toBe(true);
  });

  const ACCEPT = ['yes', 'yes please', 'do it', 'ok go', 'Yeah!', 'sure'];
  it.each(ACCEPT)('%s → accept: builds only when the coach offered to build it', (t) => {
    expect(buildFollowUp(t)).toBe('accept');
    expect(buildFollowUpIn([ben('what should I do today'), coach(PLAN)], t)).toBeNull();
    expect(buildFollowUpIn([ben('what should I do today'), coach(`${PLAN} Want me to build it in the app?`)], t)).not.toBeNull();
  });

  const NOT = ['no', 'no thanks', "don't add it", 'why split squats?', 'yes, but why calf raises?', 'yes but why calf raises', 'no but make it 45 mins', 'looks heavy', 'what about pull?', 'swap the calf raises'];
  it.each(NOT)('%s → not a follow-up build', (t) => {
    expect(buildFollowUp(t)).not.toBe('explicit');
    expect(buildFollowUpIn([ben('Can you make me a push session'), coach(`${PLAN} Want me to build it in the app?`)], t)).toBeNull();
  });

  it('needs a plan in text, or an earlier build request, in the last coach turn', () => {
    expect(buildFollowUpIn([], 'add it')).toBeNull();
    expect(buildFollowUpIn([ben('how is my bench going?'), coach('Up 5 kg in a month.')], 'add it')).toBeNull();
    // The coach answered a build request without building (a question back): "add it" still builds.
    expect(buildFollowUpIn([ben('Can you make me a push session'), coach('How long have you got?')], 'yes add it')).not.toBeNull();
    // A turn that saved something (a draft card) isn't followed up here: its card has Open, and BD15 owns "save it".
    expect(buildFollowUpIn([ben('Can you make me a push session'), coach(PLAN, ['a1'])], 'save it')).toBeNull();
    // Review B2: a bounded window. One side question in between still reaches the plan…
    expect(buildFollowUpIn([ben('make me a push session'), coach(PLAN), ben('how is my squat?'), coach('Up 10 kg.')], 'add it')).not.toBeNull();
    // …a bare "yes" doesn't, unless the last coach message offered to build…
    expect(buildFollowUpIn([ben('make me a push session'), coach(PLAN), ben('how is my squat?'), coach('Up 10 kg.')], 'yes')).toBeNull();
    // …three coach messages back is the limit…
    const far = [ben('make me a push session'), coach(PLAN), ben('how is my squat?'), coach('Up 10 kg.'), ben('and bench?'), coach('Up 5 kg.'), ben('deadlift?'), coach('Same.')];
    expect(buildFollowUpIn(far, 'add it')).toBeNull();
    // …and a coach message that saved something ends the look-back.
    expect(buildFollowUpIn([ben('make me a push session'), coach(PLAN), ben('thanks'), coach('Here.', ['a1'])], 'add it')).toBeNull();
    expect(buildFollowUpIn([ben('make me a push session'), coach(PLAN, ['a1']), ben('why split squats?'), coach('Less spine load.')], 'add it')).toBeNull();
  });

  /** Ben's build-131 thread as stored on the device (review B2): every retry now builds. */
  const DEVICE = (): CoachMessage[] => [
    ben('Can you make me a push session with split squats and calf raises'),
    coach(PLAN),
    ben('Yes u can add in the app'),
    coach("The app may support adding workouts, but I don't have access to a workout-creation tool in this chat. You can add it from the Workouts tab."),
  ];
  it.each(['Yes u can add in the app', 'add it', 'yes', 'add the push session to the app', 'please add that push session', 'make that push session in the app'])(
    'device thread: %s → builds, with Ben’s request as the length and focus words',
    (t) => {
      const f = buildFollowUpIn(DEVICE(), t);
      expect(f).toEqual({
        priorBenText: 'Can you make me a push session with split squats and calf raises',
        benTexts: ['Yes u can add in the app', 'Can you make me a push session with split squats and calf raises'],
      });
      expect(asksForBuild({ turnKind: 'general', text: t, draftInContext: false, followUp: f })).toBe(true);
      expect(buildRequestWords(t, f)).toBe(`Can you make me a push session with split squats and calf raises\nYes u can add in the app\n${t}`);
    },
  );

  it('after one side question, "yes" to the coach’s offer builds (review B2)', () => {
    const thread = [ben('Can you make me a push session'), coach(PLAN), ben('why split squats?'), coach('They load legs with less spine. Want me to build it in the app?')];
    for (const t of ['yes', 'add it']) expect(buildFollowUpIn(thread, t)).not.toBeNull();
  });

  it('review B3: "yes" to the coach’s own offer builds, whatever the plan’s wording', () => {
    const offerOnly = [ben('what should I do for push today'), coach('Bench press: 3 sets, 6-8 reps. Overhead press: 3 sets, 8-10 reps. Want me to build it?')];
    expect(buildFollowUpIn(offerOnly, 'yes')).not.toBeNull();
    const after45 = [ben('Can you make me a push session'), coach(PLAN), ben('Yes but make it 45 mins'), coach('Sure, 45 minutes works. Want me to build it in the app?')];
    for (const t of ['yes', 'yes please', 'do it']) {
      const f = buildFollowUpIn(after45, t);
      expect(f?.benTexts).toEqual(['Yes but make it 45 mins', 'Can you make me a push session']);
    }
    // An offer about something else is not a build offer.
    expect(buildFollowUpIn([ben('remember I train fasted'), coach('Noted. Want me to save that as a memory?')], 'yes')).toBeNull();
  });

  it('length and focus come from Ben’s words (now, then the request before the plan), never the coach’s', () => {
    expect(buildRequestWords('yes add it', { priorBenText: 'push session, 45 mins', benTexts: ['push session, 45 mins'] })).toBe('push session, 45 mins\nyes add it');
    expect(buildWordsNewestFirst('yes', { priorBenText: 'push session', benTexts: ['make it 45 mins', 'push session'] })).toEqual(['yes', 'make it 45 mins', 'push session']);
    expect(buildRequestWords('build me a leg day', null)).toBe('build me a leg day');
  });

  it('plan and offer detection are deterministic', () => {
    expect(describesWorkoutPlan(PLAN)).toBe(true);
    expect(describesWorkoutPlan('Bench 3 sets of 8, then rows 3x10.')).toBe(true);
    expect(describesWorkoutPlan('Do 3 × 8 on bench.')).toBe(false);
    // Review B3: "N sets, M reps" and "N sets of M-K".
    expect(describesWorkoutPlan('Bench press: 3 sets, 6-8 reps. Overhead press: 3 sets, 8-10 reps.')).toBe(true);
    expect(describesWorkoutPlan('Bench 3 sets of 6-8, rows 3 sets of 10–12.')).toBe(true);
    expect(offersToBuild('Want me to build it in the app?')).toBe(true);
    expect(offersToBuild('Want me to build it?')).toBe(true);
    expect(offersToBuild(`${PLAN} Shall I add it?`)).toBe(true);
    expect(offersToBuild('Shall I add it?')).toBe(false);
    expect(offersToBuild('Want me to save that as a memory?')).toBe(false);
    expect(offersToBuild('How long have you got?')).toBe(false);
  });
});

describe('"I can’t build workouts" on a general turn where the app can (build 131, review B1)', () => {
  const NO_TOOL = [
    "The app may support adding workouts, but I don't have access to a workout-creation tool in this chat.",
    "I can plan your session, but I can't put it into the app for you from here.",
    'I’m unable to add that to your workouts.',
    "There's no tool for adding workouts here.",
    "I don't have the ability to create workouts in the app.",
    // Review B1: missed before.
    "I can't build workouts here.",
    "I can't build a workout from here.",
    "Unfortunately I can't create workouts for you.",
  ];
  it.each(NO_TOOL)('%s', (s) => {
    expect(claimsNoBuildTool(s)).toBe(true);
  });

  const FINE = [
    "I can't make the session easier mid-set.",
    "I don't have your sleep data.",
    'There is no session today.',
    "I can't see heart rate.",
    'You can add it to your workouts from the overview.',
    // Review B1: true limits, never replaced.
    "I don't have access to your Apple Health data in the app.",
    "I can't save it to your workouts for you — open it and tap Save.",
    "I can't add exercises to today's workout in the app.",
    "I'm not able to create a programme in the app yet.",
    "I don't have a tool to change your routines.",
  ];
  it.each(FINE)('%s stays', (s) => {
    expect(claimsNoBuildTool(s)).toBe(false);
  });

  const empty = () => ({ turnId: 't', entries: [], knownExerciseNames: [] });

  it('with a build available, the reply filter hides it (listed in Why?) and says once what works', () => {
    const f = createReplyFilter({ ledger: empty, surface: 'sheet', noBuildToolLine: true });
    const items = [...f.push(`${NO_TOOL[0] ?? ''} ${NO_TOOL[1] ?? ''} Push first, then legs. `), ...f.end(true)];
    expect(items).toEqual([
      { kind: 'sentence', text: BUILD_ASK_LINE },
      { kind: 'sentence', text: 'Push first, then legs.' },
    ]);
    expect(f.hiddenLines.map((h) => h.reason)).toEqual(['no_action', 'no_action']);
  });

  it('elsewhere (a workout or summary turn, no gym) the sentence is never swapped for the build line', () => {
    const f = createReplyFilter({ ledger: empty, surface: 'sheet' });
    const items = [...f.push("I can't build workouts here. Push first. "), ...f.end(true)];
    expect(items.map((i) => (i.kind === 'sentence' ? i.text : ''))).not.toContain(BUILD_ASK_LINE);
  });

  it('never under a draft card made this turn', () => {
    const draft = { ref: 'a1', origin: 'this_turn' as const, record: { detail: { kind: 'build_workout' } } as unknown as ActionRecord };
    const f = createReplyFilter({ ledger: () => ({ turnId: 't', entries: [draft], knownExerciseNames: [] }), surface: 'sheet', noBuildToolLine: true });
    const items = [...f.push("I can't put it into the app for you. "), ...f.end(true)];
    expect(items.map((i) => (i.kind === 'sentence' ? i.text : ''))).not.toContain(BUILD_ASK_LINE);
  });
});
