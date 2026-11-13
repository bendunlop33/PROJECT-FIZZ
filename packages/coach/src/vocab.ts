/**
 * Shared training vocabulary for the request gate and the claim check (review
 * r4 B1, B3). Plain word lists, no logic. Exercise words are the movements and
 * equipment Ben and the coach name in conversation, including abbreviations
 * ("OHP", "RDL", "DB"), so a directive needs one of them (or a set, a value or
 * a pronoun) as its object, and a claim about an exercise that isn't in the
 * session can't slip past the ledger.
 */

/** Movement and equipment words (singular and plural), as a regex alternation. */
export const EXERCISE_WORD =
  '(?:bench(?:es)?|squats?|deadlifts?|dls?|press(?:es)?|ohps?|rdls?|sldls?|rows?|curls?|fl(?:y|ys|yes|ies)|raises?|pull ?downs?|pulldowns?|pull ?-?ups?|chin ?-?ups?|push ?-?ups?|dips?|lunges?|split squats?|step ?-?ups?|extensions?|thrusts?|hip thrusts?|bridges?|shrugs?|push ?downs?|pushdowns?|kick ?backs?|kickbacks?|crunch(?:es)?|planks?|leg press|pec deck|deck|face pulls?|pullovers?|good ?mornings?|hinges?|carries|farmer(?:s|\'s)? (?:walks?|carry)|skull ?crushers?|preacher|hack squats?|goblet|cleans?|snatch(?:es)?|jerks?|swings?|machine|machines|cables?|dumbbells?|dbs?|barbells?|bb|kettlebells?|kbs?|smith|incline|decline|leg curls?|calf raises?|lateral|laterals|lats? pull ?downs?|accessor(?:y|ies)|exercises?|movements?|lifts?|finisher|superset|amrap|top sets?|back ?-?off(?: sets?)?|drop ?sets?|warm ?-?ups?)';

/** Things a set change can be about: loads, sets, reps, plates. Not "volume" (the music) on its own. */
export const TRAINING_NOUN = '(?:weights?|loads?|sets?|reps?|kgs?|kilos?|lbs?|pounds?|plates?|intensity|bar|rest of (?:it|them|the sets|my sets)|rest)';

/** Common exercise names and their abbreviations, for matching claims to the ledger. Lower case. */
export const EXERCISE_ABBREVIATIONS: Readonly<Record<string, readonly string[]>> = {
  'overhead press': ['ohp', 'military press', 'shoulder press', 'overhead'],
  'romanian deadlift': ['rdl', 'rdls', 'romanian'],
  'stiff leg deadlift': ['sldl', 'sldls'],
  deadlift: ['dl', 'dls', 'deadlifts'],
  'bench press': ['bench', 'benches'],
  'lat pulldown': ['pulldown', 'pulldowns', 'lat pull down', 'lat pulldowns'],
  dumbbell: ['db', 'dbs', 'dumbbells'],
  barbell: ['bb', 'barbells'],
  kettlebell: ['kb', 'kbs', 'kettlebells'],
  'pull-up': ['pull up', 'pull ups', 'pullup', 'pullups', 'pull-ups'],
  'chin-up': ['chin up', 'chin ups', 'chinup', 'chinups', 'chin-ups'],
  'hip thrust': ['hip thrusts', 'thrusts', 'thrust'],
  'pec deck': ['pec decks', 'deck'],
};

/**
 * Exercise names a claim may mention that aren't in today's session. When one
 * of these is named and the ledger holds no change to it, the claim is a
 * mismatch, not a pass (review r4 B3). Lower case; longer first when matched.
 */
export const COMMON_EXERCISE_NAMES: readonly string[] = [
  'overhead press', 'ohp', 'military press', 'shoulder press', 'romanian deadlift', 'rdl', 'stiff leg deadlift', 'sldl',
  'deadlift', 'sumo deadlift', 'trap bar deadlift', 'bench press', 'incline press', 'incline bench', 'decline press',
  'close grip bench', 'dumbbell press', 'db press', 'back squat', 'front squat', 'goblet squat', 'hack squat', 'split squat',
  'bulgarian split squat', 'leg press', 'leg extension', 'leg curl', 'hamstring curl', 'calf raise', 'lat pulldown', 'pulldown',
  'pull-up', 'pull up', 'chin-up', 'chin up', 'cable row', 'seated row', 'barbell row', 'bent over row', 'dumbbell row',
  'db row', 't-bar row', 'pendlay row', 'face pull', 'lateral raise', 'rear delt fly', 'reverse fly', 'cable fly', 'pec deck',
  'chest fly', 'dumbbell fly', 'bicep curl', 'biceps curl', 'hammer curl', 'preacher curl', 'tricep pushdown',
  'triceps pushdown', 'tricep extension', 'skull crusher', 'dips', 'dip', 'push-up', 'push up', 'hip thrust', 'glute bridge',
  'lunge', 'lunges', 'walking lunge', 'step-up', 'step up', 'shrug', 'farmer carry', 'good morning', 'plank', 'crunch',
  'cable crunch', 'ab wheel', 'kettlebell swing', 'power clean', 'squat', 'squats', 'rows', 'curls', 'flyes', 'raises',
];
