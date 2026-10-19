import { normaliseSearchText } from '@fizz/domain';
import type { SupersetPartner } from '@fizz/domain';

/**
 * The picker opened from `Superset with…` (Ben, 19 Oct). Pure: the title, the exercises already in
 * the workout it can pair with (filtered by the search), and the toast after a pick. Any exercise
 * from the list below is added as the partner, the same exercise included (a second copy).
 */
export interface SupersetPickerView {
  title: string;
  partners: SupersetPartner[];
}

export function supersetPickerView(choices: { name: string; partners: readonly SupersetPartner[] } | null, query: string): SupersetPickerView | null {
  if (choices === null) return null;
  const q = normaliseSearchText(query);
  return {
    title: `Superset with ${choices.name}`,
    partners: q === '' ? [...choices.partners] : choices.partners.filter((p) => normaliseSearchText(p.exerciseName).includes(q)),
  };
}
