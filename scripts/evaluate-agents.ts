/**
 * Live check of the provisioned agents on the bundled demo at fixed moments. Reports how many generated items
 * the deterministic guards removed. Run `npm run agents:evaluate` after `npm run agents:provision`;
 * `npm run agents:evaluate -- --verbose ask` prints verified output and limits the run to the named agents.
 */
import { readFileSync } from "node:fs";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import type { AgentName, AgentRequest } from "@/lib/agents/contracts";
import { agentResourceName } from "@/lib/agents/definitions";
import { handleAgentRequest } from "@/lib/agents/handle";
import { runAgent, type ResponsesApi } from "@/lib/foundry/run-agent";
import { isMeaningful } from "@/lib/match/commentary";
import { countReached, formatTime, type MatchStatus } from "@/lib/match/playback";
import { validateMatch } from "@/lib/match/validation";

const data = validateMatch(JSON.parse(readFileSync(new URL("../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8")));
const half = data.match.period_seconds, end = data.match.duration_seconds;
const MOMENTS: { elapsed: number; secondHalf: boolean; status: MatchStatus }[] = [
    { elapsed: 900, secondHalf: false, status: "paused" },
    { elapsed: half, secondHalf: false, status: "half-time" },
    { elapsed: 4200, secondHalf: true, status: "paused" },
    { elapsed: end, secondHalf: true, status: "full-time" },
];

function request(moment: (typeof MOMENTS)[number], extra: Partial<AgentRequest> = {}): AgentRequest {
    const events = data.events.slice(0, countReached(data.events, moment.elapsed, moment.secondHalf));
    return {
        match: { ...data, documentation: undefined, events }, cursor: events.length, ...moment,
        preferences: { mode: "analyst", language: "en", team: data.match.home_team_id, player: "" }, ...extra,
    };
}

async function main(): Promise<void> {
    const endpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
    if (!endpoint) throw new Error("Set FOUNDRY_PROJECT_ENDPOINT in .env.local (see .env.example).");
    const openai = new AIProjectClient(endpoint, new DefaultAzureCredential()).getOpenAIClient();
    const responses: ResponsesApi = { create: (body, options) => openai.responses.create(body as never, options) };
    const reference = (agent: AgentName) => {
        const version = process.env[`FOUNDRY_AGENT_VERSION_${agent.toUpperCase()}`];
        return { name: agentResourceName(agent), ...(version ? { version } : {}) };
    };
    const cases: [AgentName, AgentRequest][] = [
        ...MOMENTS.map(moment => ["analyst", request(moment)] as [AgentName, AgentRequest]),
        ["recap", request(MOMENTS[1])], ["recap", request(MOMENTS[3])],
        ["ask", request(MOMENTS[2], { question: "Which Chelsea player has the most recorded actions so far?", history: [] })],
        ["ask", request(MOMENTS[3], { question: "Who took the most shots in this match?", history: [] })],
        // Real squad names invite outside knowledge; the agent must decline without asserting any.
        ["ask", request(MOMENTS[2], { question: "Is Bukayo Saka Arsenal's captain this season?", history: [] })],
        ["commentator", (() => { const base = request(MOMENTS[0]); return { ...base, narrate: base.match.events.filter(event => event.team_id !== null && isMeaningful(event)).slice(-8).map(event => event.event_id) }; })()],
    ];
    const args = process.argv.slice(2), verbose = args.includes("--verbose"), only = args.filter(arg => !arg.startsWith("--"));
    let failures = 0;
    for (const [agent, body] of cases.filter(([agent]) => only.length === 0 || only.includes(agent))) {
        const started = Date.now();
        let removed: string[] = [];
        const result = await handleAgentRequest(agent, body, {
            report: reasons => { removed = reasons; },
            run: async (name, input, tool) => (await runAgent(responses, { agent: reference(name), input, tool })).text,
            log: error => console.error(`  ${agent}:`, error instanceof Error ? error.message : error),
        });
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        if (!result.ok) failures++;
        const summary = !result.ok ? `${result.error}: ${result.message}`
            : Array.isArray(result.result) ? `${result.result.length} kept, ${result.dropped} dropped`
                : `ok, ${result.dropped} dropped`;
        console.log(`${agent.padEnd(12)} ${formatTime(body.elapsed).padEnd(6)} ${summary} (${seconds}s)`);
        for (const reason of removed) console.log(`    ↳ ${reason}`);
        if (verbose && result.ok) console.log(JSON.stringify(result.result, null, 2));
    }
    if (failures) process.exitCode = 1;
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
