/**
 * `classifyBenRequest`: does Ben's own message ask the coach to change
 * something? This is the `ben_request` test of the turn gate (coach-contract
 * §6.1, "The ben_request test is code, not the model's say-so"; review S3).
 * Pure and deterministic, so it works offline and can't be talked into
 * firing by tool output, imported notes or the context block: callers pass
 * only Ben's typed or spoken words, or his chip tap.
 *
 * "Ben sent a message" is not a request. A plain question ("why is set 3 at
 * 100?", "should I drop the weight?") gets the read tools only; the coach
 * answers and may offer ("Want me to adjust?"), and nothing applies until Ben
 * asks or taps `Adjust` (CLAUDE.md rule 3).
 *
 * Counts as a request:
 * - a chip: `Too hard`, `Too easy`, `Pain`, a check-in `Adjust`;
 * - a directive: "drop the weight for the last two", "please lower it",
 *   "can you take 5 kg off?", "I want it lighter", "let's go 95";
 * - a difficulty report the spec lists as Path A (coach-adjustments §4.1):
 *   "too heavy", "too easy, what next?", "that was a grind";
 * - a variety or swap request (structural, CC10): "swap cable fly",
 *   "mix it up", "I'm bored of incline press";
 * - a memory request: "remember that I train before work", "forget that".
 *
 * A bare "yes" / "do it" is not classified here: accepting a coach offer is
 * the `acceptedOffer` gate, set by the turn engine only when the previous
 * coach message was that offer.
 */

export type BenChip = 'too_hard' | 'too_easy' | 'pain' | 'lighter_session';

export type BenRequestKind = 'change' | 'difficulty' | 'structural' | 'memory';

export type BenRequest = { source: 'chip'; chip: BenChip } | { source: 'words'; kind: BenRequestKind };

const CHANGE_VERBS =
  'drop|lower|reduce|decrease|cut|raise|increase|bump|up|add|remove|delete|change|adjust|make|take|knock|put|set|move|skip|scrap|ditch|lighten|ease|log|go|give|switch|swap|replace|sub|substitute|plan|build|reschedule|deload|scale|trim|shave|halve|double|update|fix|correct|use';
const POLITE = '(?:please |pls |just |ok |okay |right |so |and )*';
/** "Drop the weight", "please lower it". Imperative at the start of a clause. */
const DIRECTIVE = new RegExp(`^${POLITE}(?:${CHANGE_VERBS})\\b`);
/** "Can you take 5 off", "could we go lighter", "I want it lighter", "let's do 95". */
const ASKING = new RegExp(
  `\\b(?:can|could|would|will) (?:you|we) (?:please )?(?:${CHANGE_VERBS}|do|try|go)\\b|\\b(?:i (?:want|need|would like|'d like|wanna) (?:you to |to |it |them |the |a |an |some |more |less |fewer |something )|let'?s (?:${CHANGE_VERBS}|do|try|go)\\b|\\bgo ahead\\b)`,
);
const DIFFICULTY = /\b(?:too (?:heavy|hard|easy|light|much)|way too|that was a grind|(?:it|that|this|set \d+) (?:was|is|felt|feels) (?:a )?(?:grind|brutal|really hard|too)\b|couldn'?t (?:finish|get|hit|do)|failed (?:the|my|that|it|a) |missed (?:reps|the reps|a rep)|easy,? what next)/;
const STRUCTURAL = /\b(?:swap|switch|replace|substitute|sub out|something (?:else|different) (?:for|instead)|mix (?:it|things) up|some variety|more variety|bored (?:of|with)|change (?:the|my) (?:routine|split|programme|program|exercises?|order)|different exercise|instead of)\b/;
const MEMORY = /^(?:please )?(?:remember|note|forget|don'?t forget)\b|\b(?:can you|could you|please) (?:remember|note|forget)\b/;
/** A question asking for the coach's view, not for a change: "should I…", "why is…", "what do you think". */
const ADVICE_QUESTION = /^(?:why|what|how|when|where|which|who|is|are|was|were|do|does|did|should|shall i|am i|have i|has)\b/;

function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[.!?;\n]+|,\s*|\s+(?:and|but|so|then)\s+(?=(?:please |can |could |just )?(?:[a-z]+)\b)/)
    .map((c) => c.replace(/\s+/g, ' ').trim())
    .filter((c) => c.length > 0);
}

/** Classify Ben's own words (typed or spoken). Returns null when they don't ask for a change. */
export function classifyBenRequest(text: string): BenRequest | null {
  const whole = text.toLowerCase().replace(/[‘’]/g, "'");
  const clauses = normalise(text);
  if (clauses.some((c) => MEMORY.test(c))) return { source: 'words', kind: 'memory' };
  const asks = clauses.some((c) => (DIRECTIVE.test(c) && !ADVICE_QUESTION.test(c)) || ASKING.test(c));
  if (STRUCTURAL.test(whole) && (asks || /\b(?:bored|variety|mix (?:it|things) up)\b/.test(whole)) && !/^(?:why|should i)\b/.test(whole.trim())) {
    return { source: 'words', kind: 'structural' };
  }
  if (asks) return { source: 'words', kind: 'change' };
  // "Is 95 too light?" asks for a view; "too easy, what next?" reports how it went.
  if (DIFFICULTY.test(whole) && !ADVICE_QUESTION.test(clauses[0] ?? '')) return { source: 'words', kind: 'difficulty' };
  return null;
}

/** A chip tap is always Ben's own request for today's sets (CA1). */
export function chipRequest(chip: BenChip): BenRequest {
  return { source: 'chip', chip };
}

/** Structural tools (CC10) need a structural request, not just any request. */
export function isStructuralRequest(r: BenRequest | null): boolean {
  return r !== null && r.source === 'words' && r.kind === 'structural';
}
