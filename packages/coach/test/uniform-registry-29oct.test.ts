import { describe, expect, it } from 'vitest';

import { asksToPlanWeek, buildTurnRegistry, claimsNoWeekTool, gateFor, type GateInput } from '../src/index';

/**
 * ADR 0039 (Ben, 29 Oct: "Can we make the coach across chats have broader and more homogenous edit rights?").
 * The entry point decides what the coach sees first, never what it can do: the same state gives the same tools
 * from every chat. Today, Plan, Progress and a Summary's thread are `general` turns; a live workout's own sheet is a
 * `workout` turn (it starts light, so it also gets `think_harder`). The post-workout review is not a chat.
 */

const words = (text: string) => ({ kind: 'words' as const, text, spoken: false });

interface State {
  name: string;
  liveWorkout: boolean;
  week: boolean;
  planInUse: boolean;
  buildOpen: boolean;
}
const STATES: State[] = [
  { name: 'nothing live, no plan', liveWorkout: false, week: false, planInUse: false, buildOpen: true },
  { name: 'a plan in use, its week', liveWorkout: false, week: true, planInUse: true, buildOpen: true },
  { name: 'a live workout and a plan', liveWorkout: true, week: true, planInUse: true, buildOpen: true },
  { name: 'a live workout, split days, no plan', liveWorkout: true, week: true, planInUse: false, buildOpen: true },
];
const MESSAGES = [
  "I'm generally achy after legs Monday, pull Tuesday and push Wednesday. Make today a rest day and don't cram the rest of the week",
  'how is my week looking?',
  'pause my plan, I’m on holiday till 3 Nov',
  'add a set to rows',
  'build me a push workout',
  'build me a 4-day plan',
];

/** Today, Plan, Progress, a Summary's thread (`general`), and the live workout's own sheet (`workout`, only when one is live). */
function toolsFrom(kind: 'general' | 'workout', s: State, text: string): string[] {
  const g: GateInput = {
    kind,
    input: words(text),
    previousOffer: null,
    structuralSignals: [],
    ...(s.liveWorkout ? { liveWorkout: true } : {}),
    ...(s.week ? { week: true } : {}),
    ...(s.planInUse ? { planInUse: true } : {}),
    ...(s.buildOpen ? { buildOpen: true } : {}),
  };
  // `think_harder` is the light turn's own step (the workout's sheet starts on low effort); it changes nothing.
  return buildTurnRegistry(gateFor(g))
    .tools.map((t) => t.name)
    .filter((n) => n !== 'think_harder')
    .sort();
}

describe('ADR 0039: the same tools from every entry point, given the same state (table)', () => {
  const ENTRIES = ['today', 'plan', 'progress', 'summary', 'workout'] as const;
  for (const s of STATES) {
    for (const text of MESSAGES) {
      it(`${s.name} · "${text.slice(0, 40)}…"`, () => {
        const sets = ENTRIES.flatMap((e) => (e === 'workout' && !s.liveWorkout ? [] : [{ e, tools: toolsFrom(e === 'workout' ? 'workout' : 'general', s, text) }]));
        const first = sets[0]?.tools ?? [];
        for (const x of sets) expect({ entry: x.e, tools: x.tools }).toEqual({ entry: x.e, tools: first });
        // What exists decides: today's tools only with a live workout, the week's only with a week, pause only with a plan.
        expect(first.includes('edit_today')).toBe(s.liveWorkout);
        expect(first.includes('propose_week')).toBe(s.week);
        expect(first.includes('pause_plan')).toBe(s.planInUse);
        expect(first).toContain('log_activity');
      });
    }
  }

  it('the post-workout review keeps its closed list (not a chat)', () => {
    const t = buildTurnRegistry(gateFor({ kind: 'summary', input: { kind: 'summary' }, previousOffer: null, structuralSignals: [], liveWorkout: true, week: true, planInUse: true })).tools.map((x) => x.name);
    expect(t).not.toContain('propose_week');
    expect(t).not.toContain('edit_today');
    expect(t).not.toContain('pause_plan');
  });
});

describe('ADR 0039: Ben asking to reshape this week (code’s reading)', () => {
  it.each([
    "Make today a rest day and don't cram the rest of the week",
    'make today a rest day',
    'take today off',
    'can we skip legs day this week?',
    'skip tomorrow’s session',
    'move legs to saturday',
    'spread out the rest of the week',
    'don’t cram the remaining workouts',
    'plan my week around my long run',
  ])('"%s" asks', (t) => {
    expect(asksToPlanWeek(t)).toBe(true);
  });
  it.each(['how is my week looking?', 'skip the last set', 'skip the warm-up sets', 'I had a rest day yesterday', 'should I rest today?'])('"%s" does not', (t) => {
    expect(asksToPlanWeek(t)).toBe(false);
  });
});

describe('ADR 0039: "not available in this chat" is false where the week tool is', () => {
  it.each(["I can advise on that adjustment here, but I don't have a weekly-plan editing tool available in this chat.", "I can't change your plan from this chat.", 'Weekly plan edits are not available in this chat.'])('"%s" is caught', (t) => {
    expect(claimsNoWeekTool(t)).toBe(true);
  });
  it.each(['Multi-week blocks aren’t available yet.', 'Take an easy run tonight.', 'I don’t have your heart rate data.'])('"%s" is kept', (t) => {
    expect(claimsNoWeekTool(t)).toBe(false);
  });
});
