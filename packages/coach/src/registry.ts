import {
  COACH_REPLY_TOOL_NAME,
  COACH_TOOL_ARGS,
  CoachEntityKindSchema,
  ToolEffectSchema,
  type CapabilitySection,
  type CoachEntityKind,
  type CoachToolName,
  type CoachTurnKind,
  type StructuralSignalKind,
  type ToolEffect,
  type ToolNeed,
} from '@fizz/schemas';
import { isStructuralRequest, requestHas, type BenRequest, type BenRequestKind } from './request';

/**
 * The restricted coach tool registry (coach-contract §6, ADR 0020 §2). These
 * are the only tools a coach turn can ever receive; `buildTurnRegistry`
 * narrows them per turn. No tool deletes or overwrites anything (CC6).
 */

export interface ToolDeclaration {
  name: CoachToolName;
  effect: ToolEffect;
  /** Entities a write may touch. Reads write nothing. */
  writes: readonly CoachEntityKind[];
  needs: ToolNeed;
  /** CC10: a lasting change in what Ben trains. Gated on a request or a signal. */
  structural: boolean;
  turnKinds: readonly CoachTurnKind[];
  /** Row text in `What the coach can do` (§2.5). Required for every non-read tool. */
  plainLabel: string | null;
  capabilitySection: CapabilitySection;
  /** Sent to the model as the function description. */
  description: string;
}

const ALL: readonly CoachTurnKind[] = ['general', 'workout', 'summary'];
/**
 * ADR 0039 (Ben, 29 Oct: "broader and more homogenous edit rights"): every chat (Today, Plan, Progress, a
 * workout's sheet, a Summary's thread, the builder's sheet) is a `general` or `workout` turn, and both get the
 * same tools. The entry point decides what the coach sees first, never what it can do. Only the post-workout
 * review (`summary`, an input, not a chat) keeps its closed list.
 */
const CHAT: readonly CoachTurnKind[] = ['general', 'workout'];

