import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AgentRunError, runAgent, type ResponsesApi } from "./run-agent";

type Call = { body: Record<string, unknown>; options: { body: Record<string, unknown>; signal?: AbortSignal } };
const message = (text: string) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
function fake(responses: unknown[]) {
    const calls: Call[] = [];
    const api: ResponsesApi = { create: async (body, options) => { calls.push({ body, options }); return responses.shift(); } };
    return { api, calls };
}

describe("Foundry agent runner", () => {
    test("sends the pinned agent reference in the request body and returns the output text", async () => {
        const { api, calls } = fake([{ id: "resp_1", status: "completed", output: [message('{"cards":[]}')] }]);
        const controller = new AbortController();
        const result = await runAgent(api, { agent: { name: "pitchpulse-analyst", version: "3" }, input: [{ type: "message", role: "user", content: "{}" }], signal: controller.signal });
        assert.deepEqual(result, { text: '{"cards":[]}', responseId: "resp_1", rounds: 1 });
        assert.deepEqual(calls[0].options.body, { agent_reference: { type: "agent_reference", name: "pitchpulse-analyst", version: "3" } });
        assert.equal(calls[0].options.signal, controller.signal);
        assert.deepEqual(calls[0].body, { input: [{ type: "message", role: "user", content: "{}" }] });
    });

    test("executes function calls locally and chains their outputs with previous_response_id", async () => {
        const { api, calls } = fake([
            { id: "resp_1", output: [{ type: "function_call", call_id: "call_a", name: "get_stats", arguments: '{"scope":"team"}' }, { type: "function_call", call_id: "call_b", name: "get_rule_insights", arguments: "" }] },
            { id: "resp_2", output: [message("done")] },
        ]);
        const executed: [string, string][] = [];
        const result = await runAgent(api, { agent: { name: "pitchpulse-ask" }, input: [], tool: (name, args) => { executed.push([name, args]); return { name }; } });
        assert.equal(result.text, "done");
        assert.equal(result.rounds, 2);
        assert.deepEqual(executed, [["get_stats", '{"scope":"team"}'], ["get_rule_insights", ""]]);
        assert.deepEqual(calls[1].body, {
            input: [{ type: "function_call_output", call_id: "call_a", output: '{"name":"get_stats"}' }, { type: "function_call_output", call_id: "call_b", output: '{"name":"get_rule_insights"}' }],
            previous_response_id: "resp_1",
        });
        assert.deepEqual(calls[1].options.body, { agent_reference: { type: "agent_reference", name: "pitchpulse-ask" } });
    });

    test("caps tool rounds and refuses tool calls for agents without tools", async () => {
        const call = { id: "resp", output: [{ type: "function_call", call_id: "c", name: "get_stats", arguments: "{}" }] };
        await assert.rejects(runAgent(fake([call, call, call]).api, { agent: { name: "a" }, input: [], tool: () => ({}), maxRounds: 2 }), AgentRunError);
        await assert.rejects(runAgent(fake([call]).api, { agent: { name: "a" }, input: [] }), AgentRunError);
    });

    test("treats refusals, failed or incomplete runs and empty output as errors", async () => {
        for (const response of [
            { id: "r", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] },
            { id: "r", status: "failed", output: [] },
            { id: "r", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] },
            { id: "r", output: [] },
            { unexpected: true },
        ]) await assert.rejects(runAgent(fake([response]).api, { agent: { name: "a" }, input: [] }), AgentRunError);
    });
});
