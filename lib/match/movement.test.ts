import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { buildMovementTimeline, sampleMovement, type MotionFrame } from "./movement";
import { pitchPosition } from "./playback";
import type { MatchData, MatchEvent, Position } from "./types";

// Read the actual public fixture, independently of the runner's working directory.
const data = JSON.parse(readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8")) as MatchData;
const kickoffPrefix = data.events.slice(0, 2);
const home = data.match.home_team_id;
const away = data.match.away_team_id;

function event(overrides: Partial<MatchEvent> = {}): MatchEvent {
    return {
        event_id: "test-1", sequence: 1, match_time_seconds: 0, period: 1,
        type: "kickoff", team_id: home, player_id: "ARS10", possession_id: 1,
        position: { x: 50, y: 50 }, ...overrides,
    };
}

function player(frame: MotionFrame, id: string): MotionFrame["players"][number] {
    const result = frame.players.find((entry) => entry.playerId === id);
    assert.ok(result, `Missing player ${id}`);
    return result;
}

function activeIds(frame: MotionFrame): string[] {
    return frame.players.filter((entry) => entry.active).map((entry) => entry.playerId).sort();
}

function positions(frame: MotionFrame): Position[] {
    return frame.players.map((entry) => entry.position);
}

function near(actual: Position | null, expected: Position, tolerance = 1e-9): void {
    assert.ok(actual);
    assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) <= tolerance,
        `${JSON.stringify(actual)} is not near ${JSON.stringify(expected)}`);
}

function boundedFrame(frame: MotionFrame): void {
    for (const position of [...positions(frame), ...(frame.ball ? [frame.ball] : [])]) {
        assert.ok(Number.isFinite(position.x) && position.x >= 0 && position.x <= 100);
        assert.ok(Number.isFinite(position.y) && position.y >= 0 && position.y <= 100);
    }
}

function freezeDeep(value: unknown): void {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) freezeDeep(child);
        Object.freeze(value);
    }
}

