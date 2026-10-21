/**
 * The Swap / Add sheet's sections (workout-builder-v3 §2.5), shared by the
 * builder and the active workout (workout-table-v3 §7): the exercises of one
 * muscle group this gym has, by focus, each with its works line. No est. max.
 */
export interface ChoiceSection {
  focus: string;
  items: { exerciseId: string; name: string; works: string | null; mayHurt: boolean }[];
}
