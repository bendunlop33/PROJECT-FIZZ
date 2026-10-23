import { describe, expect, it } from 'vitest';

import type { NextTimeRow } from '@fizz/domain';
import type { ActionRecord, NextSessionTargetRecord } from '@fizz/schemas';

import type { CoachAvailability } from '../src/coach/coach-service';
import { nextTimeView, summaryNoteSentences } from '../src/coach/next-time-view';
import { applyProgress, benText, cardView, offerLabel, outcomeFor, routeLine, seesLabel, starterChips, startLiveTurn, statusView, thinkingLabel, whyView, workoutBarText } from '../src/coach/sheet-view';
import { adjustControlView, chipForTrigger, slotAfterFailure, slotView } from '../src/coach/slot-view';

/** View models for the coach sheet, the workout's coach slot and the Summary's Next time (C6–C8). */

const AT = { utc: '2026-10-10T08:00:00.000Z', tz: 'Europe/London' };
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const kg = (value: number) => ({ value, unit: 'kg' as const, convention: 'total' as const });
const nb = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ');

function record(over: Partial<ActionRecord> & Pick<ActionRecord, 'detail'>): ActionRecord {
  return { actionId: ID(1), turnId: 't1', opId: 'op1', status: 'committed', author: 'coach', failure: null, reason: null, evidenceRefs: [], guardNotes: [], entityVersions: [], undoneBy: null, createdAt: AT, ...over };
}

const adjust = record({
  detail: { kind: 'adjust_pending_sets', sessionId: ID(9), exercises: [{ sessionExerciseId: ID(10), exerciseName: 'Bench press', changes: [3, 4].map((n) => ({ setId: ID(100 + n), setNumber: n, before: { load: kg(100), reps: { min: 6, max: 8 } }, after: { load: kg(97.5), reps: { min: 6, max: 8 } } })) }] },
  reason: 'Set 2 was RPE 10.',
  guardNotes: [
    { kind: 'snapped', setIds: [], text: 'Rounded to 97.5 kg: nearest your bar and plates allow.' },
    { kind: 'completed_set_dropped', setIds: [], text: 'Not changed: set 2 is already done.' },
  ],
});

const avail = (status: CoachAvailability['status']): CoachAvailability => ({ status, model: status === 'not_connected' ? null : 'gpt-6.1-sol' });

describe('status (minimal copy: a word or two, the rest behind Why?)', () => {
  it.each([
    ['ok', null, true],
    ['offline', 'Offline', true],
    ['not_connected', 'Not connected', false],
    ['limit', 'Paused', false],
    ['expired', 'Signed out', false],
    ['model_gone', 'Choose model', false],
    ['no_model', 'Choose model', false],
    ['not_eligible', 'Unavailable', false],
    ['no_scope', 'Unavailable', false],
    ['region', 'Unavailable', false],
  ] as const)('%s → %s', (status, word, canSend) => {
    const v = statusView(avail(status));
    expect(v.word).toBe(word);
    expect(v.canSend).toBe(canSend);
    if (word !== null) expect(word.split(' ').length).toBeLessThanOrEqual(2);
    // Not connected: the `Connect` action is enough (minimal-copy W1).
    if (status !== 'ok' && status !== 'not_connected') expect(v.why).not.toBeNull();
  });

  it('the route line always names the route; never a paid route', () => {
    expect(routeLine(avail('ok')).text).toBe('Using ChatGPT plan');
    expect(routeLine(avail('limit')).link.label).toBe('Manage usage');
    expect(routeLine(avail('not_connected')).text).toBe('Coach not connected');
  });
});

