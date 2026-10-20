/**
 * Kinds where an `added` load is plates on the machine, not weight added to
 * the body: a plate-loaded machine, and a Smith machine (ADR 0030: logged as
 * plates added, its bar's starting weight shown beside the load, never in it).
 */
export function isPlatesAddedKind(kind: string | null | undefined): boolean {
  return kind === 'plate_loaded_machine' || kind === 'smith_machine';
}
