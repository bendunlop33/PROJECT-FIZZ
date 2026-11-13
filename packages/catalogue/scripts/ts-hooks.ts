/**
 * Lets Node run the catalogue's TypeScript directly (native type stripping,
 * Node >= 22.18) without a bundler: resolves extensionless relative imports
 * to `.ts` / `/index.ts` (the style Metro and tsc use in `packages/*`) and
 * loads `.json` imports without an import attribute. Dev tooling only.
 *
 * Usage: node --import ./packages/catalogue/scripts/ts-hooks.ts <script.ts>
 */
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw error;
      for (const suffix of ['.ts', '/index.ts']) {
        try {
          return nextResolve(specifier + suffix, context);
        } catch {
          // try the next suffix
        }
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.json')) {
      const source = readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', source: `export default ${source};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