describe('workout chips (14 Oct): about the current exercise, words the coach acts on', () => {
  const entry = { kind: 'workout' as const, sessionId: ID(9) };
  const words = (label: string, text = label) => ({ label, input: { kind: 'words', text, spoken: false } });

  it('short labels, the current exercise in the words sent; Lighter and Heavier first; end with Pain (design pass 4.4)', () => {
    expect(starterChips(entry, avail('ok'), true, { exerciseName: 'Bench press', offTarget: false })).toEqual([
      words('Lighter', 'Lighter Bench press'),
      words('Heavier', 'Heavier Bench press'),
      words('+ Set', 'Add a set of Bench press'),
      words('− Set', 'Remove a set of Bench press'),
      words('Swap', 'Swap Bench press'),
      words('Set weights from my history'),
      words('Add an exercise'),
      words('Short on time'),
      { label: 'Pain', input: null },
    ]);
  });

  it('after a set off its target, `Adjust the rest?` comes first', () => {
    const chips = starterChips(entry, avail('ok'), true, { exerciseName: 'Bench press', offTarget: true });
    expect(chips[0]).toEqual(words('Adjust the rest?', 'Adjust the rest of my Bench press sets'));
    expect(chips).toHaveLength(10);
  });

  it('offline still shows them (the sheet says offline); no coach at all keeps only Pain; a finished workout asks how it went', () => {
    expect(starterChips(entry, avail('offline'), true, { exerciseName: 'Squat', offTarget: true })[0]?.label).toBe('Adjust the rest?');
    expect(starterChips(entry, avail('not_connected'), true, { exerciseName: 'Squat', offTarget: true }).map((c) => c.label)).toEqual(['Pain']);
    expect(starterChips(entry, avail('ok'), false, { exerciseName: 'Squat', offTarget: true }).map((c) => c.label)).toEqual(['How did that go?']);
  });
});

describe('starter chips (CS6): ours, by context; Pain works without the coach', () => {
  it('workout chips; offline-unknown states keep only Pain', () => {
    expect(starterChips({ kind: 'workout', sessionId: ID(9) }, avail('ok'), true).map((c) => c.label)).toEqual(['Set weights from my history', 'Add an exercise', 'Short on time', 'Pain']);
    expect(starterChips({ kind: 'workout', sessionId: ID(9) }, avail('not_connected'), true).map((c) => c.label)).toEqual(['Pain']);
    expect(starterChips({ kind: 'summary', sessionId: ID(9) }, avail('ok'), false).map((c) => c.label)).toEqual(['What should I change next time?']);
    // workout-builder §3, §5.4: `Build a workout` is on Today's empty thread, disabled (`Needs the coach`) when the coach can't answer.
    const build = (enabled: boolean) => ({ label: 'Build a workout', input: null, build: { enabled } });
    expect(starterChips({ kind: 'today' }, avail('limit'), false)).toEqual([build(false)]);
    // The coach reads past workouts now (backlog §4.3): Today offers `How am I doing?` as Ben's own words.
    expect(starterChips({ kind: 'today' }, avail('ok'), false)).toEqual([build(true), { label: 'How am I doing?', input: { kind: 'words', text: 'How am I doing?', spoken: false } }]);
    expect(starterChips({ kind: 'today' }, avail('not_connected'), false)).toEqual([build(false)]);
    expect(starterChips({ kind: 'draft', draftId: ID(9), name: 'Push · 45 min' }, avail('ok'), false)).toEqual([]);
  });
});

describe('cards: every status has an icon and a word; text from the record', () => {
  it('applied, undone, stale, refused, proposed', () => {
    expect(cardView(adjust)).toMatchObject({ status: { word: 'Applied', icon: 'checkmark.circle.fill' }, canUndo: true });
    expect(nb(cardView(adjust).text)).toBe('Changed sets 3–4 to 97.5 kg × 6–8 (targets).');
    expect(cardView({ ...adjust, undoneBy: { actionId: ID(2), atUtc: AT.utc } })).toMatchObject({ status: { word: 'Undone' }, canUndo: false });
    expect(cardView({ ...adjust, status: 'stale' })).toMatchObject({ status: { word: 'Out of date', icon: 'clock.badge.xmark' }, canUndo: false });
    expect(cardView({ ...adjust, status: 'rejected', failure: 'you flagged pain' }).status.word).toBe('Couldn’t apply');
    expect(cardView({ ...adjust, status: 'proposed' }).status.word).toBe('Suggested');
    const memory = record({ detail: { kind: 'save_memory', memoryId: ID(3), text: 'Trains before work' } });
    expect(cardView(memory)).toMatchObject({ status: { word: 'Saved' }, canUndo: true });
  });

  it('Why?: the reason in quotes; checks and Not changed from the record; Not known always says something', () => {
    expect(whyView(adjust)).toEqual({
      heading: 'Why the coach changed this',
      reason: '“Set 2 was RPE 10.”',
      checks: ['Rounded to 97.5 kg: nearest your bar and plates allow.'],
      notChanged: ['Not changed: set 2 is already done.'],
      notKnown: ['Nothing missing for this question.'],
    });
  });
});

