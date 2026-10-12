import {
  COACH_REPLY_TOOL_NAME,
  COACH_TOOL_ARGS,
  CoachEntityKindSchema,
  ToolEffectSchema,
  type CapabilitySection,
  type CoachEntityKind,
  type CoachToolName,
  type CoachTurnKind,
  type StructuralSignalKind,
  type ToolEffect,
  type ToolNeed,
} from '@fizz/schemas';
import { isStructuralRequest, requestHas, type BenRequest, type BenRequestKind } from './request';

/**
 * The restricted coach tool registry (coach-contract §6, ADR 0020 §2). These
 * are the only tools a coach turn can ever receive; `buildTurnRegistry`
 * narrows them per turn. No tool deletes or overwrites anything (CC6).
 */

export interface ToolDeclaration {
  name: CoachToolName;
  effect: ToolEffect;
  /** Entities a write may touch. Reads write nothing. */
  writes: readonly CoachEntityKind[];
  needs: ToolNeed;
  /** CC10: a lasting change in what Ben trains. Gated on a request or a signal. */
  structural: boolean;
  turnKinds: readonly CoachTurnKind[];
  /** Row text in `What the coach can do` (§2.5). Required for every non-read tool. */
  plainLabel: string | null;
  capabilitySection: CapabilitySection;
  /** Sent to the model as the function description. */
  description: string;
}

const ALL: readonly CoachTurnKind[] = ['general', 'workout', 'summary'];