export const COACH_TOOLS: readonly ToolDeclaration[] = [
  {
    name: 'get_active_session',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description: "Today's workout: each exercise's sets with target and actual values, set IDs, statuses and the session version.",
  },
  {
    name: 'get_recent_training',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description:
      "One exercise's last workouts (sets as logged, units and conventions explicit, sets Ben left out labelled) and its heaviest logged sets per equipment item. Workouts imported from FitNotes are Ben's own history (equipment not recorded) and a valid basis for loads; the app fits any load to today's equipment.",
  },
  {
    name: 'get_training_overview',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description:
      'Ben’s training over the last weeks: how many workouts, what was done, and per exercise the first and latest top set logged in the app on the same equipment, for trends. Use it for "How am I doing?". For loads, use get_recent_training, which includes FitNotes history. No estimates.',
  },
  {
    name: 'get_gym_equipment',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description:
      'Equipment for an exercise at a gym: unit, load convention, achievable loads, min and max. exerciseId null: the whole gym, with a one-line summary per item. gymName: one of Ben’s saved gyms by name; null for the gym in context.',
  },
  {
    // Coach v3 (ADR 0027): history reads, so the coach can answer from Ben's records instead of guessing.
    name: 'get_exercise_records',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description:
      'One exercise’s records per equipment item, unit and convention: the heaviest logged set, the set with the most reps, and the best estimated 1RM. An estimated 1RM is always an estimate: call it “est.” or “≈”, never a max he lifted.',
  },
  {
    name: 'get_recent_sessions',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description: 'Ben’s last finished workouts (count, newest first): date, title, gym, minutes and every exercise’s sets as logged. FitNotes imports are his own history. For one day’s full log give `date` (YYYY-MM-DD) or `daysAgo` (1 = yesterday); null otherwise.',
  },
  {
    // Coach v3 (Ben 18 Oct): a mid-workout turn starts light; this buys one deeper step when it's needed.
    name: 'think_harder',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    // ADR 0039: offered whenever the turn starts light (`lightTurn`: low effort, his lighter model), whatever the entry.
    turnKinds: CHAT,
    plainLabel: null,
    capabilitySection: 'read',
    description:
      'Once per turn: your next step runs with more reasoning on Ben’s main model. Use it only when the answer needs real thought (a replan, conflicting history, pain with a load question); a quick change or a short answer doesn’t.',
  },
  {
    name: 'get_progression_targets',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description: "The built-in rule's next targets for an exercise and why. A comparison, not advice.",
  },
  {
    name: 'get_substitutions',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description: 'Exercises that could replace one at Ben’s gym (the catalogue’s substitutes and the same movement family), with exercise IDs to use in a swap. Only doable here, never pain-flagged.',
  },
  {
    // (19 Oct, Ben: "Why can't I add it") The lists in YOUR DATA are capped; this reads the whole list.
    name: 'find_exercises',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: CHAT,
    plainLabel: null,
    capabilitySection: 'read',
    description:
      'Search every exercise Ben can do at this gym (his own and the catalogue’s, not pain-flagged), not only the shortened list in YOUR DATA: query by name or other name ("seated calf raise"), optional muscle ("calves") and equipment ("plate loaded"). Returns up to 20 with the IDs to use in propose_workout, propose_plan or edit_today add. Call it whenever Ben names an exercise that is not in build.usable or addable, before saying it is unavailable.',
  },
  {
    // (19 Oct, Ben: "Why can't the chat function make exercises not in the catalogue") A card he checks; rule 3.
    name: 'propose_exercise',
    effect: 'propose',
    writes: ['custom_exercise'],
    needs: 'none',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Suggest a new exercise for your list (added only if you tap Add)',
    capabilitySection: 'suggest_only',
    description:
      'Suggest a new exercise for Ben\'s own list when he wants one that is not in it (find_exercises found nothing like it; never a duplicate under another name). Give its usual name, one equipment kind, loadConvention (null: the equipment\'s usual one; plate-loaded machines are added, dumbbells per_hand, cable or stack machines stack, assisted machines assistance), 1–3 main muscles, how it is measured (reps, duration, distance or cardio) and laterality (unilateral when done one side at a time; null otherwise). Ben sees a card and taps Add or Edit; nothing is added until he does. After he adds it, his next message says so: then use it for what he asked.',
  },
  {
    // (20 Oct, Ben: "update as we go and train the app for each gym"; ADR 0029) Applied with Undo when Ben said it
    // ("this gym has no leg press"); the coach's own idea is a card he applies (rule 3). The executor decides.
    name: 'update_gym',
    effect: 'versioned_update',
    writes: ['gym_equipment'],
    needs: 'ben_request',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Update what a gym has (when you say so, with Undo; otherwise as a suggestion you apply)',
    capabilitySection: 'when_you_ask',
    description:
      "Update one of Ben's gyms when he says what it has or lacks (\"this gym has no leg press\", \"dumbbells go up in 2s here\", \"only up to 30 kg\", \"there's a hack squat\"). Gyms are full gyms by default with assumed equipment, so change only what he told you or what his logged loads show. Changes: `add` / `remove` a gym equipment kind; `dumbbells` with `max` (heaviest, per hand) and/or `step` in the gym's unit; `stack_step` for one machine's stack (exerciseId: that exercise's catalogueId or Ben's exercise ID, when he says one machine steps differently) or, only when he says all of them do, a whole item (itemName from get_gym_equipment, e.g. Cable station or Machines; null = every stack); `not_here` for one exercise the gym can't do (its catalogueId or Ben's exercise ID; use this for a single machine such as a leg press, not `remove`). gymName: one of his saved gyms when he named one, else null (the workout's or his selected gym). benAsked: true only when his message this turn says it, with benQuote his words copied exactly; false when it is your idea, which he sees as a card he can apply. The app checks every number and refuses anything it can't do.",
  },
  {
    name: 'get_recent_actions',
    effect: 'read',
    writes: [],
    needs: 'none',
    structural: false,
    turnKinds: ALL,
    plainLabel: null,
    capabilitySection: 'read',
    description: 'Earlier coach actions with refs you can cite as [[ref]], and whether each still stands.',
  },
  {
    // Coach v3 (ADR 0027, Ben 18 Oct): one tool for today's live workout, in place of `adjust_pending_sets` and
    // `add_exercise_today` (their records and Undo stay for earlier actions). Today only, because Ben asked (rule 3);
    // otherwise the turn saves the call as an offer he accepts. Not CC10's structural kind: the plan he trains from
    // next time stays a proposal (`propose_next_workout_change`; applied, it lands on that workout's Your workout, D8).
    name: 'edit_today',
    effect: 'versioned_update',
    writes: ['pending_set_target', 'session_exercise'],
    needs: 'ben_request',
    structural: false,
    // ADR 0038: from every entry point while the workout is live (Today, Progress and Plan open a general turn).
    turnKinds: CHAT,
    plainLabel: "Change today's workout (exercises, sets and targets), with Undo",
    capabilitySection: 'when_you_ask',
    description:
      "Change today's live workout in one call, any mix of ops: `sets` lays out an exercise's remaining working sets in order, each with its target (load, reps, target RPE): use it to fill in sets and weights (\"build up to 95 kg as the last set\": ramp sets, then his weight last); `set` one pending set's target (null keeps a value); `set_count` an exercise's working sets today (done ones included); `swap` an exercise's remaining sets to another exercise; `add` an exercise (exerciseId from YOUR DATA addable or find_exercises; sets, reps or workSeconds, targetRpe, optional position or superset partner; `load` in his unit when Ben gave a weight, 0 = no weight, else null and the app plans it; a cardio exercise takes workSeconds and, if Ben gave one, distanceMetres; an exercise already in today's workout is added as a second copy, while more sets of the same one is set_count); `remove` an exercise's remaining sets; `move` an exercise (with its superset) after another or first (null); `superset` two exercises already in today's workout; `split_superset` an exercise's superset. Loads are in the exercise's unit and convention (dumbbells per hand). Weights, reps and sets Ben names are used exactly; the app fits your own loads to his equipment. Done sets never change. An op that can't be done is left out and named in the result; the rest applies. baseVersion: the workout's version; after a change, use the sessionVersion it returns; when stale, call once more with the baseVersion it returns. Today only: never for next time, his routine or template. benAsked: true when Ben's message this turn asks for this change (or answers your question about it), with benQuote his asking words; false when it is your own idea, which he sees as an offer he can accept.",
  },
  {
    // (14 Oct, PM decision pending Ben) Offered on every live-workout turn; applies at once with Undo only when
    // Ben asked (rule 3), else the turn turns the call into an offer (`turn.ts`).
    name: 'rename_workout',
    effect: 'versioned_update',
    writes: ['session_name'],
    needs: 'ben_request',
    structural: false,
    turnKinds: CHAT,
    plainLabel: "Rename today's workout, with Undo",
    capabilitySection: 'when_you_ask',
    description: "Rename today's live workout to the name Ben asked for (baseVersion from the workout). Today's workout only: the routine it came from keeps its name. benAsked: true only when Ben's message this turn asks for this change (or answers your question about it), with benQuote his asking words copied exactly; false when it is your own idea, which he sees as an offer.",
  },
  {
    name: 'log_set',
    effect: 'versioned_update',
    writes: ['logged_set'],
    needs: 'ben_request',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Log a set you tell it ("log 100 for 8"), with Undo',
    capabilitySection: 'when_you_ask',
    description:
      'Log the set the Log button would log (the next pending set of the exercise in focus, or of the one exercise Ben names) with the weight, reps and effort Ben just said, in the exercise’s own unit and convention; rpe is RPE (if he gives reps in reserve, rpe = 10 − RIR). Only numbers Ben said are accepted. Starts rest like the Log button.',
  },
  {
    name: 'correct_set',
    effect: 'versioned_update',
    writes: ['logged_set'],
    needs: 'ben_request',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Correct a logged set you name ("set 2 was 95"), with Undo',
    capabilitySection: 'when_you_ask',
    description: 'Correct the weight, reps or effort of a logged set Ben named, with the numbers he said (null keeps a value); rpe is RPE (if he gives reps in reserve, rpe = 10 − RIR). Never marks, deletes or changes set types.',
  },
  {
    name: 'set_next_session_targets',
    effect: 'versioned_update',
    writes: ['next_session_target'],
    needs: 'summary_turn',
    structural: false,
    turnKinds: ['summary'],
    plainLabel: "Small changes to next time's load, reps and sets, shown on the summary with Undo",
    capabilitySection: 'after_workout',
    description: 'Next-session targets for exercises in this workout (rpe null keeps the target RPE). Small changes are saved with Undo; bigger ones, including a changed target RPE or a reset after a stall, become suggestions Ben applies.',
  },
  {
    name: 'propose_next_workout_change',
    effect: 'propose',
    writes: ['proposal'],
    needs: 'structural_signal',
    structural: true,
    turnKinds: ['general', 'workout', 'summary'],
    plainLabel: 'Swapping, adding, removing or reordering exercises in your next workout',
    capabilitySection: 'suggest_only',
    description:
      'Suggest swapping, removing or reordering exercises in the next workout built from a finished one (its routine, or the next session from it). Use exercise IDs from the workout or get_substitutions. Adding exercises is not possible yet. Not for adding an exercise to the current workout unless Ben named a future scope. Nothing changes until Ben taps Apply.',
  },
  {
    name: 'set_pain_flag',
    effect: 'append',
    writes: ['pain_flag'],
    needs: 'ben_pain_words',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Turn a pain flag on',
    capabilitySection: 'when_you_ask',
    description: "Turn on a pain flag for movements Ben says hurt in this message. Stops increases for them. Never diagnoses, and can't clear a flag.",
  },
  {
    name: 'save_memory',
    effect: 'append',
    writes: ['memory'],
    needs: 'ben_request',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Save a memory',
    capabilitySection: 'when_you_ask',
    description: 'Save a short personal fact Ben asked you to remember. Not for general training rules.',
  },
  {
    name: 'suggest_memory',
    effect: 'propose',
    writes: ['memory'],
    needs: 'none',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Suggest something to remember (saved only if you tap Save)',
    capabilitySection: 'suggest_only',
    description:
      'Suggest a short personal fact or preference about Ben worth remembering, when he states one without asking you to remember it. Never a general training rule. Not used until Ben taps Save.',
  },
  {
    name: 'forget_memory',
    effect: 'versioned_update',
    writes: ['memory'],
    needs: 'ben_request',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Forget a memory',
    capabilitySection: 'when_you_ask',
    description: 'Forget a saved memory Ben asked you to forget. It can be undone.',
  },
  {
    // workout-builder BD1, §8.2: a draft Ben opens, starts or saves himself. Coach v3: its length, focus and gym are the model's reading, checked by code.
    name: 'propose_workout',
    effect: 'propose',
    writes: ['workout_draft'],
    needs: 'ben_request',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Build a workout you ask for, as a draft you open, start or save',
    capabilitySection: 'when_you_ask',
    description:
      'Build one workout session as a draft, only when Ben asks for a workout or session, or agrees to put a session you described earlier in this thread into the app, or asks to change the coach draft in context. Never for pain or soreness, advice, his history, or multi-week plans. When he does ask, build it rather than describing it in reply. Exercises by catalogueId from YOUR DATA build.usable or find_exercises only, in order, with working sets, a rep range (or workSeconds for timed and cardio exercises; distanceMetres only for cardio, null otherwise), targetRpe for the working sets, warm-ups null (the app plans them; a number only when Ben asked for one), one optional top set, rest and supersets. For each exercise give the working `load` (and `topSet.load`) in the unit and convention listed for it in build.loadReferences, with a short `basis` (at most 60 characters): a reason in words with no numbers (the app shows the numbers); null when you have no opinion. The app checks, bounds and fits every load to the equipment; a load with no history of his own is shown as an estimate. Give `minutes` (15–180) when Ben asked for a length in this conversation ("make it 40" after a build is 40), `focus` for what he asked to train ("a shoulder workout" is shoulders), and `gymName` when he named one of his gyms in build.gyms ("my hotel gym"); null otherwise. The app checks each and fits the workout to the length. Stay within build.setBudget working sets. It only makes a draft; Ben starts or saves it himself.',
  },
  {
    // workout-builder v2.1 BD17, §8.4: one clarifying question card; at most 2 per build request, checked by code.
    name: 'ask_build_question',
    effect: 'append',
    writes: ['build_question'],
    needs: 'ben_request',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Ask one quick question before building a workout, when it helps',
    capabilitySection: 'when_you_ask',
    description:
      'Before building, ask Ben one short question (at most 80 characters) with 2 to 4 short tap answers (at most 24 characters each), only when the answer changes the workout and is not already in YOUR DATA (training, build.known). Never ask about the session length, his goal, pain, injury or anything medical. topic main_lift: each answer carries a catalogueId from build.usable. Do not ask if you can build a good workout with what you have. Ben can skip it.',
  },
  {
    // (Ben, 20 Oct: "should also be able to pause eg if go on hols") ADR 0039: offered whenever a plan is in use
    // (`planInUse`); applies at once with Undo when Ben asked (the turn's `verifyAsked`), else nothing is written and
    // the coach asks him (rule 3).
    name: 'pause_plan',
    effect: 'versioned_update',
    writes: ['plan_pause'],
    needs: 'none',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Pause your plan (e.g. on holiday) or resume it, with Undo',
    capabilitySection: 'when_you_ask',
    description:
      "Pause the plan in use (YOUR DATA plan.inUse) when Ben asks, e.g. \"I'm on holiday till 3 Nov\", or resume it (\"I'm back, resume my plan\"). action: pause or resume. until: the local date (YYYY-MM-DD) the plan is back in use on, from his words and today's date; null when he gave none (paused until he resumes). While paused, Up next follows his other workouts and paused days don't count against his weekly aim. The plan's days don't change. Applies at once with Undo when Ben asked. benAsked: true when his message this turn asks to pause or resume, with benQuote his words; false when it is your own idea (nothing changes; ask him).",
  },
  {
    // (Ben, 20 Oct) A run, ride, swim or sport Ben mentions. Offered on every general turn: when his own words tell the
    // coach about it (`activity`, code's reading) it is logged at once with Undo; otherwise the call is saved as an offer
    // he taps to log (rule 3). Only what he said (rule 6).
    name: 'log_activity',
    effect: 'append',
    writes: ['activity'],
    needs: 'none',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Log a run, ride, swim or sport you tell it about, with Undo',
    capabilitySection: 'when_you_ask',
    description:
      'Log a run, ride, swim, sport or other activity Ben tells you about, done or planned ("18 km run yesterday", "long run Saturday"). kind, status (done or planned), date (local YYYY-MM-DD from his words and YOUR DATA week.today), durationMin and distanceKm only as he said them (null when he didn’t), effort only from his own word (long for a long session; null otherwise). Never invent pace, heart rate or effort. Runs are not gym days.',
  },
  {
    // (Ben, 20 Oct: "maybe we swap to a push rather than shoulder and chest separately") This week only.
    // ADR 0039 (Ben, 29 Oct): offered from every chat whenever this week has days (`week`). When Ben asked (the turn's
    // `verifyAsked` on his words) it applies at once with Undo on the card, like a change to today; the coach's own
    // idea stays a proposal he applies (rule 3). Not CC10's structural kind: next week is his plan as it was.
    name: 'propose_week',
    effect: 'propose',
    writes: ['week_plan'],
    needs: 'none',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Reshape this week (rest a day, skip or merge days), with Undo',
    capabilitySection: 'when_you_ask',
    description:
      'Reshape this week’s remaining days (YOUR DATA week.remaining, in order; the first is usually today’s) when Ben asks ("make today a rest day", "skip legs this week", "don’t cram the rest of the week", "plan my week around my run"), or suggest it when YOUR DATA week shows more days left than gym days (week.gymDaysLeft). skips: day IDs to leave out this week (a rest day today: skip today’s day; not cramming: skip or merge so the days left fit the days he has); merges: two remaining upper day IDs into one day (Chest + Shoulders → Push; a leg day is never merged; the app names it). week.suggestion is code’s idea. This week only: next week is his plan as it was. benAsked: true when Ben’s message this turn asks for a change to this week, with benQuote his words: it applies at once with Undo; false when it is your own idea: he sees a proposal to apply, so say "Want me to …?", never that it changed.',
  },
  {
    // (19 Oct, Ben: "Can it build plans across multiple days as well not just single workouts?") Every day at once, as a
    // proposal (rule 3: a structural change Ben applies, with Undo). Each day is checked like a `propose_workout` draft.
    name: 'propose_plan',
    effect: 'propose',
    writes: ['plan_draft'],
    needs: 'ben_request',
    // Not CC10's signal-gated kind: it opens only on Ben's own plan request, and Apply is always his tap.
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Build a multi-day plan you ask for, as a proposal you apply or undo',
    capabilitySection: 'when_you_ask',
    description:
      'Build a plan of several different days at once (1 to 7 days), only when Ben asks for a plan, a split or a week of workouts, or asks to change the plan in context. Never a multi-week block or deloads, and never for one session (use propose_workout). Follow his split in plan.splitDays unless he asks for another: give each day its `splitDayId` (null for a day that is none of them) and a short `dayName`. Spread the muscles sensibly across the days and keep each day within plan.setBudget working sets. Each day\'s exercises are exactly like propose_workout\'s: catalogueIds from YOUR DATA build.usable or find_exercises only, working sets, a rep range (or workSeconds), targetRpe, warm-ups null (the app plans them; a number only when Ben asked for one), one optional top set, rest, supersets, and a working `load` (and `topSet.load`) from build.loadReferences in the unit and convention listed, with a short `basis` in words (no numbers); null when you have no opinion. Give `minutes` (15–180) for every day when Ben asked for a length ("60 min each"), or a day\'s own `minutes` when he asked for one for that day; null otherwise. `gymName`: one of build.gyms when he named one. The app checks every day, bounds and fits every load to the equipment, and shows the plan as a proposal: nothing changes until Ben taps Apply.',
  },
  {
    // (Ben, 30 Oct, build 486: "won't change full plan") One exercise out and another in, in every day of the plan in
    // use. Offered whenever a plan is in use, in every chat (`planInUse`, no word gate: the gate is what made a live
    // workout's chat say it couldn't). Always a proposal with each day's before/after, Apply and Undo (rule 3); the app
    // checks the direction against what Ben marked not preferred and never puts one in.
    name: 'propose_plan_swap',
    effect: 'propose',
    writes: ['proposal'],
    needs: 'none',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Swap one exercise in every day of your plan, as a proposal you apply or undo',
    capabilitySection: 'when_you_ask',
    description:
      'Swap one exercise for another in every day of the plan in use where it appears, from now on, when Ben asks ("swap leg press for leg extension in my plan", "across the full plan", "every week"). remove: the catalogueId going out; add: the catalogueId coming in (YOUR DATA plan.inUse.days or find_exercises). Only that exercise changes in each day: its sets, reps, rest, place and superset stay. Never add an exercise listed in YOUR DATA notPreferred; when Ben says "swap A and B" and one of them is not preferred, that one is `remove`. Ben sees each day before and after and taps Apply; never say it changed. reason: one short line.',
  },
  {
    // (Ben, 31 Oct, build 493: "add them in after the raises … can u fix the plan too?") One exercise into chosen plan
    // days, every week, at a chosen place. Offered whenever a plan is in use, in every chat (ADR 0039). Always a
    // proposal with each day's before/after, Apply and Undo (rule 3); never an exercise Ben marked not preferred.
    name: 'propose_plan_add',
    effect: 'propose',
    writes: ['proposal'],
    needs: 'none',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Add an exercise to days of your plan, as a proposal you apply or undo',
    capabilitySection: 'when_you_ask',
    description:
      'Add one exercise to chosen days of the plan in use, every week from now on ("add curls to my pull days", "fix the plan too" after a gap you found). add: its catalogueId (YOUR DATA plan.inUse.days, build.usable, addable or find_exercises). days: the plan day names from plan.inUse.days it goes into. after: the catalogueId it goes straight after in each day that has it (null: at the end). workingSets and reps: yours. load: only a weight Ben named this turn, in his words; else null (the app plans it from his history). Never an exercise in YOUR DATA notPreferred. Ben sees each day before and after and taps Apply; never say it changed. reason: one short line.',
  },
  {
    // (Ben, 20 Oct) Offered only while Lift targets is on (the app wires the executor then). Applies with Undo
    // only when Ben asked; code decides from his words (`liftTargetAsked` in the turn), else nothing is saved.
    name: 'set_lift_target',
    effect: 'versioned_update',
    writes: ['lift_target'],
    needs: 'none',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Set a lift target you ask for, with Undo',
    capabilitySection: 'when_you_ask',
    description:
      'Set one of Ben’s lift targets when he asks: the exercise (a name or ID of one he logs), kind one_rm ("bench 100 kg") or weight_reps ("bench 90 kg for 5", with reps), the load and unit he said, and byDate (YYYY-MM-DD) when he gave a date, else null. The load is in the exercise’s own convention: dumbbells per hand (a pair of 40s is 40, not 80; if unclear whether he means each or the pair, ask), machines the stack, barbells the total. The saved target comes back in `line` with its convention ("40 kg each"); say it that way in reply. It replaces that exercise’s target; at most 3. benAsked true only when his message this turn asks for this target, with benQuote his words copied exactly; false when it is your idea (he sees it as an offer to apply; a "yes" to your question applies that offer, so never call again for it).',
  },
  {
    // ADR 0039 (Ben, 29 Oct): the builder's Your workout draft before Start, from any chat while one is in context
    // (`builderDraft`). The builder's own edit coach makes the change from Ben's words; it is always a proposal with
    // Apply / Skip (rule 3: in the builder before Start, what he asks for comes back as a proposal).
    name: 'propose_workout_edit',
    effect: 'propose',
    writes: ['proposal'],
    needs: 'none',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Change your workout before you start it, as a change you apply or skip',
    capabilitySection: 'when_you_ask',
    description:
      'Change the Your workout draft in YOUR DATA builderDraft (not started yet) when Ben asks: swap, add, remove or reorder exercises, sets, reps, weights, its length. The app makes the exact change from his own words this turn and shows it with Apply or Skip; nothing changes until he applies it. Not for a live workout (edit_today) or his plan (propose_plan).',
  },
  {
    // ADR 0039: today's Set up from Ben's words (a day, a length, a main lift), from any chat while there is no live
    // workout (`setupOpen`). Filled at once because his words asked for it; Undo is on Set up. Nothing runs without his words.
    name: 'fill_setup',
    effect: 'append',
    writes: ['builder_setup'],
    needs: 'none',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Set up today’s workout from what you say (day, length, main lift), with Undo on Set up',
    capabilitySection: 'when_you_ask',
    description:
      'Fill today’s Set up from Ben’s own words this turn when he names today’s workout by a day, a length or a main lift ("legs, 45 min", "push day, bench first"). He opens Set up to build it. Use propose_workout instead when he asks you to write the whole workout yourself.',
  },
  {
    // Contract §6.1 says `ben_request`; ADR 0020 §2 proposes `none`. The approved
    // spec (the stricter one) wins until Ben decides.
    name: 'add_playbook_candidate',
    effect: 'append',
    writes: ['playbook_candidate'],
    needs: 'ben_request',
    structural: false,
    turnKinds: CHAT,
    plainLabel: 'Add a general training rule to your playbook to review',
    capabilitySection: 'when_you_ask',
    description: "Add a general training rule (not a personal fact) to the playbook for Ben to review. It isn't used until he approves it.",
  },
];