describe('turn lines: honest, short, Try again where it helps', () => {
  it('failures say what happened and whether anything changed', () => {
    expect(outcomeFor('failed', 'timeout', false)).toEqual({ text: 'No answer in time. Nothing changed.', icon: 'clock.badge.xmark', retry: true, why: null });
    expect(outcomeFor('failed', 'usage_limit', false)?.retry).toBe(false);
    expect(outcomeFor('cancelled', 'cancelled', true)?.text).toBe('Stopped.');
    expect(outcomeFor('interrupted', null, false)?.text).toBe('Interrupted. Nothing changed.');
    expect(outcomeFor('completed', null, false)).toBeNull();
  });

  it('F12: each failure has its own short line and its recorded reason behind Why?', () => {
    const lines = (['too_many_steps', 'no_reply', 'unavailable', 'cancelled', null] as const).map((e) => outcomeFor('failed', e, false));
    expect(lines.map((o) => o?.text)).toEqual(['Coach got stuck. Nothing changed.', 'No reply. Nothing changed.', 'Coach unavailable. Nothing changed.', 'Stopped. Nothing changed.', 'Couldn’t reach the coach. Nothing changed.']);
    expect(new Set(lines.map((o) => o?.text)).size).toBe(5);
    expect(lines.every((o) => o?.retry === true && o.why !== null)).toBe(true);
    expect(lines[0]?.why).toContain('too_many_steps');
    expect(outcomeFor('failed', 'too_many_steps', true)?.text).toBe('Coach got stuck.');
  });

  it('a live turn: static thinking label with elapsed time after 3 s; tools, cards and sentences as they come', () => {
    let live = startLiveTurn('t1', { kind: 'words', text: 'Too heavy', spoken: false }, 0);
    expect(thinkingLabel(live, 1000)).toBe('Coach · …');
    expect(thinkingLabel(live, 65_000)).toBe('Coach · 1:05');
    live = applyProgress(live, { kind: 'tool', line: { tool: 'get_active_session', outcome: 'read', text: "Read today's workout", actionId: null } });
    live = applyProgress(live, { kind: 'card', card: { record: adjust, rendered: { status: 'committed', text: '', detail: null, spoken: '', accessibilityPrefix: 'Saved change.' } } });
    live = applyProgress(live, { kind: 'item', item: { kind: 'sentence', text: 'Keep the bar path tight.' } });
    expect(live).toMatchObject({ benText: 'Too heavy', firstEvent: true, tools: ["Read today's workout"], sentences: ['Keep the bar path tight.'] });
    expect(live.cards[0]?.status.word).toBe('Applied');
    expect(thinkingLabel(live, 9000)).toBeNull();
  });
});

describe('the workout coach slot (one item: pending > banner > outcome > offer)', () => {
  const offer = { triggerId: ID(5), kind: 'rpe_high' as const, setId: ID(102), fact: 'RPE 10 on set 2', prompt: 'That looked hard. Adjust remaining sets?', sessionExerciseId: ID(10), targetRpe: 8, loggedRpe: 10, by: 'coach' as const, change: null, basis: null };
  it('priority', () => {
    expect(slotView({ pending: true, adjustment: adjust, outcome: null, offer })).toMatchObject({ kind: 'pending' });
    const banner = slotView({ pending: false, adjustment: adjust, outcome: { text: 'x', retry: false }, offer });
    // W13: guard notes are Why? checks; only a pain block shows on the banner.
    expect(banner).toMatchObject({ kind: 'banner', canUndo: true, notes: [] });
    expect(nb(banner?.kind === 'banner' ? banner.title : '')).toBe('Coach adjusted sets 3–4');
    expect(nb(banner?.kind === 'banner' ? banner.detail : '')).toBe('100 → 97.5 kg × 6–8');
    expect(slotView({ pending: false, adjustment: null, outcome: { text: 'Your workout moved on. Nothing changed.', retry: true }, offer })).toMatchObject({ kind: 'outcome', retry: true });
    expect(slotView({ pending: false, adjustment: null, outcome: null, offer })).toMatchObject({ kind: 'offer', fact: 'RPE 10 on set 2' });
    expect(slotView({ pending: false, adjustment: null, outcome: null, offer: null })).toBeNull();
  });

  it('the banner hides Undo once the gym changed after the coach change (review r2 B1)', () => {
    const set = (gymChanges: number) => ({ id: ID(103), planned: { load: kg(97.5), reps: null, durationS: null, rpe: null, rir: null, source: 'coach' as const, coach: { actionId: ID(1), before: { load: kg(100), reps: null, durationS: null, rpe: null, rir: null }, gymChanges } } });
    const change = { actionId: ID(50), kind: 'change' as const };
    const workout = (gymChanges: number, entries: (typeof change)[]) => ({ session: { gymChanges: entries }, sets: [set(gymChanges)] }) as unknown as NonNullable<Parameters<typeof slotView>[0]['workout']>;
    expect(slotView({ pending: false, adjustment: adjust, outcome: null, offer: null, workout: workout(0, []) })).toMatchObject({ kind: 'banner', canUndo: true });
    expect(slotView({ pending: false, adjustment: adjust, outcome: null, offer: null, workout: workout(0, [change]) })).toMatchObject({ kind: 'banner', canUndo: false });
    expect(slotView({ pending: false, adjustment: adjust, outcome: null, offer: null, workout: workout(1, [change]) })).toMatchObject({ kind: 'banner', canUndo: true });
  });

  it('Adjust not connected offers Too hard / Too easy (the built-in rule, review coach-fallback S1) and Pain, never Type; an offer’s Adjust is Ben’s chip in the trigger’s direction (CA1)', () => {
    expect(adjustControlView(avail('ok')).chips).toEqual(['too_hard', 'too_easy', 'pain', 'type']);
    expect(adjustControlView(avail('not_connected'))).toMatchObject({ caption: 'Not connected', chips: ['too_hard', 'too_easy', 'pain'] });
    expect(chipForTrigger('rpe_high')).toBe('too_hard');
    expect(chipForTrigger('reps_short')).toBe('too_hard');
    expect(chipForTrigger('rpe_low')).toBe('too_easy');
  });
});

