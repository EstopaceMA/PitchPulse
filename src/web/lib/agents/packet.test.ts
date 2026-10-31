import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { countReached } from "../match/playback";
import { accuracy, aggregate, averageBallSpeed, averagePassDistance, averageShotSpeed } from "../match/statistics";
import type { MatchData, MatchEvent } from "../match/types";
import { validateMatch } from "../match/validation";
import { buildMatchPacket, type PacketContext } from "./packet";

// Resolve against this file, not the test runner's working directory.
const data = validateMatch(JSON.parse(readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8")));
const half = data.match.period_seconds, end = data.match.duration_seconds;
const home = data.match.home_team_id, away = data.match.away_team_id;
const context = (elapsed: number, secondHalf: boolean, status: PacketContext["status"] = "paused"): PacketContext => ({ elapsed, secondHalf, status });
const prefix = (elapsed: number, secondHalf: boolean) => data.events.slice(0, countReached(data.events, elapsed, secondHalf));
const homePlayer = data.players.find(player => player.team_id === home)!;
const awayPlayer = data.players.find(player => player.team_id === away)!;

function synthetic(events: Partial<MatchEvent>[]): MatchData {
    return validateMatch({
        ...data,
        events: events.map((fields, index) => ({ event_id: `P-${index + 1}`, sequence: index + 1, match_time_seconds: 60 + index, period: 1, type: "shot", team_id: home, player_id: homePlayer.player_id, possession_id: index + 1, ...fields })),
    });
}

describe("agent match packet", () => {
    test("uses only the processed prefix for facts, catalog evidence and the event order", () => {
        const events = prefix(1200, false);
        const packet = buildMatchPacket(data, events, context(1200, false));
        const future = data.events.slice(events.length).map(event => event.event_id);
        const serialized = JSON.stringify(packet.facts);
        for (const id of future) assert.ok(!serialized.includes(`"${id}"`), `future event ${id} leaked into facts`);
        for (const metric of packet.catalog.values()) for (const id of metric.evidence) assert.ok(packet.order.has(id));
        assert.equal(packet.order.size, events.length);
        assert.equal(packet.cursor, events.length);
    });

    test("team and player totals equal the statistics reducer, including formatted pass accuracy", () => {
        const events = prefix(end, true);
        const packet = buildMatchPacket(data, events, context(end, true, "full-time"));
        const stats = aggregate(data, events);
        for (const [id, metrics] of [...Object.entries(stats.teams), ...Object.entries(stats.players).filter(([, value]) => value.actions > 0)]) {
            for (const key of ["goals", "shots", "shots_on_target", "passes_attempted", "passes_completed", "tackles_won", "pressure_events"] as const) {
                assert.equal(packet.catalog.get(`${id}.total.${key}`)?.value, String(metrics[key]), `${id}.total.${key}`);
                assert.equal(packet.catalog.get(`${id}.total.${key}`)?.evidence.length, metrics[key]);
            }
            assert.equal(packet.catalog.get(`${id}.total.pass_accuracy`)?.value, metrics.passes_attempted ? `${accuracy(metrics).toFixed(1)}%` : undefined);
        }
        assert.deepEqual(packet.facts.score, Object.fromEntries(data.teams.map(team => [team.team_id, stats.teams[team.team_id].goals])));
    });

    test("15-minute blocks partition the totals and half-time boundary events close block three", () => {
        const events = prefix(end, true);
        const packet = buildMatchPacket(data, events, context(end, true, "full-time"));
        for (const team of [home, away]) {
            for (const key of ["shots", "passes_attempted", "pressure_events", "recoveries", "turnovers"]) {
                let sum = 0;
                for (let block = 1; packet.catalog.has(`${team}.b${block}.${key}`); block++) sum += Number(packet.catalog.get(`${team}.b${block}.${key}`)!.value);
                assert.equal(String(sum), packet.catalog.get(`${team}.total.${key}`)!.value, `${team} ${key}`);
            }
        }
        assert.ok(!packet.catalog.has(`${home}.b7.shots`), "full-time events must not open a block after 90:00");
        const boundary = synthetic([{ match_time_seconds: half, period: 1 }, { match_time_seconds: half, period: 2, event_id: "P-2", sequence: 2 }]);
        const split = buildMatchPacket(boundary, boundary.events, context(half, true));
        assert.equal(split.catalog.get(`${home}.b3.shots`)!.value, "1");
        assert.equal(split.catalog.get(`${home}.b4.shots`)!.value, "1");
    });

    test("thirds are team-relative while flanks follow the drawn pitch for both teams", () => {
        const match = synthetic([
            { position: { x: 80, y: 10 } },
            { team_id: away, player_id: awayPlayer.player_id, position: { x: 80, y: 10 } },
        ]);
        const packet = buildMatchPacket(match, match.events, context(200, false));
        assert.equal(packet.catalog.get(`${home}.zone.shots.attacking`)!.value, "1");
        assert.equal(packet.catalog.get(`${home}.zone.shots.top`)!.value, "1");
        assert.equal(packet.catalog.get(`${away}.zone.shots.attacking`)!.value, "1");
        // Away coordinates rotate both axes when drawn, so team-relative y 10 is the bottom flank on screen.
        assert.equal(packet.catalog.get(`${away}.zone.shots.bottom`)!.value, "1");
        assert.equal(packet.catalog.get(`${away}.zone.shots.top`)!.value, "0");
    });

    test("turnovers belong to the team that lost the ball, with its third rotated and shot-end changes excluded", () => {
        const match = synthetic([
            { type: "possession_change", team_id: away, player_id: awayPlayer.player_id, from_team_id: home, reason: "interception", position: { x: 70, y: 20 } },
            { type: "possession_change", team_id: away, player_id: awayPlayer.player_id, from_team_id: home, reason: "shot_end", position: { x: 10, y: 50 } },
        ]);
        const packet = buildMatchPacket(match, match.events, context(200, false));
        assert.equal(packet.catalog.get(`${away}.total.recoveries`)!.value, "1");
        assert.equal(packet.catalog.get(`${away}.zone.recoveries.attacking`)!.value, "1");
        assert.equal(packet.catalog.get(`${home}.total.turnovers`)!.value, "1");
        assert.equal(packet.catalog.get(`${home}.zone.turnovers.defensive`)!.value, "1");
        assert.equal(packet.catalog.get(`${home}.zone.turnovers.bottom`)!.value, "1");
        assert.deepEqual(packet.catalog.get(`${home}.total.turnovers`)!.evidence, ["P-1"]);
    });

    test("pass-quality counts and synthetic speed averages equal the quality reducer and cite their events", () => {
        const events = prefix(end, true);
        const packet = buildMatchPacket(data, events, context(end, true, "full-time"));
        const stats = aggregate(data, events);
        for (const [id, quality] of [...Object.entries(stats.quality.teams), ...Object.entries(stats.quality.players).filter(([, value]) => value.pass_distance_count > 0)]) {
            for (const key of ["long_passes_attempted", "long_passes_completed", "difficult_passes_attempted", "difficult_passes_completed"] as const) {
                assert.equal(packet.catalog.get(`${id}.total.${key}`)?.value, String(quality[key]), `${id}.total.${key}`);
                assert.equal(packet.catalog.get(`${id}.total.${key}`)?.evidence.length, quality[key]);
            }
            assert.equal(packet.catalog.get(`${id}.total.avg_pass_distance`)?.value, `${averagePassDistance(quality).toFixed(1)} m`);
            assert.equal(packet.catalog.get(`${id}.total.avg_ball_speed`)?.value, `${averageBallSpeed(quality).toFixed(1)} km/h`);
        }
        for (const [id, quality] of Object.entries(stats.quality.teams)) {
            assert.equal(packet.catalog.get(`${id}.total.avg_shot_speed`)?.value, `${averageShotSpeed(quality).toFixed(1)} km/h`);
            const fastest = packet.catalog.get(`${id}.total.max_shot_speed`)!;
            assert.equal(fastest.value, `${quality.shot_speed_max.toFixed(1)} km/h`);
            assert.equal(fastest.evidence.length, 1);
            assert.equal(events.find(event => event.event_id === fastest.evidence[0])?.shot_speed_kmh, quality.shot_speed_max);
        }
        const unsampled = synthetic([{}]);
        const bare = buildMatchPacket(unsampled, unsampled.events, context(200, false));
        assert.equal(bare.catalog.get(`${home}.total.shots`)!.value, "1");
        assert.ok(!bare.catalog.has(`${home}.total.avg_shot_speed`), "no average without a sample");
    });

    test("exposes no raw synthetic fields, possession share, durations, xG or final summaries", () => {
        const events = prefix(end, true);
        const serialized = JSON.stringify(buildMatchPacket(data, events, context(end, true, "full-time")).facts);
        for (const banned of ["synthetic_xg", "difficulty_rating", "distance_m", "speed_kmh", "possession_share", "possession_pct", "final_score", "final_statistics"]) assert.ok(!serialized.includes(banned), banned);
    });

    test("is deterministic for the same prefix", () => {
        const events = prefix(3000, true);
        assert.equal(JSON.stringify(buildMatchPacket(data, events, context(3000, true)).facts), JSON.stringify(buildMatchPacket(data, [...events], context(3000, true)).facts));
    });
});
