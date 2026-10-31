/**
 * Sentence-by-sentence display (coach-contract CC8): model text is held back
 * until a sentence is finished, so each one can be claim-checked before it is
 * shown or spoken. Pure and incremental.
 */

const ABBREVIATIONS = new Set(['e.g', 'i.e', 'vs', 'approx', 'etc', 'dr', 'mr', 'mrs', 'ms', 'st', 'no', 'min', 'max', 'sec', 'secs', 'mins', 'avg', 'est', 'cf']);

function isAbbreviation(textBefore: string): boolean {
  const m = /([A-Za-z.]+)$/.exec(textBefore);
  if (!m) return false;
  return ABBREVIATIONS.has((m[1] ?? '').toLowerCase());
}

/**
 * Index just past the end of the first complete sentence in `text`, or -1.
 * A sentence ends at `.`, `!` or `?` (plus closing quotes or brackets) that is
 * followed by whitespace, or at a line break. With `final`, the end of the
 * text also ends a sentence.
 */
function firstBoundary(text: string, final: boolean): number {
  let inToken = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (c === '[' && text.charAt(i + 1) === '[') inToken = true;
    if (c === ']' && text.charAt(i + 1) === ']') inToken = false;
    if (inToken) continue;
    if (c === '\n') return i + 1;
    if (c === '.' || c === '!' || c === '?' || c === '…') {
      let j = i + 1;
      while (j < text.length && /[.!?"'”’)\]]/.test(text.charAt(j)) && !(text.charAt(j) === ']' && text.charAt(j + 1) === ']')) j += 1;
      if (j >= text.length) return final ? j : -1;
      if (!/\s/.test(text.charAt(j))) continue;
      if (c === '.' && isAbbreviation(text.slice(0, i))) continue;
      return j;
    }
  }
  return -1;
}

export class SentenceBuffer {
  private buffer = '';

  /** Add streamed text; returns the sentences it completed (trimmed, non-empty). */
  push(delta: string): string[] {
    this.buffer += delta;
    return this.drain(false);
  }

  /**
   * End of stream. `completed` = the reply finished normally; otherwise the
   * unfinished last sentence is dropped, never padded (coach-contract §3).
   */
  end(completed: boolean): string[] {
    if (!completed) {
      this.buffer = '';
      return [];
    }
    return this.drain(true);
  }

  private drain(final: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      const at = firstBoundary(this.buffer, final);
      if (at < 0) break;
      const sentence = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at);
      if (sentence.length > 0) out.push(sentence);
      if (this.buffer.length === 0) break;
    }
    if (final) {
      const rest = this.buffer.trim();
      this.buffer = '';
      if (rest.length > 0) out.push(rest);
    }
    return out;
  }
}

/** Split complete text into sentences (tests and non-streamed replies). */
export function splitSentences(text: string): string[] {
  const b = new SentenceBuffer();
  return [...b.push(text), ...b.end(true)];
}