describe('Next time (D21): coach rows over the built-in rule', () => {
  const builtInRow = (name: string, n: number): NextTimeRow => ({ exerciseId: ID(1000 + n), exerciseName: name, kind: 'change', target: `Target ${String(60 + n)} kg × 8–10`, summary: 'Hit the top of the range.', facts: ['All sets 10 reps.'], ruleName: 'Double progression', decision: 'increase_load' });
  const coachRow = (n: number, status: NextSessionTargetRecord['status'], over: Partial<NextSessionTargetRecord> = {}): NextSessionTargetRecord => ({
    id: ID(500 + n),
    ownerId: ID(1),
    version: 1,
    createdAtUtc: AT.utc,
    updatedAtUtc: AT.utc,
    sourceSessionId: ID(9),
    sourceVersion: 3,
    exerciseId: ID(1000 + n),
    exerciseName: n === 1 ? 'Bench press' : 'Row',
    actionId: ID(77),
    target: { load: kg(57.5), reps: { min: 8, max: 10 } },
    sets: null,
    builtIn: { load: kg(62.5), reps: { min: 8, max: 10 } },
    builtInSets: 3,
    size: status === 'proposed' ? 'bigger' : 'small',
    status,
    reason: 'Every set was RPE 10.',
    guardNotes: [],
    pctChange: -4.2,
    usedBySessionId: null,
    ...over,
  });
  const input = (rows: NextSessionTargetRecord[], reviewing = false) => ({ title: 'Push A', builtIn: { sourceTag: 'Built-in rule', rows: [builtInRow('Bench press', 1), builtInRow('Row', 2)], emptyText: null }, coachRows: rows, availability: avail('ok'), reviewing });

  it('a saved row: Coach tag, %, reason and built-in comparison behind Why?, Undo; Undo all with two saved', () => {
    const saved = [coachRow(1, 'saved'), coachRow(2, 'saved')];
    const v = nextTimeView(input(saved));
    expect(v?.heading).toBe('Next time · Push A');
    expect(v?.rows[0]).toMatchObject({ tag: 'Coach', pct: '−4.2%', actions: [{ label: 'Undo', tap: 'undo' }] });
    expect(v?.rows[0]?.why.map(nb)).toEqual(['“Every set was RPE 10.”', 'Rule: 62.5 kg × 8–10 · 3 sets']);
    expect(v?.undoAll).toEqual({ actionId: ID(77), rows: saved });
  });

  it('a built-in row’s Why is one short line: no rule facts, so no FitNotes wording (Ben, 18 Oct; review B3)', () => {
    const imported: NextTimeRow = { ...builtInRow('Row', 2), summary: 'Use 60 kg for 8–10 reps. Then build up.', facts: ['Last session is from FitNotes (equipment not recorded).'] };
    const v = nextTimeView({ ...input([]), builtIn: { sourceTag: 'Built-in rule', rows: [imported], emptyText: null } });
    expect(v?.rows[0]?.why.map(nb)).toEqual(['Use 60 kg for 8–10 reps']);
  });

  it('the coach note drops a number about an exercise without a saved coach target (review S5)', () => {
    const said = ['All three sets were RPE 10.', 'Bench at 57.5 should feel better.', 'Next time row 65 for 10.', 'Rows looked smooth.'];
    // Bench has the coach's saved row; Row has none, so its number would sit beside the built-in rule's.
    expect(summaryNoteSentences(said, ['Bench press', 'Row'], [coachRow(1, 'saved')])).toEqual(['All three sets were RPE 10.', 'Bench at 57.5 should feel better.', 'Rows looked smooth.']);
    // Undone or only suggested: the row shows the built-in rule, so the bench number goes too.
    expect(summaryNoteSentences(said, ['Bench press', 'Row'], [coachRow(1, 'undone')])).toEqual(['All three sets were RPE 10.', 'Rows looked smooth.']);
    expect(summaryNoteSentences(said, ['Bench press', 'Row'], [coachRow(1, 'proposed')])).toEqual(['All three sets were RPE 10.', 'Rows looked smooth.']);
  });

  it('the coach note drops a number the saved row doesn’t say, and knows short forms like RDL (review r2 N2)', () => {
    const bench = coachRow(1, 'saved');
    expect(summaryNoteSentences(['Bench goes to 100 next time.', 'Bench at 57.5 for 8 to 10, after RPE 10 on set 3.', 'Bench drops 4% next time.'], ['Bench press'], [bench])).toEqual([
      'Bench at 57.5 for 8 to 10, after RPE 10 on set 3.',
      'Bench drops 4% next time.',
    ]);
    const rdl = coachRow(2, 'saved', { exerciseName: 'Romanian deadlift', target: { load: kg(80), reps: { min: 8, max: 8 } } });
    expect(summaryNoteSentences(['RDL goes to 90.', 'RDL at 80 next time.'], ['Romanian deadlift'], [rdl])).toEqual(['RDL at 80 next time.']);
    expect(summaryNoteSentences(['RDL goes to 90.'], ['Romanian deadlift'], [])).toEqual([]);
  });

  it('undone → the built-in rule with Use coach target; proposed → Not now / Apply; used → no buttons', () => {
    const v = nextTimeView(input([coachRow(1, 'undone'), coachRow(2, 'proposed')]));
    expect(v?.rows[0]).toMatchObject({ tag: 'Rule', target: 'Target 61 kg × 8–10', actions: [{ label: 'Use coach target' }] });
    expect(v?.rows[1]).toMatchObject({ tag: 'Suggested', actions: [{ label: 'Skip' }, { label: 'Apply' }] });
    expect(v?.undoAll).toBeNull();
    const used = nextTimeView(input([coachRow(1, 'saved', { usedBySessionId: ID(99) })]));
    expect(used?.rows[0]).toMatchObject({ actions: [], note: 'Used' });
  });

  it('Ben, 23 Oct (v5offers SP2): the rule’s own stall reset is an offer: Skip / Apply; applied → Undo; skipped → no buttons; proposed again → Skip / Apply; used → no buttons', () => {
    const stalled: NextTimeRow = { ...builtInRow('Bench press', 1), kind: 'held', target: 'Same target: 60 kg × 3–6', decision: 'hold_after_miss', resetOffer: { text: 'Reset to 55 kg × 3–6?', load: kg(55), reps: { min: 3, max: 6 }, hold: { load: kg(60), reps: { min: 3, max: 6 } } } };
    const view = (rule: NextSessionTargetRecord[], row: NextTimeRow = stalled) => nextTimeView({ ...input([]), builtIn: { sourceTag: 'Built-in rule', rows: [row], emptyText: null }, ruleRows: rule })?.rows[0];
    const offered = view([]);
    expect(offered).toMatchObject({ tag: 'Built-in rule', target: 'Same target: 60 kg × 3–6', note: 'Reset to 55 kg × 3–6?', actions: [{ label: 'Skip', tap: 'not_now' }, { label: 'Apply', tap: 'apply' }] });
    expect(offered?.reset).toEqual({ exerciseId: ID(1001), exerciseName: 'Bench press', target: { load: kg(55), reps: { min: 3, max: 6 } }, hold: { load: kg(60), reps: { min: 3, max: 6 } }, row: null });
    const answer = (status: NextSessionTargetRecord['status'], over: Partial<NextSessionTargetRecord> = {}) => coachRow(1, status, { origin: 'rule', target: { load: kg(55), reps: { min: 3, max: 6 } }, ...over });
    const applied: NextTimeRow = { ...builtInRow('Bench press', 1), target: 'Target 55 kg × 3–6', decision: 'reduce_load', resetApplied: true };
    expect(view([answer('applied')], applied)).toMatchObject({ target: 'Target 55 kg × 3–6', actions: [{ label: 'Undo', tap: 'undo' }] });
    expect(view([answer('not_applied')])).toMatchObject({ note: null, actions: [] });
    expect(view([answer('proposed')])).toMatchObject({ actions: [{ label: 'Skip' }, { label: 'Apply' }] });
    expect(view([answer('proposed', { usedBySessionId: ID(99) })])).toMatchObject({ note: 'Used', actions: [] });
  });

  it('no coach rows: the built-in rule’s rows with its own tag; reviewing shows while the turn runs', () => {
    const v = nextTimeView(input([], true));
    expect(v?.status).toBe('Coach reviewing…');
    expect(v?.rows.map((r) => r.tag)).toEqual(['Built-in rule', 'Built-in rule']);
  });
});

