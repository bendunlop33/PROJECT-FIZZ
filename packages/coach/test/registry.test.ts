import { describe, expect, it } from 'vitest';
import { COACH_TOOL_ARGS, CoachToolNameSchema } from '@fizz/schemas';
import {
  assertRegistrySafe,
  buildTurnRegistry,
  COACH_TOOLS,
  functionToolDefinitions,
  listCoachCapabilities,
  parseToolCall,
  personalPlaybookText,
  toolOpId,
  appendContentKeys,
  chipRequest,
  classifyBenRequest,
  UnsafeRegistryError,
  type BenRequest,
  type ToolDeclaration,
  type TurnGate,
} from '../src/index';
import { id } from './records';

const ASKED: BenRequest = { source: 'words', kinds: ['change'] };
const STRUCTURAL: BenRequest = { source: 'words', kinds: ['structural'] };
const MEMORY: BenRequest = { source: 'words', kinds: ['memory'] };
const DIFFICULTY: BenRequest = { source: 'words', kinds: ['difficulty'] };
const PLAYBOOK: BenRequest = { source: 'words', kinds: ['playbook'] };

const gate = (over: Partial<TurnGate> = {}): TurnGate => ({
  kind: 'general',
  benRequest: null,
  acceptedOffer: false,
  benPainWords: false,
  structuralSignals: [],
  ...over,
});

const names = (g: TurnGate): string[] => buildTurnRegistry(g).tools.map((t) => t.name);

describe('registry safety (coach-contract check 1, CC6)', () => {
  it('every tool has an allowed effect and declared writes', () => {
    expect(() => {
      assertRegistrySafe(COACH_TOOLS);
    }).not.toThrow();
    for (const t of COACH_TOOLS) expect(['read', 'append', 'versioned_update', 'propose']).toContain(t.effect);
  });

  it('every v1 tool name is declared exactly once and has an argument schema', () => {
    expect(COACH_TOOLS.map((t) => t.name).sort()).toEqual([...CoachToolNameSchema.options].sort());
    for (const t of COACH_TOOLS) expect(COACH_TOOL_ARGS[t.name]).toBeDefined();
  });

  it('a stub delete_workout, an overwrite effect or an unlabelled write fails', () => {
    const base = COACH_TOOLS.find((t) => t.name === 'save_memory');
    if (!base) throw new Error('fixture');
    const bad: ToolDeclaration[] = [
      { ...base, name: 'delete_workout' as ToolDeclaration['name'] },
      { ...base, effect: 'overwrite' as ToolDeclaration['effect'] },
      { ...base, effect: 'delete' as ToolDeclaration['effect'] },
      { ...base, plainLabel: null },
      { ...base, effect: 'versioned_update', writes: ['pain_flag'] },
      { ...base, effect: 'read' },
      { ...COACH_TOOLS.find((t) => t.structural) ?? base, needs: 'none' },
    ];
    for (const b of bad) {
      expect(() => {
        assertRegistrySafe([b]);
      }).toThrow(UnsafeRegistryError);
    }
    expect(() => {
      assertRegistrySafe([base, base]);
    }).toThrow(/Duplicate/);
  });

  it('no versioned update can write a finished session or a done set', () => {
    for (const t of COACH_TOOLS.filter((x) => x.effect === 'versioned_update')) {
      for (const w of t.writes) expect(['pending_set_target', 'next_session_target', 'memory']).toContain(w);
    }
  });
});