export const COACH_TOOLS: readonly ToolDeclaration[] = [
  {
    name: 'get_active_session',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description: "Today's workout: each exercise's sets with target and actual values, set IDs, statuses and the session version.",
  },
  {
    name: 'get_recent_training',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description:
      "One exercise's last workouts (sets as logged, units and conventions explicit, sets Ben left out labelled) and its heaviest logged sets per equipment item. Imported workouts are labelled and never compared with app sets.",
  },
  {
    name: 'get_training_overview',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description:
      'Ben’s training over the last weeks: how many workouts, what was done, and per exercise the first and latest comparable top set (like for like only). Use it for "How am I doing?". No estimates.',
  },
  {
    name: 'get_gym_equipment',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description: 'Equipment for an exercise at the current gym: unit, load convention, achievable loads, min and max.',
  },
  {
    name: 'get_progression_targets',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description: "The built-in rule's next targets for an exercise and why. A comparison, not advice.",
  },
  {
    name: 'get_substitutions',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description: 'Exercises that could replace one at Ben’s gym (the catalogue’s substitutes and the same movement family), with exercise IDs to use in a swap. Only doable here, never pain-flagged.',
  },
  {
    name: 'get_recent_actions',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description: 'Earlier coach actions with refs you can cite as [[ref]], and whether each still stands.',
  },
  {
    name: 'adjust_pending_sets',
    effect: 'versioned_update',
    writes: ['pending_set_target'],
    needs: 'ben_request',
    structural: false,
    turnKinds: ['workout'],
    plainLabel: "Change today's remaining sets",
    capabilitySection: 'when_you_ask',
    description:
      "Change targets of today's pending sets (load, reps, target RPE; rpe null keeps it), or add or remove one pending set per exercise. Done sets are never changed. Loads are snapped to the equipment. Ben's own target RPE always stays.",
  },
  {
    // (12 Oct) Today only, because Ben asked (rule 3): applies at once with Undo. Not CC10's structural
    // kind: that is the plan he trains from next time, which stays a proposal (`propose_next_workout_change`).
    name: 'add_exercise_today',
    effect: 'versioned_update',
    writes: ['session_exercise'],
    needs: 'ben_request',
    structural: false,
    turnKinds: ['workout'],
    plainLabel: "Add an exercise to today's workout, with Undo",
    capabilitySection: 'when_you_ask',
    description:
      "Add an exercise Ben asked for to today's workout: exerciseId from YOUR DATA addable (only those), working sets, a rep range (or workSeconds for a timed exercise), targetRpe, and optionally where it goes (after an exercise of today's workout, or in a superset with one that has a set left). No loads: the app plans them from his history on this gym's equipment, blank with no history. Today only: if Ben names a future scope (next time, future sessions, his routine or template, every push day, permanently), use propose_next_workout_change instead and never this tool. For one more set of an exercise already in the workout, use adjust_pending_sets. Done sets are never changed. An added exercise returns sessionVersion and sessionExerciseId: use that sessionVersion as baseVersion for the next change in this turn.",
  },
  {
    name: 'log_set',
    effect: 'versioned_update',
    writes: ['logged_set'],
    needs: 'ben_request',
    structural: false,
    turnKinds: ['workout'],
    plainLabel: 'Log a set you tell it ("log 100 for 8"), with Undo',
    capabilitySection: 'when_you_ask',
    description:
      'Log the set the Log button would log (the next pending set of the exercise in focus, or of the one exercise Ben names) with the weight, reps and RPE Ben just said, in the exercise’s own unit and convention. Only numbers Ben said are accepted. Starts rest like the Log button.',
  },
  {
    name: 'correct_set',
    effect: 'versioned_update',
    writes: ['logged_set'],
    needs: 'ben_request',
    structural: false,
    turnKinds: ['workout'],
    plainLabel: 'Correct a logged set you name ("set 2 was 95"), with Undo',
    capabilitySection: 'when_you_ask',
    description: 'Correct the weight, reps or RPE of a logged set Ben named, with the numbers he said (null keeps a value). Never marks, deletes or changes set types.',
  },
  {
    name: 'set_next_session_targets',
    effect: 'versioned_update',
    writes: ['next_session_target'],
    needs: 'summary_turn',
    structural: false,
    turnKinds: ['summary'],
    plainLabel: "Small changes to next time's load, reps and sets, shown on the summary with Undo",
    capabilitySection: 'after_workout',
    description: 'Next-session targets for exercises in this workout (rpe null keeps the target RPE). Small changes are saved with Undo; bigger ones, including a changed target RPE, become suggestions Ben applies.',
  },
  {
    name: 'propose_next_workout_change',
    effect: 'propose',
    writes: ['proposal'],
    needs: 'structural_signal',
    structural: true,
    turnKinds: ['general', 'workout', 'summary'],
    plainLabel: 'Swapping, adding, removing or reordering exercises in your next workout',
    capabilitySection: 'suggest_only',
    description:
      'Suggest swapping, removing or reordering exercises in the next workout built from a finished one (its routine, or the next session from it). Use exercise IDs from the workout or get_substitutions. Adding exercises is not possible yet. Nothing changes until Ben taps Apply.',
  },
  {
    name: 'set_pain_flag',
    effect: 'append',
    writes: ['pain_flag'],
    needs: 'ben_pain_words',
    structural: false,
    turnKinds: ['general', 'workout'],
    plainLabel: 'Turn a pain flag on',
    capabilitySection: 'when_you_ask',
    description: "Turn on a pain flag for movements Ben says hurt in this message. Stops increases for them. Never diagnoses, and can't clear a flag.",
  },
  {
    name: 'save_memory',
    effect: 'append',
    writes: ['memory'],
    needs: 'ben_request',
    structural: false,
    turnKinds: ['general', 'workout'],
    plainLabel: 'Save a memory',
    capabilitySection: 'when_you_ask',
    description: 'Save a short personal fact Ben asked you to remember. Not for general training rules.',
  },
  {
    name: 'suggest_memory',
    effect: 'propose',
    writes: ['memory'],
    needs: 'none',
    structural: false,
    turnKinds: ['general', 'workout'],
    plainLabel: 'Suggest something to remember (saved only if you tap Save)',
    capabilitySection: 'suggest_only',
    description:
      'Suggest a short personal fact or preference about Ben worth remembering, when he states one without asking you to remember it. Never a general training rule. Not used until Ben taps Save.',
  },
  {
    name: 'forget_memory',
    effect: 'versioned_update',
    writes: ['memory'],
    needs: 'ben_request',
    structural: false,
    turnKinds: ['general', 'workout'],
    plainLabel: 'Forget a memory',
    capabilitySection: 'when_you_ask',
    description: 'Forget a saved memory Ben asked you to forget. It can be undone.',
  },
  {
    // workout-builder BD1, §8.2: structure only (no load, no minutes); a draft Ben opens, starts or saves himself.
    name: 'propose_workout',
    effect: 'propose',
    writes: ['workout_draft'],
    needs: 'ben_request',
    structural: false,
    turnKinds: ['general'],
    plainLabel: 'Build a workout you ask for, as a draft you open, start or save',
    capabilitySection: 'when_you_ask',
    description:
      'Build the workout Ben asked for, or a new version of the coach draft in context: exercises by catalogueId from YOUR DATA build.usable only, in order, with working sets, a rep range (or workSeconds for timed exercises), targetRpe for the working sets, optional warm-ups, one optional top set, rest and supersets. No loads or minutes: the app plans loads from his history and fits the length. Stay within build.setBudget working sets. It only makes a draft; Ben starts or saves it himself.',
  },
  {
    // Contract §6.1 says `ben_request`; ADR 0020 §2 proposes `none`. The approved
    // spec (the stricter one) wins until Ben decides.
    name: 'add_playbook_candidate',
    effect: 'append',
    writes: ['playbook_candidate'],
    needs: 'ben_request',
    structural: false,
    turnKinds: ['general', 'workout'],
    plainLabel: 'Add a general training rule to your playbook to review',
    capabilitySection: 'when_you_ask',
    description: "Add a general training rule (not a personal fact) to the playbook for Ben to review. It isn't used until he approves it.",
  },
];