describe('sheet chrome: context chip and workout bar (CS3, minimal copy)', () => {
  it('the context chip names what the coach sees', () => {
    expect(seesLabel({ kind: 'today' }, null, false)).toBe('Sees: Today');
    expect(seesLabel({ kind: 'workout', sessionId: ID(9) }, 'Push A', true)).toBe('Sees: Push A (live)');
    expect(seesLabel({ kind: 'workout', sessionId: ID(9) }, null, false)).toBe('Sees: Workout');
    expect(seesLabel({ kind: 'summary', sessionId: ID(9) }, null, false)).toBe('Sees: this workout');
  });

  it('the workout bar shows rest left, Ready or Paused, and never a Log label', () => {
    expect(workoutBarText({ kind: 'running', remainingMs: 83_200 }, false)).toBe('Rest 1:24');
    expect(workoutBarText({ kind: 'paused', remainingMs: 5_000 }, false)).toBe('Rest 0:05');
    expect(workoutBarText({ kind: 'running', remainingMs: -400 }, false)).toBe('Rest 0:00');
    expect(workoutBarText({ kind: 'ended' }, false)).toBe('Ready');
    expect(workoutBarText(null, false)).toBe('Ready');
    expect(workoutBarText({ kind: 'running', remainingMs: 60_000 }, true)).toBe('Paused');
    for (const t of [workoutBarText(null, false), workoutBarText({ kind: 'ended' }, true)]) expect(t).not.toMatch(/log/i);
  });
});