/**
 * Coach v3 (ADR 0027, 18 Oct): tool names no turn offers any more. `edit_today` replaced them; their
 * argument schemas, records and Undo stay for actions saved before it (and the built-in rule's
 * change, which writes an `adjust_pending_sets` record).
 */
export const RETIRED_COACH_TOOLS: readonly CoachToolName[] = ['adjust_pending_sets', 'add_exercise_today'];

/** The fixed `Never` section (§2.5): things that are not tools at all. */
export const COACH_NEVER: readonly string[] = [
  'Delete or rewrite a workout, a set, an import or a check-in',
  'Clear a pain flag',
  'Change settings, your AI connection, backups or playbook approvals',
];

/** Entity kinds a versioned update may write; all keep the previous version (CC6, check 1). */
/** (11 Oct) `logged_set`: a set Ben told the coach to log or correct, through the workout's own versioned commands; never a delete. */
/** (12 Oct) `session_exercise`: an exercise added to today's workout with pending sets only; Undo takes it out. */
/** (14 Oct) `session_name`: the live workout's name, through the workout's own `rename_session`; Undo names it back. */
// (Ben, 20 Oct) `plan_pause`: the plan in use paused or resumed when Ben asks; its days never change.
/** (20 Oct) `gym_equipment`: a gym's profile and items (`update_gym`); every record keeps its version, Undo puts it back. */
/** (Ben, 20 Oct) `lift_target`: a target on Ben's training profile he asked for; Undo puts back what was there. */
const VERSIONED_WRITABLE: ReadonlySet<CoachEntityKind> = new Set<CoachEntityKind>(['pending_set_target', 'next_session_target', 'memory', 'logged_set', 'session_exercise', 'session_name', 'plan_pause', 'gym_equipment', 'lift_target']);

