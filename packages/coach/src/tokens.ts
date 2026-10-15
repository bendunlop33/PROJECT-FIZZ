import type { TurnLedger } from './claims';
import { renderActionResult, type RenderSurface, type RenderedAction } from './render';

/**
 * `[[ref]]` action tokens (coach-contract CC2). The coach cites its own action
 * with the ref its tool returned; the app swaps the token for the line it
 * renders from the saved record. Raw tokens are never shown. An unknown ref
 * shows nothing and counts as a hidden line.
 */

const TOKEN = /\[\[\s*([A-Za-z0-9_-]{1,32})\s*\]\]/g;
/** Leftover bracket fragments (a malformed or half token) are removed too. */
const FRAGMENT = /\[\[[^\]]*\]?\]?|\]\]/g;

export type TokenSegment =
  | { kind: 'text'; text: string }
  | { kind: 'action'; ref: string; actionId: string; rendered: RenderedAction };

export interface ResolvedTokens {
  segments: TokenSegment[];
  /** The sentence with every token removed, for the claim check. */
  plainText: string;
  unknownRefs: string[];
}

export function resolveActionTokens(sentence: string, ledger: TurnLedger, surface: RenderSurface): ResolvedTokens {
  const segments: TokenSegment[] = [];
  const unknownRefs: string[] = [];
  let last = 0;
  let plain = '';
  const pushText = (t: string): void => {
    const cleaned = t.replace(FRAGMENT, '');
    plain += cleaned;
    if (cleaned.trim().length > 0) segments.push({ kind: 'text', text: cleaned });
  };
  for (const m of sentence.matchAll(TOKEN)) {
    const at = m.index;
    pushText(sentence.slice(last, at));
    last = at + m[0].length;
    const ref = m[1] ?? '';
    const entry = ledger.entries.find((e) => e.ref === ref);
    if (entry === undefined) {
      unknownRefs.push(ref);
      continue;
    }
    segments.push({
      kind: 'action',
      ref,
      actionId: entry.record.actionId,
      rendered: renderActionResult(entry.record, surface, { earlier: entry.origin === 'earlier' }),
    });
  }
  pushText(sentence.slice(last));
  return { segments, plainText: plain.replace(/\s+/g, ' ').trim(), unknownRefs };
}
