/**
 * `classifyPainMention` (coach-memory CM6): deterministic word lists, so the
 * pain flag works offline and the coach's `set_pain_flag` gate can't be
 * talked into firing by tool output or imported notes. Pure.
 *
 * - `pain`: "hurts", "pain", "tweaked", "pulled", "sprained", "popped",
 *   "killing me", "numb" … allow a flag.
 * - `unclear`: "sore", "tight", "stiff", "achy", "uncomfortable", and pain
 *   words with a negator a few words back in the same clause ("I don't think
 *   it hurts") are asked about, never assumed.
 * - `effort`: "burn", "pump", "grind", "heavy", "tired" never flag.
 * - Only a negator directly before the pain word cancels it ("no pain",
 *   "doesn't hurt", "no real pain"). "without" and "never" don't: "I can't
 *   press without pain" and "never had pain like this" are pain (rule 9).
 *
 * - A body part Ben owns ("my shoulder", "my lower back", "rolled my
 *   ankle") with no effort word, no positive word and no other signal is
 *   `unclear`, so CM6 asks rather than assuming `none` (review r2 B3).
 *   Exercise names ("leg press", "back squat") aren't "my …", so they don't
 *   trigger it.
 * - "sharp" and "shooting" only count as pain next to a body part, so
 *   "feeling sharp today" stays `none`.
 *
 * Review r3 B2:
 * - `knee's` is read as `knee is`, so "my knee's not right" is the same as
 *   "my knee is not right".
 * - A negated positive ("not great", "not right", "isn't happy") is
 *   `unclear`, never a signal that cancels the body-part fallback.
 * - A positive word doesn't cancel the fallback when the clause carves
 *   something out ("felt good apart from my elbow", "great except my wrist").
 * - The fallback also covers a body part without "my" when it isn't part of
 *   an exercise name or a phrase like "back to 100" ("the knee went again",
 *   "left knee feels off", "I've got a dodgy knee", "Achilles is grumbling").
 * - Vague state words next to a body part ("dodgy", "wonky", "iffy", "off",
 *   "grumbling", "funny", "weird") are `unclear`.
 * - "pain-free" / "pain free" is a negated pain word.
 *
 * Review r4 B2:
 * - Gym anatomy ("delt", "hammy", "QL", "psoas", "IT band", "hip flexors",
 *   "core") and conditions ("sciatica", "plantar fasciitis", "slipped disc",
 *   "shin splints", "broke my toe") are covered. "flexors" is a body part.
 * - A side stands for the part: "left side is weird", "my left one is
 *   grumbling".
 * - A vague word after a state verb with no other subject ("feels off",
 *   "it's weird"), or after a denied pain word ("Doesn't hurt, just feels
 *   wrong"), is `unclear`. "aint" is a negator. "Bad shoulder day" is asked
 *   about. General symptoms ("dizzy", "light headed", "heart racing") are
 *   `unclear` until Ben/PM settle a fixed safety line (r4 spec issue 2).
 *
 * Review r5 B2, S2:
 * - An effort word ("burning", "heavy", "fried", "cooked", "hard to bend")
 *   next to a joint or tendon ("elbow", "knee", "lower back", "Achilles") is
 *   `unclear`, never `effort`. It stays `effort` next to a muscle ("quads are
 *   burning", "legs are fried").
 * - Exclamations and strain reports are pain: "Ow", "Owww", "Argh", "It
 *   stings", "Something twanged", "Heard a crack", "Felt something go",
 *   "Felt a pull", "Felt a click", "Pins & needles". Idioms aren't: "crack
 *   on", "cracked 100", "snapped a photo", "Pulled 200 today", "Popped
 *   another plate on".
 * - "Can't straighten it", "can't grip properly", "can't bend my knee" are
 *   `unclear`. "Can't lift any more" is effort talk, not a symptom.
 * - "hasn't", "haven't", "hadn't" negate ("Knee hasn't hurt since Tuesday").
 *   Pain said about another day ("It hurt last week, fine now") is
 *   `unclear`, never `pain` and never `none`: CM6 asks.
 *
 * A false `pain` only lets the coach consider a flag; a missed one lets
 * progression continue on a movement that hurts. When in doubt the answer
 * leans to `pain` or `unclear`, never `none`.
 */
export type PainMention = 'pain' | 'effort' | 'unclear' | 'none';

