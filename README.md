# PitchPulse

A working event-driven football simulator using Next.js, TypeScript, Tailwind, shadcn/ui, Lucide, and self-hosted Inter and JetBrains Mono. No continuous tracking, AI connection, or credentials are involved.

The visual specification is maintained in [DESIGN.md](DESIGN.md): a charcoal match library and an editor-style analysis studio with green accents and red/blue team identity. The shipped insights are local and rule-based.

## Library and studio guide

- `/` opens a searchable game grid. The bundled Arsenal vs Chelsea synthetic demo is the first game; **Import match** adds compatible JSON as independent library entries. Cards show duration, saved progress, source, and annotation count without revealing final results.
- Imported games, playback checkpoints, notes, and bookmarks are saved in IndexedDB in the current browser. There are no accounts or cloud synchronization. Clearing browser/site data removes the local library. Imports in different browsers are separate.
- Each match opens at `/studio/[id]`. Reopening restores the exact last saved event cursor and clock, paused; ready, half-time, and full-time retain their boundary states. Unknown IDs offer a return to the library.
- Desktop gives the pitch most of the workspace, with the event/library browser collapsed initially, a narrow inspector, and compact playback/timeline controls. **Browser** reopens the event list; **View** in the pitch header opens visualization, fit/detail, and name settings. Narrow screens stack analysis below the pitch and retain one playback dock with safe-area spacing.
- The inspector provides event details, statistics, local insights/commentary, and notes. Half/full-time recaps appear there. New games default to Analyst; Casual Fan and Player Focus remain available under Details and Stats.
- Play/pause, restart, step one event, choose 1×/5×/10×/30× speed, or scrub the timeline. Arrow keys, Home, and End work on the native scrubber. Fit/2×/4×/8× timeline zoom changes horizontal scale without changing playback.
- Timeline team tracks show only processed events. Crowded timestamps form selectable groups, with paged event lists. The notes track shows saved user annotations, including moments beyond a rewound playhead.
- Half-time pauses before period-two events sharing 45:00. **Start second half** explicitly resumes. Full-time stops automatically. Seeking beyond half-time is allowed.
- Selecting an event or insight evidence inspects its processed-prefix pitch snapshot without changing the live clock or statistics. **Follow live** returns to the playhead. Scrubbing deliberately changes playback and rebuilds the prefix when moving backward.
- **Note** pauses playback and opens a text editor anchored to the playhead or inspected event. **Bookmark** saves that moment immediately. Notes and bookmarks can be edited or deleted. Selecting an annotation opens its text; **Go to moment** explicitly restores its precise saved prefix, paused. Notes are plain text, up to 4,000 characters.
- **Preferences** changes favorite team, player, and English/Filipino language without restarting. Preferences remain session-only. Player Focus resets feed filters when the focus changes.
- Imports validate before rendering: 10 MB maximum and 50,000 events. Invalid uploads leave the current match and library unchanged. Imports from within the studio pause playback and add a library entry; select it in the Library tab to switch. Empty datasets have a dedicated state.
- Checkpoints save every two seconds during playback and immediately on pause, seek, and studio navigation. Annotation changes save immediately. Abrupt browser/process termination may lose the latest unsaved interval. **Unsaved · this session only** indicates blocked/unavailable storage; **Retry** attempts persistence without discarding in-memory analysis. Corrupted stored match records are skipped with a recovery message; invalid checkpoints reset safely.
- Imported games can be removed from their card after confirmation; this also removes their notes and bookmarks. The bundled demo remains available.
- The pitch starts in **Full-team simulation**, **Fit pitch**, with player names enabled. **Detailed view** supports horizontal scrolling; selecting a player or lineup entry shows their details. All movement is deterministic and illustrative, driven by the shared replay clock.
- **Recorded events** displays only supplied positions. Missing shot endpoints are never invented. Pause/boundary states freeze movement; reduced motion uses event snapshots. Demo player labels are fictional and are never presented as actual club rosters.

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
| Game library | [components/match/match-library.tsx](components/match/match-library.tsx) |
| Studio composition | [components/match/simulator.tsx](components/match/simulator.tsx) |
| Library validation / timeline grouping | [lib/match/library.ts](lib/match/library.ts) |
| IndexedDB / serialized session store | [lib/match/library-storage.ts](lib/match/library-storage.ts), [lib/match/use-library.ts](lib/match/use-library.ts) |
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

Use `npm test`, `npm run lint`, and `npm run build`. Replay tests cover score rollback, period boundaries, validation, coordinates, and evidence. Movement tests cover all-player coverage, continuity, mirrored formations, equal timestamps, backward sampling, missing fields, and independence from future events. Component markup regressions in [components/match/presentation.test.tsx](components/match/presentation.test.tsx) cover pitch defaults, bilingual inspection controls, playback boundaries, transport labels, and header personalization. [components/match/summary-panels.test.tsx](components/match/summary-panels.test.tsx) verifies statistics comparisons, absence of possession estimates, bounded commentary, linked evidence, empty rosters, and exclusion of future goals and equal-time second-half events. Studio regressions cover exact checkpoint restoration, same-time and period boundaries, annotation anchors, invalid persisted records, library cards, bilingual note controls, and bounded 50,000-event timeline rendering. Browser checks cover multiple imports, invalid input preservation, notes/bookmarks, reload persistence, navigation, removal, storage failure/retry, timeline zoom, playback boundaries, mobile layout, keyboard controls, and reduced motion.

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
