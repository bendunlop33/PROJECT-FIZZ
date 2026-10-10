# Onboarding (first-run setup)

> **Revision 2026-10-09 (import from any app).** The Ready screen's optional row is now `Import training history` (`FitNotes, other apps, spreadsheets or notes`) and opens `Import history` ([data-import-export.md](data-import-export.md) §9.2.1). During onboarding the coach is usually not connected yet. That screen says so and that FitNotes files still import offline, so this row never pushes Ben to connect the coach. Changed: §2.6 wireframe, §3.4, §5 Ready optional, cross-links.

> **Revision 2026-10-09 (playbook v1 review fixes).**
> - **Effort for every other-training type.** Each chosen type gets `Hard or long` / `Easy` (optional), not just `Other`. Only hard, long or key entries turn the endurance switch on, so an easy jog or a yoga class changes nothing. `Classes or HIIT` and `Team or court sport` start on `Hard or long`, and Ben can change it.
> - **Missing values are named, not filled in.** Skipping days a week means weekly sets aren't worked out until Ben gives them; the coach asks when he asks it to plan. Skipping session length means plans assume 60 min, labelled `(assumed)`. Skipping experience means the lowest start cap, labelled. The "rule defaults" wording is gone.
> - **7 days a week** is defined in the playbook: the 6-day split plus one short accessory day.
> - The goal and other-training fields are the D13 design, **pending Ben's bulk approval** (open-decisions §B). Checks 16, 19 and 20 are marked that way.
> - The cross-link name is `Applied to you` (was `Your training context`), matching coaching-playbook §2.1a.
> - Changed: §2.7 step 2 and 3, §3.2, §5, §6, §7 checks 16, 19–20 and new 22–23, cross-links.

> **Revision 2026-10-09 (coaching playbook v1, approved by Ben 9 Oct).** [playbook-v1.md](../training-guides/playbook-v1.md) adapts targets to Ben's goal and to how he trains. Ben's direction: weekly volume "should be guided by how often people say they gym per week", and "stop with hyrox, it should be more adaptable depending on what the goal is / how training is being run". So **About your training** now collects what the playbook reads:
> - **Goal (step 1):** the main-focus options now match the playbook: `Strength`, `Muscle`, `General fitness`, `Maintain`, `Support other training`. There's an optional `Working towards` field with a date. The HYROX placeholder is gone; examples are neutral.
> - **How you train (step 2):** `Days a week you lift` is now the key question, because rule 1 starts weekly sets from it. The step also asks session length, usual days (optional) and experience.
> - **Other training (new step 3):** running, cycling, swimming, rowing, classes or HIIT, team or court sport, or other, each with optional usual days. This drives the endurance switch for rules 11–13.
> - Limitations move to step 4. The block is now 4 short steps, each optional, and still offered only after Essentials (OB1).
> - Field layout is the design answer to playbook open decision D13. It's listed for Ben's bulk approval in [open-decisions.md](open-decisions.md) (§B "Goals and week"). Priority muscle groups and event details are set in Profile only, to keep this short.
> - Changed: §1, §2.6, §2.7, §3.2, §3.4, §4.1a (new), §5, §6, §7 checks 11 and 16–21, §8 OB1 and OB5.

> **Revision 2026-10-08 (consolidation).**
> - **Backup step replaced (approved by Ben, relayed by the product manager).** Backups now live in the app by default, so onboarding no longer asks Ben to save a file or choose a folder. Step 3 is a short, skippable explainer (§2.5). Data-import-export's X1 (`Choose backup folder` here) is withdrawn. OB2 is withdrawn; OB1 is revised. The `verifyBackup` test is no longer part of onboarding; it lives in Data & backup → `Check a backup`.
> - Placeholder links replaced: the coach routes are [ai-connection.md](ai-connection.md); restore, import and backups are [data-import-export.md](data-import-export.md).
> - Pain flags use the canonical `setPainFlag({exerciseIds[], active, area?, note?, source}, opId)` from [coach-memory.md](coach-memory.md) §6; the flags are listed and cleared in Pain flags (coach-memory.md §2.1, reached from Profile → Pain flags).
> - `ProvenanceTag` and `StepResultLine` are now `SourceTag` and `StepRow` in design-system.md (§9.28, §9.42); the other additions are merged there (§11).
> - Data domains: everything onboarding writes is **Your data**; the gym presets it reads are **Coaching knowledge** (design-system §7.2).

Status: v0.1 draft, 8 Oct 2026. Tokens: [design-system.md](design-system.md). Gym details: [gym-editor.md](gym-editor.md). Settings that onboarding writes are edited later in [profile-and-settings.md](profile-and-settings.md).

## 1. Purpose

Onboarding answers **"What does the app need before I can log my first set safely?"**

Its single primary action on every step is **`Continue`**. The whole flow ends on Today, where `Start empty workout` is one tap away.

The brief (§1) lists seven first-run items: goals and priorities, experience, weekly availability, session length, units, first gym and optional limitations, with the AI connection skippable. It also says onboarding must be "short enough to start logging immediately" and that richer questions "can follow when they affect a decision".

This spec splits the flow:

- **Essentials (3 steps):** how you log (units and rest presets), first gym, and a short explainer about how data is kept (skippable; revision consolidation). The first two are the only things that change what the logging screen does.
- **About your training (optional, 4 short steps; revised 9 Oct):** goal; how you train (days a week, session length, usual days, experience); other training; limitations. These only feed the coach and the workout builder (playbook rules 1 and G). The built-in rule (7-F) doesn't read them, because it never adds sets (review fixes). They're offered once at the end of Essentials and can be done later from Profile.
- **Coach connection (optional, 1 step):** a single skippable card linking to [ai-connection.md](ai-connection.md).

This is a change to the brief's ordering, not its content. See §8 (proposal OB1).

**Permissions are never asked during onboarding.** Each one is asked the first time a feature needs it (§4.6).

## 2. Layout

Every step uses the same frame, top to bottom:

