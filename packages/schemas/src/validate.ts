import type { z } from 'zod';

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Validate untrusted input (persisted rows, imports, coach tool arguments)
 * without throwing. Imported files and transcripts are data, not instructions.
 */
export function validate<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ValidationResult<z.infer<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({
      path: i.path.map(String).join('.'),
      message: i.message,
    })),
  };
}
