/**
 * Schema version 38: Apple Health (Ben, 27 Oct; ADR 0035, docs/design/apple-health.md). Frozen once released.
 *
 * Your data (rule 10), owner-scoped:
 * - `health_writes`: per app workout, the Health workout written for it (UUID, sync version, what was written,
 *   op IDs). Backed up: after a restore the app still knows what it wrote, so nothing is written twice.
 *   `session_revision`: the workout's revision when last checked (a cheap "changed since" test).
 * - `health_links`: a Health activity linked to an app workout, or unlinked / `Not it` (never auto-linked again).
 *   Versioned, idempotent on op IDs, backed up. One linked activity per workout (partial unique index).
 * Local to this install (`LOCAL_ONLY_TABLES`: not in backups or exports, removed by Delete my data):
 * - `health_samples`: workouts and bodyweights read from Health. Health is their source; they are read again.
 * - `health_settings`: the switches. iOS permission is per install, so they don't travel in a backup.
 */
export const MIGRATION_0038 = `
CREATE TABLE health_writes (
  session_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('written', 'deleted', 'removed')),
  health_uuid TEXT NOT NULL,
  session_revision INTEGER NOT NULL CHECK (session_revision >= 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX health_writes_owner ON health_writes (owner_id, status);

CREATE TABLE health_links (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  health_uuid TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('linked', 'unlinked')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE UNIQUE INDEX health_links_uuid ON health_links (owner_id, health_uuid);
CREATE UNIQUE INDEX health_links_one_per_workout ON health_links (owner_id, session_id) WHERE status = 'linked';

CREATE TABLE health_samples (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('workout', 'weight')),
  start_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX health_samples_owner_kind ON health_samples (owner_id, kind, start_utc);

CREATE TABLE health_settings (
  owner_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
`;
