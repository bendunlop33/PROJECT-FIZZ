/**
 * Test-only entry point (`@fizz/domain/testing`): the shared repository
 * contract and fixtures, so other packages' tests (e.g. the SQLite adapter)
 * run the same suite as the in-memory implementation. Never import from app code.
 */
export * from './fixtures';
export * from './session-fixture';
export * from './repository-contract';
