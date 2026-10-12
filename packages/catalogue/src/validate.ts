/**
 * Whole-catalogue validation (`npm run catalogue:validate`). Pure: the script
 * reads the files and passes their parsed JSON here.
 *
 * Errors fail the build: schema failures, a key that doesn't match its file
 * name, duplicate keys. Warnings are printed but don't fail: dangling
 * variation keys (entries not written yet), a load convention unusual for the
 * equipment, an alias shared with another entry. Notes are informational
 * (none are raised at present).
 */
import type { ExerciseEquipmentKind } from '@fizz/schemas';
import { CatalogueEntrySchema, type CatalogueEntry } from './entry-schema';
import { USUAL_CONVENTIONS } from './vocab';

export interface CatalogueFile {
  /** File name only, e.g. `barbell-back-squat.json`. */
  fileName: string;
  data: unknown;
}

export interface CatalogueIssue {
  file: string;
  path: string;
  message: string;
}

export interface CatalogueReport {
  entries: CatalogueEntry[];
  errors: CatalogueIssue[];
  warnings: CatalogueIssue[];
  notes: CatalogueIssue[];
}

const usual: Record<ExerciseEquipmentKind, readonly string[]> = USUAL_CONVENTIONS;

export function validateCatalogueFiles(files: readonly CatalogueFile[]): CatalogueReport {
  const report: CatalogueReport = { entries: [], errors: [], warnings: [], notes: [] };
  const fileOfKey = new Map<string, string>();

  for (const file of files) {
    const parsed = CatalogueEntrySchema.safeParse(file.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        report.errors.push({ file: file.fileName, path: issue.path.map(String).join('.'), message: issue.message });
      }
      continue;
    }
    const entry = parsed.data;
    if (file.fileName !== `${entry.key}.json`) {
      report.errors.push({ file: file.fileName, path: 'key', message: `Key ${entry.key} doesn't match the file name` });
      continue;
    }
    const prior = fileOfKey.get(entry.key);
    if (prior !== undefined) {
      report.errors.push({ file: file.fileName, path: 'key', message: `Duplicate key, also in ${prior}` });
      continue;
    }
    fileOfKey.set(entry.key, file.fileName);
    report.entries.push(entry);
  }

  const keys = new Set(report.entries.map((e) => e.key));
  const nameOwner = new Map<string, string>();
  for (const e of report.entries) {
    for (const n of [e.name, ...e.aliases]) {
      const k = n.toLowerCase();
      const owner = nameOwner.get(k);
      if (owner !== undefined && owner !== e.key) {
        report.warnings.push({ file: `${e.key}.json`, path: 'aliases', message: `"${n}" is also a name or alias of ${owner}` });
      } else {
        nameOwner.set(k, e.key);
      }
    }
  }

  for (const e of report.entries) {
    const file = `${e.key}.json`;
    if (e.tier === 'rich' && e.variations !== undefined) {
      for (const group of ['regressions', 'progressions', 'substitutions'] as const) {
        e.variations[group].forEach((v, i) => {
          if (v.key === e.key) {
            report.errors.push({ file, path: `variations.${group}.${i}.key`, message: 'An entry lists itself as a variation' });
          } else if (v.key !== null && !keys.has(v.key)) {
            report.warnings.push({ file, path: `variations.${group}.${i}.key`, message: `Dangling key ${v.key} (no entry yet)` });
          }
        });
      }
    }
    if (!e.compatibleEquipment.some((kind) => usual[kind].includes(e.defaultLoadConvention))) {
      report.warnings.push({
        file,
        path: 'defaultLoadConvention',
        message: `${e.defaultLoadConvention} is unusual for ${e.compatibleEquipment.join(', ')}`,
      });
    }
  }
  return report;
}