/** The fixed `Never` section (§2.5): things that are not tools at all. */
export const COACH_NEVER: readonly string[] = [
  'Delete or rewrite a workout, a set, an import or a check-in',
  'Clear a pain flag',
  'Change settings, your AI connection, backups or playbook approvals',
];

/** Entity kinds a versioned update may write; all keep the previous version (CC6, check 1). */
/** (11 Oct) `logged_set`: a set Ben told the coach to log or correct, through the workout's own versioned commands; never a delete. */
/** (12 Oct) `session_exercise`: an exercise added to today's workout with pending sets only; Undo takes it out. */
const VERSIONED_WRITABLE: ReadonlySet<CoachEntityKind> = new Set<CoachEntityKind>(['pending_set_target', 'next_session_target', 'memory', 'logged_set', 'session_exercise']);

export class UnsafeRegistryError extends Error {}

/**
 * Contract check 1, run by a unit test and at module load: every tool has an
 * allowed effect, declared writes, a plain label when it writes, and argument
 * schemas. A stub `delete_workout` or an `overwrite` effect fails here.
 */
export function assertRegistrySafe(tools: readonly ToolDeclaration[]): void {
  const names = new Set<string>();
  for (const t of tools) {
    if (names.has(t.name)) throw new UnsafeRegistryError(`Duplicate tool ${t.name}`);
    if ((t.name as string) === COACH_REPLY_TOOL_NAME) throw new UnsafeRegistryError(`${t.name}: the reply function is not a registry tool`);
    names.add(t.name);
    if (!ToolEffectSchema.safeParse(t.effect).success) throw new UnsafeRegistryError(`${t.name}: effect ${t.effect} is not allowed`);
    if (/(^|_)(delete|remove_set|overwrite|clear|discard|reset|restore|update_completed)/.test(t.name)) {
      throw new UnsafeRegistryError(`${t.name}: destructive tools are never in the registry`);
    }
    if (!(t.name in COACH_TOOL_ARGS)) throw new UnsafeRegistryError(`${t.name}: no argument schema`);
    for (const w of t.writes) {
      if (!CoachEntityKindSchema.safeParse(w).success) throw new UnsafeRegistryError(`${t.name}: writes unknown entity ${w}`);
    }
    if (t.effect === 'read' && t.writes.length > 0) throw new UnsafeRegistryError(`${t.name}: a read tool can't write`);
    if (t.effect !== 'read' && t.writes.length === 0) throw new UnsafeRegistryError(`${t.name}: a write tool must declare what it writes`);
    if (t.effect === 'versioned_update' && t.writes.some((w) => !VERSIONED_WRITABLE.has(w))) {
      throw new UnsafeRegistryError(`${t.name}: versioned updates may only write targets, memories, a set Ben named or an exercise added today`);
    }
    if (t.effect !== 'read' && (t.plainLabel === null || t.plainLabel.trim() === '')) {
      throw new UnsafeRegistryError(`${t.name}: a write tool needs a plainLabel for What the coach can do`);
    }
    if (t.effect !== 'read' && t.capabilitySection === 'read') throw new UnsafeRegistryError(`${t.name}: a write tool needs a capability section`);
    if (t.structural && t.needs !== 'structural_signal' && t.needs !== 'ben_request') {
      throw new UnsafeRegistryError(`${t.name}: structural tools must be gated (CC10)`);
    }
  }
}

