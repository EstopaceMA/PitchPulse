import { isLocale } from "@/lib/i18n/locales";
import { isMeaningful } from "@/lib/match/commentary";
import { MATCH_STATUSES, type MatchStatus } from "@/lib/match/playback";
import type { Language, MatchData, Preferences, ViewMode } from "@/lib/match/types";
import { validateMatch } from "@/lib/match/validation";
import { ASK_HISTORY_LIMIT, ASK_QUESTION_LIMIT, NARRATE_LIMIT, type AgentChatTurn, type AgentErrorCode, type AgentName, type AgentOutputs, type AgentResult } from "./contracts";
import { addGrounding, createGrounding, toAgentAnswer, toAgentInsights, toAgentRecap, toCommentaryLines, UnverifiableOutput, type Verified } from "./guards";
import { buildMatchPacket, type MatchPacket } from "./packet";
import { executeTool } from "./tools";

/** Runs one agent turn and returns its final text. lib/foundry provides the Foundry Agent Service runner. */
export type AgentRunner = (agent: AgentName, input: Record<string, unknown>[], tool?: (name: string, args: string) => unknown) => Promise<string>;
/** `report` receives the reason for every removed item or rejected attempt; it is for server logs, not clients. */
export interface AgentDependencies { run: AgentRunner; signal?: AbortSignal; log?: (error: unknown) => void; report?: (reasons: string[]) => void }

export class InvalidRequest extends Error { }

const MODES: readonly unknown[] = ["casual", "analyst", "player"] satisfies ViewMode[];
const HISTORY_TEXT_LIMIT = 2000;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new InvalidRequest(message); }

interface ParsedRequest {
    data: MatchData; cursor: number; elapsed: number; secondHalf: boolean; status: MatchStatus; preferences: Preferences;
    question: string; history: AgentChatTurn[]; narrate: string[];
}