describe("illustrative movement formations", () => {
    test("shows all 22 unique original IDs at time zero without altering names or roster order", () => {
        const before = structuredClone(data.players);
        const timeline = buildMovementTimeline(data, []);
        const frame = sampleMovement(timeline, 0);
        assert.equal(frame.players.length, 22);
        assert.equal(new Set(frame.players.map((entry) => entry.playerId)).size, 22);
        assert.deepEqual(frame.players.map((entry) => entry.playerId), before.map((entry) => entry.player_id));
        assert.deepEqual(data.players, before);
        assert.deepEqual(frame.players.map((entry) => data.players.find((p) => p.player_id === entry.playerId)?.name), before.map((p) => p.name));
        assert.deepEqual(activeIds(frame), []);
        assert.equal(frame.sequence, 0);
        assert.ok(!("eventId" in frame));
        assert.equal(frame.ball, null);
        assert.deepEqual(positions(sampleMovement(timeline, 2)), positions(frame));
        assert.equal(new Set(positions(frame).map((p) => `${p.x},${p.y}`)).size, 22);
    });

    test("uses role-based lanes, separates repeated CB/CM roles, and rotates BOTH away axes", () => {
        const frame = sampleMovement(buildMovementTimeline(data, []), 0);
        const homePlayers = data.players.filter((p) => p.team_id === home);
        const awayPlayers = data.players.filter((p) => p.team_id === away);
        homePlayers.forEach((p, index) => {
            const first = player(frame, p.player_id).position;
            near(player(frame, awayPlayers[index].player_id).position, { x: 100 - first.x, y: 100 - first.y });
        });
        assert.ok(player(frame, "ARS01").position.x < player(frame, "ARS03").position.x);
        assert.ok(player(frame, "ARS03").position.x < player(frame, "ARS06").position.x);
        assert.ok(player(frame, "ARS06").position.x < player(frame, "ARS07").position.x);
        assert.ok(player(frame, "ARS07").position.x < player(frame, "ARS10").position.x);
        assert.ok(player(frame, "ARS02").position.y < player(frame, "ARS05").position.y);
        assert.notEqual(player(frame, "ARS03").position.y, player(frame, "ARS04").position.y);
        assert.notEqual(player(frame, "ARS07").position.y, player(frame, "ARS08").position.y);
    });

    test("uses each player's role rather than assuming roster array order", () => {
        const reordered = { ...data, players: [...data.players].reverse() };
        const frame = sampleMovement(buildMovementTimeline(reordered, []), 0);
        assert.equal(player(frame, "ARS01").position.x, 7);
        assert.equal(player(frame, "CHE01").position.x, 93);
        assert.equal(player(frame, "ARS02").position.y, 18);
        assert.equal(player(frame, "ARS05").position.y, 82);
    });

    for (const size of [0, 1, 7, 13, 37]) {
        test(`handles a ${size}-player roster with absent/unknown roles deterministically`, () => {
            const custom = {
                ...data,
                players: Array.from({ length: size }, (_, i) => ({
                    player_id: `custom-${i}`, team_id: i % 2 ? away : home, name: `Unchanged ${i}`,
                    position: i % 3 ? undefined : "unknown role",
                })),
            };
            const first = sampleMovement(buildMovementTimeline(custom, kickoffPrefix), 2);
            assert.equal(first.players.length, size);
            assert.deepEqual(first, sampleMovement(buildMovementTimeline(custom, kickoffPrefix), 2));
            boundedFrame(first);
        });
    }

    test("moves every player between kickoff at 0 and 2, including both goalkeepers", () => {
        const timeline = buildMovementTimeline(data, kickoffPrefix);
        const initial = sampleMovement(timeline, 0);
        assert.deepEqual(positions(initial), positions(sampleMovement(buildMovementTimeline(data, []), 0)));
        const moved = sampleMovement(timeline, 2);
        for (const entry of initial.players) {
            assert.notDeepEqual(player(moved, entry.playerId).position, entry.position, entry.playerId);
        }
        const later = sampleMovement(timeline, 20);
        const laterStill = sampleMovement(timeline, 22);
        for (const entry of later.players) {
            assert.notDeepEqual(player(laterStill, entry.playerId).position, entry.position, entry.playerId);
        }
    });
});

