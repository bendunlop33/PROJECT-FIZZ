import type { TurnLedger } from './claims';
import { renderActionResult, type RenderSurface, type RenderedAction } from './render';

/**
 * `[[ref]]` action tokens (coach-contract CC2). The coach cites its own action
 * with the ref its tool returned; the app swaps the token for the line it
 * renders from the saved record. Raw tokens are never shown. An unknown ref
 * shows nothing and counts as a hidden line.
 *
 * (Ben, 13 Nov, build 568: "…don't replace targeted work. gives them direct
 * attention…") The app line isn't shown inside the sentence (the card is), so
 * removing a token must never leave a sentence with a hole or its start cut
 * off. `displayText` is the sentence as it may be shown: a token that opens
 * the sentence's grammar becomes "This change", one inside it "this change",
 * and one that only cites (at the end, in brackets, before a new sentence) is
 * dropped with its punctuation.
 */

const TOKEN = /\[\[\s*([A-Za-z0-9_-]{1,32})\s*\]\]/g;
/** Leftover bracket fragments (a malformed or half token) are removed too. */
const FRAGMENT = /\[\[[^\]]*\]?\]?|\]\]/g;
/** One token or fragment, or a run of them joined by "and", "&" or commas ("[[a1]] and [[a2]]"). */
const ONE = String.raw`(?:\[\[[^\]]*\]?\]?|\]\])`;
const GROUP = new RegExp(String.raw`${ONE}(?:\s*(?:,\s*and|,|and|&|\+)?\s*${ONE})*`, 'g');
const WORDY = /[\p{L}\p{N}]/u;

export type TokenSegment =
  | { kind: 'text'; text: string }
  | { kind: 'action'; ref: string; actionId: string; rendered: RenderedAction };

export interface ResolvedTokens {
  segments: TokenSegment[];
  /** The sentence with every token removed, for the claim check. */
  plainText: string;
  /** The sentence as shown: tokens replaced or dropped so it stays whole and grammatical (13 Nov). Empty when only tokens. */
  displayText: string;
  /** How many of the action segments were cited before the sentence's words (shown before it). */
  leadingActions: number;
  unknownRefs: string[];
}

function capitalise(s: string): string {
  return s.replace(/^(\W*)(\p{Ll})/u, (_m, lead: string, c: string) => `${lead}${c.toUpperCase()}`);
}

/**
 * The sentence with its tokens worked into the words (13 Nov). Pure. A cited
 * change is on its card, so the words only need to stay whole:
 * - only tokens, or tokens at the end or in brackets: dropped ("Saved: [[a1]]." → "Saved.");
 * - before a capitalised word or a colon: dropped, it was a citation ("[[a1]] Then rest." → "Then rest.");
 * - as the subject: "This change" / "These changes" ("[[a1]] gives them…" → "This change gives them…");
 * - inside the sentence: "this change" / "these changes".
 */
export function tokenDisplayText(sentence: string): { text: string; leadingGroups: number } {
  let out = '';
  let last = 0;
  let leadingGroups = 0;
  let changed = false;
  for (const m of sentence.matchAll(GROUP)) {
    changed = true;
    const at = m.index;
    const count = (m[0].match(FRAGMENT) ?? []).length;
    out += sentence.slice(last, at);
    last = at + m[0].length;
    const after = sentence.slice(last);
    const afterWords = after.replace(FRAGMENT, '');
    const leading = !WORDY.test(out);
    if (/\(\s*(?:see\s+|as in\s+|cf\.?\s+)?$/i.test(out) && /^\s*\)/.test(after)) {
      // "(see [[a1]])": a bracketed citation goes with its brackets.
      out = out.replace(/\s*\(\s*(?:see\s+|as in\s+|cf\.?\s+)?$/i, '');
      last += /^\s*\)/.exec(after)?.[0].length ?? 0;
      continue;
    }
    if (!WORDY.test(afterWords)) {
      // Trailing: the sentence is already whole. Drop a dangling ":", "—" or "," before it, and a bare "See".
      out = out.replace(/[\s:\-–—,]*$/, '');
      if (/^\W*(?:see|as in|cf)\W*$/i.test(out)) out = '';
      if (leading) leadingGroups += 1;
      continue;
    }
    if (leading) {
      leadingGroups += 1;
      const sep = /^\s*[:\-–—]\s*/.exec(after);
      if (sep !== null) {
        last += sep[0].length;
        continue;
      }
      if (/^\s*\p{Lu}/u.test(afterWords)) continue;
      out += count > 1 ? 'These changes' : 'This change';
      continue;
    }
    out += count > 1 ? 'these changes' : 'this change';
  }
  if (!changed) return { text: sentence.trim(), leadingGroups: 0 };
  out += sentence.slice(last);
  const text = out
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?…)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/^[\s,;:\-–—]+/, '')
    .trim();
  if (!WORDY.test(text)) return { text: '', leadingGroups };
  return { text: capitalise(text), leadingGroups };
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
  const display = tokenDisplayText(sentence);
  // Actions cited before the first words are shown before the sentence; the rest after it.
  const firstText = segments.findIndex((s) => s.kind === 'text');
  const leadingActions = display.leadingGroups === 0 ? 0 : (firstText < 0 ? segments : segments.slice(0, firstText)).filter((s) => s.kind === 'action').length;
  return { segments, plainText: plain.replace(/\s+/g, ' ').trim(), displayText: display.text, leadingActions, unknownRefs };
}