/** Untrusted input: validated like an upload, then asserted to stop exactly at the playhead. */
function parseRequest(agent: AgentName, body: unknown): ParsedRequest {
    check(object(body), "The request body must be a JSON object.");
    const { cursor, elapsed, secondHalf, status, preferences } = body;
    check(Number.isInteger(cursor) && (cursor as number) >= 0, "cursor must be a non-negative integer.");
    check(typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0, "elapsed must be a non-negative number.");
    check(typeof secondHalf === "boolean", "secondHalf must be a boolean.");
    check((MATCH_STATUSES as readonly unknown[]).includes(status), "Unsupported playback status.");
    check(object(preferences) && MODES.includes(preferences.mode) && isLocale(preferences.language) && typeof preferences.team === "string" && typeof preferences.player === "string", "Invalid preferences.");
    let data: MatchData;
    try { data = validateMatch(body.match); } catch (error) { throw new InvalidRequest(error instanceof Error ? error.message : "Invalid match."); }
    const at = elapsed as number, half = data.match.period_seconds;
    check(data.events.length === cursor, "match.events must be exactly the processed prefix: its length must equal cursor.");
    check(at <= data.match.duration_seconds, "elapsed is beyond full-time.");
    check(data.events.every(event => event.match_time_seconds <= at), "match.events contains events after elapsed.");
    if (!secondHalf) check(at <= half && data.events.every(event => event.period === 1), "Second-half events require secondHalf.");
    if (status === "half-time") check(!secondHalf && at === half, "half-time status must sit on the half-time boundary.");
    if (status === "full-time") check(secondHalf && at === data.match.duration_seconds, "full-time status must sit on the full-time boundary.");
    if (agent === "recap") check(status === "half-time" || status === "full-time", "Recaps are written only at half-time or full-time.");
    const teams = new Set(data.teams.map(team => team.team_id)), players = new Set(data.players.map(player => player.player_id));
    const parsed: ParsedRequest = {
        data, cursor: cursor as number, elapsed: at, secondHalf, status: status as MatchStatus,
        preferences: {
            mode: preferences.mode as ViewMode, language: preferences.language as Language,
            team: teams.has(preferences.team as string) ? preferences.team as string : data.match.home_team_id,
            player: players.has(preferences.player as string) ? preferences.player as string : "",
        },
        question: "", history: [], narrate: [],
    };
    if (agent === "ask") {
        check(typeof body.question === "string" && body.question.trim().length > 0 && body.question.trim().length <= ASK_QUESTION_LIMIT, `question must be 1–${ASK_QUESTION_LIMIT} characters.`);
        const history = body.history ?? [];
        check(Array.isArray(history) && history.length <= ASK_HISTORY_LIMIT, `history must list at most ${ASK_HISTORY_LIMIT} turns.`);
        for (const turn of history) {
            check(object(turn) && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string" && turn.text.length <= HISTORY_TEXT_LIMIT, "Invalid history turn.");
            // Context from a later playhead would leak events beyond the processed prefix.
            check(Number.isInteger(turn.cursor) && (turn.cursor as number) >= 0 && (turn.cursor as number) <= parsed.cursor, "History turns must not come from beyond the current cursor.");
        }
        parsed.question = body.question.trim();
        parsed.history = history as AgentChatTurn[];
    }
    if (agent === "commentator") {
        const narrate = body.narrate;
        check(Array.isArray(narrate) && narrate.length > 0 && narrate.length <= NARRATE_LIMIT, `narrate must list 1–${NARRATE_LIMIT} event IDs.`);
        const byId = new Map(data.events.map(event => [event.event_id, event]));
        for (const id of narrate) {
            const event = typeof id === "string" ? byId.get(id) : undefined;
            check(event && event.team_id !== null && isMeaningful(event), "narrate may only list reached, meaningful team events.");
        }
        parsed.narrate = [...new Set(narrate as string[])];
    }
    return parsed;
}

const message = (content: unknown, role: "user" | "assistant" = "user") => ({ type: "message", role, content: typeof content === "string" ? content : JSON.stringify(content) });

/** One corrective retry, carrying the reasons, when a response fails outright or a card or line list loses every item. */
async function generate<N extends AgentName>(agent: N, request: ParsedRequest, packet: MatchPacket, run: AgentRunner): Promise<Verified<AgentOutputs[N]>> {
    const { facts } = packet;
    const grounding = createGrounding(packet.names, [...packet.order.keys(), ...packet.playerTeams.keys(), ...packet.teams.keys()]);
    let input: Record<string, unknown>[];
    let tool: ((name: string, args: string) => unknown) | undefined;
    if (agent === "ask") {
        const context = { match: facts.match, clock: facts.clock, score: facts.score, teams: facts.teams, roster: facts.roster, viewer: facts.viewer };
        addGrounding(grounding, context);
        addGrounding(grounding, request.question);
        for (const turn of request.history) addGrounding(grounding, turn.text);
        input = [...request.history.map(turn => message(turn.text, turn.role)), message({ task: "answer_question", context, question: request.question })];
        const tools = { data: request.data, events: request.data.events, packet };
        tool = (name, args) => {
            const output = executeTool(tools, name, args);
            addGrounding(grounding, output);
            return output;
        };
    } else if (agent === "commentator") {
        const byId = new Map(request.data.events.map(event => [event.event_id, event]));
        const payload = { task: "narrate", language: request.preferences.language, clock: facts.clock, score: facts.score, teams: facts.teams, narrate: request.narrate.map(id => packet.describe(byId.get(id)!)) };
        addGrounding(grounding, payload);
        input = [message(payload)];
    } else {
        addGrounding(grounding, facts);
        input = [message(agent === "recap" ? { task: "write_recap", boundary: request.status, ...facts } : { task: "analyze_moment", ...facts })];
    }
    const verify = (text: string): Verified<unknown> => {
        let raw: unknown;
        try { raw = JSON.parse(text); } catch { throw new UnverifiableOutput("The agent did not return valid JSON."); }
        switch (agent) {
            case "analyst": return toAgentInsights(raw, packet, grounding, request.data.match.match_id);
            case "recap": return toAgentRecap(raw, packet, grounding, request.status === "half-time" ? "half-time" : "full-time");
            case "ask": return toAgentAnswer(raw, packet, grounding);
            default: return toCommentaryLines(raw, grounding, request.narrate);
        }
    };
    const text = await run(agent, input, tool);
    let first: Verified<unknown> | undefined, failures: string[];
    try {
        first = verify(text);
        if (!(Array.isArray(first.result) && first.result.length === 0 && first.dropped > 0)) return first as Verified<AgentOutputs[N]>;
        failures = first.reasons;
    } catch (error) {
        if (!(error instanceof UnverifiableOutput)) throw error;
        failures = [error.message];
    }
    const retry = [...input, message(text, "assistant"), message(`PitchPulse could not verify that response: ${failures.slice(0, 4).join("; ")}. Answer again. Copy numbers and times exactly from the data or tool results, keep IDs and metric keys out of the text, and avoid unsupported claims.`)];
    const second = verify(await run(agent, retry, tool));
    return { ...second, reasons: [...failures.map(reason => `first attempt, ${reason}`), ...second.reasons] } as Verified<AgentOutputs[N]>;
}

function classify(error: unknown, signal: AbortSignal | undefined): { error: AgentErrorCode; message: string } {
    if (error instanceof InvalidRequest) return { error: "invalid_request", message: error.message };
    if (error instanceof UnverifiableOutput) return { error: "unverifiable_output", message: error.message };
    if (signal?.aborted) return { error: "timeout", message: "The agent did not finish in time." };
    if (object(error) && error.status === 429) return { error: "rate_limited", message: "Foundry is rate limiting requests. Try again shortly." };
    // Upstream details stay in server logs; clients only see the code.
    return { error: "upstream_error", message: "The Foundry agent request failed." };
}

export async function handleAgentRequest<N extends AgentName>(agent: N, body: unknown, dependencies: AgentDependencies): Promise<AgentResult<N>> {
    try {
        const request = parseRequest(agent, body);
        const packet = buildMatchPacket(request.data, request.data.events, request);
        const { result, dropped, reasons } = await generate(agent, request, packet, dependencies.run);
        if (reasons.length) dependencies.report?.(reasons);
        return { ok: true, agent, cursor: request.cursor, elapsed: request.elapsed, result, dropped };
    } catch (error) {
        const failure = classify(error, dependencies.signal);
        if (failure.error === "upstream_error" || failure.error === "rate_limited") dependencies.log?.(error);
        return { ok: false, agent, ...failure };
    }
}
