/** The subset of the OpenAI Responses client used by PitchPulse. lib/foundry/client.ts adapts the Foundry SDK; tests inject fakes. */
export interface ResponsesApi {
    create(body: Record<string, unknown>, options: { body: Record<string, unknown>; signal?: AbortSignal }): Promise<unknown>;
}
export interface AgentReference { name: string; version?: string }
export interface RunAgentOptions {
    agent: AgentReference;
    input: Record<string, unknown>[];
    /** Executes one function call inside PitchPulse; the result must be JSON-serializable. */
    tool?: (name: string, args: string) => unknown;
    signal?: AbortSignal;
    maxRounds?: number;
}
export interface RunAgentResult { text: string; responseId: string; rounds: number }

/** Refusals, failed or incomplete runs, unexpected payloads and runaway tool loops. */
export class AgentRunError extends Error { }

const MAX_ROUNDS = 6;
interface FunctionCall { type: "function_call"; call_id: string; name: string; arguments?: string }
interface AgentResponse { id: string; status?: string; output: unknown[]; output_text?: string; error?: { message?: string } | null; incomplete_details?: { reason?: string } | null }

function parseResponse(value: unknown): AgentResponse {
    const response = value as AgentResponse;
    if (typeof value !== "object" || value === null || typeof response.id !== "string" || !Array.isArray(response.output)) throw new AgentRunError("Foundry returned an unexpected response.");
    if (response.error) throw new AgentRunError(response.error.message ?? "Foundry reported an error.");
    if (response.status === "failed" || response.status === "cancelled") throw new AgentRunError(`The agent run ${response.status}.`);
    if (response.status === "incomplete") throw new AgentRunError(`The agent response was incomplete (${response.incomplete_details?.reason ?? "unknown reason"}).`);
    return response;
}
const isFunctionCall = (item: unknown): item is FunctionCall => typeof item === "object" && item !== null
    && (item as FunctionCall).type === "function_call" && typeof (item as FunctionCall).call_id === "string" && typeof (item as FunctionCall).name === "string";

function outputText(response: AgentResponse): string {
    let text = "";
    for (const item of response.output) {
        if (typeof item !== "object" || item === null || (item as { type?: unknown }).type !== "message") continue;
        for (const part of (item as { content?: unknown[] }).content ?? []) {
            const typed = part as { type?: unknown; text?: unknown };
            if (typed.type === "refusal") throw new AgentRunError("The agent declined to answer.");
            if (typed.type === "output_text" && typeof typed.text === "string") text += typed.text;
        }
    }
    return text || (typeof response.output_text === "string" ? response.output_text : "");
}

/**
 * One agent turn through Foundry Agent Service: responses.create with an agent reference, then a
 * local function-call loop chained by previous_response_id. Foundry runs expire after 10 minutes;
 * the caller's signal bounds the whole turn.
 */
export async function runAgent(responses: ResponsesApi, options: RunAgentOptions): Promise<RunAgentResult> {
    const maxRounds = options.maxRounds ?? MAX_ROUNDS;
    const agent = { type: "agent_reference", name: options.agent.name, ...(options.agent.version ? { version: options.agent.version } : {}) };
    // Foundry rejects the older `agent` key as deprecated; `agent_reference` is the current field.
    const send = async (body: Record<string, unknown>) => parseResponse(await responses.create(body, { body: { agent_reference: agent }, signal: options.signal }));
    let response = await send({ input: options.input });
    for (let round = 1; ; round++) {
        const calls = response.output.filter(isFunctionCall);
        if (calls.length === 0) {
            const text = outputText(response);
            if (!text) throw new AgentRunError("The agent returned no output.");
            return { text, responseId: response.id, rounds: round };
        }
        if (!options.tool) throw new AgentRunError("The agent requested a tool, but this agent has none.");
        if (round >= maxRounds) throw new AgentRunError(`The agent exceeded ${maxRounds} tool rounds.`);
        const outputs = calls.map(call => ({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(options.tool!(call.name, call.arguments ?? "")) }));
        response = await send({ input: outputs, previous_response_id: response.id });
    }
}
