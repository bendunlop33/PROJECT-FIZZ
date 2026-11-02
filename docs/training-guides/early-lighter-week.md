# What happens after an early lighter week

*Training-researcher answer for Ben, 2 Nov 2026. All sources checked 2026-11-02. Not medical advice: pain or injury stops progression on that movement and the coach suggests seeing a professional (CLAUDE.md rule 9). Builds on approved playbook rule 10, [training-blocks.md](../design/training-blocks.md) §2.3/§4.3/§4.4 and Q3/Q4, [plan-builder.md](../design/plan-builder.md) (Effort: Standard deloads in the last week, Push every 4th week, Maintain none), the 2 Nov `propose_plan_change` entry in [CHANGELOG](../brief/CHANGELOG.md), and [evidence-core.md](evidence-core.md) §7. **Ben approved LW1–LW3 on 2 Nov 2026; they supersede training-blocks Q4 for all plans, including older coach blocks.***

**Summary**
1. **Recommendation:** the plan carries on at its chosen length. The planned deload stays unless it would come **within 3 weeks** of the lighter week. In that case it becomes a normal week (option b). The plan is never ended, restarted or extended automatically.
2. **Why:** a deload exists to clear fatigue. Two lighter weeks close together cost training without adding recovery. Most lifters and coaches deload every ~4–6 weeks, and the app's own Push effort already spaces deloads 4 weeks apart.
3. **Why not end the block (old Q4):** Q4 was written when a block was a separate 6-week stretch. Now the plan *is* the block, so ending it would discard the weeks Ben chose and force a rebuild. A lighter week can also be asked for reasons other than fatigue (travel, illness, a busy week).
4. **Evidence:** there are no trials on what to do after a reactive deload. The Delphi panel agreed deloads can come anywhere in a block and that several deloads per block are fine. The rule's details are **Practice**.
5. **Approved (Ben, 2 Nov):** LW1–LW3. They supersede training-blocks Q4 (approved 21 Oct) for all plans; CHANGELOG 2 Nov.

## Playbook rules (approved)

Ben approved LW1–LW3 on 2 Nov 2026. LW = lighter week.

| # | Rule | Applies when | Evidence grade | Sources |
|---|---|---|---|---|
| LW1 | **Keep going; don't stack deloads.** After a lighter week in week L (Ben asked for it, or he accepted the early-deload offer), the plan keeps its length and its later build weeks. Take the **next** planned deload in week D. If **D − L ≤ 3** (fewer than 3 normal weeks between them), week D becomes a normal build week. Otherwise it stays. Deloads after that one are unchanged. The lighter week is never moved and never ends, restarts or extends the plan. | Any plan with planned deloads (Standard, Push), whenever a lighter week is applied. Maintain has no planned deloads, so nothing changes | Gap of ≥ 3 normal weeks between lighter weeks (deloads every ~4+ weeks): **Practice**, from the Delphi consensus, the survey's 5.6 ± 2.3 weeks and the app's own Push cadence. "Reactive deloads are fine at any point in a block": **Practice** (expert consensus). Benefit of reduced-load deloads in general: **Weak** (untested; the only RCT tested a full week off) | [Bell 2023 Delphi](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/), [Rogerson 2024 survey](https://pmc.ncbi.nlm.nih.gov/articles/PMC10948666/), [Coleman 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/), playbook rule 10 |
| LW2 | **The dropped deload is visible in the same proposal.** The lighter-week card shows both changes before and after, e.g. `Week 3 of 6 → Lighter` and `Deload: week 6 → none`. One Apply covers both. Undo restores both: the week goes back to normal and the deload comes back. If D − L > 3, the card shows only the lighter week. | The `propose_plan_change` lighter-week card, and Apply on the early-deload offer | Guardrail (CLAUDE.md rule 2) | CLAUDE.md rules 2 and 5; [CHANGELOG 2 Nov](../brief/CHANGELOG.md) |
| LW3 | **No catch-up after the lighter week.** Loads for the weeks after it come from his last normal (non-deload) sessions, which is already how history works (training-blocks §4.4 "Deload history"). The planned path doesn't advance during the lighter week: the next week's target is the last build week's value plus one step, not two. So `Behind` never counts a week he was told to go lighter. No double step to "make up" the week. | Planned path, `Behind`/`On plan`, block review | **Practice**. Strength is largely kept over a short reduced-volume spell: **Moderate** (detraining and maintenance trials) | [Bickel 2011](https://pubmed.ncbi.nlm.nih.gov/21131862/), [Coleman 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/), training-blocks §4.2/§4.4 |

### Exact behaviour (for the developer)