assertRegistrySafe(COACH_TOOLS);

/** What this turn contains, decided by code from Ben's own input (never from tool output or imported text). */
export interface TurnGate {
  kind: CoachTurnKind;
  /**
   * Ben's own message (typed, spoken) or chip in this turn, classified as a
   * request by `classifyBenRequest` / `chipRequest`. Null when he only asked a
   * question or said something else: "Ben sent a message" is not a request
   * (review S3, rule 3). Never set from tool output or imported text.
   */
  benRequest: BenRequest | null;
  /** Ben tapped `Adjust` on an offer (CA1); counts as a request for today's sets only. */
  acceptedOffer: boolean;
  /** `classifyPainMention` returned `pain` on Ben's own words in this turn (or he tapped `Pain`). */
  benPainWords: boolean;
  /** `getStructuralChangeSignals` for the workout in context. */
  structuralSignals: readonly StructuralSignalKind[];
}

export interface WithheldTool {
  name: CoachToolName;
  /** For `Why?` → `Not used`. */
  reason: 'turn_kind' | 'needs_request' | 'needs_pain_words' | 'needs_summary_turn' | 'needs_request_or_signal' | 'not_in_build';
}

export interface TurnRegistry {
  tools: ToolDeclaration[];
  withheld: WithheldTool[];
}

/**
 * Which request kinds open which `ben_request` tool (review r2 B2). A request
 * of one kind never opens another kind's tools: "remember that I train before
 * work" can't reach today's sets, and "set 2 felt good" (not a request) opens
 * nothing. Chips count as `change` (CA1). Tools not listed here that need
 * `ben_request` open on no request kind at all, so a new tool fails closed
 * until it is mapped.
 *
 * `add_playbook_candidate` opens only on `playbook` ("add a rule …", "as a
 * general rule …", "put that in the playbook"), never on a memory request:
 * "remember that my left knee is dodgy on lunges" is Your data and can't
 * reach the Coaching knowledge queue (CLAUDE.md rule 10, review r3 S1). The
 * candidate text is also checked by `personalPlaybookText` in `tool-call.ts`.
 * Its `needs` is still unsettled in ADR 0020 (Ben/PM decision).
 */
