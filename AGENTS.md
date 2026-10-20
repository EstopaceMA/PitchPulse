# PitchPulse agent guide

This file applies to the whole repository. Read [README.md](README.md) for simulator behavior, the upload contract, and data-integrity rules; use [package.json](package.json) for current dependency versions and scripts.

## Project and boundaries

- PitchPulse is an event-driven football replay app using Next.js App Router, React, strict TypeScript, and Tailwind CSS v4. The shipped insights are local and rule-based; no AI service, credentials, or recorded player tracking are required.
- [app/page.tsx](app/page.tsx) renders [components/match/simulator.tsx](components/match/simulator.tsx), which owns dashboard composition, uploads, and session-only preferences. Keep presentation in match components and domain logic in the match library.
- [app/api/match/route.ts](app/api/match/route.ts) validates the bundled [public/arsenal-vs-chelsea-match.json](public/arsenal-vs-chelsea-match.json) before responding. Do not depend on datasets outside the repository or expand the Turbopack root to find them.
- [lib/match/types.ts](lib/match/types.ts) defines data and provider contracts; [lib/match/validation.ts](lib/match/validation.ts) is the boundary for unknown input.
- [lib/match/playback.ts](lib/match/playback.ts), [lib/match/statistics.ts](lib/match/statistics.ts), [lib/match/movement.ts](lib/match/movement.ts), and [lib/match/insights.ts](lib/match/insights.ts) contain testable domain logic. Keep it independent of React, browser APIs, and network calls. [lib/match/use-simulation.ts](lib/match/use-simulation.ts) connects playback and statistics to React.

## Development and verification

- Use npm and keep [package.json](package.json) and [package-lock.json](package-lock.json) consistent. Use `npm ci` when dependencies need installing; avoid unrelated upgrades or competing lockfiles.
- `npm run dev` starts development; `npm run build` creates a production build; `npm start` serves an existing production build.
- For code changes, run `npm test`, `npm run lint`, and `npm run build`. Report any failures or checks that could not be run. Documentation-only changes need link/content checks, not a full build.
- Tests use `node:test` and `node:assert/strict` through `tsx`, not Jest or Vitest. Extend [lib/match/simulator.test.ts](lib/match/simulator.test.ts) and [lib/match/movement.test.ts](lib/match/movement.test.ts) for domain regressions, and [components/match/presentation.test.tsx](components/match/presentation.test.tsx) for component markup regressions. Resolve fixture paths relative to `import.meta.url`.
- For UI changes, also verify relevant playback controls, event inspection, uploads, keyboard navigation, mobile layout, and reduced motion in a browser. Unit tests alone do not verify rendering.

## Simulation invariants

- Derive live scores, statistics, insights, recaps, and movement from the **processed event prefix**, never future events or embedded final summaries. Keep stripping `final_score`, event `score` snapshots, and `final_statistics` at validation; raw public JSON is still downloadable, not private.
- Preserve both elapsed time and the event cursor. Equal timestamps can straddle half-time; time alone cannot identify the processed prefix. Keep the explicit second-half transition, automatic full-time stop, and deterministic restart/seek behavior.
- Use the shared clock in `useSimulation` for playback and movement, not independent animation timers. Forward progress folds only new events into cloned statistics; backward seeks rebuild the prefix. Historical inspection must not change the live clock or statistics.
- Keep movement deterministic and explicitly illustrative, with no extra events or statistics. Preserve pause/boundary freezing, historical-prefix inspection, and reduced-motion snapshots. Recorded-event mode must use only supplied positions; never invent a missing shot endpoint.
- Coordinates are team-relative, 0–100. Use `pitchPosition` to rotate **both axes** for the away team, maintaining home-right / away-left attacks in both halves.
- Validate uploads before rendering or reducing them. Preserve sequence ordering, reference checks, the 10 MB upload / 50,000-event limits, and the current match on invalid input. Accept supported missing optional fields and empty event lists.
- Keep insight facts separate from cautious interpretations, with evidence IDs referencing processed events. Preserve bilingual output, cooldowns, deduplication, and bounded history. Keep `InsightProvider` as the replacement boundary and the local provider as the offline fallback if a remote provider is requested.
- Do not infer possession percentages, player distances, real tracking, or calibrated probabilities from this dataset. Preserve the illustrative labels on synthetic estimates and the fictional-roster disclosure.

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
