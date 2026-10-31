import { isAgentName, type AgentErrorCode, type AgentResult } from "@/lib/agents/contracts";
import { handleAgentRequest } from "@/lib/agents/handle";
import { clientAddress, createRateLimiter, sameOrigin } from "@/lib/agents/rate-limit";
import { agentReference, foundryResponses, foundryStatus } from "@/lib/foundry/client";
import { runAgent } from "@/lib/foundry/run-agent";

// A recap or answer may take one corrective retry (~35 s per Foundry turn with gpt-5-mini).
export const maxDuration = 120;

const BODY_LIMIT = 10 * 1024 * 1024;
const TIMEOUT_MS = 115_000;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_LIMIT = 30;
const STATUS: Record<AgentErrorCode, number> = { invalid_request: 400, unverifiable_output: 422, rate_limited: 429, upstream_error: 502, not_configured: 503, timeout: 504 };

// Best-effort and per server instance, which is why production runs a single replica.
const limiter = createRateLimiter(RATE_LIMIT, RATE_WINDOW_MS);

const failure = (agent: string, error: AgentErrorCode, message: string, status = STATUS[error]) => Response.json({ ok: false, agent, error, message }, { status });

export async function POST(request: Request, context: RouteContext<"/api/agents/[agent]">) {
    const { agent } = await context.params;
    if (!isAgentName(agent)) return failure(agent, "invalid_request", "Unknown agent.", 404);
    if (!sameOrigin(request.headers)) return failure(agent, "invalid_request", "Cross-origin requests are not accepted.", 403);
    if (!foundryStatus().configured) return failure(agent, "not_configured", "Microsoft Foundry agents are not configured on this server.");
    if (limiter.limited(clientAddress(request.headers), Date.now())) return failure(agent, "rate_limited", "Too many AI requests. Try again in a few minutes.");
    // Browsers always send Content-Length for a string body; without it a streamed body would be read in full first.
    const length = request.headers.get("content-length");
    if (length === null) return failure(agent, "invalid_request", "Content-Length is required.", 411);
    if (Number(length) > BODY_LIMIT) return failure(agent, "invalid_request", "The request is larger than 10 MB.", 413);
    // Node stops reading at Content-Length, so the body can be no larger than the header allowed.
    const text = await request.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { return failure(agent, "invalid_request", "The request body must be JSON."); }

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]);
    const result: AgentResult = await handleAgentRequest(agent, body, {
        signal,
        run: async (name, input, tool) => (await runAgent(foundryResponses(), { agent: agentReference(name), input, tool, signal })).text,
        log: error => console.error(`[agents/${agent}]`, error instanceof Error ? error.message : error),
        report: reasons => console.warn(`[agents/${agent}] removed by verification: ${reasons.join(" | ")}`),
    });
    return Response.json(result, { status: result.ok ? 200 : STATUS[result.error] });
}
