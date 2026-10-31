/**
 * Voice gym commands (gym-switch.md §4.4, GS9), pure and local: no coach,
 * works offline. "I'm at Home", "switch gym to Home", "change gym to the
 * hotel" open the card for a gym matched by name, then by the word after
 * "the". "switch" / "yes" confirm only a card that changes no target; "not
 * now" dismisses. The utterance is data, never an instruction to anything
 * else (rule 8). The grammar is to be added to voice.md (follow-up); voice
 * isn't in the app yet, so nothing calls this.
 */

export interface GymName {
  id: string;
  name: string;
}

export type GymCommand =
  | { kind: 'choose'; gymId: string; gymName: string }
  | { kind: 'ambiguous'; options: GymName[] }
  | { kind: 'no_match'; heard: string }
  | { kind: 'confirm' }
  | { kind: 'not_now' };

/** Lower case, `·` and punctuation as spaces, single spaces. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const OPENERS = [/^(?:i am|im) (?:at|in) (.+)$/, /^(?:switch|change) (?:the )?gym to (.+)$/, /^(?:switch|change) to (.+)$/, /^(?:use|go to) (.+?)(?: gym)?$/];

/**
 * What the utterance means for the gym card, or null when it isn't a gym command.
 * The bare confirm and dismiss words ("yes", "no", "switch", "not now" …) mean
 * something only while a gym card is open, so they never intercept another voice
 * flow (review N6).
 */
export function parseGymCommand(utterance: string, gyms: readonly GymName[], ctx: { cardOpen: boolean }): GymCommand | null {
  const said = norm(utterance);
  if (said === '') return null;
  if (said === 'switch' || said === 'yes' || said === 'apply') return ctx.cardOpen ? { kind: 'confirm' } : null;
  if (said === 'not now' || said === 'no' || said === 'cancel') return ctx.cardOpen ? { kind: 'not_now' } : null;
  let heard: string | null = null;
  for (const re of OPENERS) {
    const m = re.exec(said);
    if (m?.[1] !== undefined) {
      heard = m[1].trim();
      break;
    }
  }
  if (heard === null || heard === '') return null;
  const target = heard.replace(/^the /, '');
  const named = gyms.map((g) => ({ g, n: norm(g.name) }));
  // 1. The whole name.
  const exact = named.filter((x) => x.n === heard || x.n === target);
  if (exact.length === 1 && exact[0]) return { kind: 'choose', gymId: exact[0].g.id, gymName: exact[0].g.name };
  // 2. Every word said appears in the name, in order ("hotel lisbon" → "Hotel · Lisbon"; "the hotel" → any Hotel).
  const words = target.split(' ');
  const partial = named.filter((x) => {
    const nameWords = x.n.split(' ');
    let i = 0;
    for (const w of nameWords) if (w === words[i]) i += 1;
    return i === words.length;
  });
  const first = partial[0];
  if (partial.length === 1 && first) return { kind: 'choose', gymId: first.g.id, gymName: first.g.name };
  if (partial.length > 1) return { kind: 'ambiguous', options: partial.map((x) => x.g) };
  return { kind: 'no_match', heard };
}

/**
 * The voice strip's words (§4.4). `changesTargets` is the open card's; a
 * spoken confirm applies only a card that changes no target.
 */
export function gymCommandStrip(
  cmd: GymCommand,
  ctx: { changesTargets: boolean | null; currentGymName: string | null },
): { text: string; apply: boolean } {
  switch (cmd.kind) {
    case 'choose':
      return { text: ctx.changesTargets === false ? `Gym: ${cmd.gymName}. No targets change. Say "switch" or tap.` : `Gym: ${cmd.gymName}. Check the card, then tap Switch.`, apply: false };
    case 'ambiguous':
      return { text: `${cmd.options.map((o) => o.name).join(' or ')}?`, apply: false };
    case 'no_match':
      return { text: `No gym called "${cmd.heard}". Tap the gym chip to choose.`, apply: false };
    case 'confirm':
      if (ctx.changesTargets === null) return { text: 'No gym change to confirm.', apply: false };
      return ctx.changesTargets ? { text: 'Tap Switch to apply these changes.', apply: false } : { text: 'Switching…', apply: true };
    case 'not_now':
      return { text: `Not switched. Still at ${ctx.currentGymName ?? 'this gym'}.`, apply: false };
  }
}
