/**
 * The animated guides shipped with the app (ADR 0013). Each `guide.json` is
 * validated when it is first asked for, not at launch, and a bad one is
 * reported as `invalid` instead of crashing: the how-to screen then shows the
 * text cues only. Guides are Coaching knowledge (CLAUDE.md rule 10).
 */
import type { Camera } from './figure/draw';
import { GuideSchema, type Guide } from './figure/guide-schema';
import { prepareGuide, type PreparedGuide } from './figure/pose';
import { fitCamera } from './figure/svg';
import { BUNDLED_GUIDE_FILES, type BundledGuideFile } from './generated/guide-files';

export interface LoadedGuide {
  key: string;
  guide: Guide;
  prepared: PreparedGuide;
  camera: Camera;
}

export type GuideLoad = { ok: true; value: LoadedGuide } | { ok: false; reason: 'missing' } | { ok: false; reason: 'invalid'; message: string };

export interface GuideLibrary {
  /** Keys with a bundled guide file (not yet validated). */
  readonly keys: ReadonlySet<string>;
  /** Validated and prepared on first use, then memoised. */
  load(key: string): GuideLoad;
}

export function createGuideLibrary(files: readonly BundledGuideFile[]): GuideLibrary {
  const byKey = new Map<string, BundledGuideFile>();
  for (const f of files) if (!byKey.has(f.key)) byKey.set(f.key, f);
  const memo = new Map<string, GuideLoad>();
  return {
    keys: new Set(byKey.keys()),
    load(key) {
      const hit = memo.get(key);
      if (hit) return hit;
      const file = byKey.get(key);
      let result: GuideLoad;
      if (file === undefined) {
        result = { ok: false, reason: 'missing' };
      } else {
        const parsed = GuideSchema.safeParse(file.raw);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          result = { ok: false, reason: 'invalid', message: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid guide' };
        } else if (parsed.data.exerciseKey !== key) {
          result = { ok: false, reason: 'invalid', message: `Guide is for ${parsed.data.exerciseKey}, not ${key}` };
        } else {
          const prepared = prepareGuide(parsed.data);
          // The generated camera is fitted at build time; fit here only if it is missing.
          result = { ok: true, value: { key, guide: parsed.data, prepared, camera: file.camera ?? fitCamera(prepared) } };
        }
      }
      memo.set(key, result);
      return result;
    },
  };
}

let bundled: GuideLibrary | undefined;

/** The guides shipped with the app (memoised). */
export function bundledGuides(): GuideLibrary {
  bundled ??= createGuideLibrary(BUNDLED_GUIDE_FILES);
  return bundled;
}