export class UnsafeRegistryError extends Error {}

/**
 * Contract check 1, run by a unit test and at module load: every tool has an
 * allowed effect, declared writes, a plain label when it writes, and argument
 * schemas. A stub `delete_workout` or an `overwrite` effect fails here.
 */
export function assertRegistrySafe(tools: readonly ToolDeclaration[]): void {
  const names = new Set<string>();
  for (const t of tools) {
    if (names.has(t.name)) throw new UnsafeRegistryError(`Duplicate tool ${t.name}`);
    if ((t.name as string) === COACH_REPLY_TOOL_NAME) throw new UnsafeRegistryError(`${t.name}: the reply function is not a registry tool`);
    names.add(t.name);
    if (!ToolEffectSchema.safeParse(t.effect).success) throw new UnsafeRegistryError(`${t.name}: effect ${t.effect} is not allowed`);
    if (/(^|_)(delete|remove_set|overwrite|clear|discard|reset|restore|update_completed)/.test(t.name)) {
      throw new UnsafeRegistryError(`${t.name}: destructive tools are never in the registry`);
    }
    if (!(t.name in COACH_TOOL_ARGS)) throw new UnsafeRegistryError(`${t.name}: no argument schema`);
    for (const w of t.writes) {
      if (!CoachEntityKindSchema.safeParse(w).success) throw new UnsafeRegistryError(`${t.name}: writes unknown entity ${w}`);
    }
    if (t.effect === 'read' && t.writes.length > 0) throw new UnsafeRegistryError(`${t.name}: a read tool can't write`);
    if (t.effect !== 'read' && t.writes.length === 0) throw new UnsafeRegistryError(`${t.name}: a write tool must declare what it writes`);
    if (t.effect === 'versioned_update' && t.writes.some((w) => !VERSIONED_WRITABLE.has(w))) {
      throw new UnsafeRegistryError(`${t.name}: versioned updates may only write targets, memories, a set Ben named, an exercise added today, today's workout name, the plan's pause or a gym's equipment`);
    }
    if (t.effect !== 'read' && (t.plainLabel === null || t.plainLabel.trim() === '')) {
      throw new UnsafeRegistryError(`${t.name}: a write tool needs a plainLabel for What the coach can do`);
    }
    if (t.effect !== 'read' && t.capabilitySection === 'read') throw new UnsafeRegistryError(`${t.name}: a write tool needs a capability section`);
    if (t.structural && t.needs !== 'structural_signal' && t.needs !== 'ben_request') {
      throw new UnsafeRegistryError(`${t.name}: structural tools must be gated (CC10)`);
    }
  }
}

