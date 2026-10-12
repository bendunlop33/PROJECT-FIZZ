import { describe, expect, it } from 'vitest';

import { OWNER } from '@fizz/domain/testing';
import type { CoachMessage } from '@fizz/schemas';

import {
  asksForBuild,
  BUILD_ASK_LINE,
  buildFollowUp,
  buildFollowUpIn,
  buildRequestWords,
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
  ];
  it.each(EXPLICIT)('%s → explicit; with the plan in the thread it builds', (t) => {
    expect(buildFollowUp(t)).toBe('explicit');
    const history = [ben('Can you make me a push sess with some legs'), coach(PLAN)];
    const f = buildFollowUpIn(history, t);
    expect(f).toEqual({ priorBenText: 'Can you make me a push sess with some legs' });
    expect(asksForBuild({ turnKind: 'general', text: t, draftInContext: false, followUp: f })).toBe(true);
    expect(opens(t, true)).toBe(true);
  });

  const ACCEPT = ['yes', 'yes please', 'do it', 'ok go', 'Yeah!', 'sure'];
  it.each(ACCEPT)('%s → accept: builds only when the coach offered to build it', (t) => {
    expect(buildFollowUp(t)).toBe('accept');
    expect(buildFollowUpIn([ben('what should I do today'), coach(PLAN)], t)).toBeNull();
    expect(buildFollowUpIn([ben('what should I do today'), coach(`${PLAN} Want me to build it in the app?`)], t)).not.toBeNull();
  });

  const NOT = ['no', 'no thanks', "don't add it", 'why split squats?', 'yes, but why calf raises?', 'looks heavy', 'what about pull?', 'swap the calf raises'];
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
    // Only the last coach message counts.
    expect(buildFollowUpIn([ben('make me a push session'), coach(PLAN), ben('how is my squat?'), coach('Up 10 kg.')], 'add it')).toBeNull();
  });

  it('length and focus come from Ben’s words (now, then the request before the plan), never the coach’s', () => {
    expect(buildRequestWords('yes add it', { priorBenText: 'push session, 45 mins' })).toBe('push session, 45 mins\nyes add it');
    expect(buildRequestWords('build me a leg day', null)).toBe('build me a leg day');
  });

  it('plan and offer detection are deterministic', () => {
    expect(describesWorkoutPlan(PLAN)).toBe(true);
    expect(describesWorkoutPlan('Bench 3 sets of 8, then rows 3x10.')).toBe(true);
    expect(describesWorkoutPlan('Do 3 × 8 on bench.')).toBe(false);
    expect(offersToBuild('Want me to build it in the app?')).toBe(true);
    expect(offersToBuild('Shall I add it?')).toBe(true);
    expect(offersToBuild('How long have you got?')).toBe(false);
  });
});

describe('"I don’t have access to a workout-creation tool" is never shown (build 131)', () => {
  const NO_TOOL = [
    "The app may support adding workouts, but I don't have access to a workout-creation tool in this chat.",
    "I can plan your session, but I can't put it into the app for you from here.",
    'I’m unable to add that to your workouts.',
    "There's no tool for adding workouts here.",
    "I don't have the ability to create workouts in the app.",
  ];
  it.each(NO_TOOL)('%s', (s) => {
    expect(claimsNoBuildTool(s)).toBe(true);
  });

  const FINE = ["I can't make the session easier mid-set.", "I don't have your sleep data.", 'There is no session today.', "I can't see heart rate.", 'You can add it to your workouts from the overview.'];
  it.each(FINE)('%s stays', (s) => {
    expect(claimsNoBuildTool(s)).toBe(false);
  });

  it('the reply filter hides it (listed in Why?) and says once what works', () => {
    const f = createReplyFilter({ ledger: () => ({ turnId: 't', entries: [], knownExerciseNames: [] }), surface: 'sheet' });
    const items = [...f.push(`${NO_TOOL[0] ?? ''} ${NO_TOOL[1] ?? ''} Push first, then legs. `), ...f.end(true)];
    expect(items).toEqual([
      { kind: 'sentence', text: BUILD_ASK_LINE },
      { kind: 'sentence', text: 'Push first, then legs.' },
    ]);
    expect(f.hiddenLines.map((h) => h.reason)).toEqual(['no_action', 'no_action']);
  });
});
