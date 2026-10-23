# PitchPulse agent guide

This file applies to the app in `src/web`; run every npm command from here. The repository root's [AGENTS.md](../../AGENTS.md) covers the layout and Azure deployment. Read [README.md](../../README.md) for simulator behavior, the upload contract, and data-integrity rules; use [package.json](package.json) for current dependency versions and scripts.

## Project and boundaries

- PitchPulse is an event-driven football replay app using Next.js App Router, React, strict TypeScript, and Tailwind CSS v4. The built-in insights are local and rule-based, and no recorded player tracking is required. Optional Microsoft Foundry agents are the only AI service. They are off by default, and the app runs fully without them or any credentials.
- [lib/agents/](lib/agents/) holds the pure agent layer: contracts, the prefix-only packet, guards, tools, instructions and the request pipeline. [lib/foundry/run-agent.ts](lib/foundry/run-agent.ts) is the injectable Foundry runner. [lib/foundry/client.ts](lib/foundry/client.ts) is the only `server-only` module that touches the Azure SDK and credentials. [app/api/agents/[agent]/route.ts](app/api/agents/[agent]/route.ts) is the single entry point.
- [app/page.tsx](app/page.tsx) renders the match library. [app/studio/[id]/page.tsx](app/studio/[id]/page.tsx) opens [components/match/simulator.tsx](components/match/simulator.tsx), which owns studio composition and session-only preferences. Browser persistence lives in `lib/match/library-storage.ts` and `lib/match/use-library.ts`; keep pure domain logic independent of storage and React.
- [app/api/match/route.ts](app/api/match/route.ts) validates the bundled [public/arsenal-vs-chelsea-match.json](public/arsenal-vs-chelsea-match.json) before responding. Do not depend on datasets outside the repository or expand the Turbopack root to find them.
- [lib/match/types.ts](lib/match/types.ts) defines data and provider contracts; [lib/match/validation.ts](lib/match/validation.ts) is the boundary for unknown input.
- [lib/match/playback.ts](lib/match/playback.ts), [lib/match/statistics.ts](lib/match/statistics.ts), [lib/match/movement.ts](lib/match/movement.ts), and [lib/match/insights.ts](lib/match/insights.ts) contain testable domain logic. Keep it independent of React, browser APIs, and network calls. [lib/match/use-simulation.ts](lib/match/use-simulation.ts) connects playback and statistics to React.

## Development and verification

- Production runs the standalone server (`output: "standalone"` in [next.config.ts](next.config.ts)) from [Dockerfile](Dockerfile) on Azure Container Apps. Never copy `.env*` into an image ([.dockerignore](.dockerignore)): runtime configuration comes from Container App environment variables and the managed identity (`AZURE_CLIENT_ID`). The agents route's rate limit keys on the client address from [lib/agents/rate-limit.ts](lib/agents/rate-limit.ts), the rightmost `X-Forwarded-For` entry, and assumes a single replica.
- Use npm and keep [package.json](package.json) and [package-lock.json](package-lock.json) consistent. Use `npm ci` when dependencies need installing; avoid unrelated upgrades or competing lockfiles.
- Use Node 22 or later ([.nvmrc](.nvmrc)); the Azure SDK requires it. `npm run agents:provision` and `npm run agents:evaluate` need a configured `.env.local` (see [.env.example](.env.example)) and `az login`. Tests never call Foundry.
- `npm run dev` starts development; `npm run build` creates a production build; `npm start` serves an existing production build.
- For code changes, run `npm test`, `npm run lint`, and `npm run build`. Report any failures or checks that could not be run. Documentation-only changes need link/content checks, not a full build.
- Tests use `node:test` and `node:assert/strict` through `tsx`, not Jest or Vitest. Extend [lib/match/simulator.test.ts](lib/match/simulator.test.ts) and [lib/match/movement.test.ts](lib/match/movement.test.ts) for domain regressions, and [components/match/presentation.test.tsx](components/match/presentation.test.tsx) for component markup regressions. Extend `scripts/demo-data/*.test.ts` for the demo roster tooling. Resolve fixture paths relative to `import.meta.url`.
- For UI changes, also verify relevant playback controls, event inspection, uploads, keyboard navigation, mobile layout, and reduced motion in a browser. Unit tests alone do not verify rendering.

## Simulation invariants

