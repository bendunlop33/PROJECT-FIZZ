# Project V-Drop — Claude Code agent team (Phase 1: Commercial Proposition)

## Setup (5 minutes)
1. Put this `project-v-drop` folder somewhere on your computer. Keep the hidden `.claude` folder inside it.
2. Open `docs/master-brief.md` and paste your full Unified Master Brief into it.
3. Open Claude Code on this folder: in the desktop app's Code tab, or by running `claude` in a terminal from inside the folder.
4. Type `/agents` to check that all six specialists appear.

## Kick-off prompt (paste into Claude Code)
> Start Phase 1. Follow the session start checklist in CLAUDE.md, then run step 1: use the market-mapper and customer-insight agents in parallel. When both are done, give me a summary of the key findings and the assumptions that changed, then stop at Gate 1 for my review.

## Useful prompts later
- "Continue Phase 1 from where we left off."
- "Here's my feedback on [file]: … Log it in learnings and decisions, then revise."
- "Get the red team to review [file]."
- "Show me the assumptions register: only what's still UNVERIFIED or DISPUTED."
- "End the session: update learnings.md."

## Tips
- Review at each gate. Your feedback is how the system "learns": it's written to `notes/`, and every agent reads those files first.
- Some retailer sites block automated access. The agents will mark those figures as unverified rather than guess. Fill the gaps yourself, or ask for another source.
- Research-heavy runs use a lot of usage allowance. Running step by step, with the gates, keeps this under control.
