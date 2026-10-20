import type { BenchType, EquipmentInstance, RackType } from '@fizz/schemas';
import { catalogueExerciseId } from './catalogue-id';

/**
 * Benches and racks (Ben, 20 Oct; ADR 0030): presence-only gym items that an
 * exercise may need besides its load equipment (a bench press needs a bench
 * and a rack). Coaching knowledge: the catalogue's `requiresStation`, limited
 * to the stations a gym profile records. Keyed by catalogue key and looked up
 * by exercise ID (`UUIDv5(key)`), so a catalogue row saved before this change
 * still gets its needs. `packages/catalogue/test/stations.test.ts` keeps this
 * table equal to the catalogue.
 *
 * A station only stops an exercise at a gym that *knows* about that kind:
 * the gym has a bench (or rack) record, available or not. A quick setup
 * writes an unticked bench or rack as a retired, assumed record, so "no bench
 * here" is known; gyms set up before this change have no record and nothing
 * is stopped (as before). Bodyweight exercises are never stopped (a chair or
 * a box does).
 */

export type GymStation = 'bench' | 'incline_bench' | 'rack';

export const CATALOGUE_STATIONS: Readonly<Record<string, readonly GymStation[]>> = {
  'barbell-back-squat': ['rack'],
  'barbell-bench-press': ['bench', 'rack'],
  'barbell-box-squat': ['rack'],
  'barbell-bulgarian-split-squat': ['bench', 'rack'],
  'barbell-close-grip-bench-press': ['bench', 'rack'],
  'barbell-front-squat': ['rack'],
  'barbell-good-morning': ['rack'],
  'barbell-hip-thrust': ['bench'],
  'barbell-incline-bench-press': ['incline_bench', 'rack'],
  'barbell-overhead-press': ['rack'],
  'barbell-paused-back-squat': ['rack'],
  'barbell-paused-bench-press': ['bench', 'rack'],
  'barbell-push-press': ['rack'],
  'barbell-seal-row': ['bench'],
  'barbell-seated-overhead-press': ['incline_bench', 'rack'],
  'barbell-standing-calf-raise': ['rack'],
  'bodyweight-bulgarian-split-squat': ['bench'],
  'bodyweight-copenhagen-plank': ['bench'],
  'bodyweight-inverted-row': ['rack'],
  'dumbbell-bench-press': ['bench'],
  'dumbbell-bulgarian-split-squat': ['bench'],
  'dumbbell-chest-supported-row': ['incline_bench'],
  'dumbbell-concentration-curl': ['bench'],
  'dumbbell-fly': ['bench'],
  'dumbbell-incline-bench-press': ['incline_bench'],
  'dumbbell-incline-curl': ['incline_bench'],
  'dumbbell-one-arm-row': ['bench'],
  'dumbbell-pullover': ['bench'],
  'dumbbell-seated-shoulder-press': ['incline_bench'],
  'dumbbell-step-up': ['bench'],
  'dumbbell-three-point-row': ['bench'],
  'ez-bar-skull-crusher': ['bench'],
  'smith-machine-bench-press': ['bench'],
  'smith-machine-bulgarian-split-squat': ['bench'],
};

let byId: Map<string, readonly GymStation[]> | null = null;

/** The stations an exercise needs (none for custom exercises and anything unlisted). */
export function stationsNeeded(exerciseId: string | undefined): readonly GymStation[] {
  if (exerciseId === undefined) return [];
  byId ??= new Map(Object.entries(CATALOGUE_STATIONS).map(([key, s]) => [catalogueExerciseId(key), s]));
  return byId.get(exerciseId) ?? [];
}

type StationItem = Pick<EquipmentInstance, 'kind' | 'availability'> & { benchType?: BenchType; rackType?: RackType };

const kindOf = (s: GymStation): 'bench' | 'rack' => (s === 'rack' ? 'rack' : 'bench');

/** An available item that serves the station: any rack; a flat or adjustable bench; an incline or adjustable bench. */
export function servesStation(item: StationItem, station: GymStation): boolean {
  if (item.availability !== 'available' || item.kind !== kindOf(station)) return false;
  if (station === 'rack') return true;
  const type = item.benchType ?? 'adjustable';
  return station === 'bench' ? type !== 'incline' : type !== 'flat';
}

/**
 * The stations the exercise needs that this gym is known not to have: it has
 * a record of that kind (any availability) and no available one serves it.
 */
export function missingStations(exerciseId: string | undefined, equipment: readonly Pick<EquipmentInstance, 'kind' | 'availability'>[]): GymStation[] {
  const needs = stationsNeeded(exerciseId);
  if (needs.length === 0) return [];
  const items = equipment as readonly StationItem[];
  return needs.filter((s) => items.some((e) => e.kind === kindOf(s)) && !items.some((e) => servesStation(e, s)));
}

export const STATION_WORD: Readonly<Record<GymStation, string>> = { bench: 'bench', incline_bench: 'incline bench', rack: 'rack' };
