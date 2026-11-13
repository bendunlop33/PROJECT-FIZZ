import type { BuilderEditOp as BuilderManualOp } from '@fizz/domain';
import type { BuilderEditOpKind, CoachToolName, EditTodayOp, SessionCommandType } from '@fizz/schemas';

/**
 * (Ben, 8 Nov: "the coach can do in today's workout anything I can do by hand") The inventory of Ben's manual actions
 * on today's workout, live (the workout's own commands, `SessionCommand`) and before Start (Your workout's edits,
 * the builder's `applyBuilderEdit` ops and its Set up calls), each mapped to the coach op that does the same, or
 * marked as not a coach action with the reason. The records are typed against the command and op unions, so a new
 * manual action fails the typecheck (and `parity.test.ts`) until it is classified here.
 *
 * `not_coach`: lifecycle, timers, navigation and Undo taps (Ben's own), his own reports (feel, check-in), and the
 * coach's own machinery. `gap`: a manual action the coach can't do yet, named so it is never silently missing.
 */

export type ParityEntry =
  | { kind: 'coach'; tool: CoachToolName; ops?: readonly string[]; partial?: string }
  | { kind: 'not_coach'; reason: string }
  | { kind: 'gap'; reason: string };

type EditOp = EditTodayOp['op'];
const today = (...ops: EditOp[]): ParityEntry => ({ kind: 'coach', tool: 'edit_today', ops });
const tool = (t: CoachToolName): ParityEntry => ({ kind: 'coach', tool: t });
const no = (reason: string): ParityEntry => ({ kind: 'not_coach', reason });

/** The live workout: every session command. */
export const LIVE_MANUAL_ACTIONS: Readonly<Record<SessionCommandType, ParityEntry>> = {
  log_set: tool('log_set'),
  correct_set: tool('correct_set'),
  undo_log: no('Undo tap on his own logged set'),
  save_draft: no('the set pager keeping what he is typing'),
  set_active_set: no('navigation: which set is on screen'),
  adjust_rest: no('the running rest timer (+/− on the clock)'),
  skip_rest: no('the running rest timer'),
  start_work_interval: no('the work timer'),
  stop_work_interval: no('the work timer'),
  pause: no('the workout clock'),
  resume: no('the workout clock'),
  tick: no('time passing'),
  finish: no('Finish is his'),
  discard: no('Discard is his'),
  update_session_timing: no('the record of when he trained, corrected on the Summary'),
  confirm_session_duration: no('his confirmation of the time'),
  set_feel: no('his own report (rule 6)'),
  set_session_check_in: no('his own report; pain words go to set_pain_flag'),
  tick_all_planned: no('past logs only, never a live workout'),
  add_set: today('set_count', 'sets', 'set_details'),
  add_exercise: today('add'),
  delete_set: today('set_details'),
  skip_exercise: today('remove'),
  remove_exercise: today('remove'),
  swap_exercise: today('swap'),
  move_exercise: today('move'),
  reorder_sets: today('set_details'),
  link_superset: today('superset'),
  split_superset: today('split_superset'),
  set_main_lift: today('main'),
  add_warmup: today('warmups'),
  edit_planned_set: today('set', 'sets', 'set_details'),
  set_target_rpe: today('set', 'sets'),
  adjust_pending_targets: today('set', 'sets', 'set_count'),
  set_rest_after: today('set_details'),
  set_note: today('set_details'),
  set_load_mode: today('set_details'),
  rename_session: tool('rename_workout'),
  fit_today_to_time: { kind: 'coach', tool: 'edit_today', ops: ['set_count', 'remove', 'set_details', 'set'], partial: 'the coach fits by its own ops (fewer sets, shorter rest), not the +N min card' },
  set_finish_by: { kind: 'gap', reason: '`Finish by` is a clock line for the time-left view; no coach op sets it yet' },
  change_gym: { kind: 'gap', reason: 'switching gym re-fits every row to the other gym (its own propose/apply card); the coach can update a gym (update_gym) but not switch today’s' },
  undo_change_gym: no('Undo tap'),
  undo_op: no('Undo tap'),
  revert_target_adjustment: no('Undo tap on a coach change'),
  revert_coach_edit: no('Undo tap on a coach change'),
  coach_edit_today: no('the coach’s own edit'),
  replan_built_in_targets: no('code’s own replan after an order change (SF6)'),
};

/** Your workout before Start: the builder's own edit ops (`applyBuilderEdit`). */
export type BuilderManualKind = BuilderManualOp['kind'];

const draft = (ops: BuilderEditOpKind[], partial?: string): ParityEntry => ({ kind: 'coach', tool: 'propose_workout_edit', ops, ...(partial === undefined ? {} : { partial }) });

export const BUILDER_MANUAL_ACTIONS: Readonly<Record<BuilderManualKind, ParityEntry>> = {
  delete_exercise: draft(['remove']),
  swap: draft(['swap']),
  add_exercise: draft(['add']),
  move: draft(['move']),
  drop: draft(['move', 'superset']),
  superset_next: draft(['superset']),
  unlink: draft(['unlink']),
  add_set: draft(['sets']),
  delete_set: draft(['sets'], 'by count, from the end'),
  add_warmup: draft(['warmups']),
  add_drop: draft(['drop_set']),
  set_type: draft(['drop_set', 'warmups'], 'a drop set or a warm-up; a top or back-off set by type is not yet a coach op'),
  edit_row: draft(['reps', 'rpe', 'load'], 'every working set of the exercise, not one set'),
  rest: draft(['rest'], 'the working sets’ rest'),
  make_main: draft(['main']),
};

/** Your workout's Set up and length (the builder service's own calls). */
export const BUILDER_SETUP_ACTIONS: Readonly<Record<'setTime' | 'changeSetup' | 'changeGym' | 'mixItUp', ParityEntry>> = {
  setTime: draft(['minutes']),
  changeSetup: tool('fill_setup'),
  changeGym: { kind: 'gap', reason: 'Set up’s gym: fill_setup takes a day, length, main lift and groups, not a gym' },
  mixItUp: no('code’s own reshuffle button'),
};
