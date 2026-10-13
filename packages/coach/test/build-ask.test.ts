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
  claimsWorkoutBuilt,
  createReplyFilter,
  NO_BUILD_TOOL_INSTRUCTIONS,
  BUILD_OFFER_LINE,
  retriesBuild,
  describesWorkoutPlan,
  forcesBuild,
  multiWeekScope,
  BUILD_INSTRUCTIONS,
  OFFERED_BUILD_INSTRUCTIONS,
  OFFER_REPLY_BUILD_INSTRUCTIONS,
  capUsable,
  refusedBuildActionIds,
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
    // Review r2 B2: Ben's own vocabulary ("add in the app") on a first turn.
    'Can you add a push session to my workouts',
    'add a push workout to the app',
    'put a push session in the app for me',
    'can you put a new push session in the app',
    'add a new leg day to my routines',
    'could you add a quick upper body session to the app',
    'save a push workout to my workouts',
    'Can you make me a push sess',
    'Can you do a push session for me',
    // Review r3 S5: British and casual phrasing.
    'can you programme me a push session',
    'Could you make me a pull workout for this week',
    'make me a 45 min push session at the gym this week',
    'build me a workout based on what I did last week',
    'build me something for today',
    'what should I do today? build me something',
    'need a quick 30 min workout',
    'can you sort me a push session',
    'push day today, can you sort it',
    'yo build me a chest and tris workout',
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
    // Review r2 B2 near-misses: no determiner (an exercise add, or Ben's records), or no place in the app.
    'add curls to my workout',
    'add curls to the app',
    'put my session in the app',
    'add my session to the app',
    'add the push session to my workouts',
    'add a set to my workout',
    'add 3 sets of curls to my workout',
    'save my workout',
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
    expect(f).toEqual({ priorBenText: 'Can you make me a push sess with some legs', benTexts: ['Can you make me a push sess with some legs'], strength: 'clear' });
    expect(asksForBuild({ turnKind: 'general', text: t, draftInContext: false, followUp: f })).toBe(true);
    expect(opens(t, true)).toBe(true);
  });

  const ACCEPT = ['yes', 'yes please', 'do it', 'ok go', 'Yeah!', 'sure', 'go on then', 'sure thing', 'sounds great', "that'd be great", 'yes that would be great', 'yeah why not', 'why not', 'aye', 'y', 'deal', 'Yes please 👍', '👍', 'yes mate', 'go on then thanks'];
  it.each(ACCEPT)('%s → accept: builds only when the coach offered to build it', (t) => {
    expect(buildFollowUp(t)).toBe('accept');
    expect(buildFollowUpIn([ben('what should I do today'), coach(PLAN)], t)).toBeNull();
    expect(buildFollowUpIn([ben('what should I do today'), coach(`${PLAN} Want me to build it in the app?`)], t)).not.toBeNull();
  });

  const NOT = [
    'no',
    'no thanks',
    "don't add it",
    'why split squats?',
    'yes, but why calf raises?',
    'yes but why calf raises',
    'no but make it 45 mins',
    'looks heavy',
    "that's a lot of sets",
    'what about pull?',
    'what about pull',
    'nah',
    'not now',
    'maybe later',
    'add it later',
    'later',
    "nah I'm good",
    "I'll do it myself",
    'hold on',
    // Review r2 S1: thanks or praise alone is a sign-off, not a yes.
    'thanks',
    'thanks mate',
    'cool',
    'nice',
    'perfect',
    'cheers',
    'my shoulder hurts today',
  ];
  it.each(NOT)('%s → not a follow-up build, even after the coach’s offer', (t) => {
    expect(buildFollowUp(t)).not.toBe('explicit');
    expect(buildFollowUpIn([ben('Can you make me a push session'), coach(`${PLAN} Want me to build it in the app?`)], t)).toBeNull();
  });

  // Review r2 B1: after the coach's own offer, any reply that isn't a question or a refusal opens the tool.
  const AFTER_OFFER = [
    ...ACCEPT,
    'ok',
    'yes, 45 mins',
    'yes but 45 mins',
    'yes without dips',
    'yes and add some biceps',
    'yes in the app',
    'in the app please',
    'swap the calf raises for leg press',
    'without the calf raises',
    'go for it, an hour',
  ];
  it.each(AFTER_OFFER)('after "Want me to build it in the app?", %s builds (a draft; his words are the change)', (t) => {
    const thread = [ben('what should I do for push today'), coach('Bench press 3 × 6–8, overhead press 3 × 8–10, dips 3 × 8–12. Want me to build it in the app?')];
    const f = buildFollowUpIn(thread, t);
    expect(f).toEqual({ priorBenText: 'what should I do for push today', benTexts: ['what should I do for push today'], strength: 'clear' });
    expect(asksForBuild({ turnKind: 'general', text: t, draftInContext: false, followUp: f })).toBe(true);
    expect(opens(t, true)).toBe(true);
  });

  it('review r2 B1: a yes with a length, an exclusion or a place is explicit (it builds after a plan with no offer too)', () => {
    for (const t of ['yes, 45 mins', 'yes but 45 mins', 'yes without dips', 'yes and add some biceps', 'yes in the app', 'in the app please', 'yeah, an hour', 'go on then, without dips']) {
      expect(buildFollowUp(t)).toBe('explicit');
      expect(buildFollowUpIn([ben('Can you make me a push session'), coach(PLAN)], t)).not.toBeNull();
    }
    // Review r2 N1: "log it" means he did it, and a bare "make" or "do" has no object.
    for (const t of ['log it', 'make', 'do', 'get']) expect(buildFollowUpIn([ben('Can you make me a push session'), coach(PLAN)], t)).toBeNull();
    // A bare length with no yes is not a build after a plan without an offer.
    expect(buildFollowUp('45 mins')).toBeNull();
    expect(buildFollowUpIn([ben('what should I do today'), coach(PLAN)], '45 mins')).toBeNull();
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
        strength: 'clear',
      });
      expect(asksForBuild({ turnKind: 'general', text: t, draftInContext: false, followUp: f })).toBe(true);
      expect(buildRequestWords(t, f)).toBe(`Can you make me a push session with split squats and calf raises\nYes u can add in the app\n${t}`);
    },
  );

  // Review r2 S1: after a refusal, a sign-off is not a yes; a yes-family word still builds.
  it.each(['ok thanks', 'thanks mate', 'cool', 'nice', 'perfect', 'ok', 'thanks'])('device thread: %s → no build (a sign-off)', (t) => {
    expect(buildFollowUpIn(DEVICE(), t)).toBeNull();
  });
  it.each(['yeah', 'yep', 'sure', 'ok go', 'do it', 'go on then', 'yes please'])('device thread: %s → builds (a yes)', (t) => {
    expect(buildFollowUpIn(DEVICE(), t)).not.toBeNull();
  });
  it('review r2 S3: a refusal that names no workout ("I can’t do that in the app.") counts as the refusal', () => {
    const thread = [ben('Can you make me a push session with split squats and calf raises'), coach(PLAN), ben('Yes u can add in the app'), coach("I can't do that in the app.")];
    expect(buildFollowUpIn(thread, 'yes')).not.toBeNull();
    expect(buildFollowUpIn(thread, 'ok thanks')).toBeNull();
  });

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
    expect(buildRequestWords('yes add it', { priorBenText: 'push session, 45 mins', benTexts: ['push session, 45 mins'], strength: 'clear' })).toBe('push session, 45 mins\nyes add it');
    expect(buildWordsNewestFirst('yes', { priorBenText: 'push session', benTexts: ['make it 45 mins', 'push session'], strength: 'clear' })).toEqual(['yes', 'make it 45 mins', 'push session']);
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
    // Review r2 S3: reps before sets, and paraphrased offers.
    expect(describesWorkoutPlan('Bench press for 6-8 reps, 3 sets. Dips for 8-12 reps, 3 sets.')).toBe(true);
    expect(describesWorkoutPlan('Do 8 reps on bench.')).toBe(false);
    expect(offersToBuild('I can build it in the app if you like.')).toBe(true);
    expect(offersToBuild(`${PLAN} Want me to set that up?`)).toBe(true);
    expect(offersToBuild(`${PLAN} Shall I set it up?`)).toBe(true);
    expect(offersToBuild('I can save that as a memory if you like.')).toBe(false);
    expect(offersToBuild('I can explain it if you like.')).toBe(false);
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
    expect(claimsNoBuildTool(s, { generic: true })).toBe(false);
  });

  // Review r2 S3: no workout named. Only where Ben asked for a build; elsewhere it may be a true limit.
  const GENERIC = ["I can't do that in the app.", "I don't have a tool for that.", "Sorry, I'm not able to do that in the app."];
  it.each(GENERIC)('%s: a no-build claim on a build turn only', (s) => {
    expect(claimsNoBuildTool(s, { generic: true })).toBe(true);
    expect(claimsNoBuildTool(s)).toBe(false);
  });
  it("review r2 S3: \"I don't have a way to save workouts in the app.\"", () => {
    expect(claimsNoBuildTool("I don't have a way to save workouts in the app.")).toBe(true);
  });

  it('on a build turn, a generic refusal is hidden too', () => {
    const f = createReplyFilter({ ledger: empty, surface: 'sheet', noBuildToolLine: true, buildAsked: true });
    const items = [...f.push("I can't do that in the app. "), ...f.end(true)];
    expect(items).toEqual([{ kind: 'sentence', text: BUILD_ASK_LINE }]);
    const g = createReplyFilter({ ledger: empty, surface: 'sheet', noBuildToolLine: true });
    expect([...g.push("I can't do that in the app. "), ...g.end(true)]).toEqual([{ kind: 'sentence', text: "I can't do that in the app." }]);
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

// ---------- Review r3 ----------

describe('review r3 B1: no promise or done-claim without a saved draft', () => {
  const empty = () => ({ turnId: 't', entries: [], knownExerciseNames: [] });
  // Explicit claims (review r4 B2): a workout noun, or a pronoun with "for you" or a place. Hidden on any turn that can build.
  const PROMISES = [
    "Okay, I'll set that up for you.",
    'Let me put that in the app.',
    "I'll get that into your workouts.",
    "It's ready in your workouts.",
    'You should see it in the app shortly.',
    "Sure, I'll set that up for you.",
    "I've added it to your workouts.",
    'Your push session is in the app.',
    "I'm setting that up now.",
  ];
  it.each(PROMISES)('%s → a claim', (s) => {
    expect(claimsWorkoutBuilt(s)).toBe(true);
  });
  // Review r4 B2/S1: claims only when a build is in play (Ben asked, or is following one up).
  const IN_PLAY = ['Building it now.', 'Check your Workouts tab.', "It's set up for you."];
  it.each(IN_PLAY)('%s → a claim only with a build in play', (s) => {
    expect(claimsWorkoutBuilt(s)).toBe(false);
    expect(claimsWorkoutBuilt(s, { inPlay: true })).toBe(true);
  });

  const NOT_CLAIMS = [
    'Want me to build it in the app?',
    'Should I build that for you?',
    'I can build it in the app if you like.',
    BUILD_ASK_LINE,
    'Push first, then legs.',
    'Bench press 3 × 6–8, overhead press 3 × 8–10.',
    'Let me know how it goes.',
    "Here's a push session:",
    "That's in line with your last session.",
    'Multi-week programmes are not available yet.',
    "I can't save it to your workouts for you — open it and tap Save.",
    'Your bench is up 5 kg this month.',
  ];
  it.each(NOT_CLAIMS)('%s → not a claim', (s) => {
    expect(claimsWorkoutBuilt(s)).toBe(false);
    expect(claimsWorkoutBuilt(s, { inPlay: true })).toBe(false);
  });

  it.each(PROMISES)('a no-tool general turn with a build available never shows "%s"; it asks the fixed offer once', (s) => {
    const f = createReplyFilter({ ledger: empty, surface: 'sheet', noBuildToolLine: true });
    const items = [...f.push(`${s} Push first, then legs. `), ...f.end(true)];
    const shown = items.map((i) => (i.kind === 'sentence' ? i.text : ''));
    expect(shown).not.toContain(s);
    expect(shown).toEqual([BUILD_OFFER_LINE, 'Push first, then legs.']);
    expect(f.hiddenLines.map((h) => h.reason)).toEqual(['no_action']);
    expect(f.note()?.text).toBe('Nothing changed · 1 line hidden');
  });

  it.each([...PROMISES, ...IN_PLAY])('review r4 (PM): with the tool offered but not used, "%s" is just dropped (build in play)', (s) => {
    const f = createReplyFilter({ ledger: empty, surface: 'sheet', noBuildToolLine: true, buildAsked: true, toolOffered: true });
    const items = [...f.push(`${s} Push first, then legs. `), ...f.end(true)];
    expect(items.map((i) => (i.kind === 'sentence' ? i.text : ''))).toEqual(['Push first, then legs.']);
    expect(f.hiddenLines.map((h) => h.detail)).toEqual(['No workout was built.']);
  });

  it.each([...PROMISES, ...IN_PLAY])('a build turn whose propose_workout was refused never shows "%s"', (s) => {
    const refused = { ref: 'a1', origin: 'this_turn' as const, record: { status: 'rejected', undoneBy: null, detail: { kind: 'build_workout' } } as unknown as ActionRecord };
    const f = createReplyFilter({ ledger: () => ({ turnId: 't', entries: [refused], knownExerciseNames: [] }), surface: 'sheet', noBuildToolLine: true, buildAsked: true, toolOffered: true });
    const items = [...f.push(`${s} `), ...f.end(true)];
    expect(items.map((i) => (i.kind === 'sentence' ? i.text : ''))).toEqual([]);
    expect(f.hiddenLines).toHaveLength(1);
  });

  it('under a saved draft the same words stand', () => {
    const saved = { ref: 'a1', origin: 'this_turn' as const, record: { status: 'committed', undoneBy: null, detail: { kind: 'build_workout' } } as unknown as ActionRecord };
    const f = createReplyFilter({ ledger: () => ({ turnId: 't', entries: [saved], knownExerciseNames: [] }), surface: 'sheet', noBuildToolLine: true, buildAsked: true, noChangeLine: 'off', claimsNeedToken: false });
    f.push("It's ready in your workouts. ");
    f.end(true);
    expect(f.hiddenLines.filter((h) => h.detail === 'No workout was built.')).toHaveLength(0);
  });

  it('elsewhere (no build available) the filter is unchanged', () => {
    const f = createReplyFilter({ ledger: empty, surface: 'sheet', noChangeLine: 'off' });
    const items = [...f.push("Let me know if it's too heavy. "), ...f.end(true)];
    expect(items).toEqual([{ kind: 'sentence', text: "Let me know if it's too heavy." }]);
  });

  it('the no-tool prompt matches the turn: it can’t build now, it asks, it never says the app can’t', () => {
    expect(NO_BUILD_TOOL_INSTRUCTIONS).toContain('You cannot build a workout on this turn.');
    expect(NO_BUILD_TOOL_INSTRUCTIONS).toContain('"Want me to build it in the app?"');
    expect(NO_BUILD_TOOL_INSTRUCTIONS).toContain('Never say a workout is being built');
    expect(NO_BUILD_TOOL_INSTRUCTIONS).not.toContain('The app can build one workout session as a draft when Ben asks');
  });
});

describe('review r3 S1: after an offer, non-answers never force a draft', () => {
  const offerThread = (): CoachMessage[] => [ben('what should I do for push today'), coach('Bench press 3 × 6–8, overhead press 3 × 8–10, dips 3 × 8–12. Want me to build it in the app?')];
  it.each(['maybe', 'I will think about it', "I'll think about it", 'not sure', 'brb', 'one sec', 'lol', 'my shoulder feels a bit tight', 'idk', 'hang on'])('%s → no build', (t) => {
    expect(buildFollowUpIn(offerThread(), t)).toBeNull();
  });
  it.each(["I'm going at 6", 'I am off to the gym now'])('%s → offered but loose (not held, not forced)', (t) => {
    expect(buildFollowUpIn(offerThread(), t)?.strength).toBe('loose');
  });
  it.each(['yes', 'go on then', 'without the calf raises', 'yes, 45 mins', 'add it'])('%s → clear', (t) => {
    expect(buildFollowUpIn(offerThread(), t)?.strength).toBe('clear');
  });
});

describe('review r3 S2: pushback and retries after a refusal or the ask line', () => {
  const DEVICE = (): CoachMessage[] => [
    ben('Can you make me a push session with split squats and calf raises'),
    coach(PLAN),
    ben('Yes u can add in the app'),
    coach("The app may support adding workouts, but I don't have access to a workout-creation tool in this chat. You can add it from the Workouts tab."),
  ];
  const ASKED = (): CoachMessage[] => [ben('what should I do today'), coach(PLAN), ben('stick it in'), coach(BUILD_ASK_LINE)];
  const PUSH = [
    'yes you can',
    'you can',
    'you can though',
    'yes it can',
    'the app does have a builder',
    'there is a workout builder',
    'use the workout builder',
    'you do have a tool',
    'you do have access',
    'try again',
    'can you try again',
    'just try',
    'yes try',
    'check again',
    'make a draft',
  ];
  it.each(PUSH)('%s → retries the build (device thread and after the ask line)', (t) => {
    expect(retriesBuild(t)).toBe(true);
    expect(buildFollowUpIn(DEVICE(), t)?.strength).toBe('clear');
    expect(buildFollowUpIn(ASKED(), t)).not.toBeNull();
  });
  it.each(['you can’t', 'ok thanks', 'cool', 'how?', 'thanks anyway'])('%s → no retry', (t) => {
    expect(retriesBuild(t)).toBe(false);
    expect(buildFollowUpIn(DEVICE(), t)).toBeNull();
  });
  it('a plan in text with no offer and no build request: "try again" is not a build', () => {
    expect(buildFollowUpIn([ben('what should I do today'), coach(PLAN)], 'try again')).toBeNull();
  });
});

describe('review r3 S3: a yes after Ben’s own build request went unbuilt (held text plan)', () => {
  it.each(['yes', 'go on then', 'ok do it', 'that would be great thanks'])('%s → builds', (t) => {
    const thread = [ben('Can you make me a push session'), coach(PLAN)];
    const f = buildFollowUpIn(thread, t);
    expect(f?.strength).toBe('clear');
    expect(f?.priorBenText).toBe('Can you make me a push session');
  });
  it('not when Ben never asked for a build', () => {
    expect(buildFollowUpIn([ben('what should I do today'), coach(PLAN)], 'yes')).toBeNull();
  });
  it('not after a draft was made', () => {
    expect(buildFollowUpIn([ben('Can you make me a push session'), coach('Here.', ['a1'])], 'yes')).toBeNull();
  });
});

describe('review r3 S4: detector gaps', () => {
  it.each(['Should I build that for you?', 'Do you want this as a workout in the app?', 'Want it in the app?'])('offer: %s', (s) => {
    expect(offersToBuild(s)).toBe(true);
  });
  it.each(['Want me to save that as a memory?', 'Should I go lighter?', 'Do you want it heavier?'])('not a build offer: %s', (s) => {
    expect(offersToBuild(s)).toBe(false);
  });
  it.each([
    'I can only describe workouts here, not add them.',
    "I can plan your session, but adding it to the app isn't something I can do.",
    "You'll need to add it in the app yourself.",
  ])('no-build claim: %s', (s) => {
    expect(claimsNoBuildTool(s)).toBe(true);
  });
  it.each(["That's not something I can do from this chat.", "Unfortunately I can't save sessions."])('no-build claim on a build turn: %s', (s) => {
    expect(claimsNoBuildTool(s, { generic: true })).toBe(true);
    expect(claimsNoBuildTool(s)).toBe(false);
  });
  it.each(["Adding weight to bench isn't something I'd rush.", "You'll need to add exercises yourself."])('a true statement stays: %s', (s) => {
    expect(claimsNoBuildTool(s, { generic: true })).toBe(false);
  });
  it('AMRAP and timed lines are plan lines', () => {
    expect(describesWorkoutPlan('Dips — 3 × AMRAP. Plank 3 × 45 s.')).toBe(true);
    expect(describesWorkoutPlan('Bench 3 × 8. Plank 3 × 45s.')).toBe(true);
    expect(describesWorkoutPlan('Plank 3 × 45 s.')).toBe(false);
  });
});

// ---------- Review r4 (PM decision 13 Oct, pending Ben's confirmation) ----------

const offered = (text: string, kind: 'general' | 'workout' = 'general'): boolean =>
  buildTurnRegistry(gateFor({ kind, input: words(text), previousOffer: null, structuralSignals: [], buildOpen: true })).tools.some((t) => t.name === 'propose_workout');

describe('review r4: propose_workout offered on every general turn with a gym, forced only on an explicit ask', () => {
  it.each(['how is my bench going?', 'where can I see my bench from Tuesday?', 'my shoulder hurts', 'what should I do today', 'i want it in the app', 'can you not just add it'])(
    '%s: offered (buildOpen), never forced',
    (t) => {
      expect(offered(t)).toBe(true);
      expect(forcesBuild(t)).toBe(false);
    },
  );
  it('not in a workout turn, and not without a gym (buildOpen absent)', () => {
    expect(offered('make me a push session', 'workout')).toBe(false);
    expect(opens('how is my bench going?')).toBe(false);
  });
  it('a chip never opens it through buildOpen', () => {
    const g = gateFor({ kind: 'general', input: { kind: 'chip', chip: 'too_hard' }, previousOffer: null, structuralSignals: [], buildOpen: true });
    expect(buildTurnRegistry(g).tools.map((t) => t.name)).not.toContain('propose_workout');
  });
  it('buildOpen alone is not Ben asking for a change (no "Nothing changed" line from it)', () => {
    expect(gateFor({ kind: 'general', input: words('how is my bench going?'), previousOffer: null, structuralSignals: [], buildOpen: true }).benAskedForChange).toBe(false);
  });

  it.each(['Can you make me a push session with split squats and calf raises', 'build me a 45 minute push workout', 'plan me a leg session', 'make me a push session', 'build me something for today'])('%s: forced', (t) => {
    expect(forcesBuild(t)).toBe(true);
  });
  it.each(['make me a push session, my shoulder is sore', 'build me a leg workout but my knee hurts', 'make me a push session that is easy on my sore elbow'])('%s: a pain word, never forced (rule 9)', (t) => {
    expect(forcesBuild(t)).toBe(false);
  });
  it('a change to the draft in context (BD16) is forced; with a pain word it is not', () => {
    expect(forcesBuild('make it shorter', { draftInContext: true })).toBe(true);
    expect(forcesBuild('make it shorter')).toBe(false);
    expect(forcesBuild('drop the dips, my shoulder hurts', { draftInContext: true })).toBe(false);
  });

  // Review r4 S3 first-turn phrasings: no longer widened; the tool is offered and the model reads them.
  it.each(['would you be able to make me a push session', 'any chance you could make me a push session', 'chuck together a push session for me', 'knock me up a push sesh', 'Push and legs today please', 'whats a good push session? can you make one'])(
    '%s: offered, the model decides',
    (t) => {
      expect(offered(t)).toBe(true);
    },
  );

  it('the offered instructions say when to use it and when never to', () => {
    expect(OFFERED_BUILD_INSTRUCTIONS).toContain('Use it only when Ben asks for a workout or session, or agrees to put a session you described earlier in this thread into the app');
    expect(OFFERED_BUILD_INSTRUCTIONS).toContain('Never use it for pain or soreness, advice, questions about his history, or multi-week plans');
    expect(OFFERED_BUILD_INSTRUCTIONS).toContain('Want me to build it in the app?');
    const desc = buildTurnRegistry(gateFor({ kind: 'general', input: words('hi'), previousOffer: null, structuralSignals: [], buildOpen: true })).tools.find((t) => t.name === 'propose_workout')?.description ?? '';
    expect(desc).toContain('only when Ben asks for a workout or session');
    expect(desc).toContain('Never for pain or soreness, advice, his history, or multi-week plans');
    expect(desc).toContain('It only makes a draft; Ben starts or saves it himself.');
  });
});

describe('review r4 B1: a sore body part is never a build request', () => {
  const PAIN_ASKS = [
    'can you give me something for my sore shoulder today',
    'give me something for my back pain today',
    'give me something for my knee today',
    'give me something to stretch my back today',
    'give me something to do for my shoulder today, it hurts',
    'make me something for dinner tonight',
    'make me something to read about push today',
  ];
  it.each(PAIN_ASKS)('%s: not a build, never forced', (t) => {
    expect(requestHas(classifyBenRequest(t, 'general'), 'build')).toBe(false);
    expect(forcesBuild(t)).toBe(false);
    expect(asksForBuild({ turnKind: 'general', text: t, draftInContext: false, followUp: null })).toBe(false);
  });
});

describe('review r4 B2: history and advice sentences are never hidden', () => {
  const ORDINARY = [
    "It's in your workout history.",
    "That's in your workouts from Tuesday.",
    'You can see it in your workouts.',
    'Look at your workout history for last week.',
    'Check your workout log for the last bench.',
    'Let me put it another way.',
    'Let me make this simple.',
    "I'll make it quick.",
    'Let me get this straight.',
    "I'll make that clear.",
    "I'll get back to it.",
    "I'll put it simply: rest more.",
    'Adding a set this week would help.',
    'Getting that extra rep is a good sign.',
    'Making it to the gym three times is great.',
    'Building it up slowly is the key.',
    'Making this your top set is smart.',
    'Fatigue should show up soon.',
    'Your PR should show up in History now.',
  ];
  const empty = () => ({ turnId: 't', entries: [], knownExerciseNames: [] });
  it.each(ORDINARY)('%s: not a claim', (s) => {
    expect(claimsWorkoutBuilt(s)).toBe(false);
  });
  // The build backstop adds nothing: the reply reads exactly as it does on a turn with no build at all
  // (no hidden "No workout was built.", no inserted build line). Some of these are still hidden by the
  // general change-claim check (claims.ts, CC9), which is not part of the build backstop.
  it.each(ORDINARY)('%s: the build backstop leaves it as a no-build turn would (tool offered or not)', (s) => {
    const plain = createReplyFilter({ ledger: empty, surface: 'sheet' });
    const expected = [...plain.push(`${s} `), ...plain.end(true)];
    for (const toolOffered of [false, true]) {
      const f = createReplyFilter({ ledger: empty, surface: 'sheet', noBuildToolLine: true, toolOffered });
      expect([...f.push(`${s} `), ...f.end(true)]).toEqual(expected);
      expect(f.hiddenLines.map((h) => h.detail)).toEqual(plain.hiddenLines.map((h) => h.detail));
      expect(f.hiddenLines.map((h) => h.detail)).not.toContain('No workout was built.');
    }
  });
  // Even with a build in play, the ones that never read as a claim about a new workout stay.
  it.each(ORDINARY.filter((s) => s !== 'You can see it in your workouts.'))('%s: not a claim with a build in play either', (s) => {
    expect(claimsWorkoutBuilt(s, { inPlay: true })).toBe(false);
  });
});

describe('review r4 S1: done-claims about a workout, with a build in play', () => {
  const DONE = ["Here you go, it's saved.", "It's been added.", 'Okay, adding that now.', "I've set it up.", 'On it!', 'Coming right up.', 'Done! Open it from Workouts when you are ready.'];
  const empty = () => ({ turnId: 't', entries: [], knownExerciseNames: [] });
  it.each(DONE)('%s: a claim with a build in play, ordinary words elsewhere', (s) => {
    expect(claimsWorkoutBuilt(s, { inPlay: true })).toBe(true);
    expect(claimsWorkoutBuilt(s)).toBe(false);
  });
  it.each(DONE)('%s: hidden (just dropped) on a build turn with the tool and no draft', (s) => {
    const f = createReplyFilter({ ledger: empty, surface: 'sheet', noBuildToolLine: true, buildAsked: true, toolOffered: true });
    const items = [...f.push(`${s} Bench first. `), ...f.end(true)];
    expect(items).toEqual([{ kind: 'sentence', text: 'Bench first.' }]);
    expect(f.hiddenLines.length).toBeGreaterThan(0);
  });
  it('without the tool, a hidden claim is replaced once by "Want me to build it in the app?"', () => {
    const f = createReplyFilter({ ledger: empty, surface: 'sheet', noBuildToolLine: true, buildAsked: true });
    const items = [...f.push("On it! It's been added. Bench first. "), ...f.end(true)];
    expect(items).toEqual([
      { kind: 'sentence', text: 'Want me to build it in the app?' },
      { kind: 'sentence', text: 'Bench first.' },
    ]);
    expect(BUILD_OFFER_LINE).toBe('Want me to build it in the app?');
    expect(offersToBuild(BUILD_OFFER_LINE)).toBe(true);
  });
});

describe('review r4 S2: a week of sessions is never forced into one', () => {
  it.each(['make me a workout plan for this week', 'make me a workout for each day this week', 'make me sessions for this week', 'build me 4 workouts a week'])('%s: not a build, not forced', (t) => {
    expect(multiWeekScope(t)).toBe(true);
    expect(requestHas(classifyBenRequest(t, 'general'), 'build')).toBe(false);
    expect(forcesBuild(t)).toBe(false);
  });
  it.each(['Could you make me a pull workout for this week', 'make me a 45 min push session at the gym this week', 'make me a pull workout for next week'])('%s: one session, still a build', (t) => {
    expect(multiWeekScope(t)).toBe(false);
    expect(forcesBuild(t)).toBe(true);
  });
  it('every build prompt says programmes and weekly plans are not available yet', () => {
    for (const i of [BUILD_INSTRUCTIONS, OFFERED_BUILD_INSTRUCTIONS, OFFER_REPLY_BUILD_INSTRUCTIONS]) expect(i).toContain('Multi-week programmes and weekly plans are not available yet');
  });
});

describe('review r4 S3: a laugh or a "maybe" with a yes still builds', () => {
  const offerThread = (): CoachMessage[] => [ben('what should I do for push today'), coach('Bench press 3 × 6–8, overhead press 3 × 8–10, dips 3 × 8–12. Want me to build it in the app?')];
  const askedThread = (): CoachMessage[] => [ben('Can you make me a push session'), coach(PLAN)];
  it.each(['yes lol', 'haha yes go on', 'yes, maybe add curls', 'lol yes', 'yes haha'])('%s → clear after an offer and after his own unbuilt request', (t) => {
    expect(buildFollowUpIn(offerThread(), t)?.strength).toBe('clear');
    expect(buildFollowUpIn(askedThread(), t)?.strength).toBe('clear');
  });
  it.each(['lol', 'haha', 'maybe', 'maybe later'])('%s → still no build', (t) => {
    expect(buildFollowUpIn(offerThread(), t)).toBeNull();
  });
});

describe('review r4 S4: a refused build can be retried on the next turn', () => {
  const thread = (): CoachMessage[] => [ben('Can you make me a push session'), coach("It wasn't built: none of those fit this gym.", ['a1'])];
  it.each(['try again', 'yes', 'go on then', 'try it again'])('%s → clear when a1 was a refused build', (t) => {
    const f = buildFollowUpIn(thread(), t, new Set(['a1']));
    expect(f?.strength).toBe('clear');
    expect(f?.priorBenText).toBe('Can you make me a push session');
  });
  it('a committed draft (a1 not refused) still ends the look-back', () => {
    expect(buildFollowUpIn(thread(), 'try again')).toBeNull();
  });
  it('the refused IDs come from the stored records of the last coach messages', async () => {
    const t = thread();
    const record = (actionId: string, status: string, kind = 'build_workout') => ({ actionId, status, detail: { kind } }) as unknown as ActionRecord;
    const ids = await refusedBuildActionIds(t, (turnId) => Promise.resolve(turnId === t[1]?.turnId ? [record('a1', 'rejected'), record('a2', 'committed'), record('a3', 'stale'), record('a4', 'rejected', 'save_memory')] : []));
    expect([...ids]).toEqual(['a1', 'a3']);
  });
});

describe('review r4 S5: a "can\'t build" on a turn with the tool offered becomes the offer, never the ask line', () => {
  const empty = () => ({ turnId: 't', entries: [], knownExerciseNames: [] });
  it('loose or offered turn', () => {
    const f = createReplyFilter({ ledger: empty, surface: 'sheet', noBuildToolLine: true, toolOffered: true });
    const items = [...f.push("I can't build workouts here. Push first. "), ...f.end(true)];
    expect(items).toEqual([
      { kind: 'sentence', text: BUILD_OFFER_LINE },
      { kind: 'sentence', text: 'Push first.' },
    ]);
  });
});

describe('review r4 nits', () => {
  const offerThread = (): CoachMessage[] => [ben('what should I do for push today'), coach('Bench press 3 × 6–8, overhead press 3 × 8–10. Want me to build it in the app?')];
  it.each(['ok thanks', 'okay thank you', 'ok cheers'])('N1: %s after an offer is a sign-off, not a build', (t) => {
    expect(buildFollowUp(t)).toBeNull();
    expect(buildFollowUpIn(offerThread(), t)).toBeNull();
  });
  it('N1: a plain "ok" after an offer still builds', () => {
    expect(buildFollowUpIn(offerThread(), 'ok')?.strength).toBe('clear');
  });
  it('N2: a bare "try that" after his own unbuilt request is not a retry; after a refusal it is', () => {
    expect(buildFollowUpIn([ben('Can you make me a push session'), coach(PLAN)], 'try that')).toBeNull();
    expect(buildFollowUpIn([ben('Can you make me a push session'), coach(PLAN)], 'try that again')?.strength).toBe('clear');
    expect(buildFollowUpIn([ben('Can you make me a push session'), coach(PLAN), ben('add it'), coach(BUILD_ASK_LINE)], 'try that')?.strength).toBe('clear');
  });
  it('N3: "Sorry, that\'s outside what I can do here." is a generic no-build claim', () => {
    expect(claimsNoBuildTool("Sorry, that's outside what I can do here.", { generic: true })).toBe(true);
    expect(claimsNoBuildTool("Sorry, that's outside what I can do here.")).toBe(false);
  });
});

describe('review r4: the usable list is capped, Ben\'s own exercises first', () => {
  const u = (id: string) => ({ catalogueId: id, name: id, equipment: 'Barbell', measured: 'reps' as const });
  it('keeps the list under the cap, in its own order, with the first ones kept', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map(u);
    expect(capUsable(list, 10)).toEqual(list);
    expect(capUsable(list, 2).map((x) => x.catalogueId)).toEqual(['a', 'b']);
    expect(capUsable(list, 2, ['e', 'c']).map((x) => x.catalogueId)).toEqual(['c', 'e']);
  });
});