1. **Top bar (44pt).** `Back` (left, text button) and, on optional steps only, `Skip` (right, text button). The step counter sits centred: `Step 2 of 3` (`type.label`, `text.secondary`). There's no progress bar or ring.
2. **Title** (`type.title2`) and one line of explanation (`type.callout`, `text.secondary`).
3. **Content (scrolls).** Choice cards, chips or fields.
4. **Bottom bar (fixed).** `PrimaryButton` `Continue` (or the step's specific label). It sits on `bg.surface` with a top `border.divider`, like the workout `ActionBar` but without the Talk button. When the keyboard is open, the bar sits directly above it.

The flow has no tab bar and no Ask pill. Onboarding is a full-screen stack presented over the tab shell. It's dismissed only by finishing or by restoring a backup.

### 2.1 Welcome

```
┌────────────────────────────────────────┐
│                                        │
│ Set up your training log               │ type.title2
│                                        │
│ Takes about 2 minutes. Everything is   │ type.body, text.secondary
│ saved on this phone. Nothing needs an  │
│ account or the internet.               │
│                                        │
│ You'll set:                            │
│  1  Units and rest times               │
│  2  Your gym's equipment               │
│  3  How your data is kept              │
│                                        │
│ Coach, goals and history import are    │
│ optional and can come later.           │
│                                        │
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │              Set up                │ │ PrimaryButton
│ └────────────────────────────────────┘ │
│        Restore from a backup           │ text button, accent, 44pt
└────────────────────────────────────────┘
```

`Restore from a backup` is placed here on purpose. Under ADR 0004, changing the signing tool or Apple ID installs a new, empty app, and the documented fix is "copy to Files, new app, restore". Ben must be able to restore **before** he's asked to set anything up again. On this empty phone both backup sections (`Your data` and `Coaching knowledge`) are pre-ticked in the restore preview (data-import-export.md §2.3).

### 2.2 Step 1 of 3: How you log

```
┌────────────────────────────────────────┐
│                Step 1 of 3             │
│ How you log                            │
│ You can change these any time in       │
│ Profile.                               │
│                                        │
│ Weights in                             │
│ ┌─────────────────┐ ┌─────────────────┐│
│ │ ✓ Kilograms (kg)│ │  Pounds (lb)    ││ segmented, 52pt
│ └─────────────────┘ └─────────────────┘│
│ Picked from your phone's region.       │ text.secondary
│ Each piece of equipment keeps its own  │
│ unit, so a kg gym and a lb gym both    │
│ work.                                  │
│                                        │
│ Rest times                             │
│ Starting points, not advice. Edit them │
│ to match how you train.                │
│ ┌────────────────────────────────────┐ │
│ │ Warm-up                    1:00  › │ │ tap → wheel picker
│ │ Standard (default)         1:30  › │ │
│ │ Heavy                      3:00  › │ │
│ └────────────────────────────────────┘ │
│                                        │
├────────────────────────────────────────┤
│ [             Continue               ] │
└────────────────────────────────────────┘
```

- This is where "the onboarding shows them once" (rest-state.md §4.2) happens. The source wording `Starting points, not advice` matches the brief's "UI examples, not an individual training prescription".
- Tapping a preset opens the same wheel picker as the rest duration editor (rest-state.md §2.4): minutes and seconds in 15 s steps, `Done`.
- The unit default is a preference default from the locale (en-GB gives kg), not personal data, so preselecting it doesn't break the "don't prefill as if confirmed" rule. The caption says where it came from.

### 2.3 Step 2 of 3: Your gym (starting point)

```
┌────────────────────────────────────────┐
│ ‹ Back         Step 2 of 3             │
│ Where do you train most?               │
│ Pick the closest match. You'll check   │
│ the equipment next.                    │
│                                        │
│ Gym name                               │
│ ┌────────────────────────────────────┐ │
│ │ Main gym                           │ │ text field, prefilled, editable
│ └────────────────────────────────────┘ │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ ( ) Commercial gym                 │ │ ChoiceCard
│ │     Barbells, dumbbells, cables,   │ │
│ │     machines                       │ │
│ ├────────────────────────────────────┤ │
│ │ ( ) Home: dumbbells and a bench    │ │
│ ├────────────────────────────────────┤ │
│ │ ( ) Home: barbell, rack and plates │ │
│ ├────────────────────────────────────┤ │
│ │ ( ) Hotel or small gym             │ │
│ ├────────────────────────────────────┤ │
│ │ ( ) Start empty                    │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Skip for now: loads won't be checked   │ text button, text.secondary
│ against equipment                      │
├────────────────────────────────────────┤
│ [             Continue               ] │ disabled until a card is chosen
└────────────────────────────────────────┘
```

### 2.4 Step 2 of 3 (continued): Check the equipment

The preset becomes a **draft checklist** (brief §4: "Offer presets as draft equipment lists, then let the user confirm and customise them"). Nothing is saved until `Save gym`.

```
┌────────────────────────────────────────┐
│ ‹ Back         Step 2 of 3             │
│ Main gym: what's there?                │
│ Draft from "Commercial gym". Untick    │
│ anything this gym doesn't have.        │
│                                        │
│ [x] Barbell and plates               › │ › opens detail editor
│     Typical values, not checked        │ ProvenanceTag
│ [x] Dumbbells                        › │
│     Typical values, not checked        │
│ [x] Cable station (weight stack)     › │
│     Typical values, not checked        │
│ [x] Adjustable bench                   │ no numbers needed
│ [x] Squat rack with safeties           │
│ [x] Pull-up bar                        │
│ [ ] Assisted pull-up / dip machine   › │
│ [ ] Plate-loaded machines            › │
│ [ ] Selectorised machines            › │
│ + Add something else                   │
│                                        │
│ You can check the numbers at the gym.  │
│ Until then they're marked "not         │
│ checked".                              │
├────────────────────────────────────────┤
│ [             Save gym               ] │
└────────────────────────────────────────┘
```

- Each checkbox row is at least 52pt tall. The whole row toggles; the `›` area (44 × 44, separated by `space.2`) opens that item's detail editor from [gym-editor.md](gym-editor.md) §2.4 with the preset values filled in.
- Saving a detail editor marks that item `Checked by you` and removes its `not checked` tag.
- `Save gym` calls `createGym` then `addEquipment` for each ticked item, in one transaction (proposed `createGymFromDraft`, §6). Ticked items keep `detailsSource: 'preset'` until Ben saves their details (gym-editor.md §8, proposal GE1).

### 2.5 Step 3 of 3: How your data is kept (revised, consolidation)

A short explainer, nothing to set. Approved by Ben (relayed by the product manager): backups are kept in the app by default; an off-phone copy is optional and can be made any time.

```
┌────────────────────────────────────────┐
│ ‹ Back         Step 3 of 3       Skip  │
│ How your data is kept                  │
│                                        │
│ Your data is saved and backed up on    │ type.body
│ this phone.                            │
│                                        │
│ Copies on the phone are lost if the    │
│ app is deleted or re-signed with a     │
│ different Apple ID. You can save a     │
│ copy to Files any time.                │
│                                        │
│ Save a copy to Files now             › │ optional text row, 44pt
│                                        │
├────────────────────────────────────────┤
│ [             Continue               ] │
└────────────────────────────────────────┘
```

- `Continue` and `Skip` both go to Ready. Nothing is written by this step.
- `Save a copy to Files now` is optional: it calls `createBackup` → `saveBackupToFiles` (data-import-export.md §2.2) and returns here with one line `✓ Copy saved to Files · iCloud Drive › Fizz backups`. Cancelling the picker changes nothing and shows nothing.
- No folder picker, no test, no warning, no confirmation alert.

### 2.6 Ready

```
┌────────────────────────────────────────┐
│ You're ready to log                    │
│                                        │
│ ✓ Units: kg · Rest 1:00 / 1:30 / 3:00  │
│ ✓ Main gym · 6 items (3 not checked)   │
│ ✓ Saved on this phone · backups run    │
│   after each workout                   │
│                                        │
│ Optional, any time                     │
│ ┌────────────────────────────────────┐ │
│ │ About your training            ›   │ │ goal, week, other training,
│ │ About 1 minute. Sets your goal and │ │ limitations (revised 9 Oct)
│ │ week for the coach and builder.    │ │
│ ├────────────────────────────────────┤ │
│ │ Connect the coach              ›   │ │ → §2.8
│ │ Not connected. Logging works       │ │
│ │ without it.                        │ │
│ ├────────────────────────────────────┤ │
│ │ Import training history        ›   │ │ → data-import-export §9.2.1
│ │ FitNotes, other apps, spreadsheets │ │ (revised 9 Oct)
│ │ or notes                           │ │
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│ [            Go to Today             ] │
└────────────────────────────────────────┘
```

Each optional row returns to this screen when finished or skipped, with its line changed to a done state (`✓ Strength · 3 days a week · 60 min` (revised 9 Oct: the saved values, not just "saved"; `✓ Saved` when only some fields were set), `✓ Coach connected (text)`, `Import started` or `Skipped`).

### 2.7 About your training (optional, 4 steps; revised 9 Oct for playbook v1)

Shown only when Ben taps `About your training`. Every field starts **empty**. Nothing is prefilled from history or guessed (brief §1). Each step has `Skip`; skipping a step saves nothing for it (empty means "not set", which is different from `None`).

Why these questions (playbook v1): the **goal** picks the target profile (rule G); **days a week** and **session length** set the weekly starting sets (rule 1, from Ben's direction "guided by how often people say they gym per week"); **other training** decides whether the endurance rules 11–13 apply at all; **experience** sets the starting caps. No question is sport-specific.

**Step 1 of 4: Your goal**

```
┌────────────────────────────────────────┐
│ ‹ Back         Step 1 of 4       Skip  │
│ What's your main goal?                 │ type.title2
│ The coach sets reps, sets and rest     │ type.callout, text.secondary
│ from this. Change it any time.         │
│ ┌────────────────────────────────────┐ │
│ │ ( ) Strength                       │ │ ChoiceCard, single select
│ │     Lift heavier on the main lifts │ │ one-line description
│ ├────────────────────────────────────┤ │
│ │ ( ) Muscle                         │ │
│ │     Build muscle size              │ │
│ ├────────────────────────────────────┤ │
│ │ ( ) General fitness                │ │
│ │     Health, ability and habit      │ │
│ ├────────────────────────────────────┤ │
│ │ ( ) Maintain                       │ │
│ │     Keep what you have, less time  │ │
│ ├────────────────────────────────────┤ │
│ │ ( ) Support other training         │ │
│ │     Lifting that helps your        │ │
│ │     running, cycling, classes or   │ │
│ │     sport                          │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Also matters (optional)                │
│ [Strength] [Muscle] [General fitness]  │ multi-select ParamChip;
│ [Endurance]                            │ the main focus is hidden
│                                        │
│ Working towards something? (optional)  │
│ ┌────────────────────────────────────┐ │
│ │ e.g. 10k run, 140 kg squat         │ │ placeholder in text.tertiary
│ └────────────────────────────────────┘ │
│ Date (optional)              Add date ›│ 44pt row → system date picker
│ The coach asks what it involves when   │ text.secondary, shown once
│ you plan for it.                       │ something is typed
├────────────────────────────────────────┤
│ [             Continue               ] │
└────────────────────────────────────────┘
```

- The five main-focus options are the playbook's goal profiles (rule G): Strength, Muscle, General fitness, Maintain and "performance alongside endurance", shown as `Support other training`. A named event isn't a sixth focus; it sits on top of the focus (`Working towards`).
- `Also matters` hides the chip that matches the main focus. With `Support other training` as the focus, `Endurance` is hidden too (it's implied).
- `Working towards` is free text, stored as data (rule 8), with an optional date. The coach treats it as a named event only when it has a date. It asks what the event involves and whether it's the priority when Ben plans for it, and phase changes are always suggestions he applies. Details can also be set in Profile (profile-and-settings.md §2.2).
- At AX1+ each card's description wraps under its title; the step scrolls and `Continue` stays fixed above the bottom edge.

**Step 2 of 4: How you train**

```
┌────────────────────────────────────────┐
│ ‹ Back         Step 2 of 4       Skip  │
│ How do you train?                      │
│ Your weekly sets start from this, not  │
│ from a fixed number.                   │
│                                        │
│ Days a week you lift                   │ type.headline: the key question
│ [1] [2] [3] [4] [5] [6] [7]            │ single-select ParamChip, compact
│                                        │
│ Usual session length                   │
│ [30 min] [45 min] [60 min]             │ single-select ParamChip
│ [75 min] [90 min]                      │
│                                        │
│ Days you can usually train (optional)  │
│ [Mon][Tue][Wed][Thu][Fri][Sat][Sun]    │ multi-select ParamChip, compact
│ [ ] It changes week to week            │ ChecklistRow
│                                        │
│ How long have you lifted regularly?    │
│ (optional)                             │
│ [Under 1 year] [1–3 years]             │
│ [Over 3 years]                         │
├────────────────────────────────────────┤
│ [             Continue               ] │
└────────────────────────────────────────┘
```

- `Days a week you lift` is the stated frequency, kept separate from **which** days Ben can train. 3 days a week with Mon–Fri available is valid; 3 days a week with only Mon and Wed picked isn't (§3.2).
- `It changes week to week` clears and disables the weekday chips. The days-a-week number still counts as his usual week.
- The session length is what workout-builder.md §3.1 reads as the default `Length` chip and what rule 1 uses for the set budget. Different lengths on different days are set in Profile (profile-and-settings.md §2.2), not here. Time-of-day windows aren't asked here; they come with the calendar (build step 6).
- Experience is asked in years, not as "beginner/advanced" labels, so the answer is a fact rather than a self-rating. It moved here from step 1 because it describes how Ben trains, not what he's aiming for.
- Digit and weekday chips use the compact `ParamChip` size (design-system §9.17): 52pt tall, seven to a row at default size (never narrower than 44pt), wrapping by row at AX1+.
- (Review fixes) `7` is a valid answer. The playbook plans it as the 6-day split plus one short accessory or mobility day, with no extra main-lift sets.
- (Review fixes) Skipping a field leaves it `Not set`; nothing is filled in. Days a week not set: no weekly-set number is worked out until Ben gives it (the coach asks when he asks it to plan). Session length not set: plans assume 60 min, shown as `60 min (assumed)`. Experience not set: the lowest start cap (8 sets a week per muscle), labelled, until there's history.

**Step 3 of 4: Other training (new, 9 Oct)**

```
┌────────────────────────────────────────┐
│ ‹ Back         Step 3 of 4       Skip  │
│ Any other training?                    │
│ Lifting is planned around it.          │
│                                        │
│ [None]                                 │ ParamChip; clears the others
│ [Running] [Cycling] [Swimming]         │ multi-select ParamChip
│ [Rowing] [Classes or HIIT]             │
│ [Team or court sport] [Other]          │
│                                        │
│ Running                                │ one block per chosen type
│ Usual days (optional)                  │
│ [Mon][Tue][Wed][Thu][Fri][Sat][Sun]    │
│ Usually (optional)                     │ review fixes: every type
│ [Hard or long] [Easy, like a walk]     │ single-select ParamChip
│                                        │
│ Other: what is it?                     │ only when Other is chosen
│ ┌────────────────────────────────────┐ │
│ │ e.g. climbing                      │ │
│ └────────────────────────────────────┘ │
│ Usually (optional)                     │
│ [Hard or long] [Easy, like a walk]     │
│                                        │
│ You can mark key sessions, like a long │ text.secondary
│ run or a match, in Profile or your     │
│ weekly plan.                           │
├────────────────────────────────────────┤
│ [             Continue               ] │
└────────────────────────────────────────┘
```

- Choosing `None` saves "no other training" as a confirmed fact. Skipping saves nothing (§3.2).
- How each choice maps (deterministic, `resolveTrainingContext`, §6; revised in the review fixes):
  - Running, cycling, swimming and rowing count as endurance.
  - `Classes or HIIT` counts as hard classes. Its `Usually` starts on `Hard or long`.
  - `Team or court sport` counts as sport. Its `Usually` starts on `Hard or long`, and its matches are key sessions.
  - `Other` counts as endurance-type when Ben names it.
  - **Every type** has the optional `Usually` choice. Only an entry that's `Hard or long` (or has a key day, set later in Profile or the weekly plan) turns the endurance switch on, so that rules 11 and 12 apply. `Easy` changes nothing in the rules, and neither does an entry with no effort set and no key day. Otherwise those rules stay off and the coach doesn't mention them.
  - Rule 13 also needs endurance to be one of Ben's goals (step 1: `Support other training`, or `Endurance` under also matters).
- Each block is one tap per answer. With several types chosen, the blocks stack and the step scrolls; `Continue` stays fixed above the bottom edge.
- When the main focus is `Support other training` and nothing is chosen here, one `text.secondary` line shows above the chips: `Add what you train for so lifting can be planned around it.` It never blocks `Continue`.
- Key days aren't asked here, to keep the step short. Marking them is in Profile (`Other training` editor) and in the weekly plan's session sheet.

**Step 4 of 4: Anything to work around?**

```
│ Anything to work around? (optional)    │
│ ┌────────────────────────────────────┐ │
│ │ e.g. left shoulder, no overhead    │ │
│ │ pressing                           │ │
│ └────────────────────────────────────┘ │
│ The coach reads this. It doesn't       │
│ diagnose anything.                     │
│                                        │
│ Stop load increases on a movement      │
│ (optional)                             │
│ + Choose movements                     │ → exercise picker, multi-select
│                                        │
│ Pain flags hold loads until you clear  │
│ them in Profile.                       │
├────────────────────────────────────────┤
│ [           Save and finish          ] │
```

`Choose movements` sets a pain flag on the chosen movements (`setPainFlag({exerciseIds, active: true, source: 'setup'}, opId)`, coach-memory.md §6), the same flag as the `Pain` chip in the workout (coach-adjustments.md §4.5). The free-text note alone never sets a flag; CLAUDE.md rule 9 and workout-builder.md §5.1 treat text as context, and only an explicit choice blocks increases.

### 2.8 Connect the coach (optional)

```
┌────────────────────────────────────────┐
│ ‹ Back                           Skip  │
│ Connect the coach (optional)           │
│                                        │
│ The coach can adjust your sets when    │
│ you ask, build workouts and review     │
│ sessions. Logging, rest timers and the │
│ built-in progression rules work        │
│ without it.                            │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ Use my ChatGPT plan              › │ │
│ │ Not tested on iPhone yet.          │ │ honest status from capabilities
│ ├────────────────────────────────────┤ │
│ │ Use my own API key               › │ │
│ │ Paid separately by you.            │ │
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│ [              Not now               ] │
└────────────────────────────────────────┘
```

- `Use my ChatGPT plan` opens [ai-connection.md](ai-connection.md) §2.2 (explainer, then sign-in); `Use my own API key` opens ai-connection.md §2.7 (cost confirmation and key entry). When `chatgptSignIn` is false (spike S1 not passed), the plan row shows ai-connection's unsupported text and is disabled. Onboarding only shows the entry and the status text from `getAiCapabilities`. When the coach flow finishes or is cancelled, Ben comes back here, then to Ready.
- The primary on this step is `Not now`, because skipping is the expected path for a first run.
- No route is ever chosen automatically, and no paid route is suggested as a fallback for the plan route (rule 7).

## 3. States

### 3.1 Flow states

| State | Trigger | What Ben sees |
|---|---|---|
| First launch | The database opens and has no `UserProfile` | Welcome |
| Resumed mid-setup | Relaunch with `onboardingState` not `done` | The first incomplete Essentials step. Saved steps aren't asked again. No "welcome back" screen |
| Database error | SQLite can't be opened | Not onboarding. Today's database error state (`Couldn't open your training data.` [Try again] [Restore from backup], today.md §3) |
| Restored from Welcome | `restoreBackup` succeeds and the restored data has a profile | Onboarding closes and Today opens (or Active workout if the restored backup had an unfinished session under 6 h old: flow §4.2) |
| Restored, no profile in the file | The backup predates setup | Onboarding continues at Step 1, with any restored gyms listed on Step 2 as `Use Main gym (from your backup)` |
| Restore cancelled or failed | Picker cancelled, or the restore flow (data-import-export.md §3.3) reports an error | Back on Welcome. The restore flow's error message shows as a `StatusBanner`. Nothing changed |
| Essentials done | Step 3 `Continue` or `Skip` | Ready |
| Done | `Go to Today` | Today (No plan state, or No gym if the gym was skipped). `onboardingState = done` |

### 3.2 Step states

| Step | State | Display | Primary |
|---|---|---|---|
| 1 How you log | Normal | Unit preselected from region, presets shown | `Continue` (always enabled) |
| 2 Gym, starting point | No card chosen | Cards unselected | `Continue` disabled, label `Choose a starting point` |
| 2 Gym, starting point | Name empty | Field shows inline `Give the gym a name` (`status.warning` border + text) | `Continue` disabled |
| 2 Gym, checklist | Normal | Ticked items with `not checked` tags | `Save gym` |
| 2 Gym, checklist | Nothing ticked | Hint `Nothing ticked. Logging still works, but loads won't be checked.` | `Save empty gym` |
| 2 Gym, checklist | Item detail invalid | The item's row shows `(!) Needs fixing: max is below the bar weight` (validator text) | `Save gym` disabled until fixed or unticked |
| 2 Gym | Skipped | `Skip for now…` tapped | Goes to Step 3. Ready shows `No gym yet` with `Add gym ›` |
| 3 Data explainer | Normal | §2.5 | `Continue` (always enabled); `Skip` in the top bar |
| 3 Data explainer | Copy saved to Files (optional) | `✓ Copy saved to Files · <location>` under the text | `Continue` |
| 3 Data explainer | Optional copy failed or cancelled | Cancel: nothing shown. Failure: `Couldn't save the copy: <system reason>. Your data on this phone is fine.` | `Continue` |
| About you | Any field empty | Valid; empty means "not set" | `Continue` enabled |
| About you, step 2 (9 Oct) | Fewer usual days picked than days a week | `NoteLine` warning under the weekday chips: `3 days a week, but only 2 days picked. Add a day or clear them.` | `Continue` disabled, label `Check your days`. Clearing the weekdays, adding one, lowering the number or ticking `It changes week to week` fixes it |
| About you, step 2 | Days a week set, nothing else | Valid. Rule 1 starts from the days a week. Session length reads `Not set` and plans assume `60 min (assumed)`; experience reads `Not set` and the lowest start cap is used, labelled (revised in the review fixes; was "rule defaults") | `Continue` |
| About you, step 2 | Nothing set (skipped) | Valid. Days a week `Not set`: no weekly-set number is worked out, and the coach asks for days and length when Ben asks it to plan | `Continue` |
| About you, step 3 (9 Oct) | `None` chosen | Other chips cleared; usual-days rows hidden | `Continue` (saves "no other training", confirmed) |
| About you, step 3 | `Other` chosen with no name | Field shows `Name it so the coach knows what it is` (`status.warning` border + text) | `Continue` disabled until named or `Other` is unticked |
| About you, step 3 | Main focus is `Support other training`, nothing chosen | Hint line (§2.7) | `Continue` enabled |
| Coach | Offline | Both rows show `No connection. You can connect later in Profile.` and are disabled | `Not now` |
| Coach | Route unavailable in this build | Row shows `Not available in this build yet` and is disabled | `Not now` |

### 3.3 Offline, AI unavailable, loading

- **Offline:** every Essentials step works. An optional copy saved to iCloud Drive while offline is still written; the line adds `iCloud uploads it when you're back online.`
- **AI unavailable:** only §2.8 changes. Nothing else mentions AI.
- **Loading:** all reads are local. If a step's data takes over 300 ms, static grey blocks show (no shimmer), as on Today.

### 3.4 Transitions

```
Welcome ─Set up─► Step 1 ─► Step 2 (start) ─► Step 2 (checklist) ─Save gym─► Step 3 ─► Ready ─Go to Today─► Today
   │                          └─Skip for now──────────────────────────────►┘          │
   └─Restore from a backup─► restore (data-import-export §2.3) ─ok─► Today            ├─► About you (4) ─► Ready
                                                └─cancel/fail─► Welcome               ├─► Connect coach ─► Ready
                                                                                      └─► Import history (data-import-export §9) ─► Ready
```

`Back` on any step returns to the previous step with its saved values. Going back over a saved gym edits that gym (`updateGym`), it never creates a second one.

## 4. Interactions

### 4.1 General
- One primary per step, fixed at the bottom, always above the keyboard.
- Text fields use the system keyboard. Return moves to the next field. On the last field Return closes the keyboard; it never submits the step.
- Chips and cards toggle on tap. Tapping a selected single-select chip again clears it (ParamChip behaviour).
- No swipe gestures are needed. The system back-swipe works as `Back`.
- Every step writes when `Continue` is tapped, with an operation ID, so a force-close never loses a finished step and a double tap never saves twice.

### 4.1a About your training (revised 9 Oct)
- Step 1 `Continue` → `saveTrainingGoals(…, source: 'setup', expectedVersion, opId)`. Step 2 → `saveTrainingSetup(…)`. Step 3 → `saveOtherTraining(…)`. Step 4 → the note and any pain flags (§2.7). Each write is versioned, so editing later in Profile makes a new version with its own provenance.
- `Add date ›` opens the system date picker (inline wheel in a sheet, `Done` / `Clear`). Dates before today are rejected with `Pick a date from today on.`
- Tapping `None` on step 3 deselects every other chip; tapping any type deselects `None`.
- Removing a type on step 3 removes its usual-days row and anything picked in it.
- `Back` keeps unsaved choices on the step being left. `Skip` leaves that step's saved values unchanged.
- Nothing on these steps changes a plan or a target by itself. A rebuilt plan is always a suggestion Ben applies (playbook rule 1, CLAUDE.md rule 2).

### 4.2 Gym steps
- Preset choice calls `buildPresetDraft(presetId, unit)` (proposed). Changing the preset after visiting the checklist asks `Replace the checklist with the "Home: dumbbells" draft? Your changes to it will be lost.` [Replace] [Keep mine].
- `+ Add something else` opens the add-equipment sheet from gym-editor.md §2.3.
- `Start empty` goes straight to Step 3 after creating a gym with no equipment. Ready shows `Main gym · no equipment yet`.

### 4.3 Data explainer step (revised, consolidation)
- Nothing to decide. Automatic backups on this phone are on by default and run after the first finished workout (data-import-export.md §3.2).
- `Save a copy to Files now` is optional: `createBackup(store, {at, app})` (ADR 0005) → `saveBackupToFiles` (system export picker, default iCloud Drive). It never blocks `Continue`.
- No test runs here. `Check a backup` (`verifyBackup`) lives in Data & backup. The SideStore trial run (ADR 0004) is tracked by the trial-run line in Data & backup.

### 4.4 No backup nagging
There's no "Skip the backup?" alert and no `Not backed up yet` warning on Ready or Profile. Off-phone copies are offered only at risky moments and by the quiet 30-day row (data-import-export.md §4.1a, §3.1).

### 4.5 Restore from Welcome
`Restore from a backup` opens the restore flow in [data-import-export.md](data-import-export.md) §2.3 (choose a file, check, preview by section with counts and the "replaces" warning, then Restore). Onboarding doesn't define that UI. It only defines the entry and the two exits in §3.1.

(PM decision on review SP4, 2026-10-09.) Built in this form: the empty phone skips the `Save a copy to Files first` offer, and nothing is replaced, so there's no alert. After `Done` the app relaunches; if the restored data has a profile, setup is skipped, even when the backup was saved part-way through setup (it's marked set up, and the gym editor covers anything missing). This is worked out at launch from the data, not by a step after the switch, so a force-close between `Restore` and `Done` still opens Today (review R3): when the last switch was a restore and the profile came with the backup (created before the switch), it's marked set up. The same holds for a part-way backup restored from Data & backup. If the restored data has no profile, Welcome shows again, and a profile made on this phone after that restore goes through setup as usual.

**Exits after the switch** (PM decision RS2 on the re-review, 2026-10-09). Once `Restore` is tapped, the Welcome restore has no Back: the header Back button is hidden and the swipe-back gesture is off on the restoring cover and on the `Restored` step. The only exits are `Done`, which relaunches Fizz (cold-start recovery runs: an unfinished workout from the backup reopens and rest alerts are reconciled; a restored profile opens Today), and `Undo restore`, which switches back to the empty install and relaunches into Welcome. Back before `Restore` (choosing, checking, preview) returns to Welcome as usual. Going back to first-run setup over restored data would let setup overwrite the restored profile and add a second gym (review R2).

### 4.6 Permission priming (in context, never up front)

No system permission prompt appears during onboarding. Each permission is asked once, at the moment its feature is first used, with a one-line explanation **before** the system prompt. If Ben says no, the feature shows an honest off state and a way to iOS Settings; nothing else breaks.

| Permission | Asked when | Priming (in-app, before the system prompt) | If denied |
|---|---|---|---|
| Notifications | First rest of the first workout (rest-state.md §3, `Notifications not allowed` row), or Profile → Voice & alerts → `Allow` | `Get an alert when rest ends while your phone is locked?` [Allow] [Not now]. Defined in rest-state.md | Rest still runs on screen. Profile: `Rest alerts are off in iOS Settings` [Open Settings] |
| Microphone + Speech recognition | First tap on Talk, or first time Ben picks `Conversation` or turns on `Listen during rest` | In the voice strip: `Talk uses the microphone. Speech is turned into text on this phone, and the audio isn't saved.` [Continue] [Not now]. Then the two system prompts in a row | Talk shows `Ask` (text). Strip: `Voice isn't available: microphone is off in iOS Settings` [Settings] (active-workout.md §2.5) |
| Loud alerts (AlarmKit) | Ben turns on `Loud rest alerts` in Profile | Sheet: `Loud alerts ring even in silent mode and Focus, with a full-screen alarm. Best for long rests.` [Turn on] [Cancel] | The switch returns to off with `Turned off in iOS Settings` |
| Personal Voice | Ben chooses `Personal Voice` in the voice picker | `iOS will ask to let this app use your Personal Voice for spoken cues.` [Continue] [Cancel] | The row reads `Not allowed in iOS Settings` |
| Files | Never asked. The system document picker needs no permission | n/a | n/a |
| Location | **Never asked.** Gyms use a typed label (brief §4: coordinates optional, not required) | n/a | n/a |

"Not now" on any priming doesn't trigger the system prompt, so the one-time iOS prompt is kept for when Ben actually wants the feature.

### 4.7 Voice equivalents
None. Voice isn't set up during onboarding and no microphone is opened.

### 4.8 Undo
- Every value is editable afterwards in Profile, so no step has an Undo toast.
- `Back` revisits any Essentials step before Ready.
- A gym created here can be edited, duplicated or archived in the gym editor.
- Pain flags set here are cleared in Profile → Pain flags.

## 5. Copy

| Element | Text |
|---|---|
| Welcome title | `Set up your training log` |
| Welcome body | `Takes about 2 minutes. Everything is saved on this phone. Nothing needs an account or the internet.` |
| Welcome list | `You'll set:` `Units and rest times` · `Your gym's equipment` · `How your data is kept` |
| Welcome footer | `Coach, goals and history import are optional and can come later.` |
| Welcome actions | `Set up` · `Restore from a backup` |
| Step counter | `Step 1 of 3` (Essentials) · `Step 1 of 4` (About your training, revised 9 Oct) |
| Step 1 title | `How you log` / `You can change these any time in Profile.` |
| Unit | `Weights in` · `Kilograms (kg)` · `Pounds (lb)` · `Picked from your phone's region.` · `Each piece of equipment keeps its own unit, so a kg gym and a lb gym both work.` |
| Rest | `Rest times` · `Starting points, not advice. Edit them to match how you train.` · `Warm-up 1:00` · `Standard (default) 1:30` · `Heavy 3:00` |
| Step 2 title | `Where do you train most?` / `Pick the closest match. You'll check the equipment next.` |
| Gym name | Label `Gym name`, default `Main gym`. Error `Give the gym a name` |
| Presets | `Commercial gym` (`Barbells, dumbbells, cables, machines`) · `Home: dumbbells and a bench` · `Home: barbell, rack and plates` · `Hotel or small gym` · `Start empty` |
| Skip gym | `Skip for now: loads won't be checked against equipment` |
| Checklist title | `Main gym: what's there?` / `Draft from "Commercial gym". Untick anything this gym doesn't have.` |
| Item tag | `Typical values, not checked` · after saving details: `Checked by you` |
| Checklist footer | `You can check the numbers at the gym. Until then they're marked "not checked".` |
| Checklist primary | `Save gym` · `Save empty gym` |
| Step 3 title | `How your data is kept` |
| Step 3 body | `Your data is saved and backed up on this phone.` · `Copies on the phone are lost if the app is deleted or re-signed with a different Apple ID. You can save a copy to Files any time.` (wording approved by Ben) |
| Step 3 option | `Save a copy to Files now` · result `Copy saved to Files · <location>` · `iCloud uploads it when you're back online.` · failure `Couldn't save the copy: <reason>. Your data on this phone is fine.` |
| Ready title | `You're ready to log` |
| Ready lines | `Units: kg · Rest 1:00 / 1:30 / 3:00` · `Main gym · 6 items (3 not checked)` · `Saved on this phone · backups run after each workout` (+ `Copy saved to Files` when one was made) / `No gym yet` |
| Ready optional | `About your training` (`About 1 minute. Sets your goal and week for the coach and builder.`; done: `Strength · 3 days a week · 60 min` or `Saved`) · `Connect the coach` (`Not connected. Logging works without it.`) · `Import training history` (`FitNotes, other apps, spreadsheets or notes`; revised 9 Oct) |
| Ready primary | `Go to Today` |
| Goal (revised 9 Oct) | `What's your main goal?` · `The coach sets reps, sets and rest from this. Change it any time.` · `Strength` / `Lift heavier on the main lifts` · `Muscle` / `Build muscle size` · `General fitness` / `Health, ability and habit` · `Maintain` / `Keep what you have, less time` · `Support other training` / `Lifting that helps your running, cycling, classes or sport` · `Also matters (optional)` · `Strength` `Muscle` `General fitness` `Endurance` · `Working towards something? (optional)` · placeholder `e.g. 10k run, 140 kg squat` · `Date (optional)` · `Add date` · `The coach asks what it involves when you plan for it.` · `Pick a date from today on.` |
| How you train (revised 9 Oct) | `How do you train?` · `Your weekly sets start from this, not from a fixed number.` · `Days a week you lift` · `1` … `7` · `Usual session length` · `30 min` … `90 min` · `Days you can usually train (optional)` · `It changes week to week` · `How long have you lifted regularly? (optional)` · `Under 1 year` `1–3 years` `Over 3 years` · warning `3 days a week, but only 2 days picked. Add a day or clear them.` · disabled primary `Check your days` |
| Other training (new, 9 Oct; revised in the review fixes) | `Any other training?` · `Lifting is planned around it.` · `None` · `Running` `Cycling` `Swimming` `Rowing` `Classes or HIIT` `Team or court sport` `Other` · block title `<Type>` · `Usual days (optional)` · `Usually (optional)` · `Hard or long` `Easy, like a walk` · `Other: what is it?` · placeholder `e.g. climbing` · `Name it so the coach knows what it is` · `You can mark key sessions, like a long run or a match, in Profile or your weekly plan.` · hint `Add what you train for so lifting can be planned around it.` |
| Limits | `Anything to work around? (optional)` · `The coach reads this. It doesn't diagnose anything.` · `Stop load increases on a movement (optional)` · `Choose movements` · `Pain flags hold loads until you clear them in Profile.` · primary `Save and finish` |
| Coach | `Connect the coach (optional)` · `The coach can adjust your sets when you ask, build workouts and review sessions. Logging, rest timers and the built-in progression rules work without it.` · `Use my ChatGPT plan` · `Use my own API key` (`Paid separately by you.`) · primary `Not now` |
| Coach statuses | From `getAiCapabilities`: `Not tested on iPhone yet.` · `Not available in this build yet` · `No connection. You can connect later in Profile.` |
| Microphone priming | `Talk uses the microphone. Speech is turned into text on this phone, and the audio isn't saved.` [Continue] [Not now] |

No spoken cues anywhere in onboarding.

## 6. Data needed

Existing (brief or ADRs):
- `createGym(profile)`, `updateGym(id, patch)`, `addEquipment(gymId, equipment)` (brief §4).
- `getAchievableLoads(equipment)` for the detail editors' preview (gym-editor.md).
- `createBackup(store, {at, app})` (ADR 0005) and `saveBackupToFiles` for the optional copy; `restoreBackup(file, {sections})` through data-import-export.md's flow.
- `setPainFlag({exerciseIds[], active, area?, note?, source}, opId)` (coach-memory.md §6, canonical).
- `getAiCapabilities(userId)` for the coach card. `beginAiConnection(userId, mode)` is in ai-connection.md.

Proposed new:

| Function | Why |
|---|---|
| `getOnboardingState(ownerId)` → `{state: 'not_started' \| 'essentials' \| 'done', completedSteps[]}` | Resume after a force-close, and the Ready summary (backup state comes from `getBackupStatus`, data-import-export.md §6) |
| `saveUserProfile(patch, expectedVersion, opId)` | Units, rest presets. `UserProfile` today only has `preferredUnit`, `defaultRest`, `restPresets` and `effortScale` (packages/schemas `profile.ts` notes goals come later). Goals and how Ben trains have their own versioned records below |
| `saveTrainingGoals({primary?: 'strength' \| 'muscle' \| 'general_fitness' \| 'maintain' \| 'support_other', secondary[], target?: {text, date?, involves?, priority?: 'main' \| 'alongside'}, priorityMuscleGroups?[]}, source: 'setup' \| 'profile' \| 'coach_confirmed', expectedVersion, opId)` (revised 9 Oct) | A versioned `TrainingGoals` record (Your data) stored with provenance and date (brief §2: "editable saved goals … with provenance and dates"). The coach reads it as confirmed by Ben. Plan suggestions record the goal, setup and other-training versions they were built on, so a change to any of them makes them out of date (playbook rule G and guardrail 5, CLAUDE.md rule 5; revised in the review fixes). `involves`, `priority` and `priorityMuscleGroups` are set in Profile only |
| `saveTrainingSetup({daysPerWeek?: 1..7, sessionMinutes?, minutesByDay?, usualDays[], varies, experience?: 'under_1y' \| '1_3y' \| 'over_3y'}, source, expectedVersion, opId)` (new 9 Oct; replaces `saveAvailability`) | Stated days a week, the main input to rule 1, and experience. It also writes the `AvailabilityRule` (brief §6) for usual days and minutes, with its effective date. Rejects `usualDays.length < daysPerWeek` unless `varies` |
| `saveOtherTraining(entries[{id, kind: 'running' \| 'cycling' \| 'swimming' \| 'rowing' \| 'class' \| 'sport' \| 'other', label?, effort?: 'hard' \| 'easy', usualDays[], keyDays[]}] \| 'none', source, expectedVersion, opId)` (new 9 Oct; revised in the review fixes) | Usual other training (Your data, with provenance). `effort` is optional for **every** kind (`class` and `sport` default to `hard` in the UI). Only `effort: 'hard'` or a non-empty `keyDays` makes an entry count for the endurance switch. Different efforts on different days are separate entries (Profile, e.g. `Easy run · Tue` and `Long run · Sat · hard`). `keyDays` ⊆ `usualDays`, set in Profile or the weekly plan. Read by `resolveTrainingContext`. Each save bumps the other-training version that plan suggestions record |
| `resolveTrainingContext(ownerId, date)` (new 9 Oct; pure, `packages/domain`) | Returns the active goal profile, floors, event phase by date, days a week, session budget, other training, `enduranceRulesActive` with its reason, and key sessions. Onboarding doesn't call it; it's listed here because every value onboarding writes feeds it (owner: coaching-playbook.md §6) |
| `listGymPresets()` / `buildPresetDraft(presetId, unit)` | Preset drafts with every value tagged `detailsSource: 'preset'` (gym-editor.md proposal GE1) |
| `createGymFromDraft(draft, opId)` | `createGym` + `addEquipment` × n in one transaction, so a force-close can't leave half a gym |
| (removed in consolidation) `verifyBackup`, `isInsideAppContainer` | No longer used by onboarding; both live in data-import-export.md §6 |

## 7. Acceptance checks

1. A fresh install opens on Welcome. No system permission prompt appears anywhere in onboarding (check notifications, microphone, speech, location and AlarmKit are all "not determined" afterwards).
2. From Welcome to Today with the `Commercial gym` preset and no optional steps takes at most **7 taps**, not counting typing: Set up, Continue, preset card, Continue, Save gym, Continue (or Skip), Go to Today. Today then needs one tap for `Start empty workout`. No file picker or folder picker appears unless Ben taps `Save a copy to Files now`.
3. With airplane mode on and no AI, all three Essentials steps complete. The coach card shows the offline text and nothing else mentions AI.
4. Force-quit on Step 3 and relaunch: the app opens on Step 3, the units and gym are already saved, and there's exactly one gym.
5. Double-tapping `Save gym` creates one gym with one set of equipment.
6. Preset items saved without opening their details show `Typical values, not checked` in the gym editor. Opening and saving an item changes it to `Checked by you`.
7. Step 3 shows the approved explainer text, writes nothing and asks for no permission; `Skip` and `Continue` both reach Ready.
8. After finishing the first workout, an automatic backup exists in Fizz's container and Data & backup reads `Backed up on this phone`, with no setup during onboarding.
9. No backup warning, alert or banner appears on Ready, Today or Profile because Ben didn't save a copy to Files.
10. `Restore from a backup` on Welcome, using a backup with a profile, lands on Today without showing any setup step. Cancelling the picker returns to Welcome with nothing changed.
11. The About-your-training fields all start empty. Skipping all four steps saves nothing; the workout builder then shows `No goal set` (workout-builder.md).
12. Choosing `Bench press` under `Stop load increases` creates an active pain flag visible in Profile → Pain flags. Typing "shoulder" in the free-text field alone creates no flag.
13. Every step's primary button stays fully visible with the keyboard open at 375pt width and at AX3.
14. All text is at least 16pt at the default size; durations and counts use tabular numerals; every selected chip or card shows a check icon as well as colour.
15. The choice of `Use my ChatGPT plan` or `Use my own API key` is never made for Ben, and `Not now` leaves `getAiCapabilities` reporting no route.
16. (9 Oct; D13 design, pending Ben's bulk approval) The main-focus options are exactly `Strength`, `Muscle`, `General fitness`, `Maintain` and `Support other training`. No onboarding text, placeholder or option names a specific sport or race brand; searching the copy for "HYROX" finds nothing.
17. (9 Oct) Choosing only `3` days a week and `60 min` saves `daysPerWeek: 3, sessionMinutes: 60` with `Set in setup, <date>`. Profile → Goals & schedule shows them, and the workout builder's `What it uses` lists `3 days a week · 60 min (set in setup)`.
18. (9 Oct) With `3` days a week and only Mon and Wed picked, the warning shows and `Continue` reads `Check your days` (disabled). Ticking `It changes week to week` clears the weekdays and re-enables `Continue`.
19. (9 Oct; revised in the review fixes; D13 design, pending Ben's bulk approval) `None` on step 3 saves "no other training" (confirmed), and `resolveTrainingContext` reports the endurance rules off with that reason. `Running` with `Tue` and `Sat` and `Hard or long` saves usual training, and it reports them on with a reason naming the hard run. The same with `Easy`, or with no effort chosen, saves the entry but leaves the rules off. Skipping step 3 saves nothing, and the context reports "other training not set".
20. (9 Oct; revised in the review fixes) For **every** type, `Easy` leaves the endurance rules off and `Hard or long` turns them on (tested for `Running`, `Cycling`, `Classes or HIIT` and `Other` named "climbing"). `Classes or HIIT` and `Team or court sport` show `Hard or long` already selected.
21. (9 Oct) No step in About your training changes a weekly plan, routine or target. Any rebuild appears later only as a suggestion with Apply and Undo.
22. (Review fixes) Muscle as the main focus plus `Running · Easy`: rules 11–13 are off everywhere (playbook screen, weekly plan, builder), and no screen mentions spacing or heavy sessions.
23. (Review fixes) Skipping step 2 entirely: no screen shows a weekly-set number, and none contains "rule defaults". Setting only `3` days gives `Session length: Not set` with `60 min (assumed)` wherever a budget is shown, and Profile still reads `Not set`.

## 8. Proposals for Ben (brief changes)

| # | Brief says | Proposal | Reason |
|---|---|---|---|
| OB1 | §1 First-run setup lists goals, experience, availability, session length, units, first gym, limitations | (Revised.) Split into **Essentials** (units + rest presets, first gym, a skippable "how your data is kept" explainer) and an optional **About your training** block (revised 9 Oct: goal, days a week and session length, other training, limitations; 4 short steps), offered on the Ready screen and in Profile | Only the first two Essentials change what logging does. The brief already says onboarding must be short and that richer questions can follow |
| OB5 | §1 lists "weekly availability" but not lifting frequency or other training (new 9 Oct) | Ask **days a week you lift** as its own question, separate from which days are free; add **Other training** (type, usual days) and a dated `Working towards` field; main-focus options become Strength / Muscle / General fitness / Maintain / Support other training. Priority muscle groups and event details live in Profile only | Playbook v1 (approved 9 Oct): rule 1 starts from stated days a week (Ben: "guided by how often people say they gym per week"); rule G adapts to the goal and how training is run, with no sport special case (Ben: "stop with hyrox"). Answers playbook open decision D13 as a design default for Ben's bulk approval |
| OB2 | (Withdrawn in consolidation.) | Backups now live in the app by default (approved by Ben); the verify test moved to Data & backup → `Check a backup` | — |
| OB3 | (not covered) | `Restore from a backup` on the Welcome screen | A signing-tool or Apple ID change gives an empty app (ADR 0004). Restore must come before setup |
| OB4 | (not covered) | No permissions during onboarding; each asked in context (§4.6). Location never asked | Matches the brief's honest-status rule and keeps setup short |

## Proposed design-system additions

> **Merged into design-system.md (consolidation):** `OnboardingFrame` §9.46, `ChoiceCard` §9.34, `ChecklistRow` §9.33, `ProvenanceTag` → `SourceTag` §9.28, `StepResultLine` → `StepRow` §9.42. Kept below for history.

| Name | Kind | Spec |
|---|---|---|
| `OnboardingFrame` | Component | Top bar (`Back`, centred `Step n of m` in `type.label`/`text.secondary`, optional `Skip`), title `type.title2`, explanation `type.callout`/`text.secondary`, scrolling content, fixed bottom bar with one `PrimaryButton` (same padding and keyboard behaviour as `ActionBar` §9.1, no Talk button). No progress bar |
| `ChoiceCard` | Component | Single- or multi-select card for presets and coach routes: `bg.surface`, 1pt `border.control`, `radius.md`, padding `space.4`, min height 60. Selected: 2pt `accent` border, `accent.subtle` fill, `checkmark.circle.fill` icon before the title (never colour alone). Disabled: `text.secondary` title and a reason line |
| `ChecklistRow` | Component | Checkbox row (`checkmark.square.fill` / `square`), 52pt min, whole row toggles; optional trailing `›` button 44 × 44 separated by `space.2`, with non-overlapping hit areas; optional second line for a `ProvenanceTag` |
| `ProvenanceTag` | Component | Same frame as `TargetSourceTag` (§7): `type.label`, `text.secondary` on `bg.raised`, `radius.sm`. Texts: `Typical values, not checked` (icon `questionmark.circle`), `Checked by you` (icon `checkmark`), `Set in setup, 8 Oct`. Never `accent` |
| `StepResultLine` | Component | Icon + one or two lines `type.callout`: done (`checkmark.circle.fill`, `status.done`), working (static `ellipsis`, `text.secondary`), problem (`exclamationmark.triangle`, `status.warning`). No spinner animation |

No new colour, type, spacing or timing tokens.

## Cross-links

- [design-system.md](design-system.md): `PrimaryButton`, `ParamChip`, `StatusBanner`, number and duration formats.
- [gym-editor.md](gym-editor.md): presets, checklist items, detail editors, `detailsSource` (GE1).
- [profile-and-settings.md](profile-and-settings.md): where every onboarding value is edited later; the backup attention row; permissions status.
- [rest-state.md](rest-state.md) §2.4, §3 and §4.2: rest preset wheel, notification priming row, preset resolution.
- [today.md](today.md) §3: No plan, No gym and Database error states that onboarding hands over to.
- [active-workout.md](active-workout.md) §2.5: voice strip states used by microphone priming.
- [coach-adjustments.md](coach-adjustments.md) §4.5: pain flags.
- [workout-builder.md](workout-builder.md) §3.1: reads session length, days a week and goal.
- [coaching-playbook.md](coaching-playbook.md) §2.1a: `Applied to you`, which shows how these answers are used. The rules are in [playbook-v1.md](../training-guides/playbook-v1.md) (rules 1, G, 11–13 and the "Inputs the coach uses" table).
- [ai-connection.md](ai-connection.md): ChatGPT-plan sign-in and API-key routes behind §2.8.
- [data-import-export.md](data-import-export.md): restore flow (§2.3), `Save a copy to Files` (§2.2), FitNotes import (§2.5), import from any app (§9), backup status and safeguards (§3.1, §4.1a).
- [coach-memory.md](coach-memory.md): Pain flags list and clearing; `setPainFlag` signature.
- ADR 0004 (backup before real data, signing-tool risk), ADR 0005 (backup format, restore steps), ADR 0006 (built-in rules work with no coach).
