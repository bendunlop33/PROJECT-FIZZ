import { describe, expect, it } from 'vitest';
import { checkReplyClaims } from '../src/claims';
import { renderActionResult } from '../src/render';
import { benchAdjust, id, kg, lb, ledger, record, tgt } from './records';

const nb = (s: string): string => s.replace(/\u00a0/g, ' ');

describe('renderActionResult (coach-contract §5.1)', () => {
  it("today's sets: committed, proposed, stale", () => {
    expect(nb(renderActionResult(benchAdjust(), 'sheet').text)).toBe('Changed sets 3–4 to 95 kg × 8 (targets).');
    expect(nb(renderActionResult(benchAdjust({ status: 'proposed' }), 'sheet').text)).toBe('Suggested: sets 3–4 at 95 kg × 8 (targets). Not applied.');
    expect(nb(renderActionResult(benchAdjust({ status: 'stale' }), 'sheet').text)).toBe("Couldn't change sets 3–4: your workout moved on. Nothing changed.");
    expect(renderActionResult(benchAdjust(), 'sheet').accessibilityPrefix).toBe('Saved change.');
  });

  it('banner (slot) and spoken forms', () => {
    const slot = renderActionResult(benchAdjust({}, tgt(kg(97.5), 8)), 'slot');
    expect(slot.text).toBe('Coach adjusted sets 3–4');
    expect(nb(slot.detail ?? '')).toBe('100 → 97.5 kg × 8');
    expect(slot.spoken).toBe('Sets 3 and 4: 97 and a half kilos for 8.');
  });

  it('per-hand dumbbells, assisted machines and lb say so', () => {
    const db = benchAdjust({}, tgt(kg(22.5, 'per_hand'), 10));
    expect(nb(renderActionResult(db, 'sheet').text)).toBe('Changed sets 3–4 to 22.5 kg each × 10 (targets).');
    expect(renderActionResult(db, 'voice').spoken).toBe('Sets 3 and 4: 22 and a half kilos each for 10.');
    const assist = benchAdjust({}, tgt(kg(30, 'assistance'), 8));
    expect(nb(renderActionResult(assist, 'sheet').text)).toBe('Changed sets 3–4 to Assist 30 kg × 8 (targets).');
    expect(renderActionResult(assist, 'voice').spoken).toBe('Sets 3 and 4: 30 kilos of assistance for 8.');
    expect(nb(renderActionResult(benchAdjust({}, tgt(lb(205), 8)), 'sheet').text)).toBe('Changed sets 3–4 to 205 lb × 8 (targets).');
  });

  it('removed and added sets, several exercises', () => {
    const r = record({
      kind: 'adjust_pending_sets',
      sessionId: id(1),
      exercises: [
        { sessionExerciseId: id(10), exerciseName: 'Bench press', changes: [{ setId: id(14), setNumber: 4, before: tgt(kg(100), 6, 8), after: null }] },
        { sessionExerciseId: id(11), exerciseName: 'Incline DB press', changes: [{ setId: id(15), setNumber: 4, before: null, after: tgt(kg(20, 'per_hand'), 10) }] },
      ],
    });
    expect(nb(renderActionResult(r, 'sheet').text)).toBe('Bench press: removed set 4. Incline DB press: added set 4: 20 kg each × 10 (targets).');
    expect(renderActionResult(r, 'slot')).toMatchObject({ text: 'Coach adjusted 2 sets', detail: 'Bench press 4 · Incline DB press 4' });
  });

  it('undone later: the line gains the time (check 15) and the status changes', () => {
    const r = renderActionResult(benchAdjust({ undoneBy: { actionId: id(900), atUtc: '2026-10-10T17:24:00.000Z' } }), 'sheet');
    expect(r.status).toBe('undone');
    expect(nb(r.text)).toBe('Changed sets 3–4 to 95 kg × 8 (targets). · undone 18:24');
  });

  it('earlier actions carry their time (CC5)', () => {
    expect(nb(renderActionResult(benchAdjust(), 'sheet', { earlier: true }).text)).toBe('Changed sets 3–4 to 95 kg × 8 (targets). · 18:21');
  });

  it('next-session targets: saved small rows and bigger suggestions', () => {
    const r = record({
      kind: 'set_next_session_targets',
      sourceSessionId: id(1),
      workoutLabel: 'Push A',
      rows: [
        { exerciseId: id(20), exerciseName: 'Bench press', before: tgt(kg(95), 6, 8), after: tgt(kg(97.5), 6, 8), setsBefore: 3, setsAfter: 3, size: 'small' },
        { exerciseId: id(21), exerciseName: 'Overhead press', before: tgt(kg(50), 6, 8), after: tgt(kg(40), 6, 8), setsBefore: 3, setsAfter: 3, size: 'bigger' },
      ],
    });
    expect(nb(renderActionResult(r, 'summary').text)).toBe(
      'Next Push A: Bench press 97.5 kg × 6–8 (target). Suggested for next Push A: Overhead press 40 kg × 6–8 (target). Not applied.',
    );
    expect(renderActionResult(record(r.detail, { status: 'failed' }), 'summary').text).toBe("Couldn't set next targets.");
  });

  it('proposals, pain flags, memories, playbook, undo', () => {
    const swap = record({ kind: 'propose_next_workout_change', sourceSessionId: id(1), workoutLabel: 'Push A', changes: [{ change: 'swap', text: 'Cable fly → Pec deck' }], because: 'you asked for some variety.' }, { status: 'proposed' });
    expect(renderActionResult(swap, 'sheet').text).toBe('Suggested for your next Push A: Cable fly → Pec deck. Not applied.');
    expect(renderActionResult(record({ kind: 'set_pain_flag', flagIds: [id(50)], exerciseNames: ['Overhead press'], area: 'shoulder' }), 'sheet').text).toBe(
      'Pain flag on: Overhead press · no increases',
    );
    expect(renderActionResult(record({ kind: 'save_memory', memoryId: id(60), text: 'Trains before work' }), 'sheet').text).toBe('Saved to memory: “Trains before work”.');
    expect(renderActionResult(record({ kind: 'forget_memory', memoryId: id(60), text: "Doesn't like lunges" }), 'sheet').text).toBe('Forgot: “Doesn\'t like lunges”');
    expect(renderActionResult(record({ kind: 'add_playbook_candidate', candidateId: id(70), text: 'Deload every 6 weeks' }), 'sheet').text).toBe(
      'Playbook, to review: “Deload every 6 weeks”',
    );
    const undo = record({
      kind: 'undo',
      undoneActionId: id(101),
      what: 'the change to sets 3–4',
      restored: [{ sessionExerciseId: id(10), exerciseName: 'Bench press', changes: [{ setId: id(14), setNumber: 4, before: tgt(kg(95), 8), after: tgt(kg(100), 6, 8) }] }],
      alreadyLogged: [3],
    });
    expect(nb(renderActionResult(undo, 'sheet').text)).toBe('Undone: the change to sets 3–4. Back to 100 kg × 6–8 (target). Set 3 was already logged.');
    expect(renderActionResult(undo, 'voice').spoken).toBe('Back to 100 kilos for 6 to 8 for set 4.');
  });

  it('spoken undo with different restored targets says each set (review B4)', () => {
    const undo = record({
      kind: 'undo',
      undoneActionId: id(101),
      what: 'the change to sets 3–4',
      restored: [
        {
          sessionExerciseId: id(10),
          exerciseName: 'Bench press',
          changes: [
            { setId: id(13), setNumber: 3, before: tgt(kg(95), 8), after: tgt(kg(100), 6, 8) },
            { setId: id(14), setNumber: 4, before: tgt(kg(95), 8), after: tgt(kg(97.5), 6, 8) },
          ],
        },
      ],
      alreadyLogged: [],
    });
    const r = renderActionResult(undo, 'voice');
    expect(nb(r.text)).toBe('Undone: the change to sets 3–4. Back to the previous targets for sets 3–4.');
    expect(r.spoken).toBe('Set 3 back to 100 kilos for 6 to 8. Set 4 back to 97 and a half kilos for 6 to 8.');
    expect(r.spoken).not.toContain('sets 3 and 4');
  });

  it('spoken changes across several exercises name each exercise', () => {
    const r = record({
      kind: 'adjust_pending_sets',
      sessionId: id(1),
      exercises: [
        { sessionExerciseId: id(10), exerciseName: 'Bench press', changes: [{ setId: id(13), setNumber: 3, before: tgt(kg(100), 6, 8), after: tgt(kg(95), 8) }] },
        { sessionExerciseId: id(11), exerciseName: 'Incline DB press', changes: [{ setId: id(15), setNumber: 2, before: tgt(kg(22.5, 'per_hand'), 10), after: tgt(kg(20, 'per_hand'), 10) }] },
      ],
    });
    expect(renderActionResult(r, 'voice').spoken).toBe('Bench press. Set 3: 95 kilos for 8. Incline DB press. Set 2: 20 kilos each for 10.');
  });
});