- Derive live scores, statistics, insights, recaps, and movement from the **processed event prefix**, never future events or embedded final summaries. Keep stripping `final_score`, event `score` snapshots, and `final_statistics` at validation; raw public JSON is still downloadable, not private.
- Preserve both elapsed time and the event cursor. Equal timestamps can straddle half-time; time alone cannot identify the processed prefix. Keep the explicit second-half transition, automatic full-time stop, and deterministic restart/seek behavior.
- Use the shared clock in `useSimulation` for playback and movement, not independent animation timers. Forward progress folds only new events into cloned statistics; backward seeks rebuild the prefix. Historical inspection must not change the live clock or statistics.
- Keep movement deterministic and explicitly illustrative, with no extra events or statistics. Preserve pause/boundary freezing, historical-prefix inspection, and reduced-motion snapshots. Recorded-event mode must use only supplied positions; never invent a missing shot endpoint.
- Coordinates are team-relative, 0–100. Use `pitchPosition` to rotate **both axes** for the away team, maintaining home-right / away-left attacks in both halves.
- Validate uploads before rendering or reducing them. Preserve sequence ordering, reference checks, the 10 MB upload / 50,000-event limits, and the current match on invalid input. Accept supported missing optional fields and empty event lists.
- Keep insight facts separate from cautious interpretations, with evidence IDs referencing processed events. Preserve bilingual output, cooldowns, deduplication, and bounded history. `InsightProvider` is the Foundry boundary: `foundryInsightProvider` is the remote implementation, and `ruleBasedProvider` stays always on as the local fallback.
- Do not infer possession percentages, player distances, real tracking, or calibrated probabilities from this dataset. Preserve the illustrative labels on synthetic estimates and the roster disclosure: fictional demo players, or real squad names in a simulated match.
- The demo roster is a committed snapshot of the clubs' Wikipedia squad lists ([data/squads.json](data/squads.json)) plus editorial lineups ([data/lineups.json](data/lineups.json)), applied offline by `npm run data:demo`. README.md documents the data sources. Don't add scraping or fetching code for it, and never fetch player data at runtime. Keep player IDs, slot positions and `synthetic: true` stable, and never add fabricated fixture details such as dates, venues or competitions.

## Foundry agent invariants

- Only the processed prefix leaves the browser. Keep the client stripping in `agentRequest` and the server assertions in `handleAgentRequest`: `validateMatch`, cursor/elapsed/period/boundary checks, and cursor-checked Ask history.
- Code supplies the numbers and evidence. Metric labels, values and evidence come from the packet catalog. Every number and mm:ss time in AI text must be grounded, and every cited event must be reached. Items that fail are dropped, never silently truncated. New packet facts or tool outputs must still reach `addGrounding`.
- Never enable web or Bing grounding, Code Interpreter or outside knowledge. Keep the banned-claim patterns aligned with the dataset limits: no possession share, distances, speeds, xG, probabilities, ratings or betting, and no outside knowledge about the real clubs and players (seasons, careers, transfers, injuries, captaincy, national teams, competitions).
- AI output is always labeled AI and hidden after a rewind past its cursor; local rules are never labeled AI. AI is opt-in per session, and every Foundry call follows an explicit click or question.
- Keep `lib/agents` and `lib/foundry/run-agent.ts` free of React, browser APIs and `server-only`. Never import `lib/foundry/client.ts` from client components or tests.
- Bump `PROMPT_VERSION` when instructions or schemas change, then re-run `npm run agents:provision`. Extend `lib/agents/*.test.ts` and `lib/foundry/run-agent.test.ts` using fake runners, and `components/match/agent-panels.test.tsx` for AI markup.

## UI conventions

- Follow surrounding TypeScript/TSX style and the `@/*` import alias. Use client boundaries for interactive components without moving pure domain modules into browser-only code.
- Reuse [components/ui/button.tsx](components/ui/button.tsx), which uses Base UI and CVA; do not assume Radix-specific APIs. Extend existing tokens and match styles in [app/globals.css](app/globals.css) rather than introducing a separate design system.
- Use `tr` from [lib/match/presentation.ts](lib/match/presentation.ts) for English/Filipino interface copy. Keep both language variants when adding visible text or accessible labels.
- Preserve labeled controls, visible keyboard focus, the skip link, SVG descriptions, responsive layouts, and `prefers-reduced-motion` support. Keep Inter self-hosted through the import in [app/layout.tsx](app/layout.tsx).

## Next.js guidance

Preserve the generated block below. Consult the installed framework documentation before changing framework-specific code or configuration.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