describe('buildTurnRegistry (CC10, summary closed list)', () => {
  it('a plain question gets the reads only', () => {
    expect(names(gate())).toEqual(['get_active_session', 'get_recent_training', 'get_gym_equipment', 'get_progression_targets', 'get_recent_actions']);
  });

  it("today's sets need Ben's request or an accepted offer, and only in a workout", () => {
    expect(names(gate({ kind: 'workout' }))).not.toContain('adjust_pending_sets');
    expect(names(gate({ kind: 'workout', benRequest: ASKED }))).toContain('adjust_pending_sets');
    expect(names(gate({ kind: 'workout', acceptedOffer: true }))).toContain('adjust_pending_sets');
    expect(names(gate({ kind: 'general', benRequest: ASKED }))).not.toContain('adjust_pending_sets');
    // An accepted offer is not a request for anything else.
    expect(names(gate({ kind: 'workout', acceptedOffer: true }))).not.toContain('save_memory');
  });

  it('the summary turn is a closed list: reads, next-session targets, structural only when gated (check 17)', () => {
    const summary = names(gate({ kind: 'summary' }));
    expect(summary).toEqual(['get_active_session', 'get_recent_training', 'get_gym_equipment', 'get_progression_targets', 'get_recent_actions', 'set_next_session_targets']);
    const withSignal = names(gate({ kind: 'summary', structuralSignals: ['pain_flag'] }));
    expect(withSignal).toContain('propose_next_workout_change');
    // Even a request in the summary turn can't reach memory, pain or today's sets.
    const asked = names(gate({ kind: 'summary', benRequest: ASKED, benPainWords: true }));
    expect(asked).not.toEqual(expect.arrayContaining(['save_memory']));
    expect(asked).not.toContain('set_pain_flag');
    expect(asked).not.toContain('adjust_pending_sets');
  });

  it('every structural tool is absent with no request and no signal, in every turn kind (check 17)', () => {
    const structural = COACH_TOOLS.filter((t) => t.structural).map((t) => t.name);
    expect(structural.length).toBeGreaterThan(0);
    for (const kind of ['general', 'workout', 'summary'] as const) {
      const r = buildTurnRegistry(gate({ kind, benRequest: ASKED }));
      for (const name of structural) {
        expect(r.tools.map((t) => t.name)).not.toContain(name);
        expect(r.withheld).toContainEqual({ name, reason: 'needs_request_or_signal' });
      }
      for (const name of structural) expect(names(gate({ kind, benRequest: STRUCTURAL }))).toContain(name);
    }
  });

  it('a plain question is not a request: it never unlocks today’s sets (review S3, rule 3)', () => {
    for (const q of ['why is set 3 at 100?', 'should I drop the weight?', 'what do you think of my bench?', 'how many sets are left?', 'is 95 too light?']) {
      expect(classifyBenRequest(q)).toBeNull();
      expect(names(gate({ kind: 'workout', benRequest: classifyBenRequest(q) }))).not.toContain('adjust_pending_sets');
    }
    expect(names(gate({ kind: 'workout', benRequest: classifyBenRequest('drop the weight for the last two') }))).toContain('adjust_pending_sets');
    expect(names(gate({ kind: 'workout', benRequest: chipRequest('too_hard') }))).toContain('adjust_pending_sets');
  });

  it('a non-structural request never unlocks structural tools (CC10)', () => {
    const r = buildTurnRegistry(gate({ kind: 'summary', benRequest: classifyBenRequest('lower bench next time') }));
    expect(r.tools.some((t) => t.structural)).toBe(false);
    expect(buildTurnRegistry(gate({ kind: 'summary', benRequest: classifyBenRequest('swap cable fly for something else next time') })).tools.some((t) => t.structural)).toBe(true);
  });

  it('the request kind limits which tools open (review r2 B2)', () => {
    const memory = names(gate({ kind: 'workout', benRequest: MEMORY }));
    expect(memory).toEqual(expect.arrayContaining(['save_memory', 'forget_memory']));
    // Review r3 S1: a memory request never opens the playbook queue (rule 10).
    expect(memory).not.toContain('add_playbook_candidate');
    expect(names(gate({ kind: 'workout', benRequest: PLAYBOOK }))).toContain('add_playbook_candidate');
    expect(names(gate({ kind: 'workout', benRequest: PLAYBOOK }))).not.toContain('save_memory');
    expect(memory).not.toContain('adjust_pending_sets');
    const change = names(gate({ kind: 'workout', benRequest: ASKED }));
    expect(change).toContain('adjust_pending_sets');
    expect(change).not.toContain('save_memory');
    expect(change).not.toContain('forget_memory');
    const difficulty = names(gate({ kind: 'workout', benRequest: DIFFICULTY }));
    expect(difficulty).toContain('adjust_pending_sets');
    expect(difficulty).not.toContain('save_memory');
    expect(difficulty).not.toContain('forget_memory');
    const structural = names(gate({ kind: 'workout', benRequest: STRUCTURAL }));
    expect(structural).not.toContain('adjust_pending_sets');
    expect(structural).not.toContain('save_memory');
    expect(names(gate({ kind: 'workout', benRequest: chipRequest('pain') }))).not.toContain('save_memory');
  });

  it('a remark during a workout opens no write tool, so the coach can only offer (rule 3, review r2 B2)', () => {
    for (const remark of ['set 2 felt good', 'Set 3 was fine', 'Plan looks good', 'Remember when I did 100 for 8?']) {
      const r = buildTurnRegistry(gate({ kind: 'workout', benRequest: classifyBenRequest(remark) }));
      expect(r.tools.filter((t) => t.effect !== 'read').map((t) => t.name)).toEqual([]);
      expect(r.withheld).toContainEqual({ name: 'adjust_pending_sets', reason: 'needs_request' });
    }
    expect(names(gate({ kind: 'workout', benRequest: classifyBenRequest('remember that I train before work') }))).not.toContain('adjust_pending_sets');
  });

  it('a question about an offer never opens adjust_pending_sets (review r3 B1, rule 3)', () => {
    for (const q of ['Why would you lower sets 3 and 4?', 'What would you change?', 'Would you lower it if you were me?', 'why would we drop the weight', 'Lower sets 3 and 4?']) {
      const r = buildTurnRegistry(gate({ kind: 'workout', benRequest: classifyBenRequest(q) }));
      expect(r.tools.map((t) => t.name)).not.toContain('adjust_pending_sets');
      expect(r.withheld).toContainEqual({ name: 'adjust_pending_sets', reason: 'needs_request' });
    }
    // A bare "Go ahead" opens it only through the turn engine's acceptedOffer gate.
    expect(names(gate({ kind: 'workout', benRequest: classifyBenRequest('Go ahead') }))).not.toContain('adjust_pending_sets');
    expect(names(gate({ kind: 'workout', benRequest: classifyBenRequest('Go ahead'), acceptedOffer: true }))).toContain('adjust_pending_sets');
  });

  it('a remark never opens adjust_pending_sets (review r4 B1, rule 3)', () => {
    for (const q of [
      "It wasn't too heavy",
      'Not too heavy',
      'Set 3 was too heavy?',
      'Way too early for this',
      'Increase in pain on set 3',
      'Update on my shoulder, feels fine',
      'Change the music',
      'Delete that last message',
      'Add a rule: never squat after deadlifts',
      'Can you lower it? Actually no, leave it.',
    ]) {
      const r = buildTurnRegistry(gate({ kind: 'workout', benRequest: classifyBenRequest(q) }));
      expect(r.tools.map((t) => t.name), q).not.toContain('adjust_pending_sets');
      expect(r.withheld, q).toContainEqual({ name: 'adjust_pending_sets', reason: 'needs_request' });
    }
    // The spec's playbook example opens the playbook queue only (review r4 S2).
    const playbook = names(gate({ kind: 'workout', benRequest: classifyBenRequest('Add a rule: never squat after deadlifts') }));
    expect(playbook).toContain('add_playbook_candidate');
    expect(playbook).not.toContain('save_memory');
    // A real report or request still opens it.
    for (const q of ['Set 3 was too heavy', 'Lighter please', 'Bring it down to 95']) {
      expect(names(gate({ kind: 'workout', benRequest: classifyBenRequest(q) })), q).toContain('adjust_pending_sets');
    }
  });

  it('memory requests and memory questions never open the playbook queue (review r3 S1, rule 10)', () => {
    for (const text of ['Remember that my left knee is dodgy on lunges', 'Remember that time I hit 100?', 'remember when I did 100 for 8?']) {
      expect(names(gate({ kind: 'workout', benRequest: classifyBenRequest(text) }))).not.toContain('add_playbook_candidate');
    }
    expect(names(gate({ kind: 'workout', benRequest: classifyBenRequest('Remember that time I hit 100?') }))).not.toContain('save_memory');
    expect(names(gate({ kind: 'workout', benRequest: classifyBenRequest('add this as a general rule: pause reps build strength') }))).toContain('add_playbook_candidate');
  });

  it('a playbook candidate about Ben is refused, a general rule is accepted (review r3 S1, rule 10)', () => {
    const reg = buildTurnRegistry(gate({ kind: 'workout', benRequest: PLAYBOOK }));
    for (const text of ['My left knee is dodgy on lunges', 'Ben trains before work', "I'm weaker after night shifts", 'Avoid lunges for your knee', 'Go lighter when your left shoulder flares up']) {
      const r = parseToolCall('t1', 'add_playbook_candidate', JSON.stringify({ text, statedBy: 'ben' }), reg);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.line).toMatch(/not a general rule/);
    }
    for (const text of ['Deload every 6 weeks', 'Pause reps build strength off the chest', 'Stop progressing a movement when it causes pain', 'Add a set when RPE is below 7 for two sessions']) {
      expect(parseToolCall('t1', 'add_playbook_candidate', JSON.stringify({ text, statedBy: 'coach' }), reg).ok).toBe(true);
    }
  });

  it('third-person and particular-body facts are refused too (review r4 S2, rule 10)', () => {
    for (const text of [
      'The left knee is dodgy on lunges',
      'Avoid deep lunges with a dodgy left knee',
      'He trains before work',
      'The owner trains fasted',
      'She prefers dumbbells',
      'His shoulder flares up on dips',
      'Go lighter on the bad shoulder',
      'Skip lunges because of the right knee',
    ]) {
      expect(personalPlaybookText(text), text).toBe(true);
    }
    for (const text of [
      'Keep the knee tracking over the toes',
      'Stop progressing a movement when the shoulder hurts',
      'A painful joint is a reason to hold the load',
      'Brace before each rep',
      'Left and right sides should be trained evenly',
    ]) {
      expect(personalPlaybookText(text), text).toBe(false);
    }
  });

  it("set_pain_flag needs Ben's own pain words this turn (check 19)", () => {
    expect(names(gate({ benRequest: ASKED }))).not.toContain('set_pain_flag');
    expect(names(gate({ benPainWords: true }))).toContain('set_pain_flag');
  });
});

