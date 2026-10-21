import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { builderInfoOf, starterExercises, type BuilderContext, type BuilderExerciseInfo, type BuilderGroupName, type BuilderPool } from '../src/index';
import { cable, loadInput } from './builder-v3-fixture';

/**
 * The real bundled catalogue (packages/catalogue/data/exercises) as the
 * builder sees it: `builderInfoOf` on every rep-based entry, keyed by the
 * entry's `key`. `starterFacts`: the starter rows a phone already has
 * (`starterExercises`: primary muscles only) replace their catalogue facts,
 * as on Ben's phone (his Barbell row works lats and upper back only).
 * Pools are alphabetical (the service's order with no history), led by an
 * optional history order. Loads are a plain cable stack (structure only).
 */

type Facts = Parameters<typeof builderInfoOf>[0];

interface Raw {
  key: string;
  name: string;
  movementPattern: string;
  mechanic?: 'compound' | 'isolation';
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  compatibleEquipment: string[];
  measurement: string;
}

const DIR = join(__dirname, '../../catalogue/data/exercises');

const RAW: readonly Raw[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Raw)
  .filter((e) => e.measurement === 'reps');

export interface CatalogueWorld {
  info: (id: string) => BuilderExerciseInfo | null;
  /** Every known exercise ID (catalogue keys). */
  ids: readonly string[];
  pool: (history?: readonly string[]) => BuilderPool;
  ctx: () => BuilderContext;
}

export function catalogueWorld(opts: { starterFacts?: boolean } = {}): CatalogueWorld {
  const infos = new Map<string, BuilderExerciseInfo>();
  for (const e of RAW) {
    const i = builderInfoOf({ ...e, id: e.key } as unknown as Facts);
    if (i !== null) infos.set(e.key, i);
  }
  if (opts.starterFacts === true) {
    for (const s of starterExercises('2026-10-01T00:00:00.000Z')) {
      const key = s.catalogueKey;
      if (key == null) continue;
      const i = builderInfoOf({ ...s, id: key });
      if (i === null) infos.delete(key);
      else infos.set(key, i);
    }
  }
  const info = (id: string) => infos.get(id) ?? null;
  return {
    info,
    ids: [...infos.keys()],
    pool: (history = []) => (g: BuilderGroupName) => {
      const inGroup = [...infos.values()].filter((i) => i.group === g);
      const hist = history.filter((id) => infos.get(id)?.group === g);
      const rest = inGroup
        .filter((i) => !hist.includes(i.exerciseId))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => i.exerciseId);
      return [...hist, ...rest];
    },
    ctx: () => {
      let n = 0;
      return {
        info,
        loads: () => loadInput({ equipment: cable, convention: 'stack', e1rm: 60 }),
        newKey: (id) => {
          n += 1;
          return `${id}#${String(n)}`;
        },
      };
    },
  };
}
