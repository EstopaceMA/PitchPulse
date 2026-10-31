import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { isMeaningful } from "../match/commentary";
import { countReached, type MatchStatus } from "../match/playback";
import { aggregate } from "../match/statistics";
import { validateMatch } from "../match/validation";
import { handleAgentRequest, type AgentRunner } from "./handle";
import { buildMatchPacket } from "./packet";
import { executeTool } from "./tools";

const raw = JSON.parse(readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8"));
const data = validateMatch(raw);
const half = data.match.period_seconds, end = data.match.duration_seconds;
const home = data.match.home_team_id, away = data.match.away_team_id;
const homeName = data.teams.find(team => team.team_id === home)!.name;
const both = (en: string, fil = en) => { void fil; return en; };

function body(elapsed: number, secondHalf: boolean, status: MatchStatus = "paused", extra: Record<string, unknown> = {}) {
    const cursor = countReached(data.events, elapsed, secondHalf);
    return { match: { ...data, events: data.events.slice(0, cursor) }, cursor, elapsed, secondHalf, status, preferences: { mode: "analyst", language: "en", team: home, player: "" }, ...extra };
}
function fake(respond: (input: Record<string, unknown>[], tool?: (name: string, args: string) => unknown) => string | Promise<string>) {
    const calls: { agent: string; input: Record<string, unknown>[] }[] = [];
    const run: AgentRunner = async (agent, input, tool) => { calls.push({ agent, input }); return respond(input, tool); };
    return { run, calls };
}
const prefixStats = (elapsed: number, secondHalf: boolean) => aggregate(data, data.events.slice(0, countReached(data.events, elapsed, secondHalf)));

describe("agent request handling", () => {
    test("passes each validated locale to Foundry and returns one verified response in that language", async () => {
        const headlines = { en: "Shots so far", fil: "Mga tira sa ngayon", es: "Tiros hasta ahora", "pt-BR": "Finalizações até agora", id: "Tembakan sejauh ini", ar: "التسديدات حتى الآن", th: "การยิงจนถึงตอนนี้" } as const;
        const request = body(1800, false);
        for (const language of Object.keys(headlines) as (keyof typeof headlines)[]) {
            const runner = fake(() => JSON.stringify({ cards: [{ topic: "chance_creation", team_id: home, player_id: null, headline: headlines[language], observed: homeName, casual: headlines[language], interpretation: headlines[language], metric_keys: [`${home}.total.shots`], evidence_event_ids: [] }] }));
            const result = await handleAgentRequest("analyst", { ...request, preferences: { ...request.preferences, language } }, { run: runner.run });
            assert.ok(result.ok, `${language}: ${JSON.stringify(result)}`);
            assert.equal(result.result[0].headline, headlines[language]);
            assert.ok(runner.calls[0].input.some(entry => String(entry.content).includes(`"language":"${language}"`)), `${language} was omitted from the Foundry payload`);
        }
        const invalid = await handleAgentRequest("analyst", { ...request, preferences: { ...request.preferences, language: "de" } }, { run: fake(() => { throw new Error("must not run"); }).run });
        assert.equal(!invalid.ok && invalid.error, "invalid_request");
    });
    test("returns verified analyst cards stamped with the request cursor", async () => {
        const shots = prefixStats(1800, false).teams[home].shots;
        const runner = fake(() => JSON.stringify({ cards: [{ topic: "chance_creation", team_id: home, player_id: null, headline: both(`${homeName} shots`), observed: both(`${homeName} have ${shots} shots.`), casual: both("They keep shooting."), interpretation: both("This may show attacking intent."), metric_keys: [`${home}.total.shots`], evidence_event_ids: [] }] }));
        const request = body(1800, false);
        const result = await handleAgentRequest("analyst", request, { run: runner.run });
        assert.ok(result.ok);
        assert.equal(result.cursor, request.cursor);
        assert.equal(result.result.length, 1);
        assert.equal(result.result[0].metrics[0].value, String(shots));
        assert.equal(runner.calls[0].agent, "analyst");
    });

    test("rejects payloads that are not exactly the processed prefix, without calling the agent", async () => {
        const runner = fake(() => { throw new Error("must not run"); });
        const base = body(1800, false);
        const cases = [
            { ...base, match: { ...base.match, events: data.events.slice(0, base.cursor + 1) } },
            { ...base, cursor: data.events.length, match: { ...data } },
            { ...body(half, true), secondHalf: false },
            { ...body(half, false, "half-time"), elapsed: half - 1 },
            body(end, true, "paused", { elapsed: end + 1 }),
        ];
        for (const [index, request] of cases.entries()) {
            const result = await handleAgentRequest("analyst", request, { run: runner.run });
            assert.equal(!result.ok && result.error, "invalid_request", `case ${index}`);
        }
        const recap = await handleAgentRequest("recap", body(1800, false), { run: runner.run });
        assert.equal(!recap.ok && recap.error, "invalid_request");
        assert.equal(runner.calls.length, 0);
    });

    test("strips final summaries and upload documentation before anything reaches the agent", async () => {
        const cursor = countReached(data.events, 1800, false);
        const runner = fake(() => JSON.stringify({ cards: [] }));
        const request = { ...body(1800, false), match: { ...raw, events: raw.events.slice(0, cursor) } };
        const result = await handleAgentRequest("analyst", request, { run: runner.run });
        assert.ok(result.ok);
        const sent = JSON.stringify(runner.calls[0].input);
        for (const leaked of ["final_score", "final_statistics", "difficulty_rating", "synthetic_xg"]) assert.ok(!sent.includes(leaked), leaked);
    });

    test("Ask runs PitchPulse tools locally over the prefix and grounds the answer in their output", async () => {
        const player = data.players.find(candidate => candidate.team_id === away)!;
        const actions = prefixStats(3000, true).players[player.player_id].actions;
        let toolOutput: unknown;
        const runner = fake((input, tool) => {
            assert.ok(tool, "ask agents receive the local tool executor");
            toolOutput = tool("get_stats", JSON.stringify({ scope: "player", id: player.player_id, from_seconds: null, to_seconds: 99999 }));
            return JSON.stringify({ answer: both(`${player.name} has ${actions} recorded actions.`), evidence_event_ids: (toolOutput as { event_ids: string[] }).event_ids.slice(-2), caveat: null, out_of_scope: false });
        });
        const result = await handleAgentRequest("ask", body(3000, true, "paused", { question: "Who is busiest?", history: [] }), { run: runner.run });
        assert.ok(result.ok, JSON.stringify(result));
        assert.equal((toolOutput as { stats: { actions: number } }).stats.actions, actions, "tools never count events beyond the prefix");
        assert.equal((toolOutput as { window: string }).window, "00:00–50:00");
        assert.equal(result.result.eventIds.length, 2);
    });

    test("get_stats reports no pass accuracy, not 0%, before any pass", () => {
        const events = data.events.slice(0, countReached(data.events, 0, false));
        const packet = buildMatchPacket(data, events, { elapsed: 0, secondHalf: false, status: "ready" });
        const output = executeTool({ data, events, packet }, "get_stats", JSON.stringify({ scope: "team", id: home, from_seconds: null, to_seconds: null })) as { stats: { passes_attempted: number; pass_accuracy: string | null } };
        assert.equal(output.stats.passes_attempted, 0);
        assert.equal(output.stats.pass_accuracy, null);
    });

    test("Ask rejects context produced beyond the current cursor", async () => {
        const earlier = countReached(data.events, 900, false);
        const request = body(1800, false, "paused", { question: "And now?", history: [{ role: "assistant", text: "Earlier answer", cursor: earlier }] });
        const ok = await handleAgentRequest("ask", request, { run: fake(() => JSON.stringify({ answer: both("Fine."), evidence_event_ids: [], caveat: null, out_of_scope: false })).run });
        assert.ok(ok.ok);
        const ahead = await handleAgentRequest("ask", { ...request, history: [{ role: "assistant", text: "Later answer", cursor: request.cursor + 1 }] }, { run: fake(() => { throw new Error("must not run"); }).run });
        assert.equal(!ahead.ok && ahead.error, "invalid_request");
    });

    test("an unverifiable recap gets one corrective retry", async () => {
        const goals = prefixStats(half, false).teams[home].goals;
        const outputs = [
            JSON.stringify({ story: both(`${homeName} had 9999 shots.`), turning_points: [], team_notes: [], watch_next: null }),
            JSON.stringify({ story: both(`${homeName} reached half-time with ${goals} goals.`), turning_points: [], team_notes: [], watch_next: both("Can they add another?") }),
        ];
        const runner = fake(() => outputs.shift()!);
        const result = await handleAgentRequest("recap", body(half, false, "half-time"), { run: runner.run });
        assert.ok(result.ok, JSON.stringify(result));
        assert.equal(runner.calls.length, 2);
        assert.match(JSON.stringify(runner.calls[1].input.at(-1)), /could not verify/);
        assert.equal(result.result.kind, "half-time");
    });

    test("a card list that loses every card gets one retry carrying the reasons", async () => {
        const shots = prefixStats(1800, false).teams[home].shots;
        const card = (observed: string) => ({ topic: "chance_creation", team_id: home, player_id: null, headline: both(`${homeName} shots`), observed: both(observed), casual: both("They keep shooting."), interpretation: both("This may show attacking intent."), metric_keys: [`${home}.total.shots`], evidence_event_ids: [] });
        const outputs = [JSON.stringify({ cards: [card(`${homeName} have ${shots} shots (${home}.total.shots).`)] }), JSON.stringify({ cards: [card(`${homeName} have ${shots} shots.`)] })];
        const runner = fake(() => outputs.shift()!);
        let reported: string[] = [];
        const result = await handleAgentRequest("analyst", body(1800, false), { run: runner.run, report: reasons => { reported = reasons; } });
        assert.ok(result.ok, JSON.stringify(result));
        assert.equal(result.result.length, 1);
        assert.equal(runner.calls.length, 2);
        assert.match(JSON.stringify(runner.calls[1].input.at(-1)), /observed contains the internal reference ARS\.total\.shots/);
        assert.equal(reported.length, 1);
        assert.match(reported[0], /^first attempt, card 1: observed contains the internal reference ARS\.total\.shots/);
    });

    test("classifies failures without exposing upstream details", async () => {
        const logged: unknown[] = [];
        const upstream = await handleAgentRequest("analyst", body(600, false), { run: fake(() => { throw new Error("401 tenant secret"); }).run, log: error => logged.push(error) });
        assert.ok(!upstream.ok);
        assert.equal(upstream.error, "upstream_error");
        assert.ok(!upstream.message.includes("secret"));
        assert.equal(logged.length, 1);
        const limited = await handleAgentRequest("analyst", body(600, false), { run: fake(() => { throw Object.assign(new Error("slow down"), { status: 429 }); }).run });
        assert.equal(!limited.ok && limited.error, "rate_limited");
        const controller = new AbortController();
        controller.abort();
        const timeout = await handleAgentRequest("analyst", body(600, false), { run: fake(() => { throw new Error("aborted"); }).run, signal: controller.signal });
        assert.equal(!timeout.ok && timeout.error, "timeout");
        const garbage = await handleAgentRequest("analyst", body(600, false), { run: fake(() => "not json").run });
        assert.equal(!garbage.ok && garbage.error, "unverifiable_output");
    });

    test("the commentator only narrates reached, meaningful team events", async () => {
        const request = body(1800, false);
        const reached = request.match.events.filter(event => event.team_id !== null && isMeaningful(event)).slice(-2).map(event => event.event_id);
        const routine = request.match.events.find(event => event.type === "pass" && event.outcome === "complete")!.event_id;
        const future = data.events[request.cursor].event_id;
        for (const narrate of [[routine], [future], []]) {
            const result = await handleAgentRequest("commentator", { ...request, narrate }, { run: fake(() => { throw new Error("must not run"); }).run });
            assert.equal(!result.ok && result.error, "invalid_request");
        }
        const result = await handleAgentRequest("commentator", { ...request, narrate: reached }, { run: fake(() => JSON.stringify({ lines: reached.map(id => ({ event_id: id, text: both("Something happened.") })) })).run });
        assert.ok(result.ok);
        assert.deepEqual(result.result.map(line => line.eventId), reached);
    });
});
