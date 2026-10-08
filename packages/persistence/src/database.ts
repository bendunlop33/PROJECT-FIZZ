import type { SqlDriver, SqlExecutor } from './driver';

/**
 * One serialised queue in front of a driver (research §2.1). Every repository
 * call goes through it, so a voice turn and a tap can never interleave inside
 * SQLite, and reads never observe another caller's half-finished transaction.
 *
 * - `write` runs `fn` in one exclusive transaction: all of it commits or none.
 * - `read` runs `fn` without a transaction; it is still consistent because no
 *   write can run while it holds the queue.
 *
 * Not re-entrant: inside `fn`, use the executor you were given, never `read`
 * or `write` again (that would wait on itself).
 */
export class Database {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(readonly driver: SqlDriver) {}

  read<T>(fn: (q: SqlExecutor) => Promise<T>): Promise<T> {
    return this.enqueue(() => fn(this.driver));
  }

  write<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.enqueue(() => this.driver.withExclusiveTransaction(fn));
  }

  /** Close after every queued call has finished. Later calls fail loudly. */
  close(): Promise<void> {
    return this.enqueue(async () => {
      this.closed = true;
      await this.driver.close();
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => {
      if (this.closed) throw new Error('Database is closed');
      return fn();
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