describe('renderActionResult: an exercise added today (12 Oct)', () => {
  const added = (over: Partial<Extract<Parameters<typeof record>[0], { kind: 'add_exercise_today' }>> = {}, status: 'committed' | 'stale' | 'rejected' = 'committed', failure: string | null = null) =>
    record(
      {
        kind: 'add_exercise_today',
        sessionId: id(1),
        sessionExerciseId: id(20),
        exerciseId: id(30),
        exerciseName: 'Lateral raise',
        sets: 3,
        target: { load: kg(10, 'per_hand'), reps: { min: 10, max: 15 }, rpe: 8 },
        durationS: null,
        equipmentName: 'Main dumbbells',
        afterName: null,
        supersetWithName: null,
        ...over,
      },
      { status, failure },
    );

  it('values only, with where it went', () => {
    expect(nb(renderActionResult(added(), 'sheet').text)).toBe('Added Lateral raise: 3 × 10 kg each × 10–15 · RIR 2.');
    expect(nb(renderActionResult(added({ afterName: 'Bench press' }), 'sheet').text)).toBe('Added Lateral raise: 3 × 10 kg each × 10–15 · RIR 2 · after Bench press.');
    expect(nb(renderActionResult(added({ supersetWithName: 'Bench press' }), 'sheet').text)).toBe('Added Lateral raise: 3 × 10 kg each × 10–15 · RIR 2 · superset with Bench press.');
  });

  it('a blank load (no history, B6), a timed exercise, an assisted machine and lb', () => {
    expect(nb(renderActionResult(added({ target: { load: null, reps: { min: 12, max: 15 }, rpe: null } }), 'sheet').text)).toBe('Added Lateral raise: 3 × 12–15 reps.');
    expect(nb(renderActionResult(added({ exerciseName: 'Plank', target: { load: null, reps: null, rpe: null }, durationS: 45 }), 'sheet').text)).toBe('Added Plank: 3 × 0:45.');
    expect(nb(renderActionResult(added({ exerciseName: 'Assisted pull-up', target: { load: kg(30, 'assistance'), reps: { min: 6, max: 8 }, rpe: null } }), 'sheet').text)).toBe('Added Assisted pull-up: 3 × Assist 30 kg × 6–8.');
    expect(nb(renderActionResult(added({ target: { load: lb(20, 'per_hand'), reps: { min: 10, max: 15 }, rpe: null } }), 'sheet').text)).toBe('Added Lateral raise: 3 × 20 lb each × 10–15.');
  });

  it('cardio (review S3): the card names the time and distance added, or the distance alone', () => {
    const row = { exerciseName: 'Rowing machine', sets: 1, target: { load: null, reps: null, rpe: null }, equipmentName: null };
    expect(nb(renderActionResult(added({ ...row, durationS: null, distanceM: 5000 }), 'sheet').text)).toBe('Added Rowing machine: 1 × 5,000 m.');
    expect(nb(renderActionResult(added({ ...row, durationS: 1200, distanceM: 4800 }), 'sheet').text)).toBe('Added Rowing machine: 1 × 20:00 · 4,800 m.');
    expect(nb(renderActionResult(added({ ...row, durationS: 600 }), 'sheet').text)).toBe('Added Rowing machine: 1 × 10:00.');
  });

  it('not added: stale and refused', () => {
    expect(renderActionResult(added({}, 'stale'), 'sheet').text).toBe('Not added: your workout moved on.');
    expect(renderActionResult(added({}, 'rejected', 'shoulder flagged 6 Oct'), 'sheet').text).toBe("Couldn't add Lateral raise: shoulder flagged 6 Oct. Nothing changed.");
  });
});

