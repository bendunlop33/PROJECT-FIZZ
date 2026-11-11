import { z } from 'zod';

/**
 * (Ben, 11 Nov) `Paste` in Log a past workout: the coach's optional answer for a workout note. One forced
 * `submit_note_matches` call; its arguments can only name exercises and propose sets, nothing else (rule 8).
 * Code checks every ID against the list it sent and never lets a proposed set replace one it read itself.
 */

/** `exercise`: an ID from the list sent, or `own:<name>` for an exercise Ben would add himself; null: no idea. */
export const NoteMatchMappingSchema = z.object({
  name: z.string().min(1).max(120),
  exercise: z.string().min(1).max(160).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type NoteMatchMapping = z.infer<typeof NoteMatchMappingSchema>;

/** A set the coach read from a line the app couldn't (`line` must be one of the unread lines sent, as sent). */
export const NoteProposedSetSchema = z.object({
  name: z.string().min(1).max(120),
  line: z.string().min(1).max(200),
  load: z.number().min(0).max(1000).nullable(),
  bodyweight: z.boolean(),
  unit: z.enum(['kg', 'lb']),
  reps: z.int().min(1).max(100),
  sets: z.int().min(1).max(20),
  perHand: z.boolean(),
});
export type NoteProposedSet = z.infer<typeof NoteProposedSetSchema>;

export const NoteMatchAnswerSchema = z.object({
  mappings: z.array(NoteMatchMappingSchema).max(40),
  sets: z.array(NoteProposedSetSchema).max(60),
});
export type NoteMatchAnswer = z.infer<typeof NoteMatchAnswerSchema>;
