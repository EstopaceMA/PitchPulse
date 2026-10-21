/**
 * Creates the four PitchPulse prompt agents in Microsoft Foundry, or adds a new version of each.
 * Run `npm run agents:provision` after `az login`; the signed-in identity needs the Foundry User role on the project.
 */
import { AIProjectClient, type PromptAgentDefinition } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { AGENT_NAMES } from "@/lib/agents/contracts";
import { AGENT_DEFINITIONS, agentMetadata, agentResourceName, promptAgentDefinition } from "@/lib/agents/definitions";

async function main(): Promise<void> {
    const endpoint = process.env.FOUNDRY_PROJECT_ENDPOINT, model = process.env.FOUNDRY_MODEL_DEPLOYMENT;
    if (!endpoint || !model) throw new Error("Set FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_MODEL_DEPLOYMENT in .env.local (see .env.example).");
    const fast = process.env.FOUNDRY_MODEL_DEPLOYMENT_FAST || model;
    const project = new AIProjectClient(endpoint, new DefaultAzureCredential());
    const pins: string[] = [];
    for (const agent of AGENT_NAMES) {
        const deployment = AGENT_DEFINITIONS[agent].fast ? fast : model;
        const definition: PromptAgentDefinition = promptAgentDefinition(agent, deployment);
        const version = await project.agents.createVersion(agentResourceName(agent), definition, { description: AGENT_DEFINITIONS[agent].description, metadata: agentMetadata(agent) });
        console.log(`✓ ${version.name} v${version.version} (${deployment})`);
        pins.push(`FOUNDRY_AGENT_VERSION_${agent.toUpperCase()}=${version.version}`);
    }
    console.log(`\nOptional version pins for .env.local:\n${pins.join("\n")}`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