describe('claim check: an exercise added today (12 Oct)', () => {
  const raise = record({
    kind: 'add_exercise_today',
    sessionId: id(1),
    sessionExerciseId: id(20),
    exerciseId: id(30),
    exerciseName: 'Lateral raise',
    sets: 3,
    target: { load: kg(10, 'per_hand'), reps: { min: 10, max: 15 }, rpe: 8 },
    durationS: null,
    equipmentName: 'Main dumbbells',
    afterName: null,
    supersetWithName: null,
  });

  it('"Added lateral raises" is backed only by the add itself; nothing backs it with no card', () => {
    expect(checkReplyClaims("I've added lateral raises.", ledger([raise]), new Set([raise.actionId])).keep).toBe(true);
    expect(checkReplyClaims("I've added lateral raises.", ledger([]), new Set()).keep).toBe(false);
    // Another exercise named, or the add claimed for next time, isn't backed by it.
    expect(checkReplyClaims("I've added face pulls.", ledger([raise]), new Set([raise.actionId])).keep).toBe(false);
    expect(checkReplyClaims("I've added lateral raises to next time's workout.", ledger([raise]), new Set([raise.actionId])).keep).toBe(false);
  });

  it('cardio (review S3): "20 minutes", "20:00" and "5,000 m" are checked against the row added; other numbers are not backed', () => {
    const row = record({
      kind: 'add_exercise_today',
      sessionId: id(1),
      sessionExerciseId: id(21),
      exerciseId: id(31),
      exerciseName: 'Rowing machine',
      sets: 1,
      target: { load: null, reps: null, rpe: null },
      durationS: 1200,
      distanceM: 5000,
      equipmentName: null,
      afterName: null,
      supersetWithName: null,
    });
    const cited = new Set([row.actionId]);
    expect(checkReplyClaims("I've added 20 minutes on the rowing machine.", ledger([row]), cited).keep).toBe(true);
    expect(checkReplyClaims("I've added the rowing machine for 20:00.", ledger([row]), cited).keep).toBe(true);
    expect(checkReplyClaims("I've added 5,000 m on the rowing machine.", ledger([row]), cited).keep).toBe(true);
    expect(checkReplyClaims("I've added 5 km on the rowing machine.", ledger([row]), cited).keep).toBe(true);
    expect(checkReplyClaims("I've added 30 minutes on the rowing machine.", ledger([row]), cited)).toMatchObject({ keep: false, reason: 'numbers_differ' });
    expect(checkReplyClaims("I've added 6,000 m on the rowing machine.", ledger([row]), cited)).toMatchObject({ keep: false, reason: 'numbers_differ' });
  });
});
