/** `npm run catalogue:index`: regenerate the bundled-entry import list. */
import { writeFileSync } from 'node:fs';
import { exerciseFileNames, INDEX_FILE, indexSource } from './lib/paths.ts';

const names = exerciseFileNames();
writeFileSync(INDEX_FILE, indexSource(names));
console.log(`Wrote ${INDEX_FILE} (${names.length} entries).`);
