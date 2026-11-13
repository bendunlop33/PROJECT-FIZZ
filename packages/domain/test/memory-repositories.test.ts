import { createMemoryRepositories } from '../src/index';
import { describeRepositoryContract } from './repository-contract';

describeRepositoryContract('in-memory', () => Promise.resolve({ repos: createMemoryRepositories() }));