Inputs: the plan's planned deload weeks `P` (from Effort), its `lighterWeeks` and the new lighter week `L`.
1. Validity is unchanged from 2 Nov: not in the lead-in, not past the plan's end, not on a week that is already a deload or lighter week.
2. `D` = the smallest planned deload week in `P` with `D > L`. If none exists, or `D − L > 3`, change only `L`.
3. If `D − L ≤ 3`, store `D` as a skipped deload (e.g. `skippedDeloads: [D]` on the builder answers, optional, so no migration). Week D drafts as a normal build week.
4. The plan length and the other weeks in `P` are unchanged. A new block starts with neither `lighterWeeks` nor `skippedDeloads`, as `lighterWeeks` already works.
5. Undo of that proposal removes `L` and restores `D`. A stale proposal is refused (`Out of date. Ask again.`).
6. A lighter week asked for straight after a planned deload is still honoured, because Ben asked. LW1 looks forward only: it never removes a deload already done and never refuses his request.
7. With no AI, the code applies LW1 the same way. Code owns the arithmetic, and the coach only words the card.

**Worked examples** (week numbers within the plan)

| Plan | Lighter week | Planned deload | Result |
|---|---|---|---|
| 6 wk Standard (deload 6) | 3 | 6 → 6 − 3 = 3 | 1, 2, **L3**, 4, 5, 6 (normal); block done after 6 |
| 6 wk Standard | 2 | 6 → 4 | 1, **L2**, 3, 4, 5, D6 (both kept) |
| 4 wk Standard (deload 4) | 2 | 4 → 2 | 1, **L2**, 3, 4 (normal) |
| 8 wk Standard (deload 8) | 3 | 8 → 5 | 1, 2, **L3**, 4–7, D8 |
| 12 wk Push (deloads 4, 8, 12) | 3 | 4 → 1 | 1, 2, **L3**, 4 (normal), 5–7, D8, 9–11, D12 |
| 12 wk Push | 6 | 8 → 2 | …D4, 5, **L6**, 7, 8 (normal), 9–11, D12 |
| 12 wk Push | 5 | 8 → 3 | …D4, **L5**, 6, 7, 8 (normal), 9–11, D12 (Ben asked for L5 right after D4, so it's honoured) |
| 8 wk Maintain (no deloads) | 4 | none | only week 4 changes |

### Guardrail check

- **Rule 2:** the deload change is part of the one proposal (before/after, Apply, Undo). Completed sets and templates are never touched.
- **Rule 3:** nothing new is raised unprompted. The lighter week is still only proposed when Ben asks or he accepts the code-raised early-deload offer (training-blocks §4.3). LW1 is arithmetic inside that proposal.
- **Rules 4 and 5:** the transform is unchanged (§4.4: −10%, rounded **down** to achievable, one set fewer, never below 2, RPE ≤ 7). Versioned, idempotent writes as on 2 Nov.
- **Rule 9:** a lighter week isn't pain treatment and doesn't clear a pain flag. If Ben asks for one because something hurts, the pain flow still holds that movement (no progression, suggest a professional, no diagnosis), and a later "normal" week D never progresses a flagged movement.
- **Rule 6:** no fatigue score is invented. LW1 only uses week numbers.
- **Rule 10:** these are Coaching knowledge. The plan's `lighterWeeks`/`skippedDeloads` are Your data.

**Conflicts flagged (resolved: Ben approved LW1–LW3, 2 Nov):**
1. **Supersedes training-blocks Q4** (approved 21 Oct: "accepting an early deload ends the block after that week"). This applies to builder plans and to the older `Start a block` coach blocks, so there is one rule. It changes an approved answer, so it needs Ben's OK and a CHANGELOG line. The 2 Nov build already doesn't apply Q4, so code changes only by adding step 3 (the skipped deload) and LW3's path hold.
2. **2 Nov CHANGELOG** says "The effort's own deload weeks stay." LW1 changes this to "stay unless within 3 weeks after the lighter week".
3. **Playbook rule 10** ("every 4–8 weeks if Ben prefers") is unchanged. LW1 is consistent with its lower bound.

---

## 1. For Ben, in plain words

A lighter week clears built-up tiredness. If you take one in week 3 and the plan also has one in week 6, you'd have two easy weeks out of four with little gained from the second. So the app keeps the plan as you set it, drops the planned easy week if it's within 3 weeks, and carries on. If you want the plan longer or shorter, just ask ("make the plan 8 weeks"), as you already can.

## 2. The four options compared

| Option | For | Against | Verdict |
|---|---|---|---|
| (a) Continue, keep the planned deload | Simplest. It's the current build | Can give two lighter weeks 1–3 weeks apart (e.g. L5 + D6), which wastes build weeks for no recovery need. No source spaces deloads that closely by default | Good when they're far apart. LW1 keeps (a) for those cases |
| **(b) Continue, drop the deload if it's close** | Keeps Ben's chosen length and weeks. Avoids stacked deloads. Spacing matches common practice and the app's Push cadence. One number | Adds one rule and one line on the card | **Recommended** |
| (c) Extend the plan a week | Keeps the number of build weeks | Moves the end date Ben chose. Every lighter week grows the plan. Structural changes should be Ben-initiated (rule 3). He can already ask for a different length | Not by default. It stays available if he asks |
| (d) End or restart the block (old Q4) | Common in strength sports: 68% of surveyed athletes start a new block after a deload. RP's app lets a mesocycle be shortened to deload early (search snippet, unverified) | Under plan = block 1 it cuts a 6-week plan to 3 and forces a rebuild, against Ben's "longer term plan … don't need to rebuild it much" (training-blocks §1). A lighter week asked for life reasons isn't a sign the block has run its course | Not recommended |

## 3. Evidence

**Documented fact**
- **Delphi consensus, 21 strength and physique coaches/experts:** Bell, Strafford, Coleman, Androulakis Korakakis and Nolan, *Sports Med Open* 2023;9:87 ([PMC10511399](https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/), checked 2026-11-02). Agreed in round 3:
  - "Deloading could occur when athletes feel physically and mentally fatigued regardless of training week in the mesocycle": 100%.
  - "Deloading could occur in the last week of a mesocycle": 95.2%.
  - "There may be multiple deloads depending on the mesocycle length": 100%.
  - "Deload frequency may depend on how athlete responds to training stimulus": 100%.
  - "Deloading could reduce the mesocycle duration": 77.8%.
  - No fixed interval was agreed. "Every 4–6 weeks, ~7 days" comes from the paper's background, not the consensus.
  - Several authors run coaching or education businesses. This is expert opinion, so grade it Practice.
- **Survey of 246 strength and physique athletes:** Rogerson et al., *Sports Med Open* 2024;10:26 ([PMC10948666](https://pmc.ncbi.nlm.nih.gov/articles/PMC10948666/), checked 2026-11-02). Most respondents were powerlifters (63%), recruited as a convenience sample, and answers were self-reported.
  - Deloads came every 5.6 ± 2.3 weeks (range 1–12) and lasted 6.4 ± 1.7 days.
  - 47% planned deloads only, 39% planned plus reactive, 13% reactive only.
  - Triggers: "when it says so on the programme" (65%), feeling beat up (63%), stalled performance (~46–54%; the paper is internally inconsistent).
  - After a deload, 68% start a new block and 55% ramp back up gradually.
  - This describes practice, not effectiveness, so it's Practice.
- **Coleman et al., *PeerJ* 2024;12:e16777** ([PMC10809978](https://pmc.ncbi.nlm.nih.gov/articles/PMC10809978/), checked 2026-11-02). In trained young adults, a full week **off** at week 5 of 9 gave no hypertrophy or power benefit and slightly smaller lower-body strength gains than training straight through. It is one trial, of a full break rather than a reduced-load week (Weak). It suggests extra easy weeks aren't free.
- **Bickel, Cross and Bamman, *MSSE* 2011** ([PubMed 21131862](https://pubmed.ncbi.nlm.nih.gov/21131862/), checked 2026-11-02). After 16 weeks of training, young adults kept their size on ⅓ or even ⅑ of the training volume, and strength was largely kept even through detraining. So one lighter week loses essentially nothing, which supports LW3's "no catch-up".
- **5/3/1 Forever (Wendler, paid book):** the "7th week protocol" places a deload or training-max test after two 3-week cycles, i.e. about every 7th week ([Lift Vault summary](https://liftvault.com/resources/7th-week-protocol/), secondary, checked 2026-11-02). Wendler sells the books. This is a coaching convention.
- **App facts:** Push deloads every 4th week and Standard in the last week ([plan-builder.md](../design/plan-builder.md)). The deload transform is in training-blocks §4.4.

**Expert opinion (secondary, unverified)**
- RP (Israetel; sells an app and books): search snippets say RP articles allow cutting a mesocycle short to deload early, and that after a deload you return at lower volume and build up again ([search, rpstrength.com](https://rpstrength.com/blogs/articles/fixing-the-high-volume-stall); the pages returned HTTP 429/403 on 2026-11-02, so this is unverified). This supports (d) for hypertrophy mesocycles that ramp volume to a limit. GymSmarter's plans don't ramp sets weekly (rule 1: sets grow only when Ben asks), so there's no "hit the limit, reset volume" logic to restart.

**My inference**
- **The 3-week threshold** sets the shortest gap between lighter weeks at 4 weeks. That is the low end of the Delphi background (4–6), within one SD of the survey mean, and equal to the app's own Push cadence. A 2-week threshold would allow L + D only 3 weeks apart. A 4-week threshold would drop more deloads than needed. It's a Practice number; Ben can change it later.
- **Why not shift the deload later:** in Standard plans the deload is the last week, and it can't move past the plan's end (2 Nov rule). Shifting in Push plans would ripple through later deloads. Dropping it is simpler and behaves the same everywhere.
- **Ending a plan on a normal week** (e.g. 6-week Standard with L3) is fine. The next block's week 1 starts at its ramp's easiest effort (SS6, RPE ~7), which already acts as a soft re-entry.

## 4. Paid material

- *5/3/1 Forever* (already on the README list), for Wendler's exact 7th-week rules.
- RP's *Scientific Principles of Hypertrophy Training*, for the exact early-deload guidance (paid). Ben could add his own copy.