describe('slotAfterFailure (review N2)', () => {
  const rec = (status: ActionRecord['status'], kind: 'adjust_pending_sets' | 'save_memory') =>
    ({ actionId: ID(800), status, detail: kind === 'adjust_pending_sets' ? { kind, sessionId: ID(9), exercises: [] } : { kind, memoryId: ID(801), text: 'x' } }) as unknown as ActionRecord;
  it('nothing saved: Nothing changed, with Try again', () => {
    expect(slotAfterFailure([])).toEqual({ adjustment: null, outcome: { text: 'Couldn’t reach the coach. Nothing changed.', retry: true } });
    expect(slotAfterFailure([rec('rejected', 'adjust_pending_sets')]).outcome?.text).toBe('Couldn’t reach the coach. Nothing changed.');
  });
  it('a change saved before the error shows as its banner; another saved action never reads "Nothing changed"', () => {
    const a = rec('committed', 'adjust_pending_sets');
    expect(slotAfterFailure([a])).toEqual({ adjustment: a, outcome: null });
    expect(slotAfterFailure([rec('committed', 'save_memory')]).outcome).toEqual({ text: 'Couldn’t reach the coach.', retry: false });
  });
});

describe('offer row label (review lift-targets B1)', () => {
  it('Adjust for today’s sets, Apply for a lift target', () => {
    expect(offerLabel('adjust_today')).toBe('Adjust');
    expect(offerLabel('lift_target')).toBe('Apply');
    expect(benText({ kind: 'accept_offer', offer: 'lift_target' })).toBe('Apply');
  });
});
