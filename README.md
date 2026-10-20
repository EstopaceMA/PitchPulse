# PitchPulse

A working event-driven football simulator using Next.js, TypeScript, Tailwind, shadcn/ui, Lucide, and self-hosted Inter and JetBrains Mono. No continuous tracking, AI connection, or credentials are involved.

The visual specification is maintained in [DESIGN.md](DESIGN.md): dark-green surfaces, green/lime data accents, 16px cards, and a responsive 12-column dashboard. Unsupported possession metrics are not shown; local rule-based insights are never mislabeled as AI output.

## Simulator guide

- Play/pause, restart, step one event, select 1×/5×/10×/30× speed, or scrub the timeline. Arrow keys, Home, and End work on the native scrubber.
- Half-time pauses before period-two events sharing 45:00. **Start second half** resumes. Full-time stops automatically. Seeking beyond half-time is allowed.
- Clicking a feed event or insight evidence ID inspects that processed event on the pitch. **Follow live**, beside the reviewing status in the pitch header, restores the current event. Inspection does not change the shared clock or statistics.
- Casual Fan uses shorter explanations. Analyst exposes comparisons and interpretations. Player Focus shows the selected player's feed, insights, and accumulated metrics. Changing focus resets feed filters only.
- **Preferences** (the settings icon on mobile) changes favorite team (insight priority), player, and English/Filipino language without restarting. Preferences are session-only.
- **Load match** pauses playback and validates JSON locally. Invalid files preserve the current match; valid files reset it. Limits: 10 MB and 50,000 events. Empty datasets have a dedicated state.
- Half/full-time recaps use only processed events for goals, statistics, player contributions, and supporting patterns.
- The pitch opens in **Full-team simulation** with **Fit pitch** selected: every roster player has a marker, role-based formation, and deterministic illustrative movement driven by the same match clock. On narrow screens, fit mode shows active/selected names; select a marker or lineup entry to see player details below the field. **Detailed view** keeps all enabled names readable with horizontal scrolling. **Player names** toggles labels in either size mode.
- Desktop opens with a full-width match summary and simulator controls, followed directly by the main 8/4 grid: the pitch and statistics beside viewing modes, factual commentary, and key moments. Shots, shots on target, and pass accuracy remain in Match statistics, without a separate KPI card row. Event history, evidence-linked insights, and half/full-time recaps follow below. Expanded lineups cannot stretch the sidebar controls.
- The header separates branding, navigation, and **Preferences** from a quieter match-selection row with one **Load match** action and a compact status badge. Language lives inside Preferences instead of a duplicate header selector. Commentary and its evidence links show only reached events; goals and on-target shots form the key moments, never a future-result preview.
- Match selection, preferences, player focus, and event filters share styled, accessible dropdowns with selected-item checks and grouped player lists. Use arrow keys or type a name to navigate, Enter to select, and Escape to close. Escape closes an open dropdown before its containing Preferences panel; selections never restart playback except when loading a different match.
- On tablets the panels stack in reading order. On mobile, a persistent playback bar reserves space at the bottom, including device safe areas. **Events / Insights / Statistics** switches the visible analysis panel without resetting playback or feed filters.
- **Recorded events** preserves the original event-only view. Simulated player paths and ball-flight timing are explicitly illustrative, not recorded tracking. Names are used exactly as supplied; the demo uses fictional labels, not actual club rosters.
- Pausing, half-time, and full-time freeze movement; restart restores the formation; seeking reconstructs the same positions. Inspecting a historical event freezes its processed-prefix formation. Reduced-motion preferences replace continuous movement with event snapshots.

## Data and architecture

The default source is [public/arsenal-vs-chelsea-match.json](public/arsenal-vs-chelsea-match.json). The match API imports this copy and validates it before sending it to the simulator. No parent-folder dataset or expanded Turbopack root is required. As with any public asset, the original JSON is also directly downloadable; its raw summaries are not used by live panels.

| Responsibility | Source |
| --- | --- |
| Types / provider contract | [lib/match/types.ts](lib/match/types.ts) |
| Upload validation | [lib/match/validation.ts](lib/match/validation.ts) |
| Pure event state machine | [lib/match/playback.ts](lib/match/playback.ts) |
| Shared clock / atomic incremental stats | [lib/match/use-simulation.ts](lib/match/use-simulation.ts) |
| Statistics reducer | [lib/match/statistics.ts](lib/match/statistics.ts) |
| Illustrative movement model | [lib/match/movement.ts](lib/match/movement.ts) |
| Named player markers and roster | [components/match/team-motion.tsx](components/match/team-motion.tsx) |
| Deterministic bilingual rules | [lib/match/insights.ts](lib/match/insights.ts) |
| Dataset API | [app/api/match/route.ts](app/api/match/route.ts) |
| UI composition | [components/match/simulator.tsx](components/match/simulator.tsx) |
| Tests | [lib/match/simulator.test.ts](lib/match/simulator.test.ts) |

