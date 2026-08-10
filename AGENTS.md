# Agent notes

Read `ARCHITECTURE.md` first. It is the root map; descend into `docs/architecture/*.md` only for the subsystem you are touching. Any change must trace to an invariant or goal named there.

## Tests

- `npm run test:unit` - headless, parallel, `SKIP_LIVE=1`. Needs nothing but node. Run this by default.
- `npm test` - unit then live. Live needs ollama at `localhost:11434` with the models pulled, cargo, and the reference GPU.
- `npm run test:live` runs its files serially (`--test-concurrency=1`) in a fixed order that is part of the contract. Never reorder the list or parallelize it: latency and residency bars presume the warm serial context.
- `npm run typecheck` before committing TypeScript changes.

## Rules

- `test/blind*.test.cjs` are the frozen contract set. Never edit them to make an implementation pass; fix the implementation, or raise the contract question to the human.
- Donor repos (`prior-art/`, `~/work/utilitydelta/human-replay-vscode-extension`, `~/repos/external/*`) are read-only. Copy with attribution headers intact; never modify in place.
- `src/core/` never imports `vscode`. Decisions go core-side with a headless oracle; `src/vscode/` adapts.