assertRegistrySafe(COACH_TOOLS);

/** What this turn contains, decided by code from Ben's own input (never from tool output or imported text). */
export interface TurnGate {
  kind: CoachTurnKind;
  /**
   * Ben's own message (typed, spoken) or chip in this turn, classified as a
   * request by `classifyBenRequest` / `chipRequest`. Null when he only asked a
   * question or said something else: "Ben sent a message" is not a request
   * (review S3, rule 3). Never set from tool output or imported text.
   */
  benRequest: BenRequest | null;
  /** Ben tapped `Adjust` on an offer (CA1); counts as a request for today's sets only. */
  acceptedOffer: boolean;
  /** `classifyPainMention` returned `pain` on Ben's own words in this turn (or he tapped `Pain`). */
  benPainWords: boolean;
  /** `getStructuralChangeSignals` for the workout in context. */
  structuralSignals: readonly StructuralSignalKind[];
  /**
   * Review r4 (PM, 13 Oct, pending Ben): a general turn in Ben's words where the app can build a
   * workout (a gym or typical equipment). `propose_workout` is then offered whatever his words; it
   * only makes a draft he opens, starts or saves himself (BD12, BD15). Forcing stays code's call.
   */
  buildOpen?: boolean;
  /**
   * (14 Oct, PM decision pending Ben) A workout turn while the workout is live. The today-tools
   * (`TODAY_TOOLS`) are then offered whatever Ben's words: whether a call applies (Ben asked) or
   * becomes an offer (he didn't) is decided in the turn by `todayChangeAsked`, never by the model.
   */
  liveWorkout?: boolean;
  /**
   * (14 Oct, workout builder v2.1 BD17) This build request may still ask a clarifying question:
   * fewer than 2 asked, and not a revision of a draft. Absent or false: `ask_build_question` is withheld.
   */
  buildQuestionOpen?: boolean;
  /** (20 Oct, ADR 0029) Ben's words say what a gym has or lacks (`mentionsGymSetup`): `update_gym` is offered. */
  gymWords?: boolean;
  /** (Ben, 20 Oct) The Lift targets setting is on. Absent or false: `set_lift_target` is withheld. */
  liftTargetsOn?: boolean;
  /** ADR 0039: this week has days (a plan in use, or Ben's split) and its tool is wired: `propose_week`. */
  week?: boolean;
  /** ADR 0039: a plan is in use (paused or not): `pause_plan`. */
  planInUse?: boolean;
  /** ADR 0039: a Your workout draft (not started) is in context: `propose_workout_edit`. */
  builderDraft?: boolean;
  /** ADR 0039: today's Set up can be filled (no live workout): `fill_setup`. */
  setupOpen?: boolean;
  /** ADR 0039: the turn starts light (low effort, Ben's lighter mid-workout model): `think_harder` buys one deeper step. */
  lightTurn?: boolean;
}

