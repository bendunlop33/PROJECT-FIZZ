/**
 * Text helpers for the claim check: normalisation, contractions, spoken
 * numbers ("ninety seven and a half kilos"), and set lists. Pure.
 */

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

const NUMBER_WORD = [...Object.keys(ONES), ...Object.keys(TENS), 'hundred', 'a', 'and'].join('|');
const NUMBER_RUN = new RegExp(`\\b(?:${NUMBER_WORD})(?:[\\s-]+(?:${NUMBER_WORD}))*\\b`, 'gi');

/** Parse a run of words into numbers and leftover words: "three and four" → ["3", "and", "4"]. */
function parseRun(run: string): string {
  const words = run.toLowerCase().split(/[\s-]+/);
  const out: string[] = [];
  let cur: number | null = null;
  let lastKind: 'ones' | 'tens' | 'hundred' | null = null;
  const flush = (): void => {
    if (cur !== null) out.push(String(cur));
    cur = null;
    lastKind = null;
  };
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i] ?? '';
    const next = words[i + 1];
    if (w in TENS) {
      if (cur !== null && lastKind !== 'hundred') flush();
      cur = (cur ?? 0) + (TENS[w] ?? 0);
      lastKind = 'tens';
    } else if (w in ONES) {
      const v = ONES[w] ?? 0;
      const joinsTens = lastKind === 'tens' && v > 0 && v < 10;
      if (cur !== null && !joinsTens && lastKind !== 'hundred') flush();
      cur = (cur ?? 0) + v;
      lastKind = 'ones';
    } else if (w === 'hundred') {
      cur = (cur === null || cur === 0 ? 1 : cur) * 100;
      lastKind = 'hundred';
    } else if (w === 'a' && next === 'hundred') {
      flush();
      cur = 1;
      lastKind = 'ones';
    } else if (w === 'and' && lastKind === 'hundred' && next !== undefined && (next in ONES || next in TENS)) {
      // "a hundred and two"
    } else {
      flush();
      out.push(w);
    }
  }
  flush();
  return out.join(' ');
}

/**
 * Replace spelled-out numbers with digits: "ninety-five" → 95, "a hundred and
 * two point five" → 102.5, "97 and a half" → 97.5, "sets three and four" →
 * "sets 3 and 4". Words that aren't numbers are left alone.
 */
export function digitiseNumbers(text: string): string {
  return text
    .replace(/\b(sets?)\s+one\b/gi, '$1 1')
    // A lone "one" is usually a pronoun ("the last one"), not a number.
    .replace(NUMBER_RUN, (run) => (run.toLowerCase() === 'one' ? run : parseRun(run)))
    .replace(/(\d+)\s+point\s+(\d+)/gi, '$1.$2')
    .replace(/(\d+)\s+and\s+a\s+half\b/gi, (_m, n: string) => String(Number(n) + 0.5))
    .replace(/(\d+)\s+and\s+a\s+quarter\b/gi, (_m, n: string) => String(Number(n) + 0.25))
    .replace(/(\d+)\s+and\s+three\s+quarters\b/gi, (_m, n: string) => String(Number(n) + 0.75));
}

const CONTRACTIONS: [RegExp, string][] = [
  [/\bi'm\b/g, 'i am'],
  [/\bi've\b/g, 'i have'],
  [/\bwe've\b/g, 'we have'],
  [/\bi'll\b/g, 'i will'],
  [/\bwe'll\b/g, 'we will'],
  [/\bi'd\b/g, 'i would'],
  [/\bwe'd\b/g, 'we would'],
  [/\byou'd\b/g, 'you would'],
  [/\byou've\b/g, 'you have'],
  [/\byou'll\b/g, 'you will'],
  [/\byou're\b/g, 'you are'],
  [/\bwe're\b/g, 'we are'],
  [/\bthey're\b/g, 'they are'],
  [/\bthey've\b/g, 'they have'],
  [/\b(it|that|this|everything|everything's|what|there|set \d+|weight|load)'s been\b/g, '$1 has been'],
  [/\b(\w+)'s been\b/g, '$1 has been'],
  [/\b([a-z0-9]+)'s (now|done|sorted|set|all set|lower|lighter|heavier|updated|changed|in|locked|flagged|saved|gone|down|up)\b/g, '$1 is $2'],
  [/\bit's\b/g, 'it is'],
  [/\bthat's\b/g, 'that is'],
  [/\bthere's\b/g, 'there is'],
  [/\bwhat's\b/g, 'what is'],
  [/\blet's\b/g, 'let us'],
  [/\b(\w+)'ve\b/g, '$1 have'],
  [/\b(\w+)'ll\b/g, '$1 will'],
];

/**
 * Lower-case, straight quotes, plain spaces, `x`/`×` spaced, contractions
 * expanded, numbers in digits, and set lists made one token-friendly form
 * (`sets 3 and 4` → `sets 3_4`, `sets 2, 4` → `sets 2_4`).
 */
export function normaliseForClaims(sentence: string): string {
  let s = sentence
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[–—]/g, (m) => (m === '–' ? '-' : ' - '))
    .replace(/…/g, '...');
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  s = digitiseNumbers(s);
  s = s
    .replace(/(\d)\s*[x×]\s*(\d)/g, '$1 x $2')
    .replace(/×/g, ' x ')
    .replace(/(\d)\s*(kgs?|kilos?|kilograms?|lbs?|pounds?)\b/g, '$1 $2');
  s = s.replace(/\b(?:went|gone|go|going) (?:ahead )?and\b/g, ' ');
  // Set lists: "sets 3 and 4", "sets 3 & 4", "sets 3 to 4", "sets 3, 4 and 5" → "sets 3_4" / "sets 3_4_5".
  s = s.replace(/\bsets? (\d+)((?:\s*(?:,|and|&|or|-|to|through)\s*\d+(?:\.\d+)?)*)(\s*(?:kgs?|kilos?|kilograms?|lbs?|pounds?|x|%|percent)\b)?/g, (m: string, first: string, tail: string, unit: string | undefined): string => {
    const nums = [Number(first)];
    const steps = [...tail.matchAll(/\s*(,|and|&|or|-|to|through)\s*(\d+(?:\.\d+)?)/g)];
    let used = 0;
    for (const [k, step] of steps.entries()) {
      const sep = step[1] ?? '';
      const n = Number(step[2]);
      const prev = nums[nums.length - 1] ?? 0;
      const isLast = k === steps.length - 1;
      // "sets 3-4 to 95 kg": a number after "to" that's followed by a unit, or is far larger, is a value, not a set.
      if (!Number.isInteger(n) || n > 30 || n <= 0 || (isLast && unit !== undefined)) break;
      if (sep === '-' || sep === 'to' || sep === 'through') {
        if (n <= prev) break;
        for (let x = prev + 1; x <= n; x += 1) nums.push(x);
      } else {
        nums.push(n);
      }
      used += step[0].length;
    }
    const rest = tail.slice(used);
    // `_` joins the list so clause splitting on commas can't break it.
    return `${m.startsWith('sets') ? 'sets' : 'set'} ${nums.join('_')}${rest}${unit ?? ''}`;
  });
  return s.replace(/\s+/g, ' ').trim();
}
