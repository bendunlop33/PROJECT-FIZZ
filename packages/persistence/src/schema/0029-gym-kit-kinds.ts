/**
 * Schema version 29 (written on branch `claude/ben-kit-20oct`; renumber on
 * merge if another branch took 29 first): new gym equipment kinds (Ben,
 * 20 Oct; ADR 0030). Frozen once released.
 *
 * - `equipment.kind` gains `kettlebell`, `ez_bar`, `trap_bar`,
 *   `smith_machine`, `bench` and `rack`. SQLite can't alter a CHECK, so the
 *   table is rebuilt with the same columns, rows and index. Every row is kept
 *   as it is: the new kinds' fields live inside the validated JSON document.
 */
export const MIGRATION_0029 = `
CREATE TABLE equipment_v29 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  gym_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('barbell', 'plate_loaded_machine', 'dumbbells', 'weight_stack', 'assisted_stack', 'bodyweight_station', 'kettlebell', 'ez_bar', 'trap_bar', 'smith_machine', 'bench', 'rack')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
INSERT INTO equipment_v29 (id, owner_id, gym_id, kind, version, updated_at_utc, data)
  SELECT id, owner_id, gym_id, kind, version, updated_at_utc, data FROM equipment;
DROP TABLE equipment;
ALTER TABLE equipment_v29 RENAME TO equipment;
CREATE INDEX equipment_gym ON equipment (gym_id);
`;