describe("pure, prefix-only movement sampling", () => {
    test("identical times, backward seeks, rebuilds, and arbitrary call order give identical frames", () => {
        const timeline = buildMovementTimeline(data, data.events.slice(0, 100));
        const times = [0, 0.01, 1, 2, 4, 5.5, 7, 13, 70, 90, 300, 470];
        const expected = times.map((time) => sampleMovement(timeline, time));
        for (let i = times.length - 1; i >= 0; i--) {
            assert.deepEqual(sampleMovement(timeline, times[i]), expected[i]);
            assert.deepEqual(sampleMovement(timeline, times[i]), sampleMovement(timeline, times[i]));
            assert.deepEqual(sampleMovement(buildMovementTimeline(data, data.events.slice(0, 100)), times[i]), expected[i]);
        }
    });

    test("never reads data.events, final summaries, or an unsupplied future event", () => {
        const guarded: MatchData = {
            match: data.match, players: data.players, teams: data.teams,
            get events(): MatchEvent[] { throw new Error("Future event access"); },
        };
        Object.defineProperty(guarded, "final_statistics", { get() { throw new Error("Summary access"); } });
        const timeline = buildMovementTimeline(guarded, kickoffPrefix);
        assert.deepEqual(sampleMovement(timeline, 133), sampleMovement(buildMovementTimeline(data, kickoffPrefix), 133));
        assert.equal(sampleMovement(timeline, 133).eventId, kickoffPrefix[1].event_id);
        const future = event({ sequence: 3, match_time_seconds: 50 });
        Object.defineProperty(future, "position", { get() { throw new Error("Unsupplied event access"); } });
        const custom = { ...data, events: [...kickoffPrefix, future] };
        assert.deepEqual(sampleMovement(buildMovementTimeline(custom, custom.events.slice(0, 2)), 60), sampleMovement(timeline, 60));
    });

    test("adding later supplied events cannot change earlier samples", () => {
        const small = buildMovementTimeline(data, kickoffPrefix);
        const complete = buildMovementTimeline(data, data.events);
        for (const time of [0, 0.1, 1, 2, 3.999]) {
            assert.deepEqual(sampleMovement(complete, time), sampleMovement(small, time));
        }
    });

    test("does not mutate frozen input and does not retain source or output position references", () => {
        const frozen = structuredClone(data);
        const before = structuredClone(frozen);
        freezeDeep(frozen);
        const timeline = buildMovementTimeline(frozen, frozen.events.slice(0, 20));
        const frame = sampleMovement(timeline, 7);
        const expected = structuredClone(frame);
        frame.players[0].position.x = -999;
        frame.players[0].playerId = "changed";
        frame.players[0].active = !frame.players[0].active;
        if (frame.ball) frame.ball.y = -999;
        frame.players.pop();
        assert.deepEqual(sampleMovement(timeline, 7), expected);
        assert.deepEqual(frozen, before);
        const mutable = structuredClone(data);
        const snapshot = buildMovementTimeline(mutable, mutable.events.slice(0, 2));
        const sample = sampleMovement(snapshot, 2);
        mutable.players[0].player_id = "changed";
        mutable.players[0].position = "ST";
        mutable.events[1].position!.x = 0;
        mutable.events[1].sequence = 999;
        mutable.match.duration_seconds = 1;
        assert.deepEqual(sampleMovement(snapshot, 2), sample);
    });

    test("preserves equal-timestamp sequence order and pinned historical prefix selection", () => {
        const index = data.events.findIndex((e) => e.type === "tackle");
        const tackle = data.events[index];
        const recovery = data.events[index + 1];
        assert.equal(tackle.match_time_seconds, recovery.match_time_seconds);
        const first = sampleMovement(buildMovementTimeline(data, data.events.slice(0, index + 1)), tackle.match_time_seconds);
        const second = sampleMovement(buildMovementTimeline(data, data.events.slice(0, index + 2)), recovery.match_time_seconds);
        assert.equal(first.sequence, tackle.sequence);
        assert.equal(first.eventId, tackle.event_id);
        assert.equal(second.sequence, recovery.sequence);
        assert.equal(second.eventId, recovery.event_id);
        assert.deepEqual(activeIds(first), [tackle.player_id!, tackle.target_player_id!].sort());
        assert.deepEqual(activeIds(second), [recovery.player_id]);
        assert.deepEqual(positions(first), positions(second));
    });

    test("clears historical activity instead of accumulating highlighted players", () => {
        const timeline = buildMovementTimeline(data, data.events.slice(0, 5));
        assert.deepEqual(activeIds(sampleMovement(timeline, 0)), ["ARS10"]);
        assert.deepEqual(activeIds(sampleMovement(timeline, 4)), ["ARS10", "CHE08"]);
        // The intercepted intended recipient ARS11 is NOT highlighted as a winner.
        assert.deepEqual(activeIds(sampleMovement(timeline, 5)), ["ARS10"]);
        assert.deepEqual(activeIds(sampleMovement(timeline, 6)), ["CHE08"]);
    });

    test("rejects unordered supplied events rather than silently changing sequence semantics", () => {
        assert.throws(() => buildMovementTimeline(data, [event({ match_time_seconds: 2 }), event({ sequence: 2, match_time_seconds: 1 })]), RangeError);
        assert.throws(() => buildMovementTimeline(data, [event({ sequence: 2 }), event({ sequence: 1 })]), RangeError);
        assert.throws(() => buildMovementTimeline(data, [event({ match_time_seconds: Number.NaN })]), RangeError);
    });
});

