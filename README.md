# PitchPulse

A working event-driven football simulator using Next.js, TypeScript, Tailwind, shadcn/ui, Lucide, and self-hosted Inter and JetBrains Mono. No continuous tracking is involved. Optional [Microsoft Foundry analysis agents](#optional-microsoft-foundry-agents) are off by default; without them, no AI connection or credentials are involved.

The visual specification is maintained in [DESIGN.md](src/web/DESIGN.md): a charcoal match library and an editor-style analysis studio with green accents and red/blue team identity. The built-in insights are local and rule-based; the optional agents add separately labeled AI analysis.

Repository layout:
- [src/web/](src/web/) is the whole Next.js app: source, tests, scripts, data and its `Dockerfile`. Run npm commands there.
- [infra/](infra/) (Terraform) and [azure.yaml](azure.yaml) make the repository an Azure Developer CLI template; see [Deploy to Azure](#deploy-to-azure).

## Library and studio guide

- `/` opens a searchable match library with one **Import match** action and a single preview/title link per card. The bundled Arsenal vs Chelsea synthetic demo is the first game; **Import match** adds compatible JSON as independent library entries. Cards show duration, saved progress, source, and annotation count without revealing final results.
- Imported games, playback checkpoints, notes, and bookmarks are saved in IndexedDB in the current browser. There are no accounts or cloud synchronization. Clearing browser/site data removes the local library. Imports in different browsers are separate.
- Each match opens at `/studio/[id]`. Reopening restores the exact last saved event cursor and clock, paused; ready, half-time, and full-time retain their boundary states. Unknown IDs offer a return to the library.
- Desktop gives the pitch most of the workspace, with the event browser collapsed initially, a narrow inspector, and compact playback/timeline controls. **Browser** in the pitch toolbar reopens the event list; **Inspector** toggles analysis; **View** in the pitch header opens visualization, fit/detail, and name settings. Narrow screens stack analysis below the pitch and retain one playback dock with safe-area spacing.
- Above 900px, drag the divider beside Browser or Inspector to resize it. Arrow keys move a focused divider by 10px (Shift: 50px); Home/End select its minimum/maximum width. Enter or double-click restores its responsive default; Escape cancels a drag. Widths are remembered for the mounted studio, including closing/reopening panels, and reset on a fresh visit. Smaller windows temporarily reduce panel widths to keep at least 360px for the pitch; the preferred widths return when space allows. Mobile keeps the stacked layout without splitters.
- The inspector provides event details, statistics, local insights/commentary, and notes. Half/full-time recaps appear there. New games default to Analyst; Casual Fan and Player Focus remain available under **Preferences → Perspective**, with the active perspective shown above the inspector content. When AI analysis is on, an **Ask** tab appears as well.
- Play/pause, restart, step one event, choose 1×/5×/10×/30× from the labeled speed select, or scrub the timeline. Arrow keys, Home, and End work on the native scrubber. The Fit/2×/4×/8× zoom select changes horizontal scale without changing playback.
- Timeline team tracks show only processed events. Crowded timestamps form selectable groups, with paged event lists. The notes track shows saved user annotations, including moments beyond a rewound playhead.
- Half-time pauses before period-two events sharing 45:00. **Start second half** explicitly resumes. Full-time stops automatically. Seeking beyond half-time is allowed.
- Selecting an event or insight evidence inspects its processed-prefix pitch snapshot without changing the live clock or statistics. **Follow live** returns to the playhead. Scrubbing deliberately changes playback and rebuilds the prefix when moving backward.
- **Note** pauses playback and opens a text editor anchored to the playhead or inspected event. **Bookmark** saves that moment immediately. Notes and bookmarks can be edited or deleted. Selecting an annotation opens its text; **Go to moment** explicitly restores its precise saved prefix, paused. Notes are plain text, up to 4,000 characters.
- **Preferences** changes perspective, favorite team, player, and English/Filipino language without restarting. Preferences remain session-only. Player Focus resets feed filters when the focus changes.
- Imports validate before rendering: 10 MB maximum and 50,000 events. Invalid uploads leave the current match and library unchanged. Use the top-bar **Library** link to return to the match library to import or switch matches. Empty datasets have a dedicated state.
- Checkpoints save every two seconds during playback and immediately on pause, seek, and studio navigation. Annotation changes save immediately. Abrupt browser/process termination may lose the latest unsaved interval. **Unsaved · this session only** indicates blocked/unavailable storage; **Retry** attempts persistence without discarding in-memory analysis. Corrupted stored match records are skipped with a recovery message; invalid checkpoints reset safely.
- Imported games can be removed from their card after confirmation; this also removes their notes and bookmarks. The bundled demo remains available.
- The pitch starts in **Full-team simulation**, **Fit pitch**, with player names enabled. **Detailed view** supports horizontal scrolling; selecting a player or lineup entry shows their details. All movement is deterministic and illustrative, driven by the shared replay clock.
- **Recorded events** displays only supplied positions. Missing shot endpoints are never invented. Pause/boundary states freeze movement; reduced motion uses event snapshots. A visible pitch disclosure identifies illustrative movement and what the dataset says about its players: fictional demo players, or real squad names in a simulated match, as in the bundled demo. **About this view** expands the legend, interaction hints, and detailed data limitations. Raw event IDs remain available in event details. The demo's events are never presented as an actual fixture.

## Data and architecture

The default source is [public/arsenal-vs-chelsea-match.json](src/web/public/arsenal-vs-chelsea-match.json). The match API imports this copy and validates it before sending it to the simulator. No parent-folder dataset or expanded Turbopack root is required. As with any public asset, the original JSON is also directly downloadable; its raw summaries are not used by live panels.

### Demo roster

The bundled demo is a simulated match between real clubs with real players. Every event is invented; only the player details are real.

Data sources:

| Data | Source | Notes |
| --- | --- | --- |
| Arsenal first-team squad | English Wikipedia, [Arsenal F.C. § First-team squad](https://en.wikipedia.org/w/index.php?title=Arsenal_F.C.&oldid=1381292988), revision 1381292988 | Section marked updated 3 September 2026 |
| Chelsea first-team squad | English Wikipedia, [Chelsea F.C. § First-team squad](https://en.wikipedia.org/w/index.php?title=Chelsea_F.C.&oldid=1381218771), revision 1381218771 | Section marked updated 1 September 2026 |
| Starting XIs | Editorial choice, [data/lineups.json](src/web/data/lineups.json) | Placed in the dataset's fixed 4-3-3; not a real lineup |
| Match events | The original PitchPulse simulation | Synthetic; see `documentation` in the dataset |

- Both squad lists were read on 22 October 2026 (UTC). Wikipedia text is available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- Only each player's name, shirt number, nationality code and listed position (GK, DF, MF or FW) were taken. No dates of birth, photos or other personal details were taken.
- [data/squads.json](src/web/data/squads.json) records those rows for both full squads, with each page and revision. The repository contains no scraping code, and the app never fetches player data.
- Player IDs (`ARS01`…`CHE11`) and slot positions never change.
- Shots that the original simulation gave to defenders now belong to a forward (inside the penalty area) or a midfielder (outside it), together with the pass, ball win or pressure that set them up. Event IDs, times, positions, outcomes, team totals and goals are unchanged.
- The dataset's `disclaimer`, `documentation.roster` and `documentation.shot_attribution` record the same sources and changes.

To change the roster:
1. Edit [data/squads.json](src/web/data/squads.json) from a newer revision of the pages above, and record the new revision and date. Edit [data/lineups.json](src/web/data/lineups.json) if a pick has changed.
2. From `src/web`, run `npm run data:demo`. It rebuilds the bundled JSON offline and stops if a pick is not in the squad, does not fit its slot, or repeats a shirt number. It changes only the roster, disclaimer, documentation notes and realigned event references, and keeps the file's formatting.

| Responsibility | Source |
| --- | --- |
| Types / provider contract | [lib/match/types.ts](src/web/lib/match/types.ts) |
| Upload validation | [lib/match/validation.ts](src/web/lib/match/validation.ts) |
| Pure event state machine | [lib/match/playback.ts](src/web/lib/match/playback.ts) |
| Shared clock / atomic incremental stats | [lib/match/use-simulation.ts](src/web/lib/match/use-simulation.ts) |
| Statistics reducer | [lib/match/statistics.ts](src/web/lib/match/statistics.ts) |
| Illustrative movement model | [lib/match/movement.ts](src/web/lib/match/movement.ts) |
| Named player markers and roster | [components/match/team-motion.tsx](src/web/components/match/team-motion.tsx) |
| Deterministic bilingual rules | [lib/match/insights.ts](src/web/lib/match/insights.ts) |
| Dataset API | [app/api/match/route.ts](src/web/app/api/match/route.ts) |
| Game library | [components/match/match-library.tsx](src/web/components/match/match-library.tsx) |
| Studio composition | [components/match/simulator.tsx](src/web/components/match/simulator.tsx) |
| Library validation / timeline grouping | [lib/match/library.ts](src/web/lib/match/library.ts) |
| IndexedDB / serialized session store | [lib/match/library-storage.ts](src/web/lib/match/library-storage.ts), [lib/match/use-library.ts](src/web/lib/match/use-library.ts) |
| Agent contracts / prefix-only match packet | [lib/agents/contracts.ts](src/web/lib/agents/contracts.ts), [lib/agents/packet.ts](src/web/lib/agents/packet.ts) |
| Agent output guards / Ask tools / instructions | [lib/agents/guards.ts](src/web/lib/agents/guards.ts), [lib/agents/tools.ts](src/web/lib/agents/tools.ts), [lib/agents/definitions.ts](src/web/lib/agents/definitions.ts) |
| Agent request pipeline / route | [lib/agents/handle.ts](src/web/lib/agents/handle.ts), [app/api/agents/[agent]/route.ts](src/web/app/api/agents/[agent]/route.ts) |
| Foundry runner / server-only client | [lib/foundry/run-agent.ts](src/web/lib/foundry/run-agent.ts), [lib/foundry/client.ts](src/web/lib/foundry/client.ts) |
| Studio AI state / Foundry insight provider | [lib/match/use-agents.ts](src/web/lib/match/use-agents.ts) |
| Demo roster build (lineups, shot realignment) | [scripts/build-demo.ts](src/web/scripts/build-demo.ts), [scripts/demo-data/](src/web/scripts/demo-data/) |
| Tests | [lib/match/simulator.test.ts](src/web/lib/match/simulator.test.ts), [lib/agents/](src/web/lib/agents/), [scripts/demo-data/](src/web/scripts/demo-data/) |

Playback stores elapsed time **and an event cursor** to preserve sequence at equal timestamps. Forward playback folds new events into cloned statistics; backward seeks rebuild the prefix. Statistics never use final summaries.

The movement timeline is built exclusively from the processed prefix, never future events. Player targets combine role-based lanes, the last observed ball location, and participants in the current action. Interrupted six-second player tweens start from the previous trajectory's current position. Ball flights between recorded endpoints use an illustrative two seconds; a shot without an endpoint does not invent a goal location. Pure sampling at elapsed time is replay/seek deterministic. It produces no extra match events or statistics.

Insights use 300-second windows, 180-second per-rule/team/player cooldowns, and a bounded 200-card history. Live cards expire after 600 seconds and deduplicate by rule/team/player. Comparison evidence includes both windows. Early comparisons disclose partial windows. Player rules require four actions or a goal. Facts are separate from cautious interpretations.

`InsightProvider` is the Microsoft Foundry boundary. `ruleBasedProvider` is local, deterministic and always on. `foundryInsightProvider` is the remote implementation. It calls a server route that keeps credentials private, accepts only processed events and returns typed, verified evidence. Foundry is called only when AI analysis is configured, switched on, and a button is pressed.

## Optional Microsoft Foundry agents

Four Foundry Agent Service prompt agents add AI analysis. Each runs only on demand and pauses playback first:

| Agent | Where | What it adds |
| --- | --- | --- |
| Tactical Analyst (`pitchpulse-analyst`) | Insights → **Analyze this moment** | One to four insight cards: pressing, build-up, turnovers, flank preference, momentum, player involvement |
| Recap Writer (`pitchpulse-recap`) | Half/full-time recap → **Write AI recap** | A narrative story, evidence-linked turning points, per-team notes and, at half-time only, questions for the second half |
| Ask the Analyst (`pitchpulse-ask`) | **Ask** tab, and **Draft with AI** in the note editor | Answers about the reached match. The agent calls PitchPulse function tools, which see only the processed prefix |
| Live Commentator (`pitchpulse-commentator`) | Live commentary → **Narrate with AI** | One casual line per recent meaningful event, shown under the unchanged templated row |

How the agents stay honest:
- The model chooses what to say and writes the text; PitchPulse code supplies every number.
- Requests carry only the processed prefix. The server re-validates the payload like an upload and asserts that it ends at the playhead.
- [lib/agents/packet.ts](src/web/lib/agents/packet.ts) derives the metrics with the same reducer as the Stats tab: totals, 15-minute blocks, team-relative thirds, and flanks as drawn. It derives no possession share, distances, speeds or synthetic estimates.
- [lib/agents/guards.ts](src/web/lib/agents/guards.ts) removes any card, note or line with any of the following:
  - unknown or future evidence;
  - numbers or mm:ss times the model was never shown;
  - possession percentages, distances, speeds, xG, probabilities or betting language;
  - outside knowledge about the real clubs and players, such as seasons, transfers, injuries, captaincy or competitions;
  - internal metric keys, block codes or dataset IDs in the prose.
- Card metrics and evidence come from the packet catalog. When the list of supporting events is capped, the card states the full count.
- AI output is always labeled **AI · Microsoft Foundry**, and is hidden after a rewind past the moment it describes. Ask history from a later playhead is never sent back.
- No web grounding is enabled.

Setup (requires Node 22 or later, for example via `nvm use`):

1. Create a Foundry project and deploy an agent-supported model (the default is `gpt-5-mini`).
2. Grant your account **Foundry User** (formerly Azure AI User) on the project. A deployed server identity needs **Foundry User** on the project; the Azure template assigns it at project scope only. The narrower Foundry Project Runtime User and Foundry Agent Consumer roles return 403 for Responses API calls that use an agent reference. Agent Service uses Microsoft Entra ID, not API keys: `DefaultAzureCredential` uses `az login` locally, a managed identity on Azure, or `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` elsewhere.
3. In `src/web`, copy [.env.example](src/web/.env.example) to `.env.local` and set `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_MODEL_DEPLOYMENT` and `PITCHPULSE_AI=on`.
4. From `src/web`, run `npm run agents:provision`. It creates or versions the four agents and prints optional `FOUNDRY_AGENT_VERSION_*` pins.
5. Optionally run `npm run agents:evaluate`. It calls each agent on the bundled demo at fixed moments and reports how many generated items the guards removed, and why. Add `-- --verbose` to print the verified output, and agent names (for example `-- --verbose ask`) to run only those agents.

When a recap or answer fails verification, or every card or line is removed, the agent gets one corrective retry that names the failed checks. The server logs removal reasons as `[agents/<name>] removed by verification: …`. With `gpt-5-mini`, a turn takes roughly 15–45 seconds; the route allows up to 115 seconds.

Data and limits:
- AI analysis is opt-in per session, under Preferences or in the Insights tab.
- When used, the match's reached events, your question and earlier visible answers are sent to your Foundry project, where responses are stored. Note text is never sent.
- AI results live in session memory only.
- The route accepts same-origin requests up to 10 MB, with a best-effort per-instance rate limit.
- Claude models in Foundry are served through the Anthropic Messages API rather than prompt agents, so using them would require a hosted agent.

## Compatible uploads and integrity

Required top-level fields: `match`, `teams` (two), `players`, and `events`. Match requires `match_id`, valid distinct home/away IDs, positive `duration_seconds`, and an earlier `period_seconds` half-time boundary.

Players require `player_id`, `name` and a valid `team_id`; `shirt_number`, `position`, `nationality` (text) and `fictional` are optional. A `synthetic: true` match whose players are all marked `fictional: false` is shown as real squad names in a simulated match. Any player marked `fictional: true` keeps the fictional-demo disclosure.

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

From `src/web`, use `npm test`, `npm run lint`, and `npm run build`. For the infrastructure, run `terraform fmt -check` and `terraform validate` in `infra/`. Agent tests run without Azure, using fake runners. They cover:
- prefix-only packets and parity with the statistics reducer;
- zone mirroring;
- grounding and banned claims in English and Filipino;
- the local tool loop;
- request rejection and error classification;
- markup for the labeled AI panels.

Demo roster tests cover lineup checks against the squad snapshot, shot realignment, minimal-diff rewriting of the bundled JSON and the demo refresh that keeps saved progress and notes.

Replay tests cover score rollback, period boundaries, validation, coordinates, and evidence. Movement tests cover all-player coverage, continuity, mirrored formations, equal timestamps, backward sampling, missing fields, and independence from future events. Component markup regressions in [components/match/presentation.test.tsx](src/web/components/match/presentation.test.tsx) cover pitch defaults, bilingual inspection controls, playback boundaries, transport labels, and header personalization. [components/match/summary-panels.test.tsx](src/web/components/match/summary-panels.test.tsx) verifies statistics comparisons, absence of possession estimates, bounded commentary, linked evidence, empty rosters, and exclusion of future goals and equal-time second-half events. Studio regressions cover exact checkpoint restoration, same-time and period boundaries, annotation anchors, invalid persisted records, library cards, bilingual note controls, and bounded 50,000-event timeline rendering. Browser checks cover multiple imports, invalid input preservation, notes/bookmarks, reload persistence, navigation, removal, storage failure/retry, timeline zoom, playback boundaries, mobile layout, keyboard controls, and reduced motion.

The current audit reports nine high-severity dependency paths rooted in `braces@3.0.3` ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). The registry's latest release remains 3.0.3; suggested fixes downgrade shadcn/Next ESLint across major versions. These were not force-applied. Recheck upstream patches before deployment. Uploaded JSON never enters those glob-pattern tooling packages.

## Deploy to Azure

The repository is an [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/) (azd) template. `azd up` provisions [infra/](infra/) with Terraform and deploys [src/web](src/web/) to Azure Container Apps. The image is built in Azure from [src/web/Dockerfile](src/web/Dockerfile) as a Next.js standalone server.

It creates one resource group, `rg-<environment>`, containing:
- **Container App:** one always-warm replica, 0.5 vCPU and 1 GiB, with an HTTPS endpoint.
- **Container Registry:** Basic.
- **Container Apps environment** and a **Log Analytics workspace**.
- **User-assigned managed identity:** gets **AcrPull** on the registry, and **Foundry User** scoped to your one Foundry project. There are no keys or secrets.

It also creates a monthly cost alert on your Foundry resource group, which notifies subscription Owners. Your Foundry account and project are only looked up, so `azd down` never deletes them.

Prerequisites:
- **Tools:** azd, Terraform 1.9 or later, and the Azure CLI.
- **Sign-in:** run `az login` and `azd auth login`. Terraform authenticates through the Azure CLI.
- **Permissions:** Owner or User Access Administrator on the subscription, to create the role assignments.
- **One-time setup:** `az provider register --namespace Microsoft.ContainerRegistry --wait`.

```bash
azd env new pitchpulse-demo --location southeastasia
azd env set FOUNDRY_PROJECT_ENDPOINT "https://<account>.services.ai.azure.com/api/projects/<project>"
azd env set FOUNDRY_AGENT_VERSION 5   # optional
azd env set AI_BUDGET_AMOUNT 25       # optional
azd up
```

| Setting | Effect |
| --- | --- |
| `FOUNDRY_PROJECT_ENDPOINT` | Turns AI analysis on and gives the app's identity access to that project. Leave it unset to deploy without AI. |
| `FOUNDRY_AGENT_VERSION` | Pins all four agents to one provisioned version. Unset uses each agent's latest version. |
| `AI_BUDGET_AMOUNT` | Monthly cost alert in US dollars on the Foundry resource group. The default is 25; 0 creates none. |

Afterwards:
- `azd deploy` ships code changes.
- `azd provision` applies infrastructure changes and never rolls back the deployed image.
- `azd down` deletes the environment.
- After provisioning new agent versions, run `azd env set FOUNDRY_AGENT_VERSION <n>` and then `azd provision`.

Notes:
- **Region:** use the Foundry project's region for `--location`, to keep agent calls short.
- **Access:** the app is public. AI stays opt-in per visitor and on demand, and the agents route rate-limits each visitor by the client address that Container Apps supplies. The single replica keeps that in-memory limit accurate.
- **Cost:** roughly US$15 a month (one idle replica about US$10, the registry about US$5) plus Foundry token usage.
- **State:** Terraform state stays local in `.azure/<environment>`. Configure remote state before sharing an environment. azd's Terraform support is in beta.
- **Troubleshooting:**
  - If the first AI request fails with a Foundry error (403 in `az containerapp logs show`), the role assignment may still be propagating; retry after a few minutes.
  - Older azd releases (for example 1.23) fail the remote build with `InvalidCorrelationRequestId`. Update azd, or start Docker so azd can build locally, or build and roll out with the Azure CLI using the values from `azd env get-values`:

    ```bash
    az acr build --registry "$AZURE_CONTAINER_REGISTRY_NAME" --image "pitchpulse/web-$AZURE_ENV_NAME:$TAG" src/web
    az containerapp update -n "$SERVICE_WEB_NAME" -g "$AZURE_RESOURCE_GROUP" --image "$AZURE_CONTAINER_REGISTRY_ENDPOINT/pitchpulse/web-$AZURE_ENV_NAME:$TAG"
    ```

## Getting Started

From `src/web`, use Node 22 or later (`nvm use` reads [.nvmrc](src/web/.nvmrc)), install with `npm ci`, then run the development server:

```bash
cd src/web
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/web/app/page.tsx`. The page auto-updates as you edit the file.

Inter is self-hosted through `@fontsource-variable/inter`; metric values use self-hosted `@fontsource/jetbrains-mono`. No external font request is required.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!
