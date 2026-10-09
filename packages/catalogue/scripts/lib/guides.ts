import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CatalogueEntrySchema, type CatalogueEntry } from '../../src/entry-schema.ts';
import { EXERCISES_DIR, GUIDES_DIR, readJson } from './paths.ts';

export interface GuideFile {
  id: string;
  dir: string;
  path: string;
  raw: unknown;
  bytes: number;
  entry: CatalogueEntry | null;
}

/** Guide folders (`_rig`, `_templates` and other `_` folders are skipped). */
export function guideIds(): string[] {
  if (!existsSync(GUIDES_DIR)) return [];
  return readdirSync(GUIDES_DIR)
    .filter((d) => !d.startsWith('_') && !d.startsWith('.') && existsSync(join(GUIDES_DIR, d, 'guide.json')))
    .sort();
}

export function loadGuideFile(id: string): GuideFile {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Not a guide id: ${id}`);
  const dir = join(GUIDES_DIR, id);
  const path = join(dir, 'guide.json');
  if (!existsSync(path)) throw new Error(`No guide at ${path}`);
  const read = readJson(path);
  if (!read.ok) throw new Error(`${path}: ${read.message}`);
  const entryPath = join(EXERCISES_DIR, `${id}.json`);
  let entry: CatalogueEntry | null = null;
  if (existsSync(entryPath)) {
    const e = readJson(entryPath);
    const parsed = e.ok ? CatalogueEntrySchema.safeParse(e.data) : null;
    entry = parsed?.success === true ? parsed.data : null;
  }
  return { id, dir, path, raw: read.data, bytes: statSync(path).size, entry };
}
