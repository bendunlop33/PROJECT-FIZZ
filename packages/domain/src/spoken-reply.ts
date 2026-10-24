import { spokenDuration, spokenNumber, spokenUnit } from './spoken-cues';

/**
 * A coach reply as it is read aloud (Ben, 19 Oct 2026; voice.md §5.2 "Long
 * reply"): the first two sentences, at most `maxChars`, with markdown removed
 * and numbers said the way people say them ("97 and a half kilos for 8",
 * "6 to 8", "1 minute 30"). The screen keeps the whole reply. Pure.
 */
export const SPOKEN_REPLY_MAX_CHARS = 300;

const UNIT = String.raw`(kg|kgs|kilos?|lb|lbs|pounds?)`;
const NUM = String.raw`(\d+(?:\.\d+)?)`;

function unitOf(word: string): 'kg' | 'lb' {
  return /^k/i.test(word) ? 'kg' : 'lb';
}

/** Markdown and symbols out; numbers, units, ranges and times in words. */
export function speakableText(text: string): string {
  let t = text.replace(/\u00a0/g, ' ').replace(/\r?\n+/g, ' ');
  // Markdown: links keep their words; emphasis, code, headings and bullets go.
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/[*_`#]+/g, '');
  t = t.replace(/(^|\s)[-•]\s+/g, '$1');
  // `+2.5 kg` → `plus 2 and a half kilos`.
  t = t.replace(new RegExp(String.raw`\+\s?(?=\d)`, 'g'), 'plus ');
  // `100 kg × 8` → `100 kilos for 8` (load then reps); other `3 × 8` → `3 by 8`.
  t = t.replace(new RegExp(String.raw`${NUM}\s?${UNIT}\b(\s*each)?\s*[×x]\s*(\d+)`, 'gi'), (_m, n: string, u: string, each: string | undefined, reps: string) => {
    const v = Number(n);
    return `${spokenNumber(v)} ${spokenUnit(unitOf(u), v)}${each ? ' each' : ''} for ${reps}`;
  });
  t = t.replace(/(\d)\s*[×]\s*(\d)/g, '$1 by $2');
  t = t.replace(new RegExp(String.raw`${NUM}\s?${UNIT}\b`, 'gi'), (_m, n: string, u: string) => {
    const v = Number(n);
    return `${spokenNumber(v)} ${spokenUnit(unitOf(u), v)}`;
  });
  // Ranges: `6–8`, `6-8` → `6 to 8`.
  t = t.replace(/(\d)\s*[–—-]\s*(\d)/g, '$1 to $2');
  // Short times `1:30`, `0:45` (not clock times like 18:42).
  t = t.replace(/\b(\d):([0-5]\d)\b/g, (_m, m: string, s: string) => spokenDuration(Number(m) * 60 + Number(s)));
  t = t.replace(/(\d)\s?%/g, '$1 percent');
  t = t.replace(/\be1RM\b/gi, 'estimated 1 rep max').replace(/\b1RM\b/gi, '1 rep max');
  t = t.replace(/\bBW\b/g, 'bodyweight');
  t = t.replace(/\s*[·|]\s*/g, ', ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Sentences: split only at `.`, `!` or `?` followed by a space, so `97.5` and `e.g. this` stay whole. */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/(?<=[.!?])\s+/)) {
    const last = out[out.length - 1];
    if (last !== undefined && /\b(?:e\.g|i\.e|vs)\.$/i.test(last)) out[out.length - 1] = `${last} ${piece}`;
    else if (piece.trim() !== '') out.push(piece.trim());
  }
  return out;
}

/** What is spoken of a reply: '' when nothing is worth saying. */
export function spokenReplyText(text: string, maxChars: number = SPOKEN_REPLY_MAX_CHARS): string {
  const speakable = speakableText(text);
  if (speakable === '') return '';
  const firstTwo = sentences(speakable).slice(0, 2).join(' ');
  if (firstTwo.length <= maxChars) return firstTwo;
  const cut = firstTwo.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = (lastSpace > maxChars / 2 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, '');
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