describe("continuous trajectories and boundary controls", () => {
    test("interrupted movement starts at the previous trajectory's sampled position", () => {
        const prefix = [event()];
        const interrupt = event({ event_id: "interrupt", sequence: 2, match_time_seconds: 1, type: "shot", player_id: "ARS02", position: { x: 95, y: 90 } });
        const before = buildMovementTimeline(data, prefix);
        const after = buildMovementTimeline(data, [...prefix, interrupt]);
        const at = sampleMovement(after, 1);
        assert.deepEqual(positions(at), positions(sampleMovement(before, 1)));
        for (const time of [1 - 1e-6, 1 + 1e-6]) {
            const nearby = sampleMovement(after, time);
            at.players.forEach((p) => near(player(nearby, p.playerId).position, p.position, 0.0001));
        }
        assert.notDeepEqual(positions(sampleMovement(after, 3)), positions(sampleMovement(before, 3)));
    });

    test("all actual event interruptions, including shared timestamps, preserve player positions", () => {
        const timeline = buildMovementTimeline(data, data.events);
        for (const e of data.events) {
            if (e.match_time_seconds === 0) continue;
            const before = sampleMovement(timeline, e.match_time_seconds - 1e-7);
            const at = sampleMovement(timeline, e.match_time_seconds);
            before.players.forEach((p) => near(player(at, p.playerId).position, p.position, 0.0001));
        }
    });

    test("keeps every coordinate finite and bounded throughout dense full-match sampling", () => {
        assert.equal(data.events.length, 1111);
        const timeline = buildMovementTimeline(data, data.events);
        for (let time = 0; time <= data.match.duration_seconds; time += 0.25) {
            boundedFrame(sampleMovement(timeline, time));
        }
    });

    test("stops at half-time, resumes without teleporting, and stops at full-time", () => {
        const halfIndex = data.events.findIndex((e) => e.type === "half_time");
        const half = data.match.period_seconds;
        const halfTimeline = buildMovementTimeline(data, data.events.slice(0, halfIndex + 1));
        const paused = sampleMovement(halfTimeline, half);
        assert.deepEqual(activeIds(paused), []);
        assert.deepEqual(positions(sampleMovement(halfTimeline, half + 20)), positions(paused));
        assert.deepEqual(sampleMovement(halfTimeline, half + 20).ball, paused.ball);
        assert.deepEqual(sampleMovement(halfTimeline, half), paused);
        const resumed = buildMovementTimeline(data, data.events.slice(0, halfIndex + 3));
        assert.deepEqual(positions(sampleMovement(resumed, half)), positions(paused));
        assert.notDeepEqual(positions(sampleMovement(resumed, half + 2)), positions(paused));
        const complete = buildMovementTimeline(data, data.events);
        const final = sampleMovement(complete, data.match.duration_seconds);
        assert.deepEqual(activeIds(final), []);
        assert.deepEqual(sampleMovement(complete, data.match.duration_seconds + 20), final);
    });

    test("period-one extrapolation cannot drift past half-time even without a supplied stop event", () => {
        const timeline = buildMovementTimeline(data, kickoffPrefix);
        const atHalf = sampleMovement(timeline, data.match.period_seconds);
        assert.deepEqual(positions(sampleMovement(timeline, data.match.period_seconds + 10)), positions(atHalf));
        assert.deepEqual(sampleMovement(timeline, data.match.period_seconds + 10).ball, atHalf.ball);
    });

    test("freeze controls interrupt an unfinished ball flight at its current position", () => {
        const pass = event({ type: "pass", position: undefined, start_position: { x: 20, y: 40 }, end_position: { x: 80, y: 60 } });
        const stop = event({ sequence: 2, match_time_seconds: 1, type: "half_time", team_id: null, player_id: null, position: undefined });
        const timeline = buildMovementTimeline(data, [pass, stop]);
        near(sampleMovement(timeline, 1).ball, { x: 50, y: 50 });
        near(sampleMovement(timeline, 20).ball, { x: 50, y: 50 });
    });

    test("handles negative and nonfinite elapsed without contaminating coordinates", () => {
        const timeline = buildMovementTimeline(data, kickoffPrefix);
        const zero = sampleMovement(timeline, 0);
        for (const time of [-10, Number.NaN, Infinity, -Infinity]) assert.deepEqual(sampleMovement(timeline, time), zero);
    });
});

