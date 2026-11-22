# PROJECT-FIZZ

GymSmarter: a personal iOS strength-training app with fast logging, a voice/text coach and equipment-aware progression.

- Product brief: [`docs/brief/training-app-build-brief.md`](docs/brief/training-app-build-brief.md)
- Project context and agent workflow: [`CLAUDE.md`](CLAUDE.md)
- Agents: [`.claude/agents/`](.claude/agents/) (researcher, designer, developer, reviewer)

## Development

Node 22.18+ and npm workspaces. Packages: `packages/schemas` (zod schemas and types), `packages/domain` (pure rules, session state machine, storage ports).

```sh
npm install
npm run typecheck
npm run lint
npm test           # default suite, no wall-clock budgets
npm run test:perf  # perf lane: *.perf.test.ts timing budgets (non-blocking in CI)
```