const PAIN = [
  'pain', 'pains', 'painful', 'hurt', 'hurts', 'hurting', 'hurted', 'tweak', 'tweaked', 'tweaky', 'tweaking', 'sharp',
  'pinch', 'pinching', 'pinches', 'pinchy', 'twinge', 'twinged', 'injured', 'injury', 'injure', 'strain', 'strains',
  'strained', 'straining', 'pulled', 'sprain', 'sprains', 'sprained', 'pop', 'popped', 'popping', 'killing', 'torn', 'tore',
  'numb', 'numbness', 'tingling', 'tingly', 'throbbing', 'throbs', 'stabbing', 'shooting', 'agony', 'ouch', 'jarred',
  // Review r2 B3: common injury talk that used to be `none`.
  'spasm', 'spasms', 'spasmed', 'spasming', 'swollen', 'swelling', 'swelled',
  'aggravate', 'aggravated', 'aggravating', 'rolled', 'impinge', 'impinged', 'impingement', 'impinging', 'tendinitis',
  'tendonitis', 'tendinopathy', 'bursitis', 'dislocate', 'dislocated', 'dislocation', 'subluxed', 'bruise', 'bruised',
  'bruising', 'cramp', 'cramped', 'cramping', 'buckled', 'wrenched', 'twisted', 'jammed',
  // Review r4 B2: conditions and injuries named outright.
  'sciatica', 'sciatic', 'fasciitis', 'herniated', 'herniation', 'hernia', 'prolapsed', 'prolapse', 'fracture', 'fractured',
  'splints', 'arthritis', 'arthritic', 'gout', 'ruptured', 'rupture', 'pinched', 'crick', 'concussion', 'whiplash', 'tendinosis',
  'epicondylitis', 'sprung', 'broke', 'broken', 'tear', 'busted',
  // Review r5 B2: exclamations, stings and strain sounds.
  'ow', 'oww', 'owww', 'owwww', 'ouchie', 'argh', 'aargh', 'arggh', 'arghh', 'sting', 'stings', 'stinging', 'stung',
  'twang', 'twanged', 'twangs', 'twangy', 'crack', 'cracked', 'snap', 'snapped', 'snapping', 'ping', 'pinged', 'zinger', 'zing', 'zinged',
];
/** Pain only with a body part in the same clause ("sharp pain in my knee", not "feeling sharp today"). */
const NEEDS_BODY = new Set(['sharp', 'shooting', 'broke', 'broken', 'tear', 'busted']);
/** Multi-word pain phrases, matched on the joined clause. */
const PAIN_PHRASES = [
  /\bpins and needles\b/,
  /\b(?:gave|gives|giving|give) out\b/,
  /\b(?:acting|playing) up\b/,
  /\bflared? up\b|\bflaring up\b|\bflares up\b/,
  /\bbother(?:s|ed|ing)? (?:my|me)\b/,
  // Review r4 B2: "slipped disc", "bulging disc", "disc issue" (a "disc" alone may be a plate).
  /\b(?:slipped|herniated|bulging|bulged|prolapsed|ruptured|degenerated|degenerative|blown) discs?\b|\bdiscs? (?:issue|issues|problem|problems|injury|bulge|herniation|prolapse|thing)\b/,
  /\b(?:tennis|golfer'?s?) elbow\b|\bfrozen shoulder\b|\bjumper'?s? knee\b|\brunner'?s? knee\b/,
  /\b(?:felt|feel|feels|heard|think i (?:had|got)|might have had|may have had) (?:a |something )?(?:tear|rip|snap)\b/,
  // Review r5 B2: "felt something go on the last rep", "felt a pull", "something gave", "felt a click".
  /\b(?:felt|feel|feels|heard|noticed) (?:a |something |some |a bit of a |a little )(?:go|give|gave|went|pull|pop|popped|tear|tore|rip|ripped|twang|twanged|snap|snapped|ping|pinged|click|clicked|crack|cracked|clunk|clunked|shift|shifted|slip|slipped|tweak|twinge|zing|grab|grabbed)\b/,
  /\b(?:felt|feel|heard) (?:it|that) (?:pop|tear|rip|twang|snap|ping|click|crack|clunk|give|go)\b(?! (?:up|down|well|fine|easy|smooth|smoothly|nicely|great|ok|okay|fast|quick|quickly))/,
  /\bsomething (?:went|gave|go|give|popped|pinged|snapped|twanged|tore|cracked|clicked|shifted|slipped|pulled)\b/,
  /\bbit of a (?:twang|pull|ping|tweak|twinge|zing)\b/,
];
/** General symptoms with no named part (review r4 spec issue 2): asked about, never a verdict. */
const UNCLEAR_PHRASES = [
  /\b(?:feel|feeling|feels|felt) (?:a bit |bit |really |quite )?(?:sick|faint|unwell|ill|crook|woozy|spaced)\b/,
  // Review r5 B2: "can't straighten it", "can't grip properly", "can't bend my knee". Not "can't lift any more".
  /\b(?:can'?t|cannot|cant|unable to) (?:fully |properly |really |quite )?(?:straighten|bend|grip|lift|raise|turn|move|rotate|extend|flex|feel|squeeze|close|open|reach|put weight|weight bear|bear weight|walk|sit|stand|look)\b(?! (?:any ?more|another|more|the (?:bar|weight|load)|it up any ?more|\d))/,
  /\b(?:hard|painful|hurts|struggling|difficult|tough) to (?:fully |properly )?(?:straighten|bend|turn|rotate|extend|flex|close|open|reach|put weight|bear weight|walk|sit|stand|look|sleep)\b/,
  /\b(?:burning|tingling|weird|strange|odd|electric|pins) (?:sensation|feeling)\b/,
  // "burning down my leg", "something running into my arm": radiating, not a muscle working.
  /\b(?:burning|burns|shooting|tingling|running|radiating|radiates|spreading|goes|going|travels|travelling|traveling) (?:all the way )?(?:down|into|through|up) (?:my|the|his) (?:\w+ )?(?:leg|legs|arm|arms|back|neck|hand|hands|fingers|foot|feet|butt|glute|calf|thigh|shoulder)\b/,
];
const BODY = [
  'shoulder', 'shoulders', 'elbow', 'elbows', 'wrist', 'wrists', 'hand', 'hands', 'finger', 'fingers', 'thumb', 'thumbs',
  'forearm', 'forearms', 'bicep', 'biceps', 'tricep', 'triceps', 'arm', 'arms', 'neck', 'back', 'spine', 'hip', 'hips',
  'groin', 'knee', 'knees', 'ankle', 'ankles', 'foot', 'feet', 'toe', 'toes', 'heel', 'heels', 'achilles', 'shin', 'shins',
  'calf', 'calves', 'hamstring', 'hamstrings', 'quad', 'quads', 'glute', 'glutes', 'chest', 'pec', 'pecs', 'rib', 'ribs',
  'trap', 'traps', 'lat', 'lats', 'si', 'joint', 'joints', 'tendon', 'tendons', 'rotator', 'cuff', 'leg', 'legs', 'head',
  // Review r4 B2: gym anatomy.
  'delt', 'delts', 'hammy', 'hammies', 'adductor', 'adductors', 'abductor', 'abductors', 'ql', 'psoas', 'piriformis', 'teres',
  'scap', 'scaps', 'scapula', 'scapulae', 'collarbone', 'clavicle', 'sternum', 'oblique', 'obliques', 'abs', 'core', 'itband',
  'tfl', 'rhomboid', 'rhomboids', 'lumbar', 'thoracic', 'flexor', 'flexors', 'pelvis', 'tailbone', 'coccyx', 'sacrum',
  'jaw', 'thigh', 'thighs', 'butt', 'bum', 'torso', 'kneecap', 'kneecaps', 'patella', 'meniscus', 'acl', 'mcl', 'labrum',
  'ligament', 'ligaments', 'muscle', 'muscles', 'nerve', 'vertebra', 'vertebrae', 'pinky', 'knuckle', 'knuckles', 'palm', 'palms',
  'serratus', 'infraspinatus', 'supraspinatus', 'gastroc', 'soleus', 'tibialis', 'shoulderblade', 'shoulderblades', 'heart',
];
/** Words that may sit between "my" and the body part: "my left knee", "my lower back". */
const BODY_QUALIFIERS = new Set(['left', 'right', 'lower', 'upper', 'mid', 'middle', 'bad', 'dodgy', 'rotator', 'other', 'front', 'rear', 'hip', 'side', 'inner', 'outer']);
/** Body words that only count after a side: "left side", "my right one" (review r4 B2). Not "one more set" or "on the side". */
const SIDE_ONLY = new Set(['side', 'one']);
const SIDES = new Set(['left', 'right', 'other']);
/** "my back went", "my knee went on me", "the knee went again". */
function bodyWent(ws: readonly string[]): number {
  for (const [i, w] of ws.entries()) {
    if (w === 'went' && i > 0 && bodyPartAt(ws, i - 1) && (ownedAt(ws, i - 1) || unownedBodyPartAt(ws, i - 1))) return i;
  }
  return -1;
}
const POSITIVE = new Set(['good', 'great', 'fine', 'fresh', 'strong', 'solid', 'ok', 'okay', 'better', 'perfect', 'amazing', 'awesome', 'easy']);
/**
 * Words that are positive only when they're negated ("not right", "isn't
 * happy", "not 100"): on their own they're too common ("my right knee") to
 * count. Negated, they and `POSITIVE` words are `unclear` (review r3 B2).
 */
const NEGATABLE_POSITIVE = new Set([...POSITIVE, 'right', 'happy', 'well', 'normal', 'brilliant', 'itself', 'quite', 'hundred', '100', 'cooperating', 'cooperative', 'playing', 'behaving', 'best']);
const POSITIVE_NEGATORS = new Set([
  'no', 'not', "doesn't", 'doesnt', "didn't", 'didnt', "isn't", 'isnt', "wasn't", 'wasnt', "don't", 'dont', "aren't", 'arent',
  "weren't", 'werent', "won't", 'wont', 'never', 'hardly', 'nowhere', 'less', 'far', 'aint', "ain't",
]);
/** Things a negated positive may be about that aren't Ben's body: "sleep wasn't great", "bar speed not great". */
const NON_BODY_SUBJECT = new Set([
  'sleep', 'slept', 'session', 'workout', 'speed', 'form', 'technique', 'food', 'gym', 'music', 'weather', 'energy', 'warmup', 'lift',
  'lifts', 'lifting', 'pump', 'focus', 'motivation', 'mood', 'day', 'week', 'traffic', 'coffee', 'plan', 'app', 'timer', 'rest', 'bar',
  'tempo', 'lockout', 'depth', 'grip', 'setup', 'brace', 'bracing', 'breathing', 'cardio', 'run', 'ride', 'diet', 'work',
  // Review r4 B2: things that can be "off" or "weird" that aren't Ben.
  'alarm', 'phone', 'light', 'lights', 'wifi', 'signal', 'watch', 'machine', 'bench', 'cable', 'seat', 'pad', 'handle', 'rack',
  'equipment', 'gear', 'belt', 'shoes', 'playlist', 'podcast', 'voice', 'screen', 'battery', 'chalk', 'plates', 'plate', 'dumbbell',
  'dumbbells', 'barbell', 'pulley', 'pin', 'stack', 'camera', 'video', 'audio', 'sound', 'volume', 'display', 'number', 'numbers',
  'weight', 'weights', 'load', 'maths', 'math', 'count', 'counter', 'clock', 'aircon', 'air', 'heating', 'temperature', 'room',
]);
/** "Felt good apart from my elbow": a positive word that carves out a body part doesn't cancel the fallback. */
const CARVE_OUT = /\b(?:except|apart from|other than|besides|aside from|bar my|but my|just my|only my|save for|barring)\b/;
/** Vague words that, next to a body part, mean "something's wrong": ask (review r3 B2). */
const VAGUE_BODY = new Set([
  'dodgy', 'bad', 'wonky', 'iffy', 'funny', 'off', 'grumbling', 'grumbly', 'grumpy', 'weird', 'wrong', 'dicky', 'gammy', 'janky',
  'crunchy', 'cranky', 'unhappy', 'angry', 'unstable', 'loose', 'locked', 'locking', 'catching', 'twingy', 'sketchy', 'rough',
  'strange', 'odd', 'creaky', 'creaking', 'grinding', 'crunching', 'complaining', 'moaning', 'touchy', 'fragile', 'delicate', 'weak',
  'wobbly', 'giving', 'shot', 'knackered', 'buggered', 'wrecked', 'busted', 'banged', 'dodgey',
]);
/** Vague words that mean "something's wrong" even with no body part, after a state verb or a denied pain word (review r4 B2). */
const VAGUE_STANDALONE = new Set(['weird', 'off', 'wrong', 'odd', 'funny', 'strange', 'wonky', 'iffy', 'dodgy', 'janky', 'sketchy', 'wrecked', 'busted']);
/** State verbs before a vague word: "feels off", "it's weird", "felt wrong". */
const STATE_VERBS = new Set(['feels', 'feel', 'felt', 'feeling', 'is', 'was', 'seems', 'seemed', 'went', 'going', 'gone', 'acting', 'are', 'were', 'getting', 'got']);
/** "something's up", "something's wrong": a vague report with no named part. */
const SOMETHING_UP = /\bsomething (?:is |was |feels |felt )?(?:up|wrong|off|not right|weird|funny|odd)\b/;

/**
 * A body part followed by one of these is an exercise, a session or a
 * direction, not Ben's body: "leg press", "chest day", "back to 100",
 * "shoulders next".
 */
const NOT_BODY_FOLLOW = new Set([
  'press', 'presses', 'pressing', 'squat', 'squats', 'raise', 'raises', 'curl', 'curls', 'extension', 'extensions', 'row', 'rows',
  'day', 'days', 'workout', 'workouts', 'session', 'sessions', 'exercise', 'exercises', 'machine', 'stretch', 'stretches',
  'pulldown', 'pulldowns', 'pull', 'pulls', 'fly', 'flys', 'flyes', 'dip', 'dips', 'thrust', 'thrusts', 'bridge', 'bridges',
  'kickback', 'kickbacks', 'work', 'training', 'bench', 'circles', 'swings', 'routine', 'focus', 'pump', 'superset', 'accessory',
  'accessories', 'abduction', 'adduction', 'flexion', 'hinge', 'plank', 'planks', 'note', 'notes', 'wheel', 'rollout', 'rollouts',
  'crunch', 'crunches', 'machine', 'circuit', 'finisher', 'stability', 'exercise', 'more', 'set', 'sets', 'rep', 'reps', 'of', 'as', 'than', 'hinges', 'openers', 'mobility', 'warmup', 'warm',
  'to', 'on', 'off', 'in', 'into', 'out', 'up', 'down', 'at', 'for', 'from', 'with', 'over', 'home', 'then', 'me', 'you', 'it', 'them',
  'next', 'first', 'last', 'after', 'before', 'or', 'and', 'tomorrow', 'width', 'grip', 'position', 'placement', 'angle', 'height',
  'rate', 'rates', 'zone', 'zones',
]);
/** Before a body part, these mean Ben's (or "the") body part, not a figure of speech. */
const BODY_LEADERS = new Set(['the', 'a', 'my', 'both', 'left', 'right', 'lower', 'upper', 'mid', 'middle', 'other', 'front', 'rear', 'one', 'that', 'this']);
/** After a body part, these say how it is: "knee is wonky", "Achilles was off", "wrist keeps clicking". */
const BODY_STATE = new Set([
  'is', 'isn', "isn't", 'isnt', 'was', "wasn't", 'wasnt', 'are', "aren't", 'were', 'feels', 'felt', 'feel', 'feeling', 'went', 'goes',
  'seems', 'seemed', 'has', 'had', 'keeps', 'kept', 'needs', 'still', 'not', 'being', 'playing', 'acting', 'again', 'today', 'tonight',
  'grumbling', 'clicking', 'locking', 'catching', 'giving', 'hurts', 'hurt', 'aches', 'ached', 'stuff', 'thing', 'issue', 'issues',
  'problem', 'problems', 'niggle', 'injury',
]);
const UNCLEAR = [
  'sore', 'soreness', 'tight', 'tightness', 'stiff', 'stiffness', 'achy', 'aching', 'ache', 'aches', 'niggle', 'niggly',
  'niggling', 'uncomfortable', 'discomfort', 'tender', 'clicking', 'clicky',
  // "flared" alone may be technique ("elbows flared"); "flared up" is a phrase below and is pain.
  'flare', 'flared', 'flaring', 'flares',
  // Review r4 B2: conditions said without a verdict, and general symptoms (asked about; see spec issue 2).
  'bulging', 'stitch', 'dizzy', 'dizziness', 'lightheaded', 'faint', 'nauseous', 'nausea', 'palpitations', 'headache', 'migraine',
  'nosebleed', 'breathless',
];
/**
 * Joints, tendons and the like: an effort word next to one of these is a
 * question, not effort ("burning in my elbow", "knee is hard to bend";
 * review r5 B2). Muscles ("quads", "legs", "arms") keep effort words as effort.
 */
const JOINTS = new Set([
  'shoulder', 'shoulders', 'elbow', 'elbows', 'wrist', 'wrists', 'hand', 'hands', 'finger', 'fingers', 'thumb', 'thumbs', 'neck',
  'back', 'spine', 'hip', 'hips', 'groin', 'knee', 'knees', 'ankle', 'ankles', 'foot', 'feet', 'toe', 'toes', 'heel', 'heels',
  'achilles', 'joint', 'joints', 'tendon', 'tendons', 'rotator', 'cuff', 'si', 'lumbar', 'thoracic', 'kneecap', 'kneecaps',
  'patella', 'meniscus', 'acl', 'mcl', 'labrum', 'ligament', 'ligaments', 'nerve', 'vertebra', 'vertebrae', 'jaw', 'collarbone',
  'clavicle', 'sternum', 'rib', 'ribs', 'chest', 'heart', 'knuckle', 'knuckles', 'pelvis', 'tailbone', 'coccyx', 'sacrum', 'head',
  'side', 'one', 'itband', 'scap', 'scaps', 'scapula', 'shoulderblade', 'shoulderblades', 'forearm', 'forearms',
]);
/** Words that make the past tense explicit: pain on another day is asked about, not assumed (review r5 S2). */
const PAST_TIME = /\b(?:last (?:week|time|session|night|month|year|workout|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|yesterday|ago|the other day|used to|previously|earlier (?:this|in the) (?:week|month|year)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|since (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|last|then|january|february|march|april|may|june|july|august|september|october|november|december))\b/;
const EFFORT = ['burn', 'burns', 'burning', 'pump', 'pumped', 'grind', 'grindy', 'grinder', 'heavy', 'tired', 'tiring', 'hard', 'exhausted', 'fried', 'gassed', 'cooked'];

/** Drawn-out exclamations: "owwww", "aaargh", "ouchy" (review r5 B2). */
const EXCLAMATION = /^(?:o+w+|a+r+g+h+|a+r+g+|ou+ch+(?:y|ie)?)$/;
const PAIN_WORDS = new Set(PAIN);
const PAIN_SET = { has: (w: string): boolean => PAIN_WORDS.has(w) || EXCLAMATION.test(w) };
const BODY_SET = new Set(BODY);
const UNCLEAR_SET = new Set(UNCLEAR);
const EFFORT_SET = new Set(EFFORT);
const NEGATORS = new Set([
  'no', 'not', "doesn't", 'doesnt', "didn't", 'didnt', "isn't", 'isnt', "wasn't", 'wasnt', "don't", 'dont', 'nothing', 'zero', 'aint', "ain't",
  // Review r5 S2.
  "hasn't", 'hasnt', "haven't", 'havent', "hadn't", 'hadnt', "aren't", 'arent', "weren't", 'werent',
]);
/** Words that may sit between a negator and the pain word without breaking it: "no real pain", "doesn't really hurt". */
const NEGATION_FILLERS = new Set(['real', 'really', 'any', 'actual', 'much']);
/** A negator this far back in the same clause makes it a question, not a no ("I don't think it hurts"). */
const DOUBT_WINDOW = 4;
/** "It didn't hurt until set 3": the negation is about before, the pain is now. */
const NEGATION_BREAKERS = new Set(['until', 'till', 'except', 'unless', 'before']);

function clauses(text: string): string[][] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    // "knee's" → "knee is", "it's" → "it is" (review r3 B2). "let's" stays.
    .replace(/\b(?!let's\b)([a-z]+)'s\b/g, '$1 is')
    // "pain-free", "pain free": a negated pain word (review r3 nit).
    .replace(/\b(pain|hurt|injury)[- ]free\b/g, 'no $1')
    // "IT band", "hip-flexor": one word each (review r4 B2).
    .replace(/\bi\.?t\.? band\b/g, 'itband')
    .replace(/\blight[- ]headed\b/g, 'lightheaded')
    .replace(/\b(hip|knee|shoulder|ankle|wrist|elbow)-/g, '$1 ')
    // "pins & needles" (review r5 B2).
    .replace(/\s*&\s*/g, ' and ')
    .split(/[,.;:!?\n]+|\s+(?:but|though|although|however)\s+/)
    .map((c) => c.split(/[^a-z0-9']+/).filter((w) => w.length > 0))
    .filter((c) => c.length > 0);
}

type Negation = 'negated' | 'doubt' | 'clear';

function negationOf(ws: readonly string[], i: number): Negation {
  if (NEGATION_BREAKERS.has(ws[i + 1] ?? '')) return 'clear';
  let j = i - 1;
  while (j >= 0 && NEGATION_FILLERS.has(ws[j] ?? '')) j -= 1;
  if (j >= 0 && NEGATORS.has(ws[j] ?? '')) return 'negated';
  for (let k = Math.max(0, i - DOUBT_WINDOW); k < i; k += 1) {
    if (NEGATORS.has(ws[k] ?? '')) return 'doubt';
  }
  return 'clear';
}

/** "You're killing it" is praise, not pain. */
function idiom(ws: readonly string[], i: number): boolean {
  if (ws[i] === 'killing' && ws[i + 1] === 'it') return true;
  // "foam rolled my quads" is recovery work, not an injury.
  if (ws[i] === 'rolled' && ws[i - 1] === 'foam') return true;
  const w = ws[i] ?? '';
  const next = ws[i + 1] ?? '';
  // Review r5 B2/S2: "let's crack on", "cracked 100", "snapped a photo", "pulled 200 today",
  // "popped another plate on", "a ping on my phone".
  if ((w === 'crack' || w === 'cracked') && (next === 'on' || next === 'it' || next === 'open' || /^\d/.test(next) || next === 'a' && /^(?:pb|pr|smile|joke|beer)$/.test(ws[i + 2] ?? ''))) return true;
  if ((w === 'snap' || w === 'snapped') && (next === 'a' || next === 'some') && /^(?:pic|picture|photo|selfie|video|shot)s?$/.test(ws[i + 2] ?? '')) return true;
  if (w === 'snapped' && next === 'at') return true;
  if (w === 'pulled' && (/^\d/.test(next) || ((next === 'a' || next === 'an') && /^(?:pb|pr|single|double|triple|\d.*)$/.test(ws[i + 2] ?? '')))) return true;
  if ((w === 'ping' || w === 'pinged') && (ws.includes('phone') || ws.includes('message') || ws.includes('text') || ws.includes('notification') || next === 'me' || next === 'you')) return true;
  if (['pop', 'popped', 'popping'].includes(w) && !anyBodyPart(ws) && ['another', 'a', 'an', 'the', 'some', 'it', 'them', 'on', 'in', 'one', 'two', 'over', 'out', 'round', 'by'].includes(next)) {
    return ws.some((x) => /^(?:plates?|weights?|kgs?|lbs?|collars?|clips?|pins?|on|in|over|round|by|out|pill|pills|kettle|music|song)$/.test(x));
  }
  if ((w === 'sting' || w === 'stung') && next === 'operation') return true;
  return false;
}

function bodyPartAt(ws: readonly string[], i: number): boolean {
  const w = ws[i] ?? '';
  // "left side", "my right one": a side stands for the part (review r4 B2).
  if (SIDE_ONLY.has(w)) return SIDES.has(ws[i - 1] ?? '');
  return BODY_SET.has(w);
}

/** "my knee", "my left knee", "my lower back": a body part Ben owns at index `i`. */
function ownedAt(ws: readonly string[], i: number): boolean {
  let j = i - 1;
  while (j >= 0 && BODY_QUALIFIERS.has(ws[j] ?? '')) j -= 1;
  return ws[j] === 'my';
}

/**
 * A body part at `i` without "my" that still reads as Ben's body (review r3
 * B2): not followed by an exercise or direction word ("leg press", "back to
 * 100"), and led by "the"/"left"/"dodgy"…, or at the start of the clause,
 * or followed by a state word ("Achilles is grumbling", "knee went again").
 */
function unownedBodyPartAt(ws: readonly string[], i: number): boolean {
  if (!bodyPartAt(ws, i)) return false;
  const next = ws[i + 1];
  const prev = ws[i - 1];
  // "Bad shoulder day": a vague word before the part wins over "day" after it (review r4 nit).
  const vagueBefore = prev !== undefined && VAGUE_BODY.has(prev);
  if (next !== undefined && NOT_BODY_FOLLOW.has(next) && !vagueBefore && !(next === 'and' && bodyPartAt(ws, i + 2))) return false;
  // "rotator cuff", "hip flexor stretch": the last word of a compound decides.
  if (next !== undefined && bodyPartAt(ws, i + 1)) return false;
  if (i === 0 || prev === undefined) return true;
  if (BODY_LEADERS.has(prev) || BODY_QUALIFIERS.has(prev) || VAGUE_BODY.has(prev)) return true;
  return next === undefined || BODY_STATE.has(next);
}

/** A body part Ben owns, or one that reads as his body: ask rather than assume `none`. */
function bodyPartMentioned(ws: readonly string[]): boolean {
  return ws.some((_, i) => bodyPartAt(ws, i) && (ownedAt(ws, i) || unownedBodyPartAt(ws, i)));
}

function anyBodyPart(ws: readonly string[]): boolean {
  return ws.some((_, i) => bodyPartAt(ws, i));
}

/** "feels off", "it's weird", "just feels wrong": a vague word after a state verb, about nothing that isn't Ben (review r4 B2). */
function vagueStateAt(ws: readonly string[], i: number): boolean {
  if (!VAGUE_STANDALONE.has(ws[i] ?? '')) return false;
  if (ws.some((x) => NON_BODY_SUBJECT.has(x))) return false;
  // "off the bench", "off to the gym", "off day": a direction or a day, not a state.
  if ((ws[i] === 'off' || ws[i] === 'busted') && ws[i + 1] !== undefined && !['today', 'again', 'now', 'lately', 'still', 'though', 'tbh', 'mate', 'somehow'].includes(ws[i + 1] ?? '')) return false;
  for (let j = i - 1; j >= Math.max(0, i - 4); j -= 1) if (STATE_VERBS.has(ws[j] ?? '')) return true;
  return false;
}

/** A positive word with a negator just before it ("not great", "isn't happy", "not 100%"). */
function positiveNegated(ws: readonly string[], i: number): boolean {
  for (let j = i - 1; j >= Math.max(0, i - 3); j -= 1) {
    const w = ws[j] ?? '';
    if (POSITIVE_NEGATORS.has(w)) return true;
    if (!['a', 'the', 'very', 'really', 'quite', 'too', 'that', 'so', 'all', 'feeling', 'feel', 'feels', 'felt', 'is', 'was', 'been', 'being', 'at', 'from', 'great', 'super', 'exactly', 'totally', 'entirely', 'fully', 'completely', 'percent', 'yet'].includes(w)) return false;
  }
  return false;
}

/** A joint or tendon in this clause that reads as Ben's body ("my elbow", "knee is", "lower back"). */
function jointMentioned(ws: readonly string[]): boolean {
  return ws.some((w, i) => JOINTS.has(w) && bodyPartAt(ws, i) && (ownedAt(ws, i) || unownedBodyPartAt(ws, i)));
}

/**
 * The first body part Ben names that reads as his body ("my left knee" →
 * `knee`), for the guard note "Not increasing: you mentioned your knee"
 * (review r5 B4). Null when none is named.
 */
export function painBodyPart(text: string): string | null {
  for (const ws of clauses(text)) {
    for (const [i, w] of ws.entries()) {
      if (!bodyPartAt(ws, i) || !(ownedAt(ws, i) || unownedBodyPartAt(ws, i))) continue;
      if (SIDE_ONLY.has(w)) return `${ws[i - 1] ?? ''} side`.trim();
      if (w === 'back' && (ws[i - 1] === 'lower' || ws[i - 1] === 'upper')) return `${ws[i - 1] ?? ''} back`;
      if (w === 'itband') return 'IT band';
      return w;
    }
  }
  return null;
}

export function classifyPainMention(text: string): PainMention {
  let pain = false;
  let unclear = false;
  let effort = false;
  // "Doesn't hurt, just feels wrong": a denied pain word followed by a vague one is asked about (review r4 B2).
  let deniedPain = false;
  for (const ws of clauses(text)) {
    let clauseSignal = false;
    const joined = ws.join(' ');
    // Review r5 S2: pain on another day ("It hurt last week") is asked about, not assumed.
    const pastClause = PAST_TIME.test(joined);
    const painNow = pain;
    const joint = jointMentioned(ws);
    if (SOMETHING_UP.test(joined) || UNCLEAR_PHRASES.some((re) => re.test(joined))) unclear = true;
    for (const re of PAIN_PHRASES) {
      const m = re.exec(joined);
      if (m === null) continue;
      const before = joined.slice(0, m.index).split(' ').filter((w) => w.length > 0);
      const n = negationOf([...before, '\u0000'], before.length);
      clauseSignal = true;
      if (n === 'clear') pain = true;
      else if (n === 'doubt') unclear = true;
    }
    const went = bodyWent(ws);
    if (went >= 0) {
      clauseSignal = true;
      const n = negationOf(ws, went);
      if (n === 'clear') pain = true;
      else if (n === 'doubt') unclear = true;
    }
    for (const [i, w] of ws.entries()) {
      if (PAIN_SET.has(w)) {
        if (idiom(ws, i)) {
          clauseSignal = true;
          continue;
        }
        if (NEEDS_BODY.has(w) && !anyBodyPart(ws) && !ws.some((x) => x !== w && PAIN_SET.has(x) && !NEEDS_BODY.has(x))) continue;
        clauseSignal = true;
        const n = negationOf(ws, i);
        if (n === 'clear') pain = true;
        else if (n === 'doubt') unclear = true;
        else deniedPain = true;
      } else if (UNCLEAR_SET.has(w)) {
        clauseSignal = true;
        if (negationOf(ws, i) !== 'negated') unclear = true;
      } else if (EFFORT_SET.has(w)) {
        clauseSignal = true;
        // Review r5 B2: "burning in my elbow", "knee is cooked": a joint isn't a muscle working.
        if (joint && negationOf(ws, i) !== 'negated') unclear = true;
        else effort = true;
      } else if (NEGATABLE_POSITIVE.has(w) && positiveNegated(ws, i)) {
        // "not great", "isn't happy", "not right": ask (review r3 B2). "Wasn't easy" is effort;
        // "sleep wasn't great" names something other than his body.
        clauseSignal = true;
        if (w === 'easy') effort = true;
        else if (anyBodyPart(ws) || !ws.some((x) => NON_BODY_SUBJECT.has(x))) unclear = true;
      } else if (POSITIVE.has(w)) {
        // "Felt good apart from my elbow": the carve-out is what Ben is flagging.
        if (!CARVE_OUT.test(joined)) clauseSignal = true;
      } else if (VAGUE_BODY.has(w) && anyBodyPart(ws)) {
        // "dodgy knee", "wrist is iffy", "elbow was a bit off": ask.
        if (bodyPartMentioned(ws)) {
          clauseSignal = true;
          if (negationOf(ws, i) !== 'negated') unclear = true;
        }
      } else if (VAGUE_STANDALONE.has(w) && (vagueStateAt(ws, i) || (deniedPain && !ws.some((x) => NON_BODY_SUBJECT.has(x)))) && negationOf(ws, i) !== 'negated') {
        // "Feels off", "it's weird", "Doesn't hurt, just off": ask.
        clauseSignal = true;
        unclear = true;
      }
    }
    // Review r2 B3, r3 B2: a body part with nothing else said is a question, never `none`.
    if (!clauseSignal && bodyPartMentioned(ws)) unclear = true;
    if (pastClause && pain && !painNow) {
      pain = false;
      unclear = true;
    }
  }
  if (pain) return 'pain';
  if (unclear) return 'unclear';
  if (effort) return 'effort';
  return 'none';
}

/**
 * Which of the workout's exercises Ben's words name, for rule 9's
 * `messagePain` (a pain or unclear mention blocks increases on the named
 * movements only, and on every movement when none is named).
 *
 * Conservative by design (coach review B2):
 * - only a whole exercise name counts (`romanian deadlift`, plural allowed),
 *   never a lone word of it, so "back" never names Back squat;
 * - when the words name a body part, nothing is named: a body part can't be
 *   mapped to the movements that load it, so every increase is blocked.
 */
export function exercisesNamedForPain(text: string, exercises: readonly { exerciseId: string; exerciseName: string }[]): string[] {
  if (painBodyPart(text) !== null) return [];
  return exercisesNamedIn(text, exercises);
}

/** Exercises whose whole name (plural allowed) appears in the words; never a lone word of a name. */
export function exercisesNamedIn(text: string, exercises: readonly { exerciseId: string; exerciseName: string }[]): string[] {
  const norm = (s: string): string => ` ${s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const said = norm(text);
  const out: string[] = [];
  for (const ex of exercises) {
    const name = norm(ex.exerciseName).trim();
    if (name.length === 0) continue;
    if (said.includes(` ${name} `) || said.includes(` ${name}s `) || said.includes(` ${name}es `)) out.push(ex.exerciseId);
  }
  return [...new Set(out)];
}
