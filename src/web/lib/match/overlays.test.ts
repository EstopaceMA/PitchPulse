import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { activeCues, buildCues, CUE_KINDS, cueClock, OVERLAY_CUE_SCHEMA, preferencesFromQuery } from "./overlays";
import { countReached } from "./playback";
import { aggregate } from "./statistics";
import type { Preferences } from "./types";
import { validateMatch } from "./validation";

const data = validateMatch(JSON.parse(readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8")));
const home = data.match.home_team_id;
const preferences: Preferences = { mode: "analyst", language: "en", team: home, player: "" };
const prefix = (at: number) => data.events.slice(0, countReached(data.events, at, at > data.match.period_seconds));

test("cues are deterministic, use only the reached prefix and start no later than the clock", () => {
    for (const at of [600, 1500, 2700, 4700]) {
        const events = prefix(at), reached = new Set(events.map(event => event.event_id));
        const cues = buildCues(data, events, at, preferences);
        assert.deepEqual(buildCues(data, [...events], at, preferences), cues);
        for (const cue of cues) {
            assert.ok(CUE_KINDS.includes(cue.kind));
            assert.ok(cue.in <= at && cue.in < cue.out, cue.id);
            if (cue.eventId) assert.ok(reached.has(cue.eventId), `${cue.id} cites a future event`);
        }
        assert.equal(new Set(cues.map(cue => cue.id)).size, cues.length, "ids are unique");
    }
});

test("the change clock gives the same cues as the live clock, so renderers can memoize", () => {
    for (const at of [905, 1499, 2701, 3999]) {
        const events = prefix(at);
        assert.deepEqual(buildCues(data, events, cueClock(events, at), preferences), buildCues(data, events, at, preferences), `at ${at}`);
    }
});

test("a goal becomes a lower third with its why-it-matters context, and the scorebug follows the prefix", () => {
    const goal = data.events.find(event => event.type === "shot" && event.outcome === "goal")!;
    const cues = buildCues(data, prefix(goal.match_time_seconds + 5), goal.match_time_seconds + 5, preferences);
    const lower = activeCues(cues, goal.match_time_seconds + 5).find(cue => cue.kind === "lower_third")!;
    assert.equal(lower.eventId, goal.event_id);
    assert.equal(lower.values.headline, "Arsenal open the scoring");
    assert.match(lower.detail ?? "", /The move lasted 43 seconds/);
    assert.deepEqual([cues[0].kind, cues[0].values.homeGoals, cues[0].values.awayGoals], ["scorebug", 1, 0]);
    assert.equal(buildCues(data, prefix(goal.match_time_seconds - 1), goal.match_time_seconds - 1, preferences)[0].values.homeGoals, 0);
    assert.ok(!activeCues(cues, goal.match_time_seconds + 20).some(cue => cue.kind === "lower_third"), "the lower third expires");
});

test("perspectives shape the cue list while ids and values stay language-independent", () => {
    const events = prefix(4000);
    const analyst = buildCues(data, events, 4000, preferences);
    const casual = buildCues(data, events, 4000, { ...preferences, mode: "casual" });
    assert.ok(analyst.some(cue => cue.id.includes('"passing"')));
    assert.ok(!casual.some(cue => cue.id.includes('"passing"')), "casual viewers skip percentage-point comparisons");
    assert.ok(!analyst.some(cue => cue.id.includes('"player"')), "player cards need a favourite or focus player");
    const scorer = data.events.find(event => event.type === "shot" && event.outcome === "goal")!.player_id!;
    assert.ok(buildCues(data, events, 4000, { ...preferences, favorites: [scorer] }).some(cue => cue.kind === "insight" && cue.playerId === scorer));
    const spanish = buildCues(data, events, 4000, { ...preferences, language: "es" });
    assert.deepEqual(spanish.map(cue => [cue.id, cue.in, cue.out, cue.priority]), analyst.map(cue => [cue.id, cue.in, cue.out, cue.priority]));
    assert.notEqual(spanish.find(cue => cue.kind === "stat_pop")!.text, analyst.find(cue => cue.kind === "stat_pop")!.text);
});

test("my metric tracks its owner from the prefix and pings at milestones", () => {
    const events = prefix(data.match.duration_seconds);
    const stats = aggregate(data, events);
    const cues = buildCues(data, events, data.match.duration_seconds, { ...preferences, metric: "shots" });
    const bug = cues.find(cue => cue.kind === "my_metric")!;
    assert.equal(bug.values.value, String(stats.teams[home].shots));
    const pings = cues.filter(cue => cue.id.startsWith("milestone:shots:"));
    assert.equal(pings.length, Math.floor(stats.teams[home].shots / 5));
    const player = data.players.find(entry => entry.team_id === home && stats.players[entry.player_id].passes_attempted > 20)!;
    const focus = buildCues(data, events, data.match.duration_seconds, { ...preferences, mode: "player", player: player.player_id, metric: "pass_accuracy" }).find(cue => cue.kind === "my_metric")!;
    assert.equal(focus.detail, player.name);
    assert.match(String(focus.values.value), /^\d+\.\d%$/);
});

test("stat pops land on 15-minute checkpoints and the half-time pop excludes second-half events", () => {
    const cues = buildCues(data, prefix(data.match.duration_seconds), data.match.duration_seconds, preferences).filter(cue => cue.id.startsWith("stats:"));
    assert.deepEqual(cues.map(cue => cue.in), [900, 1800, 2700, 3600, 4500, 5400]);
    const halfTime = aggregate(data, prefix(data.match.period_seconds));
    assert.equal(cues[2].values.homeShots, halfTime.teams[home].shots);
});

test("URL preferences fall back safely and the cue schema lists every kind", () => {
    const get = (values: Record<string, string>) => (name: string) => values[name] ?? null;
    assert.deepEqual(preferencesFromQuery(data, get({ lang: "xx", mode: "boss", team: "NOPE", metric: "xg", units: "furlongs" })), { mode: "analyst", language: "en", team: home, player: "", metric: null, units: "metric" });
    const chosen = preferencesFromQuery(data, get({ lang: "th", mode: "player", team: data.match.away_team_id, metric: "fastest_shot", units: "imperial" }));
    assert.equal(data.players.find(player => player.player_id === chosen.player)?.team_id, data.match.away_team_id);
    assert.deepEqual([chosen.language, chosen.metric, chosen.units], ["th", "fastest_shot", "imperial"]);
    assert.deepEqual(OVERLAY_CUE_SCHEMA.properties.kind.enum, [...CUE_KINDS]);
});