/**
 * ADR 0039: what each tool acts on. A tool is offered only while its target exists, whatever the entry point
 * (no live workout: nothing to edit today; no plan: nothing to pause). Tools not listed act on something that is
 * always there (Ben's memories, his gyms, his history) or are opened by his words alone (`needMet`).
 */
export type ToolTarget = 'liveWorkout' | 'week' | 'planInUse' | 'lightTurn' | 'liftTargetsOn' | 'builderDraft' | 'setupOpen';

export const TOOL_TARGET: Partial<Record<CoachToolName, ToolTarget>> = {
  edit_today: 'liveWorkout',
  rename_workout: 'liveWorkout',
  log_set: 'liveWorkout',
  correct_set: 'liveWorkout',
  propose_week: 'week',
  pause_plan: 'planInUse',
  propose_plan_swap: 'planInUse',
  propose_plan_add: 'planInUse',
  think_harder: 'lightTurn',
  set_lift_target: 'liftTargetsOn',
  propose_workout_edit: 'builderDraft',
  fill_setup: 'setupOpen',
};

/**
 * ADR 0039: tools offered whenever their target exists, whose call applies at once only when Ben asked (the turn's
 * `verifyAsked` on his words this turn); otherwise the turn makes it an offer or a proposal (rule 3).
 */
