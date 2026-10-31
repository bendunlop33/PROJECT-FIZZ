/** `npm run catalogue:index`: regenerate the bundled-entry and bundled-guide import lists. */
import { writeFileSync } from 'node:fs';
import { guideIds, guideIndexSource } from './lib/guides.ts';
import { exerciseFileNames, GUIDE_INDEX_FILE, INDEX_FILE, indexSource } from './lib/paths.ts';

const names = exerciseFileNames();
writeFileSync(INDEX_FILE, indexSource(names));
console.log(`Wrote ${INDEX_FILE} (${names.length} entries).`);
const ids = guideIds();
writeFileSync(GUIDE_INDEX_FILE, guideIndexSource(ids));
console.log(`Wrote ${GUIDE_INDEX_FILE} (${ids.length} guides).`);
