/**
 * `npm run catalogue:validate`: validate every `data/exercises/*.json` entry.
 * Exit 1 on any error; warnings (e.g. dangling variation keys) don't fail.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCatalogueFiles, type CatalogueFile, type CatalogueIssue } from '../src/validate.ts';
import { EXERCISES_DIR, exerciseFileNames, INDEX_FILE, indexSource, readJson } from './lib/paths.ts';

const names = exerciseFileNames();
const files: CatalogueFile[] = [];
const parseErrors: CatalogueIssue[] = [];
for (const fileName of names) {
  const read = readJson(join(EXERCISES_DIR, fileName));
  if (read.ok) files.push({ fileName, data: read.data });
  else parseErrors.push({ file: fileName, path: '', message: `Invalid JSON: ${read.message}` });
}

const report = validateCatalogueFiles(files);
const errors = [...parseErrors, ...report.errors];
const expectedIndex = indexSource(names);
if (!existsSync(INDEX_FILE) || readFileSync(INDEX_FILE, 'utf8') !== expectedIndex) {
  errors.push({ file: 'src/generated/exercise-files.ts', path: '', message: 'Stale; run `npm run catalogue:index`' });
}

const show = (label: string, list: readonly CatalogueIssue[]): void => {
  for (const i of list) console.log(`${label} ${i.file}${i.path ? ` ${i.path}` : ''}: ${i.message}`);
};
// Dangling variation keys are expected while the basic catalogue is being
// written, so print one line per missing key rather than one per reference.
const dangling = new Map<string, Set<string>>();
const otherWarnings: CatalogueIssue[] = [];
for (const w of report.warnings) {
  const m = /^Dangling key (\S+)/.exec(w.message);
  if (m?.[1] === undefined) otherWarnings.push(w);
  else dangling.set(m[1], (dangling.get(m[1]) ?? new Set()).add(w.file.replace(/\.json$/, '')));
}
show('error  ', errors);
show('warning', otherWarnings);
for (const [key, from] of [...dangling].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`warning dangling variation key ${key} (from ${[...from].join(', ')})`);
}
show('note   ', report.notes);

const rich = report.entries.filter((e) => e.tier === 'rich').length;
console.log(
  `\n${names.length} files, ${report.entries.length} valid (${rich} rich, ${report.entries.length - rich} basic); ` +
    `${errors.length} errors, ${report.warnings.length} warnings, ${report.notes.length} notes.`,
);
process.exitCode = errors.length > 0 ? 1 : 0;
