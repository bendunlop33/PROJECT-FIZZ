/**
 * Schema version 45 (Ben, 2 Nov: "yes if i ask for it … the warm-up could be any cardio exercise"). Frozen once released.
 *
 * - `session_exercises.warmup`: the row is a cardio or timed warm-up Ben asked the coach for (the plan day's
 *   `RoutineExercise.warmup`, carried at Start): its meta reads `Warm-up` in the workout and in history. NULL = not
 *   marked (every row before this migration). Its sets stay working sets; nothing else reads it.
 */
export const MIGRATION_0045 = `
ALTER TABLE session_exercises ADD COLUMN warmup INTEGER CHECK (warmup IS NULL OR warmup = 1);
`;