Playback stores elapsed time **and an event cursor** to preserve sequence at equal timestamps. Forward playback folds new events into cloned statistics; backward seeks rebuild the prefix. Statistics never use final summaries.

The movement timeline is built exclusively from the processed prefix, never future events. Player targets combine role-based lanes, the last observed ball location, and participants in the current action. Interrupted six-second player tweens start from the previous trajectory's current position. Ball flights between recorded endpoints use an illustrative two seconds; a shot without an endpoint does not invent a goal location. Pure sampling at elapsed time is replay/seek deterministic. It produces no extra match events or statistics.

Insights use 300-second windows, 180-second per-rule/team/player cooldowns, and a bounded 200-card history. Live cards expire after 600 seconds and deduplicate by rule/team/player. Comparison evidence includes both windows. Early comparisons disclose partial windows. Player rules require four actions or a goal. Facts are separate from cautious interpretations.

`InsightProvider` is the future Microsoft Foundry replacement boundary. The current `ruleBasedProvider` is local and deterministic. A future adapter should run server-side, keep credentials private, accept only processed events, return typed evidence, and keep the local provider as an offline fallback. No Foundry API is called.

## Compatible uploads and integrity

Required top-level fields: `match`, `teams` (two), `players`, and `events`. Match requires `match_id`, valid distinct home/away IDs, positive `duration_seconds`, and an earlier `period_seconds` half-time boundary.

Events require unique `event_id` / integer `sequence`, valid `match_time_seconds`, `period` (1 or 2), supported `type`, `team_id`, `player_id`, and `possession_id`. Neutral references may be null. Acting players must belong to the acting team. Sequence timestamps/periods must not move backward. Array order is normalized by sequence.

Supported event types: `match_start`, `kickoff`, `pass`, `shot`, `tackle`, `pressure`, `possession_change`, `half_time`, `second_half_start`, `full_time`. Optional positions, outcomes, recipients, targets, and metrics are validated only when present.

- Coordinates: 0–100, team-relative, x toward the acting team's attacking goal. Away positions rotate **both axes**, giving fixed home-right / away-left attacks in both halves. Missing coordinate documentation assumes this convention; incompatible explicit documentation is rejected.
- Recorded-event view displays only supplied locations. Full-team view adds clearly labeled illustrative formations and paths, not tracking measurements. Missing shot endpoints are never invented. Neither visualization adds events or statistics.
- Goals are shots with `outcome: "goal"`, counted once as shots and on target. Saved/on-target shots count on target; blocked/off-target shots do not.
- Pass attempts include missing outcomes, but only `complete` counts as completion. Zero attempts display 0.0%.
- Won tackles require `outcome: "won"`. Pressure counts recorded pressure events.
- Recovery rules exclude shot-end possession changes.
- Final scores, score snapshots, and `final_statistics` are stripped before the API responds. Tests alone compare final statistics against the supplied summary.
- No possession percentage or player-distance metrics. Pass difficulty / synthetic xG are explicitly illustrative estimates, not calibrated probabilities.
- Keyboard focus, skip link, labeled controls, SVG descriptions, responsive stacking, and reduced-motion preferences are supported.

## Verification and advisory

Use `npm test`, `npm run lint`, and `npm run build`. Replay tests cover score rollback, period boundaries, validation, coordinates, and evidence. Movement tests cover all-player coverage, continuity, mirrored formations, equal timestamps, backward sampling, missing fields, and independence from future events. Component markup regressions in [components/match/presentation.test.tsx](components/match/presentation.test.tsx) cover pitch defaults, bilingual inspection controls, playback boundaries, transport labels, and header personalization. [components/match/summary-panels.test.tsx](components/match/summary-panels.test.tsx) verifies statistics comparisons, absence of possession estimates, bounded commentary, linked evidence, empty rosters, and exclusion of future goals and equal-time second-half events. Browser checks also cover responsive layout, the mobile playback dock, analysis switching, names/roster selection, motion freezing, seeking, uploads, scenario selection, and reduced motion.

The current audit reports nine high-severity dependency paths rooted in `braces@3.0.3` ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). The registry's latest release remains 3.0.3; suggested fixes downgrade shadcn/Next ESLint across major versions. These were not force-applied. Recheck upstream patches before deployment. Uploaded JSON never enters those glob-pattern tooling packages.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

Inter is self-hosted through `@fontsource-variable/inter`; metric values use self-hosted `@fontsource/jetbrains-mono`. No external font request is required.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!