export const ASK_CHECKED_TOOLS: ReadonlySet<CoachToolName> = new Set<CoachToolName>(['edit_today', 'rename_workout', 'propose_week', 'pause_plan']);

/**
 * (14 Oct) Tools that change today's live workout and are offered on every live-workout turn: the
 * regex classifier kept missing Ben's wording ("can you repopulate the weights based on my max?"),
 * and a withheld tool made the coach say it had none. Rule 3 still holds: see `todayChangeAsked`.
 */
export const TODAY_TOOLS: ReadonlySet<CoachToolName> = new Set<CoachToolName>(['edit_today', 'rename_workout']);

export interface WithheldTool {
  name: CoachToolName;
  /** For `Why?` → `Not used`. */
  reason: 'turn_kind' | 'no_target' | 'needs_request' | 'needs_pain_words' | 'needs_summary_turn' | 'needs_request_or_signal' | 'not_in_build' | 'setting_off';
}

export interface TurnRegistry {
  tools: ToolDeclaration[];
  withheld: WithheldTool[];
}

/**
 * Which request kinds open which `ben_request` tool (review r2 B2). A request
 * of one kind never opens another kind's tools: "remember that I train before
 * work" can't reach today's sets, and "set 2 felt good" (not a request) opens
 * nothing. Chips count as `change` (CA1). Tools not listed here that need
 * `ben_request` open on no request kind at all, so a new tool fails closed
 * until it is mapped.
 *
 * `add_playbook_candidate` opens only on `playbook` ("add a rule …", "as a
 * general rule …", "put that in the playbook"), never on a memory request:
 * "remember that my left knee is dodgy on lunges" is Your data and can't
 * reach the Coaching knowledge queue (CLAUDE.md rule 10, review r3 S1). The
 * candidate text is also checked by `personalPlaybookText` in `tool-call.ts`.
 * Its `needs` is still unsettled in ADR 0020 (Ben/PM decision).
 */
