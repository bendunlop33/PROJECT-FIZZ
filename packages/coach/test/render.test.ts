import { describe, expect, it } from 'vitest';
import { renderActionResult } from '../src/render';
import { benchAdjust, id, kg, lb, record, tgt } from './records';

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
    expect(renderActionResult(record(r.detail, { status: 'failed' }), 'summary').text).toBe("Couldn't set next targets. The built-in rule's are used.");
  });

  it('proposals, pain flags, memories, playbook, undo', () => {
    const swap = record({ kind: 'propose_next_workout_change', sourceSessionId: id(1), workoutLabel: 'Push A', changes: [{ change: 'swap', text: 'Cable fly → Pec deck' }], because: 'you asked for some variety.' }, { status: 'proposed' });
    expect(renderActionResult(swap, 'sheet').text).toBe('Suggested for your next Push A: Cable fly → Pec deck. Not applied.');
    expect(renderActionResult(record({ kind: 'set_pain_flag', flagIds: [id(50)], exerciseNames: ['Overhead press'], area: 'shoulder' }), 'sheet').text).toBe(
      'Pain flag on for Overhead press. No increases until you clear it.',
    );
    expect(renderActionResult(record({ kind: 'save_memory', memoryId: id(60), text: 'Trains before work' }), 'sheet').text).toBe('Saved to memory: “Trains before work”.');
    expect(renderActionResult(record({ kind: 'forget_memory', memoryId: id(60), text: "Doesn't like lunges" }), 'sheet').text).toBe('Forgot: “Doesn\'t like lunges”. Undo is on the card.');
    expect(renderActionResult(record({ kind: 'add_playbook_candidate', candidateId: id(70), text: 'Deload every 6 weeks' }), 'sheet').text).toBe(
      'Added to your playbook to review: “Deload every 6 weeks”. Not in use until you approve it.',
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
