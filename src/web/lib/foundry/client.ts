import "server-only";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import type { AgentName } from "@/lib/agents/contracts";
import { agentResourceName } from "@/lib/agents/definitions";
import type { AgentReference, ResponsesApi } from "./run-agent";

/**
 * Server-only Foundry access. Agent Service endpoints use Microsoft Entra ID: DefaultAzureCredential picks up
 * `az login` locally, a managed identity on Azure, or AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET elsewhere.
 */
export function foundryStatus(): { configured: boolean } {
    return { configured: process.env.PITCHPULSE_AI === "on" && Boolean(process.env.FOUNDRY_PROJECT_ENDPOINT) };
}

let responses: ResponsesApi | undefined;
export function foundryResponses(): ResponsesApi {
    if (!responses) {
        const project = new AIProjectClient(process.env.FOUNDRY_PROJECT_ENDPOINT!, new DefaultAzureCredential());
        const openai = project.getOpenAIClient();
        // The SDK merges options.body into the request body, which is how the agent reference is sent.
        responses = { create: (body, options) => openai.responses.create(body as never, options) };
    }
    return responses;
}

export function agentReference(agent: AgentName): AgentReference {
    const version = process.env[`FOUNDRY_AGENT_VERSION_${agent.toUpperCase()}`];
    return { name: agentResourceName(agent), ...(version ? { version } : {}) };
}