export const REQUEST_KINDS_BY_TOOL: Partial<Record<CoachToolName, readonly BenRequestKind[]>> = {
  // "Add a set to bench", "another set" are `change`; "put in some curls" is `add`, which also opens this
  // tool so the coach can add one more set when the exercise is already in today's workout.
  adjust_pending_sets: ['change', 'difficulty', 'add'],
  // (12 Oct) "Add 3 sets of lateral raises", "put in some curls", "can we do some face pulls".
  add_exercise_today: ['add'],
  // Review r2 B1: every add also opens the proposal tool, so a future scope Ben names ("to every push
  // day", "permanently") always has a tool that only proposes, and today's add is never the only choice.
  propose_next_workout_change: ['add'],
  log_set: ['log'],
  correct_set: ['correct'],
  save_memory: ['memory'],
  forget_memory: ['memory'],
  add_playbook_candidate: ['playbook'],
  // workout-builder §8.2: a build request ("build me a 45-minute push session"), or a change to the draft in context (BD16).
  propose_workout: ['build'],
};

function requestOpens(t: ToolDeclaration, r: BenRequest | null): boolean {
  const kinds = REQUEST_KINDS_BY_TOOL[t.name] ?? [];
  return kinds.some((k) => requestHas(r, k));
}

function needMet(t: ToolDeclaration, g: TurnGate): WithheldTool['reason'] | null {
  switch (t.needs) {
    case 'none':
      return null;
    case 'ben_request':
      if (requestOpens(t, g.benRequest)) return null;
      // An accepted offer only counts for today's sets (CA1).
      return g.acceptedOffer && t.name === 'adjust_pending_sets' ? null : 'needs_request';
    case 'ben_pain_words':
      return g.benPainWords ? null : 'needs_pain_words';
    case 'ben_named_target':
      return requestHas(g.benRequest, 'change') ? null : 'needs_request';
    case 'summary_turn':
      return g.kind === 'summary' ? null : 'needs_summary_turn';
    case 'structural_signal':
      return isStructuralRequest(g.benRequest) || requestOpens(t, g.benRequest) || g.structuralSignals.length > 0 ? null : 'needs_request_or_signal';
  }
}

/** The tools the model sees in this turn (CC10, summary closed list). */
export function buildTurnRegistry(gate: TurnGate, tools: readonly ToolDeclaration[] = COACH_TOOLS): TurnRegistry {
  const out: ToolDeclaration[] = [];
  const withheld: WithheldTool[] = [];
  for (const t of tools) {
    if (!t.turnKinds.includes(gate.kind)) {
      withheld.push({ name: t.name, reason: 'turn_kind' });
      continue;
    }
    const missing = needMet(t, gate);
    if (missing !== null) withheld.push({ name: t.name, reason: missing });
    else out.push(t);
  }
  return { tools: out, withheld };
}

export interface CapabilityList {
  intro: string;
  sections: { section: 'when_you_ask' | 'after_workout' | 'suggest_only' | 'never'; title: string; rows: string[] }[];
}

const SECTION_TITLES = {
  when_you_ask: 'When you ask',
  after_workout: 'After each workout',
  suggest_only: 'Only as a suggestion you apply',
  never: 'Never',
} as const;

/** `What the coach can do` (§2.5), generated from the registry so it can't drift. */
export function listCoachCapabilities(tools: readonly ToolDeclaration[] = COACH_TOOLS): CapabilityList {
  const rows = (section: CapabilitySection): string[] =>
    tools.filter((t) => t.capabilitySection === section && t.plainLabel !== null).map((t) => t.plainLabel ?? '');
  return {
    intro: 'The coach only says something changed when the app has saved that change. You can undo every change it makes.',
    sections: [
      { section: 'when_you_ask', title: SECTION_TITLES.when_you_ask, rows: rows('when_you_ask') },
      { section: 'after_workout', title: SECTION_TITLES.after_workout, rows: rows('after_workout') },
      { section: 'suggest_only', title: SECTION_TITLES.suggest_only, rows: rows('suggest_only') },
      { section: 'never', title: SECTION_TITLES.never, rows: [...COACH_NEVER] },
    ],
  };
}

export function findTool(name: string, tools: readonly ToolDeclaration[] = COACH_TOOLS): ToolDeclaration | null {
  return tools.find((t) => t.name === name) ?? null;
}