export const REQUEST_KINDS_BY_TOOL: Partial<Record<CoachToolName, readonly BenRequestKind[]>> = {
  // "Add a set to bench", "another set" are `change`; "put in some curls" is `add`, which also opens this
  // tool so the coach can add one more set when the exercise is already in today's workout.
  adjust_pending_sets: ['change', 'difficulty', 'add'],
  // (Coach v3, 18 Oct) The one tool for today's workout: sets, difficulty, adds and swaps.
  edit_today: ['change', 'difficulty', 'add'],
  // (12 Oct) "Add 3 sets of lateral raises", "put in some curls", "can we do some face pulls".
  add_exercise_today: ['add'],
  // A future add ("next time", "to every push day") is `structural` and opens only this tool. Review r3 S1:
  // a plain today add ("put in some curls") doesn't open it (it can't add, and a swap Ben didn't ask for
  // would be an unrequested structural change, rule 3); an add with an unclear scope ("to the plan",
  // "to my routine now") opens it alongside today's add.
  propose_next_workout_change: ['add_plan'],
  log_set: ['log'],
  correct_set: ['correct'],
  save_memory: ['memory'],
  forget_memory: ['memory'],
  add_playbook_candidate: ['playbook'],
  // workout-builder §8.2: a build request ("build me a 45-minute push session"), or a change to the draft in context (BD16).
  propose_workout: ['build'],
  // workout-builder v2.1 BD17: only in a build turn, and only while the request has a question left (`buildQuestionOpen`).
  // (19 Oct) A plan request may ask too (at most 2 per request, as a build).
  ask_build_question: ['build', 'build_plan'],
  // (19 Oct) A plan of several days ("build me a 4-day plan", "PPL week"), or a change to the plan in context.
  propose_plan: ['build_plan'],
  // ADR 0039: `pause_plan` and `propose_week` are offered whenever their target exists (`TOOL_TARGET`); Ben's words
  // decide only whether a call applies at once (`ASK_CHECKED_TOOLS`).
};

function requestOpens(t: ToolDeclaration, r: BenRequest | null): boolean {
  const kinds = REQUEST_KINDS_BY_TOOL[t.name] ?? [];
  return kinds.some((k) => requestHas(r, k));
}

function needMet(t: ToolDeclaration, g: TurnGate): WithheldTool['reason'] | null {
  switch (t.needs) {
    case 'none':
      return null;
    case 'ben_request':
      if (t.name === 'ask_build_question') return requestOpens(t, g.benRequest) && g.buildQuestionOpen === true ? null : 'needs_request';
      if (t.name === 'update_gym') return g.gymWords === true ? null : 'needs_request';
      if (requestOpens(t, g.benRequest)) return null;
      if (t.name === 'propose_workout' && g.kind !== 'summary' && g.buildOpen === true) return null;
      // ADR 0038: from any entry point while today's workout is live (the workout's sheet, Today, Progress, Plan).
      if (TODAY_TOOLS.has(t.name) && g.kind !== 'summary' && g.liveWorkout === true) return null;
      // An accepted offer only counts for today's sets (CA1).
      return g.acceptedOffer && (t.name === 'adjust_pending_sets' || t.name === 'edit_today') ? null : 'needs_request';
    case 'ben_pain_words':
      return g.benPainWords ? null : 'needs_pain_words';
    case 'ben_named_target':
      return requestHas(g.benRequest, 'change') ? null : 'needs_request';
    case 'summary_turn':
      return g.kind === 'summary' ? null : 'needs_summary_turn';
    case 'structural_signal':
      return isStructuralRequest(g.benRequest) || requestOpens(t, g.benRequest) || g.structuralSignals.length > 0 ? null : 'needs_request_or_signal';
  }
}

/** The tools the model sees in this turn (CC10, summary closed list). */
export function buildTurnRegistry(gate: TurnGate, tools: readonly ToolDeclaration[] = COACH_TOOLS): TurnRegistry {
  const out: ToolDeclaration[] = [];
  const withheld: WithheldTool[] = [];
  for (const t of tools) {
    if (!t.turnKinds.includes(gate.kind)) {
      withheld.push({ name: t.name, reason: 'turn_kind' });
      continue;
    }
    // ADR 0039: offered only while what it acts on exists, the same from every entry point.
    const target = TOOL_TARGET[t.name];
    // A workout turn is the live workout's own sheet (`kindFor`): its target is there by definition.
    const present = target === 'liveWorkout' ? gate.liveWorkout === true || gate.kind === 'workout' : target !== undefined && gate[target] === true;
    if (target !== undefined && !present) {
      withheld.push({ name: t.name, reason: target === 'liftTargetsOn' ? 'setting_off' : 'no_target' });
      continue;
    }
    const missing = needMet(t, gate);
    if (missing !== null) withheld.push({ name: t.name, reason: missing });
    else out.push(t);
  }
  return { tools: out, withheld };
}

export interface CapabilityList {
  intro: string;
  sections: { section: 'when_you_ask' | 'after_workout' | 'suggest_only' | 'never'; title: string; rows: string[] }[];
}

const SECTION_TITLES = {
  when_you_ask: 'When you ask',
  after_workout: 'After each workout',
  suggest_only: 'Only as a suggestion you apply',
  never: 'Never',
} as const;

/** `What the coach can do` (§2.5), generated from the registry so it can't drift. */
export function listCoachCapabilities(tools: readonly ToolDeclaration[] = COACH_TOOLS): CapabilityList {
  const rows = (section: CapabilitySection): string[] =>
    tools.filter((t) => t.capabilitySection === section && t.plainLabel !== null).map((t) => t.plainLabel ?? '');
  return {
    intro: 'The coach only says something changed when the app has saved that change. You can undo every change it makes.',
    sections: [
      { section: 'when_you_ask', title: SECTION_TITLES.when_you_ask, rows: rows('when_you_ask') },
      { section: 'after_workout', title: SECTION_TITLES.after_workout, rows: rows('after_workout') },
      { section: 'suggest_only', title: SECTION_TITLES.suggest_only, rows: rows('suggest_only') },
      { section: 'never', title: SECTION_TITLES.never, rows: [...COACH_NEVER] },
    ],
  };
}

export function findTool(name: string, tools: readonly ToolDeclaration[] = COACH_TOOLS): ToolDeclaration | null {
  return tools.find((t) => t.name === name) ?? null;
}