describe('listCoachCapabilities (check 11)', () => {
  it('matches the registry (snapshot)', () => {
    expect(listCoachCapabilities()).toMatchInlineSnapshot(`
      {
        "intro": "The coach only says something changed when the app has saved that change. You can undo every change it makes.",
        "sections": [
          {
            "rows": [
              "Change today's remaining sets",
              "Turn a pain flag on",
              "Save a memory",
              "Forget a memory",
              "Add a general training rule to your playbook to review",
            ],
            "section": "when_you_ask",
            "title": "When you ask",
          },
          {
            "rows": [
              "Small changes to next time's load, reps and sets, shown on the summary with Undo",
            ],
            "section": "after_workout",
            "title": "After each workout",
          },
          {
            "rows": [
              "Swapping, adding, removing or reordering exercises in your next workout",
            ],
            "section": "suggest_only",
            "title": "Only as a suggestion you apply",
          },
          {
            "rows": [
              "Delete or rewrite a workout, a set, an import or a check-in",
              "Clear a pain flag",
              "Change settings, your AI connection, backups or playbook approvals",
            ],
            "section": "never",
            "title": "Never",
          },
        ],
      }
    `);
  });

  it('every write tool appears as a row', () => {
    const rows = listCoachCapabilities().sections.flatMap((s) => s.rows);
    for (const t of COACH_TOOLS.filter((x) => x.effect !== 'read')) expect(rows).toContain(t.plainLabel);
  });
});

