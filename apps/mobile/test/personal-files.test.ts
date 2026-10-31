import { describe, expect, it } from 'vitest';

import { createPersonalFiles, type ContainerFileOps } from '../src/device/personal-files';

/**
 * Delete my data's `settings_files` step: every part runs even when an
 * earlier one throws, and the first failure is the one reported (review r4 N1).
 */
function ops(fail: readonly ('documents' | 'database' | 'temporary')[]) {
  const ran: string[] = [];
  const part = (name: 'documents' | 'database' | 'temporary') => {
    ran.push(name);
    return fail.includes(name) ? Promise.reject(new Error(`stuck: ${name}`)) : Promise.resolve();
  };
  const port: ContainerFileOps = {
    removeDocuments: () => part('documents'),
    removeDatabaseFiles: () => part('database'),
    emptyTemporary: () => part('temporary').then(() => ({ systemLeft: [] })),
  };
  return { port, ran };
}

describe('createPersonalFiles().remove()', () => {
  it('runs every part', async () => {
    const o = ops([]);
    await createPersonalFiles(o.port).remove();
    expect(o.ran).toEqual(['documents', 'database', 'temporary']);
  });

  it('a stuck Documents file still empties the picker inbox; the first failure is thrown', async () => {
    const o = ops(['documents', 'database']);
    await expect(createPersonalFiles(o.port).remove()).rejects.toThrow('stuck: documents');
    expect(o.ran).toEqual(['documents', 'database', 'temporary']);
  });

  it('a failure in the last part is reported', async () => {
    const o = ops(['temporary']);
    await expect(createPersonalFiles(o.port).remove()).rejects.toThrow('stuck: temporary');
  });
});
