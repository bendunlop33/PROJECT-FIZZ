import { join } from 'node:path';
import { describeRepositoryContract } from '@fizz/domain/testing';
import { openStore } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

describeRepositoryContract('SQLite (node:sqlite, in memory)', async () => {
  const store = await openStore(memoryDriver());
  return { repos: store.repos, close: () => store.close() };
});

describeRepositoryContract('SQLite (node:sqlite, WAL file)', async () => {
  const { dir, cleanup } = tempDir();
  const store = await openStore(openNodeDriver(join(dir, 'contract.db')));
  return {
    repos: store.repos,
    close: async () => {
      await store.close();
      cleanup();
    },
  };
});
