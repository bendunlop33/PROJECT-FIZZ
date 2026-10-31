/**
 * Effort ratings written in set comments (data-import-export §2.5 step 3c):
 * `@8`, `@ 8.5`, `RPE 9`, `rpe:7`. Pure. Only a candidate: nothing is set
 * unless Ben ticks the row (default `Keep as notes only`), and the comment
 * is kept either way. A comment with two different ratings isn't a
 * candidate (ambiguous), and neither is a value outside RPE 1–10 in half steps.
 */

const AT = /(?:^|[\s(,;/])@\s?(\d{1,2}(?:\.\d)?)(?![\d.])/gi;
const RPE = /\brpe\s*[:=]?\s*(\d{1,2}(?:\.\d)?)(?![\d.])/gi;

function valid(v: number): boolean {
  return v >= 1 && v <= 10 && Number.isInteger(v * 2);
}

/** The RPE a comment states, or null when it states none, an invalid one or two different ones. */
export function effortFromComment(comment: string): number | null {
  const found = new Set<number>();
  for (const re of [AT, RPE]) {
    for (const m of comment.matchAll(re)) {
      const raw = m[1];
      if (raw === undefined) continue;
      const v = Number(raw);
      if (!valid(v)) return null;
      found.add(v);
    }
  }
  if (found.size !== 1) return null;
  return [...found][0] ?? null;
}