describe("recorded ball anchors and action context", () => {
    const pass = event({
        event_id: "pass", sequence: 3, match_time_seconds: 5, type: "pass", position: undefined,
        start_position: { x: 20, y: 30 }, end_position: { x: 80, y: 70 },
        recipient_player_id: "ARS11", outcome: "complete",
    });

    test("a processed pass travels start to end in two illustrative seconds, never beforehand", () => {
        const timeline = buildMovementTimeline(data, [...kickoffPrefix, pass]);
        near(sampleMovement(timeline, 4.99).ball, { x: 50, y: 50 });
        near(sampleMovement(timeline, 5).ball, pass.start_position!);
        near(sampleMovement(timeline, 6).ball, { x: 50, y: 50 });
        near(sampleMovement(timeline, 7).ball, pass.end_position!);
        near(sampleMovement(timeline, 20).ball, pass.end_position!);
        assert.deepEqual(activeIds(sampleMovement(timeline, 5)), ["ARS10", "ARS11"]);
        near(player(sampleMovement(timeline, 11), "ARS11").position, pass.end_position!, 0.4);
        near(sampleMovement(buildMovementTimeline(data, kickoffPrefix), 20).ball, { x: 50, y: 50 });
    });

    test("does not use recorded speeds to determine illustrative flight timing", () => {
        const slow = buildMovementTimeline(data, [pass]);
        const fast = buildMovementTimeline(data, [{ ...pass, ball_speed_kmh: 999, distance_m: 999 }]);
        for (const time of [5, 5.5, 6, 7]) assert.deepEqual(sampleMovement(slow, time), sampleMovement(fast, time));
    });

    test("rotates both pass endpoints for away actions without flipping at half-time", () => {
        for (const period of [1, 2] as const) {
            const time = period === 1 ? 5 : data.match.period_seconds;
            const awayPass = { ...pass, team_id: away, player_id: "CHE10", recipient_player_id: "CHE11", period, match_time_seconds: time };
            const timeline = buildMovementTimeline(data, [awayPass]);
            near(sampleMovement(timeline, time).ball, { x: 80, y: 70 });
            near(sampleMovement(timeline, time + 2).ball, { x: 20, y: 30 });
        }
    });

    test("an intercepted intended recipient is neither active nor pulled to the pass endpoint", () => {
        const intercepted = { ...pass, outcome: "intercepted", end_position: { x: 95, y: 5 } };
        const timeline = buildMovementTimeline(data, [intercepted]);
        const frame = sampleMovement(timeline, 11);
        assert.deepEqual(activeIds(frame), ["ARS10"]);
        assert.ok(Math.hypot(player(frame, "ARS11").position.x - 95, player(frame, "ARS11").position.y - 5) > 10);
        near(frame.ball, intercepted.end_position);
    });

    test("shots without end coordinates stay at their recorded location, including every goal", () => {
        for (const shot of data.events.filter((e) => e.type === "shot")) {
            assert.equal(shot.end_position, undefined);
            const timeline = buildMovementTimeline(data, [shot]);
            const expected = pitchPosition(shot.position!, shot.team_id, home);
            near(sampleMovement(timeline, shot.match_time_seconds).ball, expected);
            near(sampleMovement(timeline, shot.match_time_seconds + 10).ball, expected);
        }
    });

    test("a shot only gets a flight if an actual endpoint is supplied", () => {
        const shot = event({ type: "shot", position: { x: 82, y: 40 }, end_position: { x: 97, y: 45 }, outcome: "saved" });
        const timeline = buildMovementTimeline(data, [shot]);
        near(sampleMovement(timeline, 0).ball, shot.position!);
        near(sampleMovement(timeline, 1).ball, { x: 89.5, y: 42.5 });
        near(sampleMovement(timeline, 2).ball, shot.end_position!);
    });

    for (const type of ["pressure", "tackle"] as const) {
        test(`${type} brings only the actor and explicitly named opponent near the same world anchor`, () => {
            const defensive = event({ type, team_id: away, player_id: "CHE08", target_player_id: "ARS10", position: { x: 70, y: 20 }, outcome: type === "tackle" ? "won" : undefined });
            const timeline = buildMovementTimeline(data, [defensive]);
            const frame = sampleMovement(timeline, 6);
            assert.deepEqual(activeIds(frame), ["ARS10", "CHE08"]);
            near(frame.ball, { x: 30, y: 80 });
            near(player(frame, "CHE08").position, { x: 31.5, y: 80 }, 0.4);
            near(player(frame, "ARS10").position, { x: 28.5, y: 80 }, 0.4);
            const unnamed = sampleMovement(buildMovementTimeline(data, [{ ...defensive, target_player_id: undefined }]), 6);
            assert.deepEqual(activeIds(unnamed), ["CHE08"]);
        });
    }

    test("missing defensive coordinates do not manufacture a location or halt an existing pass", () => {
        const pressure = event({ event_id: "pressure", sequence: 4, match_time_seconds: 5.5, type: "pressure", team_id: away, player_id: "CHE08", target_player_id: "ARS10", position: undefined });
        const timeline = buildMovementTimeline(data, [pass, pressure]);
        near(sampleMovement(timeline, 6).ball, { x: 50, y: 50 });
        near(sampleMovement(timeline, 7).ball, pass.end_position!);
    });

    test("pressure and unsuccessful tackles do not infer a possession change from a named target", () => {
        for (const type of ["pressure", "tackle"] as const) {
            const action = event({ sequence: 2, match_time_seconds: 1, type, target_player_id: "CHE08", outcome: "lost" });
            const withTarget = sampleMovement(buildMovementTimeline(data, [event(), action]), 8);
            const withoutTarget = sampleMovement(buildMovementTimeline(data, [event(), { ...action, target_player_id: undefined }]), 8);
            // Naming a target affects only that player's contextual trajectory, not
            // the possession-based attacking/defending shape of uninvolved players.
            assert.deepEqual(player(withTarget, "ARS02"), player(withoutTarget, "ARS02"));
            assert.deepEqual(player(withTarget, "CHE02"), player(withoutTarget, "CHE02"));
        }
    });

    test("invalid or missing optional coordinates never leak NaN or fabricate a ball origin", () => {
        const invalid = [undefined, null, {}, { x: 50 }, { x: "20", y: 30 }, { x: NaN, y: 50 }, { x: 40, y: Infinity }, { x: -1, y: 50 }, { x: 101, y: 40 }];
        for (const position of invalid) {
            const action = { ...pass, position, start_position: position, end_position: position } as MatchEvent;
            const timeline = buildMovementTimeline(data, [action]);
            for (const time of [0, 5, 5.5, 6, 100]) {
                const frame = sampleMovement(timeline, time);
                boundedFrame(frame);
                assert.equal(frame.ball, null);
            }
            const withHistory = buildMovementTimeline(data, [...kickoffPrefix, action]);
            near(sampleMovement(withHistory, 6).ball, { x: 50, y: 50 });
        }
        const noOrigin = { ...pass, start_position: undefined };
        assert.equal(sampleMovement(buildMovementTimeline(data, [noOrigin]), 6).ball, null);
        const noEnd = { ...pass, end_position: undefined };
        near(sampleMovement(buildMovementTimeline(data, [noEnd]), 6).ball, pass.start_position!);
    });
});

test("supports a 50,000-event prefix with packed per-event paths and direct random-access samples", () => {
    const count = 50_000;
    const large = { ...data, match: { ...data.match, duration_seconds: count, period_seconds: count / 2 } };
    const events = Array.from({ length: count }, (_, i) => event({
        event_id: `large-${i}`, sequence: i + 1, match_time_seconds: i,
        period: i < count / 2 ? 1 : 2, type: "pressure", position: { x: i % 101, y: (i * 7) % 101 },
        target_player_id: "CHE08",
    }));
    const timeline = buildMovementTimeline(large, events);
    for (const time of [count - 0.5, 1, count / 2 + 0.5, 100.5, 0]) {
        const frame = sampleMovement(timeline, time);
        assert.equal(frame.sequence, Math.min(count, Math.floor(time) + 1));
        assert.equal(frame.players.length, 22);
        boundedFrame(frame);
    }
});