describe('parseToolCall', () => {
  const workout = buildTurnRegistry(gate({ kind: 'workout', benRequest: ASKED }));
  const args = {
    baseVersion: 7,
    exercises: [{ sessionExerciseId: id(10), sets: [{ setId: id(13), target: { load: { value: 95, unit: 'kg', convention: 'total' }, reps: null } }], addSet: null, removeSetId: null }],
    reason: 'Set 2 was RPE 10.',
  };

  it('refuses a tool that is not in this turn (Not allowed: delete_set, check 7)', () => {
    expect(parseToolCall('t1', 'delete_set', '{}', workout)).toEqual({ ok: false, error: 'not_allowed', line: 'Not allowed: delete_set' });
    const general = buildTurnRegistry(gate());
    expect(parseToolCall('t1', 'adjust_pending_sets', JSON.stringify(args), general)).toMatchObject({ ok: false, error: 'not_allowed' });
  });

  it('parses a valid call into the typed union with a replay-stable opId (check 6)', () => {
    const a = parseToolCall('t1', 'adjust_pending_sets', JSON.stringify(args), workout);
    const b = parseToolCall('t1', 'adjust_pending_sets', JSON.stringify({ reason: args.reason, exercises: args.exercises, baseVersion: 7 }), workout);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.call.tool).toBe('adjust_pending_sets');
    expect(a.opId).toBe(b.opId);
    expect(a.opId.length).toBeLessThanOrEqual(128);
    expect(toolOpId('t2', 'adjust_pending_sets', a.call.args)).not.toBe(a.opId);
  });

  it('a same-turn repeat with the same semantic fields is a replay; a real second change gets its own opId (review r2 S3, ADR 0019 §5)', () => {
    const summary = buildTurnRegistry(gate({ kind: 'summary' }));
    const t = (value: number, reason: string) => ({ exerciseId: id(1), target: { load: { value, unit: 'kg', convention: 'total' }, reps: { min: 6, max: 8 } }, sets: null, reason });
    const first = parseToolCall('t1', 'set_next_session_targets', JSON.stringify({ sourceSessionId: id(5), sourceVersion: 12, targets: [t(97.5, 'Set 2 was RPE 10.')] }), summary);
    // Same targets and sourceVersion, different wording: the same operation, so one record, not two.
    const again = parseToolCall('t1', 'set_next_session_targets', JSON.stringify({ sourceSessionId: id(5), sourceVersion: 12, targets: [t(97.5, 'Keeping it a touch lighter.')] }), summary);
    // A different target is a different operation even with the same sourceVersion.
    const other = parseToolCall('t1', 'set_next_session_targets', JSON.stringify({ sourceSessionId: id(5), sourceVersion: 12, targets: [t(95, 'Set 2 was RPE 10.')] }), summary);
    if (!first.ok || !again.ok || !other.ok) throw new Error('fixture');
    expect(again.opId).toBe(first.opId);
    expect(other.opId).not.toBe(first.opId);
    // adjust_pending_sets: an apply bumps the session version, so the same sets asked again after it is a new operation.
    const afterApply = parseToolCall('t1', 'adjust_pending_sets', JSON.stringify({ ...args, baseVersion: 8 }), workout);
    const before = parseToolCall('t1', 'adjust_pending_sets', JSON.stringify(args), workout);
    if (!afterApply.ok || !before.ok) throw new Error('fixture');
    expect(afterApply.opId).not.toBe(before.opId);
  });

  it('a reworded retry of an append tool is the same operation; content keys catch a new turn (review S4)', () => {
    const reg = buildTurnRegistry(gate({ kind: 'workout', benRequest: { source: 'words', kinds: ['change', 'memory', 'playbook'] }, benPainWords: true }));
    const pain1 = parseToolCall('t1', 'set_pain_flag', JSON.stringify({ exerciseIds: [id(2), id(1)], area: 'shoulder', quote: 'my shoulder hurts' }), reg);
    const pain2 = parseToolCall('t1', 'set_pain_flag', JSON.stringify({ exerciseIds: [id(1), id(2)], area: 'shoulder', quote: 'shoulder is hurting' }), reg);
    const mem1 = parseToolCall('t1', 'save_memory', JSON.stringify({ text: 'Trains before work.', quote: 'I train before work' }), reg);
    const mem2 = parseToolCall('t1', 'save_memory', JSON.stringify({ text: ' trains  before work', quote: 'remember I train early' }), reg);
    const pb1 = parseToolCall('t1', 'add_playbook_candidate', JSON.stringify({ text: 'Deload every 6 weeks', statedBy: 'ben' }), reg);
    const pb2 = parseToolCall('t1', 'add_playbook_candidate', JSON.stringify({ text: 'Deload every 6 weeks.', statedBy: 'ben' }), reg);
    if (!pain1.ok || !pain2.ok || !mem1.ok || !mem2.ok || !pb1.ok || !pb2.ok) throw new Error('fixture');
    expect(pain1.opId).toBe(pain2.opId);
    expect(mem1.opId).toBe(mem2.opId);
    expect(pb1.opId).toBe(pb2.opId);
    // A Try again is a new turn: a different opId, but the same content keys for the store to dedupe on.
    const again = parseToolCall('t2', 'save_memory', JSON.stringify({ text: 'Trains before work', quote: 'x' }), reg);
    if (!again.ok) throw new Error('fixture');
    expect(again.opId).not.toBe(mem1.opId);
    expect(appendContentKeys(again.call)).toEqual(appendContentKeys(mem1.call));
    expect(appendContentKeys(pain1.call)).toEqual([`pain_flag:${id(1)}`, `pain_flag:${id(2)}`]);
    // A different memory is a different item.
    const other = parseToolCall('t1', 'save_memory', JSON.stringify({ text: 'Hates lunges', quote: 'x' }), reg);
    if (!other.ok) throw new Error('fixture');
    expect(other.opId).not.toBe(mem1.opId);
    expect(appendContentKeys(other.call)).not.toEqual(appendContentKeys(mem1.call));
  });

  it('a reworded reason on adjust_pending_sets is the same operation', () => {
    const a = parseToolCall('t1', 'adjust_pending_sets', JSON.stringify(args), workout);
    const b = parseToolCall('t1', 'adjust_pending_sets', JSON.stringify({ ...args, reason: 'Set 2 was a grind at RPE 10.' }), workout);
    if (!a.ok || !b.ok) throw new Error('fixture');
    expect(a.opId).toBe(b.opId);
  });

  it('drops smuggled fields and lists them (CC10: a programme inside another tool)', () => {
    const smuggled = { ...args, programme: { name: '5/3/1' }, exercises: [{ ...args.exercises[0], swapTo: id(99) }] };
    const r = parseToolCall('t1', 'adjust_pending_sets', JSON.stringify(smuggled), workout);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropped.sort()).toEqual(['exercises.0.swapTo', 'programme']);
    expect(JSON.stringify(r.call.args)).not.toMatch(/programme|swapTo/);
  });

  it('rejects bad JSON and bad values', () => {
    expect(parseToolCall('t1', 'adjust_pending_sets', '{not json', workout)).toMatchObject({ ok: false, error: 'invalid_args' });
    expect(parseToolCall('t1', 'adjust_pending_sets', JSON.stringify({ ...args, baseVersion: 0 }), workout)).toMatchObject({ ok: false, error: 'invalid_args' });
    const noUnit = { ...args, exercises: [{ ...args.exercises[0], sets: [{ setId: id(13), target: { load: { value: 95 }, reps: null } }] }] };
    expect(parseToolCall('t1', 'adjust_pending_sets', JSON.stringify(noUnit), workout)).toMatchObject({ ok: false, error: 'invalid_args' });
  });
});

describe('strict function-tool definitions', () => {
  type Node = Record<string, unknown>;
  function walk(node: unknown, visit: (n: Node, path: string) => void, path = '$'): void {
    if (Array.isArray(node)) node.forEach((n, i) => { walk(n, visit, `${path}[${String(i)}]`); });
    else if (node !== null && typeof node === 'object') {
      visit(node as Node, path);
      for (const [k, v] of Object.entries(node)) walk(v, visit, `${path}.${k}`);
    }
  }

  it('every tool schema is closed, fully required, and avoids unsupported keywords', () => {
    const defs = functionToolDefinitions(COACH_TOOLS);
    expect(defs).toHaveLength(COACH_TOOLS.length);
    for (const d of defs) {
      expect(d.strict).toBe(true);
      walk(d.parameters, (n, path) => {
        expect(n).not.toHaveProperty('oneOf');
        expect(n).not.toHaveProperty('minLength');
        expect(n).not.toHaveProperty('$schema');
        if (n.type === 'object') {
          expect(n.additionalProperties, `${d.name} ${path}`).toBe(false);
          expect([...(n.required as string[])].sort(), `${d.name} ${path}`).toEqual(Object.keys(n.properties as object).sort());
        }
      });
    }
  });
});
