import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { ruleBasedProvider } from "./insights";
import {
  countReached,
  initialPlayback,
  pitchPosition,
  playbackReducer,
  type PlaybackAction,
  type PlaybackState,
} from "./playback";
import {
  accuracy,
  aggregate,
  createStatistics,
  emptyMetrics,
  StatisticsAccumulator,
} from "./statistics";
import type { EventType, MatchData, MatchEvent, Metrics, Statistics } from "./types";
import { validateMatch } from "./validation";

type Fixture = Omit<MatchData, "match" | "events"> & {
  match: MatchData["match"] & { final_score: Record<string, number> };
  events: (MatchEvent & { score: Record<string, number> })[];
  final_statistics: Record<string, Omit<Metrics, "actions"> & { pass_accuracy_pct: number }>;
};

// Resolve against this file, not the test runner's working directory.
const fixture = JSON.parse(
  readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8"),
) as Fixture;
const data = validateMatch(fixture);
const half = data.match.period_seconds;
const end = data.match.duration_seconds;
const zero: Metrics = {
  goals: 0,
  shots: 0,
  shots_on_target: 0,
  passes_attempted: 0,
  passes_completed: 0,
  tackles_won: 0,
  pressure_events: 0,
  actions: 0,
};

function act(state: PlaybackState, action: PlaybackAction): PlaybackState {
  return playbackReducer(data, state, action);
}

function eventOf(match: MatchData, type: EventType): MatchEvent {
  const event = match.events.find((entry) => entry.type === type);
  assert.ok(event, `Fixture needs a ${type} event`);
  return event;
}

function assertZero(stats: Statistics): void {
  assert.deepEqual(Object.keys(stats.teams).sort(), data.teams.map((team) => team.team_id).sort());
  assert.deepEqual(Object.keys(stats.players).sort(), data.players.map((player) => player.player_id).sort());
  for (const metrics of [...Object.values(stats.teams), ...Object.values(stats.players)]) {
    assert.deepEqual(metrics, zero);
  }
}

function score(stats: Statistics): Record<string, number> {
  return Object.fromEntries(Object.entries(stats.teams).map(([id, metrics]) => [id, metrics.goals]));
}

function rejectsUpload(name: string, mutate: (upload: Fixture) => void, error: RegExp): void {
  test(name, () => {
    const upload = structuredClone(fixture);
    mutate(upload);
    assert.throws(() => validateMatch(upload), error);
  });
}

describe("match upload validation", () => {
  test("bundled roster names real squad players while the match stays clearly simulated", () => {
    assert.equal(data.players.length, 22);
    assert.equal(data.synthetic, true);
    assert.match(data.disclaimer ?? "", /simulated/i);
    assert.match(data.disclaimer ?? "", /none of these events happened/i);
    for (const team of data.teams) {
      const squad = data.players.filter((player) => player.team_id === team.team_id);
      // Slots keep the fixed 4-3-3 that the event history and illustrative movement were built around.
      assert.deepEqual(squad.map((player) => player.position), ["GK", "RB", "CB", "CB", "LB", "DM", "CM", "CM", "RW", "ST", "LW"]);
      assert.equal(new Set(squad.map((player) => player.shirt_number)).size, squad.length);
    }
    for (const player of data.players) {
      assert.equal(player.fictional, false);
      assert.match(player.nationality ?? "", /^[A-Z]{3}$/);
      assert.doesNotMatch(player.name, /^(Arsenal|Chelsea) \d{2}$/);
    }
  });

  test("player nationality is optional text", () => {
    const upload = structuredClone(fixture);
    for (const player of upload.players) delete player.nationality;
    assert.equal(validateMatch(upload).players[0].nationality, undefined);
  });

  test("uploaded player names are preserved, including the word Demo", () => {
    const upload = structuredClone(fixture);
    upload.players[0].name = "Custom Demo Player";
    assert.equal(validateMatch(upload).players[0].name, "Custom Demo Player");
  });

  test("validates the actual dataset without changing its events or leaking final summaries", () => {
    const original = structuredClone(fixture);
    const validated = validateMatch(fixture);
    assert.equal(validated.match.match_id, fixture.match.match_id);
    assert.equal(validated.events.length, fixture.events.length);
    assert.ok(validated.events.length > 0);
    assert.deepEqual(validated.teams, fixture.teams);
    assert.deepEqual(validated.players, fixture.players);
    assert.deepEqual(validated.events.map((event) => event.event_id), fixture.events.map((event) => event.event_id));
    assert.ok(!("final_statistics" in validated));
    assert.ok(!("final_score" in validated.match));
    assert.ok(validated.events.every((event) => !("score" in event)));
    assert.deepEqual(fixture, original);
  });

  test("normalizes shuffled input by sequence without mutating the upload", () => {
    const upload = structuredClone(fixture);
    upload.events.reverse();
    const before = structuredClone(upload);
    assert.deepEqual(validateMatch(upload).events, data.events);
    assert.deepEqual(upload, before);
  });

  for (const [name, value] of [
    ["null", null], ["undefined", undefined], ["array", []], ["text", "match"], ["number", 1],
  ] as const) {
    test(`rejects a ${name} instead of an upload object`, () => {
      assert.throws(() => validateMatch(value), /JSON object/);
    });
  }

  for (const key of ["match", "teams", "players", "events"] as const) {
    rejectsUpload(`rejects missing ${key}`, (upload) => { Reflect.deleteProperty(upload, key); }, /required|teams|events/i);
  }

  rejectsUpload("rejects a player nationality that is not text", (upload) => {
    Object.assign(upload.players[0], { nationality: 7 });
  }, /nationality must be text/);
  rejectsUpload("rejects duplicate event IDs", (upload) => {
    upload.events[1].event_id = upload.events[0].event_id;
  }, /event_id.*unique/);
  rejectsUpload("rejects duplicate sequences", (upload) => {
    upload.events[1].sequence = upload.events[0].sequence;
  }, /sequence.*unique/);
  rejectsUpload("rejects duplicate team IDs", (upload) => {
    upload.teams[1].team_id = upload.teams[0].team_id;
  }, /Duplicate team_id/);
  rejectsUpload("rejects duplicate player IDs", (upload) => {
    upload.players[1].player_id = upload.players[0].player_id;
  }, /Duplicate player_id/);

  for (const sequence of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3"]) {
    rejectsUpload(`rejects invalid sequence ${String(sequence)}`, (upload) => {
      Object.assign(upload.events[0], { sequence });
    }, /sequence.*integer/);
  }

  for (const key of ["position", "start_position", "end_position"] as const) {
    for (const [name, position] of [
      ["negative x", { x: -0.01, y: 50 }],
      ["x above 100", { x: 100.01, y: 50 }],
      ["negative y", { x: 50, y: -0.01 }],
      ["y above 100", { x: 50, y: 100.01 }],
      ["non-finite x", { x: Number.NaN, y: 50 }],
      ["non-finite y", { x: 50, y: Number.POSITIVE_INFINITY }],
      ["string x", { x: "50", y: 50 }],
      ["missing y", { x: 50 }],
      ["null", null],
    ] as const) {
      rejectsUpload(`rejects ${key} with ${name}`, (upload) => {
        Object.assign(eventOf(upload, "pass"), { [key]: position });
      }, new RegExp(`${key}.*numeric x and y`));
    }
  }

  test("accepts coordinate edges on both axes", () => {
    const upload = structuredClone(fixture);
    Object.assign(eventOf(upload, "pass"), {
      position: { x: 0, y: 100 },
      start_position: { x: 100, y: 0 },
      end_position: { x: 100, y: 100 },
    });
    assert.doesNotThrow(() => validateMatch(upload));
  });

  rejectsUpload("rejects an unknown home team", (upload) => {
    upload.match.home_team_id = "UNKNOWN";
  }, /Home and away team IDs/);
  rejectsUpload("rejects identical home and away teams", (upload) => {
    upload.match.away_team_id = upload.match.home_team_id;
  }, /two different teams/);
  rejectsUpload("rejects a player's unknown team", (upload) => {
    upload.players[0].team_id = "UNKNOWN";
  }, /valid team_id/);
  rejectsUpload("rejects an event's unknown team", (upload) => {
    eventOf(upload, "pass").team_id = "UNKNOWN";
  }, /team_id must reference/);
  rejectsUpload("rejects an action without a team", (upload) => {
    eventOf(upload, "pass").team_id = null;
  }, /action events require a team_id/);
  rejectsUpload("rejects an unknown acting player", (upload) => {
    eventOf(upload, "pass").player_id = "UNKNOWN";
  }, /player_id must reference/);
  rejectsUpload("rejects an acting player from the opposing team", (upload) => {
    const event = eventOf(upload, "pass");
    const opponent = upload.players.find((player) => player.team_id !== event.team_id);
    assert.ok(opponent);
    event.player_id = opponent.player_id;
  }, /acting player must belong/);
  for (const key of ["recipient_player_id", "target_player_id"] as const) {
    rejectsUpload(`rejects an unknown ${key}`, (upload) => {
      eventOf(upload, "pass")[key] = "UNKNOWN";
    }, new RegExp(`${key} references an unknown player`));
  }
  rejectsUpload("rejects a pass recipient from the opposing team", (upload) => {
    const event = eventOf(upload, "pass");
    const opponent = upload.players.find((player) => player.team_id !== event.team_id);
    assert.ok(opponent);
    event.recipient_player_id = opponent.player_id;
  }, /pass recipient must belong/);
  rejectsUpload("rejects an unknown possession-change origin team", (upload) => {
    eventOf(upload, "possession_change").from_team_id = "UNKNOWN";
  }, /from_team_id is unknown/);

  for (const [type, outcome] of [["pass", "goal"], ["shot", "complete"], ["tackle", "saved"]] as const) {
    rejectsUpload(`rejects ${outcome} as a ${type} outcome`, (upload) => {
      eventOf(upload, type).outcome = outcome;
    }, /unsupported.*outcome/);
  }
  for (const outcome of ["", 1, null]) {
    rejectsUpload(`rejects non-text or empty outcome ${String(outcome)}`, (upload) => {
      Object.assign(eventOf(upload, "pass"), { outcome });
    }, /outcome must be text/);
  }
  rejectsUpload("rejects an unsupported event type", (upload) => {
    Object.assign(upload.events[0], { type: "goal" });
  }, /unsupported event type/);

  for (const period of [0, 3, "1"]) {
    rejectsUpload(`rejects invalid period ${JSON.stringify(period)}`, (upload) => {
      Object.assign(upload.events[0], { period });
    }, /period must be 1 or 2/);
  }
  rejectsUpload("rejects period 1 after half-time", (upload) => {
    eventOf(upload, "pass").match_time_seconds = half + 1;
  }, /period conflicts with its timestamp/);
  rejectsUpload("rejects period 2 before half-time", (upload) => {
    eventOf(upload, "pass").period = 2;
  }, /period conflicts with its timestamp/);
  for (const [type, timestamp] of [["half_time", half - 1], ["second_half_start", half + 1], ["full_time", end - 1]] as const) {
    rejectsUpload(`rejects ${type} at the wrong boundary`, (upload) => {
      eventOf(upload, type).match_time_seconds = timestamp;
    }, new RegExp(`${type} must be at`));
  }
  for (const timestamp of [-1, end + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    rejectsUpload(`rejects invalid timestamp ${String(timestamp)}`, (upload) => {
      upload.events[0].match_time_seconds = timestamp;
    }, /match_time_seconds must be within/);
  }
  rejectsUpload("rejects timestamps that decrease in sequence order", (upload) => {
    const pressure = eventOf(upload, "pressure");
    const pass = eventOf(upload, "pass");
    [pressure.sequence, pass.sequence] = [pass.sequence, pressure.sequence];
  }, /non-decreasing timestamps and periods/);
  rejectsUpload("rejects periods that decrease at a shared timestamp", (upload) => {
    const first = eventOf(upload, "half_time");
    const second = eventOf(upload, "second_half_start");
    [first.sequence, second.sequence] = [second.sequence, first.sequence];
  }, /non-decreasing timestamps and periods/);

  test("accepts an empty event list and replays it safely to full-time", () => {
    const upload = structuredClone(fixture);
    upload.events = [];
    const empty = validateMatch(upload);
    assert.deepEqual(empty.events, []);
    assertZero(aggregate(empty, empty.events));
    let state = playbackReducer(empty, initialPlayback(), { type: "toggle" });
    state = playbackReducer(empty, state, { type: "tick", seconds: end });
    assert.equal(state.status, "half-time");
    assert.equal(state.cursor, 0);
    state = playbackReducer(empty, state, { type: "toggle" });
    state = playbackReducer(empty, state, { type: "tick", seconds: end });
    assert.equal(state.status, "full-time");
    assert.equal(state.elapsed, end);
    assert.equal(state.cursor, 0);
  });
});

describe("playback controls and event boundaries", () => {
  test("starts ready with zero elapsed time, zero cursor, and zero statistics", () => {
    assert.deepEqual(initialPlayback(), { elapsed: 0, cursor: 0, status: "ready", speed: 5, secondHalf: false });
    assertZero(aggregate(data, data.events.slice(0, initialPlayback().cursor)));
  });

  test("does not advance while ready, paused, at half-time, or at full-time", () => {
    const playing = act(act(initialPlayback(), { type: "toggle" }), { type: "tick", seconds: 10 });
    const paused = act(playing, { type: "toggle" });
    assert.equal(paused.status, "paused");
    for (const state of [initialPlayback(), paused, act(playing, { type: "seek", elapsed: half }), act(playing, { type: "seek", elapsed: end })]) {
      assert.deepEqual(act(state, { type: "tick", seconds: end * 10 }), state);
    }
    const resumed = act(paused, { type: "toggle" });
    assert.equal(resumed.elapsed, paused.elapsed);
    assert.equal(act(resumed, { type: "tick", seconds: 1 }).elapsed, paused.elapsed + paused.speed);
  });

  for (const speed of [1, 5, 10, 30]) {
    test(`advances by real elapsed time at ${speed}x`, () => {
      const selected = act(initialPlayback(), { type: "speed", speed });
      const state = act(act(selected, { type: "toggle" }), { type: "tick", seconds: 2.5 });
      assert.equal(state.speed, speed);
      assert.equal(state.elapsed, 2.5 * speed);
      assert.equal(state.cursor, data.events.filter((event) => event.period === 1 && event.match_time_seconds <= 2.5 * speed).length);
      assert.equal(state.status, "playing");
    });
  }

  test("ignores unsupported speeds and invalid clock inputs", () => {
    const playing = act(initialPlayback(), { type: "toggle" });
    for (const speed of [0, -1, 2, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(act(playing, { type: "speed", speed }), playing);
    }
    for (const seconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(act(playing, { type: "tick", seconds }), playing);
    }
    for (const elapsed of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.deepEqual(act(playing, { type: "seek", elapsed }), playing);
    }
  });

  test("half-time excludes every period-2 event sharing its timestamp", () => {
    const expected = data.events.filter((event) => event.period === 1);
    const boundaryEvents = data.events.filter((event) => event.period === 2 && event.match_time_seconds === half);
    assert.ok(boundaryEvents.length >= 2, "Fixture must exercise multiple second-half boundary events");
    const playing = act(initialPlayback(), { type: "toggle" });
    for (const state of [act(playing, { type: "tick", seconds: end * 10 }), act(playing, { type: "seek", elapsed: half })]) {
      assert.equal(state.elapsed, half);
      assert.equal(state.status, "half-time");
      assert.equal(state.secondHalf, false);
      assert.equal(state.cursor, expected.length);
      assert.equal(countReached(data.events, half, false), expected.length);
      assert.deepEqual(data.events.slice(0, state.cursor), expected);
      assert.ok(boundaryEvents.every((event) => !data.events.slice(0, state.cursor).includes(event)));
      assert.deepEqual(act(state, { type: "step" }), state);
      const halfTimeScore = fixture.events.find((event) => event.type === "half_time")?.score;
      assert.ok(halfTimeScore);
      assert.deepEqual(score(aggregate(data, expected)), halfTimeScore);
    }
  });

  test("starting the second half releases all its boundary events without advancing the clock", () => {
    const stopped = act(initialPlayback(), { type: "seek", elapsed: half });
    const resumed = act(stopped, { type: "toggle" });
    const released = data.events.filter((event) => event.period === 2 && event.match_time_seconds === half);
    assert.equal(resumed.status, "playing");
    assert.equal(resumed.secondHalf, true);
    assert.equal(resumed.elapsed, half);
    assert.equal(resumed.cursor, stopped.cursor + released.length);
    assert.deepEqual(data.events.slice(stopped.cursor, resumed.cursor), released);
    assert.equal(countReached(data.events, half, true), resumed.cursor);
    assert.deepEqual(act(resumed, { type: "tick", seconds: 0 }), resumed);
    assert.deepEqual(act(act(resumed, { type: "toggle" }), { type: "toggle" }), resumed);
  });

  test("stops exactly at full-time and cannot play or step beyond the final event", () => {
    let state = act(initialPlayback(), { type: "toggle" });
    state = act(state, { type: "tick", seconds: end * 10 });
    state = act(state, { type: "toggle" });
    state = act(state, { type: "tick", seconds: end * 10 });
    assert.equal(state.status, "full-time");
    assert.equal(state.elapsed, end);
    assert.equal(state.cursor, data.events.length);
    assert.equal(data.events[state.cursor - 1].type, "full_time");
    for (const action of [{ type: "toggle" }, { type: "step" }, { type: "tick", seconds: end }] as const) {
      assert.deepEqual(act(state, action), state);
    }
    assert.deepEqual(score(aggregate(data, data.events.slice(0, state.cursor))), fixture.match.final_score);
  });

  test("seeking clamps to the match and resets the second-half flag when going backwards", () => {
    const finished = act(initialPlayback(), { type: "seek", elapsed: end + 100 });
    assert.equal(finished.elapsed, end);
    assert.equal(finished.status, "full-time");
    assert.equal(finished.secondHalf, true);
    const previousHalf = act(finished, { type: "seek", elapsed: half - 1 });
    assert.equal(previousHalf.status, "paused");
    assert.equal(previousHalf.secondHalf, false);
    assert.ok(data.events.slice(0, previousHalf.cursor).every((event) => event.period === 1));
    const beginning = act(previousHalf, { type: "seek", elapsed: -100 });
    assert.equal(beginning.elapsed, 0);
    assert.equal(beginning.cursor, data.events.filter((event) => event.match_time_seconds === 0).length);
  });

  test("restart resets the clock, cursor, period, score, and every metric while retaining speed", () => {
    const accumulator = new StatisticsAccumulator(data);
    let state = act(initialPlayback(), { type: "speed", speed: 30 });
    state = act(state, { type: "seek", elapsed: end });
    assert.deepEqual(score(accumulator.at(state.cursor)), fixture.match.final_score);
    state = act(state, { type: "restart" });
    assert.deepEqual(state, { elapsed: 0, cursor: 0, status: "ready", speed: 30, secondHalf: false });
    assertZero(accumulator.at(state.cursor));
    assertZero(aggregate(data, data.events.slice(0, state.cursor)));
    const first = act(state, { type: "step" });
    assert.equal(first.cursor, 1);
    assert.equal(first.elapsed, data.events[0].match_time_seconds);
  });

  test("steps the two initial timestamp-zero events individually", () => {
    const first = act(initialPlayback(), { type: "step" });
    const second = act(first, { type: "step" });
    assert.equal(first.cursor, 1);
    assert.equal(second.cursor, 2);
    assert.equal(first.elapsed, 0);
    assert.equal(second.elapsed, 0);
    assert.equal(first.status, "paused");
    assert.equal(second.status, "paused");
    assert.equal(data.events[first.cursor - 1].type, "match_start");
    assert.equal(data.events[second.cursor - 1].type, "kickoff");
  });

  for (const period of [1, 2]) {
    test(`steps same-timestamp actions one by one in period ${period}`, () => {
      const index = data.events.findIndex((event, index, events) =>
        event.period === period && event.match_time_seconds > 0 && event.match_time_seconds !== half &&
        events[index + 1]?.period === period && events[index + 1]?.match_time_seconds === event.match_time_seconds,
      );
      assert.ok(index >= 0, `Fixture needs a same-timestamp action pair in period ${period}`);
      const timestamp = data.events[index].match_time_seconds;
      const group = data.events.filter((event) => event.period === period && event.match_time_seconds === timestamp);
      let state = act(initialPlayback(), { type: "seek", elapsed: timestamp - 0.5 });
      const emitted: string[] = [];
      for (const event of group) {
        const before = state.cursor;
        state = act(state, { type: "step" });
        assert.equal(state.cursor, before + 1);
        assert.equal(state.elapsed, timestamp);
        assert.equal(state.status, "paused");
        assert.equal(data.events[state.cursor - 1].event_id, event.event_id);
        emitted.push(data.events[state.cursor - 1].event_id);
      }
      assert.deepEqual(emitted, group.map((event) => event.event_id));
    });
  }

  test("stepping reaches half-time and full-time without crossing either boundary", () => {
    let state = act(initialPlayback(), { type: "seek", elapsed: half - 0.5 });
    state = act(state, { type: "step" });
    assert.equal(state.status, "half-time");
    assert.equal(state.elapsed, half);
    assert.equal(data.events[state.cursor - 1].type, "half_time");
    assert.equal(data.events[state.cursor].period, 2);
    state = act(state, { type: "seek", elapsed: end - 0.5 });
    state = act(state, { type: "step" });
    assert.equal(state.status, "full-time");
    assert.equal(state.elapsed, end);
    assert.equal(state.cursor, data.events.length);
  });
});

describe("event-derived statistics", () => {
  test("matches every actual final_statistics field, including two-decimal pass accuracy", () => {
    const stats = aggregate(data, data.events);
    const published = Object.fromEntries(Object.entries(stats.teams).map(([id, metrics]) => [id, {
      goals: metrics.goals,
      passes_attempted: metrics.passes_attempted,
      passes_completed: metrics.passes_completed,
      pass_accuracy_pct: Number(accuracy(metrics).toFixed(2)),
      shots: metrics.shots,
      shots_on_target: metrics.shots_on_target,
      tackles_won: metrics.tackles_won,
      pressure_events: metrics.pressure_events,
    }]));
    assert.deepEqual(published, fixture.final_statistics);
    assert.deepEqual(score(stats), fixture.match.final_score);
  });

  test("derives each player's metrics only from their own actions", () => {
    const stats = aggregate(data, data.events);
    for (const player of data.players) {
      const events = data.events.filter((event) => event.player_id === player.player_id);
      assert.deepEqual(stats.players[player.player_id], {
        goals: events.filter((event) => event.type === "shot" && event.outcome === "goal").length,
        shots: events.filter((event) => event.type === "shot").length,
        shots_on_target: events.filter((event) => event.type === "shot" && ["goal", "saved", "on_target"].includes(event.outcome ?? "")).length,
        passes_attempted: events.filter((event) => event.type === "pass").length,
        passes_completed: events.filter((event) => event.type === "pass" && event.outcome === "complete").length,
        tackles_won: events.filter((event) => event.type === "tackle" && event.outcome === "won").length,
        pressure_events: events.filter((event) => event.type === "pressure").length,
        actions: events.length,
      }, player.player_id);
    }
  });

  test("counts every goal as exactly one shot and one shot on target", () => {
    const goals = data.events.filter((event) => event.type === "shot" && event.outcome === "goal");
    assert.ok(goals.length > 0);
    for (const goal of goals) {
      assert.ok(goal.team_id && goal.player_id);
      const stats = aggregate(data, [goal]);
      const expected = { ...zero, goals: 1, shots: 1, shots_on_target: 1, actions: 1 };
      assert.deepEqual(stats.teams[goal.team_id], expected);
      assert.deepEqual(stats.players[goal.player_id], expected);
    }
    const total = Object.values(aggregate(data, data.events).teams).reduce((sum, team) => sum + team.shots, 0);
    assert.equal(total, data.events.filter((event) => event.type === "shot").length);
  });

  for (const [outcome, goals, onTarget] of [["goal", 1, 1], ["saved", 0, 1], ["on_target", 0, 1], ["blocked", 0, 0], ["off_target", 0, 0]] as const) {
    test(`classifies a ${outcome} shot without double counting`, () => {
      const shot = { ...eventOf(data, "shot"), outcome };
      assert.ok(shot.team_id);
      assert.deepEqual(aggregate(data, [shot]).teams[shot.team_id], {
        ...zero, goals, shots: 1, shots_on_target: onTarget, actions: 1,
      });
    });
  }

  test("accuracy handles no attempts and rounds only when displaying percentages", () => {
    assert.equal(accuracy(emptyMetrics()), 0);
    const metrics = { ...zero, passes_attempted: 3, passes_completed: 2 };
    assert.equal(accuracy(metrics), 2 / 3 * 100);
    assert.equal(Number(accuracy(metrics).toFixed(2)), 66.67);
    assert.equal(accuracy({ ...metrics, passes_completed: 3 }), 100);
  });

  test("backwards seeks rebuild statistics rather than retaining future goals or counters", () => {
    const accumulator = new StatisticsAccumulator(data);
    let state = initialPlayback();
    const firstGoal = data.events.find((event) => event.type === "shot" && event.outcome === "goal");
    assert.ok(firstGoal);
    for (const elapsed of [end, half + 100, half, half - 1, firstGoal.match_time_seconds - 0.5, 60, 0, end]) {
      state = act(state, { type: "seek", elapsed });
      const emitted = data.events.slice(0, state.cursor);
      const stats = accumulator.at(state.cursor);
      assert.deepEqual(stats, aggregate(data, emitted), `Statistics after seeking to ${elapsed}`);
      assert.deepEqual(score(stats), fixture.events[state.cursor - 1].score);
      assert.deepEqual(accumulator.at(state.cursor), stats, "Repeated reads must not count events twice");
    }
  });

  test("accumulator snapshots stay independent across forward, backwards, and reset reads", () => {
    const accumulator = new StatisticsAccumulator(data);
    const earlyCount = countReached(data.events, 60, false);
    const early = accumulator.at(earlyCount);
    const saved = structuredClone(early);
    accumulator.at(data.events.length);
    assert.deepEqual(early, saved);
    assert.deepEqual(accumulator.at(earlyCount), saved);
    early.teams[data.teams[0].team_id].shots = 999;
    early.players[data.players[0].player_id].passes_attempted = 999;
    assert.deepEqual(accumulator.at(earlyCount), saved);
    assertZero(accumulator.at(0));
    assert.deepEqual(accumulator.at(data.events.length), aggregate(data, data.events));
  });

  test("creates independent zero counters and never uses uploaded score snapshots", () => {
    const initial = createStatistics(data);
    assertZero(initial);
    initial.teams[data.teams[0].team_id].goals = 1;
    assert.deepEqual(initial.teams[data.teams[1].team_id], zero);
    assert.deepEqual(initial.players[data.players[0].player_id], zero);
    assertZero(createStatistics(data));
    const upload = structuredClone(fixture);
    for (const id of Object.keys(upload.final_statistics)) {
      upload.match.final_score[id] = 999;
      upload.final_statistics[id].goals = 999;
      for (const event of upload.events) event.score[id] = 999;
    }
    const validated = validateMatch(upload);
    assertZero(aggregate(validated, []));
    assert.deepEqual(aggregate(validated, validated.events), aggregate(data, data.events));
  });
});

describe("fixed pitch coordinate conversion", () => {
  test("keeps home and neutral coordinates unchanged and rotates both away axes", () => {
    const point = { x: 23, y: 71 };
    const before = { ...point };
    assert.deepEqual(pitchPosition(point, data.match.home_team_id, data.match.home_team_id), { x: 23, y: 71 });
    assert.deepEqual(pitchPosition(point, null, data.match.home_team_id), { x: 23, y: 71 });
    assert.deepEqual(pitchPosition(point, data.match.away_team_id, data.match.home_team_id), { x: 77, y: 29 });
    assert.deepEqual(point, before);
    for (const [input, expected] of [
      [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      [{ x: 100, y: 0 }, { x: 0, y: 100 }],
      [{ x: 0, y: 100 }, { x: 100, y: 0 }],
      [{ x: 100, y: 100 }, { x: 0, y: 0 }],
      [{ x: 50, y: 50 }, { x: 50, y: 50 }],
    ]) {
      assert.deepEqual(pitchPosition(input, data.match.away_team_id, data.match.home_team_id), expected);
    }
  });

  test("uses the same fixed orientation for actual events in both halves", () => {
    for (const period of [1, 2]) {
      for (const team of data.teams) {
        const event = data.events.find((event) => event.period === period && event.team_id === team.team_id && event.position && event.position.x !== 50 && event.position.y !== 50);
        assert.ok(event?.position, `Fixture needs a non-central position for ${team.team_id} in period ${period}`);
        const original = { ...event.position };
        const expected = team.team_id === data.match.home_team_id ? original : { x: 100 - original.x, y: 100 - original.y };
        assert.deepEqual(pitchPosition(event.position, team.team_id, data.match.home_team_id), expected);
        assert.deepEqual(event.position, original);
      }
    }
  });
});

describe("rule-based insight provider", () => {
  test("renders the same reached evidence in every selected language", () => {
    const prefix = data.events.filter(event => event.match_time_seconds <= 1200);
    const languages = ["en", "fil", "es", "pt-BR", "id", "ar", "th"] as const;
    const results = languages.map(language => ruleBasedProvider.generate(data, prefix, 1200, { preferences: { mode: "analyst", language, team: data.match.home_team_id, player: "" } }));
    assert.ok(results[0].length > 0);
    for (const [index, insights] of results.entries()) {
      assert.deepEqual(insights.map(insight => [insight.id, insight.eventIds, insight.metrics.map(metric => metric.value)]), results[0].map(insight => [insight.id, insight.eventIds, insight.metrics.map(metric => metric.value)]));
      if (index) assert.notEqual(insights[0].headline, results[0][0].headline, languages[index]);
    }
  });
  test("is local and deterministic across repeated runs, reordered input, and backwards seeks", () => {
    assert.equal(ruleBasedProvider.kind, "rule-based");
    const elapsed = 1200;
    const prefix = data.events.filter((event) => event.match_time_seconds <= elapsed);
    const before = structuredClone(data);
    const expected = ruleBasedProvider.generate(data, prefix, elapsed);
    assert.ok(expected.length > 0);
    assert.deepEqual(ruleBasedProvider.generate(data, prefix, elapsed), expected);
    assert.deepEqual(ruleBasedProvider.generate(data, [...prefix].reverse(), elapsed), expected);
    ruleBasedProvider.generate(data, data.events, end);
    assert.deepEqual(ruleBasedProvider.generate(data, prefix, elapsed), expected);
    assert.deepEqual(data, before);
  });

  test("uses only supplied emitted events, never future events in the dataset", () => {
    const prefix = data.events.filter((event) => event.match_time_seconds <= 600);
    const expected = ruleBasedProvider.generate(data, prefix, 600);
    assert.ok(expected.length > 0);
    assert.deepEqual(ruleBasedProvider.generate(data, data.events, 600), expected);
    assert.deepEqual(ruleBasedProvider.generate(data, prefix, end), expected);
    assert.deepEqual(ruleBasedProvider.generate({ ...data, events: [] }, prefix, 600), expected);
    assert.deepEqual(ruleBasedProvider.generate(data, [], end), []);
  });

  test("keeps all evidence within emitted events and emits localized, bounded, unique cards", () => {
    const state = act(initialPlayback(), { type: "seek", elapsed: half });
    const prefix = data.events.slice(0, state.cursor);
    const events = new Map(prefix.map((event) => [event.event_id, event]));
    const insights = ruleBasedProvider.generate(data, prefix, half);
    assert.ok(insights.length > 0 && insights.length <= 200);
    assert.equal(new Set(insights.map((insight) => insight.id)).size, insights.length);
    const cooldowns = new Map<string, number>();
    for (const [index, insight] of insights.entries()) {
      assert.ok(insight.from >= 0 && insight.from <= insight.at && insight.at <= half);
      if (index > 0) assert.ok(insight.at >= insights[index - 1].at);
      assert.ok(data.teams.some((team) => team.team_id === insight.teamId));
      if (insight.playerId) assert.ok(data.players.some((player) => player.player_id === insight.playerId && player.team_id === insight.teamId));
      const key = JSON.stringify([insight.rule, insight.teamId, insight.playerId]);
      const previous = cooldowns.get(key);
      if (previous !== undefined) assert.ok(insight.at - previous >= 180);
      cooldowns.set(key, insight.at);
      assert.ok(insight.eventIds.length > 0);
      assert.equal(new Set(insight.eventIds).size, insight.eventIds.length);
      for (const id of insight.eventIds) {
        const event = events.get(id);
        assert.ok(event, `Missing emitted evidence: ${id}`);
        assert.equal(event.period, 1);
        assert.equal(event.team_id, insight.teamId);
        assert.ok(event.match_time_seconds >= insight.from && event.match_time_seconds <= insight.at);
        if (insight.playerId) assert.equal(event.player_id, insight.playerId);
      }
      assert.ok(insight.metrics.length > 0);
      for (const translation of [insight.headline, insight.explanation, insight.casual, insight.interpretation, ...insight.metrics.map((metric) => metric.label)]) {
        assert.ok(translation.trim().length > 0);
      }
      assert.ok(insight.metrics.every((metric) => metric.value.trim().length > 0));
    }
  });

  test("returns no insights for an empty prefix or invalid elapsed time", () => {
    for (const elapsed of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(ruleBasedProvider.generate(data, data.events, elapsed), []);
    }
    assert.deepEqual(ruleBasedProvider.generate(data, [], 0), []);
  });

  test("counts attacking-third recoveries using team-relative x for both teams", () => {
    for (const team of data.teams) {
      const player = data.players.find((player) => player.team_id === team.team_id);
      assert.ok(player);
      const event: MatchEvent = {
        ...eventOf(data, "possession_change"),
        event_id: `recovery-${team.team_id}`,
        sequence: 1,
        match_time_seconds: 100,
        period: 1,
        team_id: team.team_id,
        player_id: player.player_id,
        position: { x: 66.67, y: 20 },
        reason: "interception",
      };
      const recoveries = ruleBasedProvider.generate(data, [event], 100).filter((insight) => insight.rule === "recoveries");
      assert.equal(recoveries.length, 1);
      assert.equal(recoveries[0].teamId, team.team_id);
      assert.deepEqual(recoveries[0].eventIds, [event.event_id]);
      for (const excluded of [
        { ...event, position: { x: 66.66, y: 20 } },
        { ...event, reason: "shot_end" },
        { ...event, type: "tackle" as const, outcome: "won" },
      ]) {
        assert.equal(ruleBasedProvider.generate(data, [excluded], 100).filter((insight) => insight.rule === "recoveries").length, 0);
      }
    }
  });

  test("a goal yields one shot of evidence and one recorded player action", () => {
    const goal = data.events.find((event) => event.type === "shot" && event.outcome === "goal");
    assert.ok(goal);
    const insights = ruleBasedProvider.generate(data, [goal], goal.match_time_seconds);
    const shots = insights.find((insight) => insight.rule === "shots");
    const player = insights.find((insight) => insight.rule === "player");
    assert.ok(shots && player);
    assert.deepEqual(shots.eventIds, [goal.event_id]);
    assert.equal(shots.metrics.find((metric) => metric.label === "Recent shots")?.value, "1");
    assert.equal(player.playerId, goal.player_id);
    assert.deepEqual(player.eventIds, [goal.event_id]);
    assert.equal(player.metrics.find((metric) => metric.label === "Recorded actions")?.value, "1");
    assert.equal(player.metrics.find((metric) => metric.label === "Goals")?.value, "1");
  });
});
// Studio checkpoints must preserve cursor identity, not just the displayed clock.
import { annotationAnchor, restorePlayback, validCheckpoint } from "./playback";
import { createLibraryMatch, DEMO_ID, groupTimelineEvents, refreshDemo, validateAnnotations, validateLibraryMatch } from "./library";

describe("studio persistence and annotation anchors", () => {
  test("restores stepped equal-time events exactly and never resumes automatically", () => {
    const first = playbackReducer(data, initialPlayback(), { type: "step" });
    assert.equal(first.cursor, 1);
    assert.equal(first.elapsed, 0);
    assert.deepEqual(restorePlayback(data, first), first);
    assert.equal(restorePlayback(data, { ...first, status: "playing" }).status, "paused");
    assert.equal(restorePlayback(data, { ...first, status: "playing" }).cursor, 1);
  });
  test("keeps opposite sides of the half-time boundary distinct", () => {
    const halfState = playbackReducer(data, initialPlayback(), { type: "seek", elapsed: half });
    const secondHalf = playbackReducer(data, halfState, { type: "toggle" });
    assert.equal(restorePlayback(data, halfState).status, "half-time");
    assert.equal(restorePlayback(data, secondHalf).secondHalf, true);
    assert.equal(restorePlayback(data, secondHalf).status, "paused");
    assert.ok(secondHalf.cursor > halfState.cursor);
    assert.equal(restorePlayback(data, secondHalf).cursor, secondHalf.cursor);
  });
  test("invalid stored checkpoints reset safely", () => {
    for (const value of [null, {}, { ...initialPlayback(), elapsed: NaN }, { ...initialPlayback(), cursor: 999999 }, { ...initialPlayback(), elapsed: 100 }, { ...initialPlayback(), secondHalf: true }, { ...initialPlayback(), status: "full-time" }]) {
      assert.equal(validCheckpoint(data, value), false);
      assert.deepEqual(restorePlayback(data, value), initialPlayback());
    }
  });
  test("full-time restores completed and restart still clears the prefix", () => {
    const completed = playbackReducer(data, initialPlayback(), { type: "seek", elapsed: end });
    assert.equal(restorePlayback(data, completed).status, "full-time");
    assert.deepEqual(playbackReducer(data, completed, { type: "restart" }), initialPlayback());
  });
  test("inspection annotation anchors end at the selected event without changing live state", () => {
    const live = playbackReducer(data, initialPlayback(), { type: "seek", elapsed: end });
    const before = { ...live };
    const anchor = annotationAnchor(data, live, data.events[0].event_id);
    assert.equal(anchor.cursor, 1);
    assert.equal(anchor.elapsed, 0);
    assert.deepEqual(live, before);
    const restored = playbackReducer(data, live, { type: "restore", checkpoint: anchor });
    assert.equal(aggregate(data, data.events.slice(0, restored.cursor)).teams[data.match.home_team_id].goals, 0);
    assert.equal(aggregate(data, data.events.slice(0, restored.cursor)).teams[data.match.away_team_id].goals, 0);
  });
  test("annotation references must be within their saved prefix", () => {
    const note = { id: "note", kind: "note", text: "Look at the shape", anchor: annotationAnchor(data, initialPlayback()), createdAt: 1 };
    assert.equal(validateAnnotations(data, [note]).length, 1);
    assert.equal(validateAnnotations(data, [{ ...note, eventId: data.events[0].event_id }]).length, 0);
    assert.equal(validateAnnotations(data, [note, note]).length, 1);
    assert.equal(validateAnnotations(data, [{ ...note, text: "x".repeat(4001) }]).length, 0);
  });
  test("library validation strips final summaries and resets only invalid review data", () => {
    const match = createLibraryMatch("independent-id", data, "test.json", "upload", 1);
    const stored = validateLibraryMatch({ ...match, data: fixture }, { checkpoint: { elapsed: -1 }, annotations: [] });
    assert.equal(stored.id, "independent-id");
    assert.equal("final_score" in stored.data.match, false);
    assert.deepEqual(stored.checkpoint, initialPlayback());
    assert.throws(() => validateLibraryMatch({ ...match, data: {} }));
  });
  test("a newer bundled demo replaces stored data but keeps saved progress and notes", () => {
    const checkpoint = playbackReducer(data, initialPlayback(), { type: "seek", elapsed: 1200 });
    const note = { id: "note", kind: "note" as const, text: "Rice from distance", anchor: annotationAnchor(data, checkpoint), createdAt: 1 };
    const stored = { ...createLibraryMatch(DEMO_ID, data, "Arsenal vs Chelsea", "demo", 1), checkpoint, annotations: [note] };
    assert.equal(refreshDemo(stored, structuredClone(data)), null);
    const placeholders = { ...data, players: data.players.map((player) => ({ ...player, name: player.player_id, fictional: true })) };
    const refreshed = refreshDemo({ ...stored, data: placeholders }, data);
    assert.ok(refreshed);
    assert.deepEqual(refreshed.data, data);
    assert.deepEqual(refreshed.checkpoint, checkpoint);
    assert.deepEqual(refreshed.annotations, [note]);
    assert.equal(refreshed.createdAt, stored.createdAt);
  });
  test("50,000 events produce a bounded set of timeline groups with no lost events", () => {
    const large = Array.from({ length: 50000 }, (_, i) => ({ ...data.events[0], event_id: `large-${i}`, sequence: i, match_time_seconds: i / 49999 * end }));
    for (const buckets of [40, 80, 160, 320]) {
      const groups = groupTimelineEvents(large, end, buckets);
      assert.ok(groups.length <= buckets);
      assert.equal(groups.reduce((n, group) => n + group.events.length, 0), 50000);
    }
    assert.equal(groupTimelineEvents([], end, 40).length, 0);
  });
});

import { addQuality, averagePassDistance, difficultyBand, emptyQuality, LONG_PASS_METRES } from "./statistics";
import { activeHighlights, buildHighlights, HIGHLIGHT_SECONDS, HIGHLIGHT_THRESHOLDS } from "./thresholds";

describe("pass quality, synthetic speeds and threshold highlights", () => {
  const teamEvents = (teamId: string) => data.events.filter((event) => event.team_id === teamId);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  test("team quality totals match values computed directly from the bundled demo", () => {
    const stats = aggregate(data, data.events);
    for (const team of data.teams) {
      const passes = teamEvents(team.team_id).filter((event) => event.type === "pass");
      const shots = teamEvents(team.team_id).filter((event) => event.type === "shot");
      const quality = stats.quality.teams[team.team_id];
      const long = passes.filter((event) => event.distance_m! >= LONG_PASS_METRES);
      const difficult = passes.filter((event) => event.difficulty_rating! >= 0.3);
      assert.equal(quality.pass_distance_count, passes.length);
      assert.equal(quality.pass_distance_total, sum(passes.map((event) => event.distance_m!)));
      assert.equal(quality.long_passes_attempted, long.length);
      assert.equal(quality.long_passes_completed, long.filter((event) => event.outcome === "complete").length);
      assert.equal(quality.difficult_passes_attempted, difficult.length);
      assert.equal(quality.difficult_passes_completed, difficult.filter((event) => event.outcome === "complete").length);
      assert.equal(quality.ball_speed_max, Math.max(...passes.map((event) => event.ball_speed_kmh!)));
      assert.equal(quality.shot_speed_count, shots.length);
      assert.equal(quality.shot_speed_max, Math.max(...shots.map((event) => event.shot_speed_kmh!)));
      assert.ok(averagePassDistance(quality) > 0);
    }
    assert.ok(stats.quality.teams[data.match.home_team_id].long_passes_attempted > 0, "the demo needs long passes");
  });

  test("missing quality fields count nowhere and other event types never add quality", () => {
    const quality = emptyQuality();
    addQuality(quality, { ...eventOf(data, "pass"), distance_m: undefined, difficulty_rating: undefined, ball_speed_kmh: undefined });
    addQuality(quality, { ...eventOf(data, "shot"), shot_speed_kmh: undefined });
    addQuality(quality, { ...eventOf(data, "tackle"), distance_m: 40, ball_speed_kmh: 90 });
    assert.deepEqual(quality, emptyQuality());
    assert.equal(averagePassDistance(quality), 0);
  });

  test("difficulty bands have inclusive lower edges", () => {
    assert.deepEqual([0, 0.1999, 0.2, 0.2999, 0.3, 0.3999, 0.4, 0.8].map(difficultyBand), ["routine", "routine", "moderate", "moderate", "hard", "hard", "elite", "elite"]);
  });

  test("forward folding keeps quality equal to a fresh aggregate after seeks", () => {
    const accumulator = new StatisticsAccumulator(data);
    for (const count of [300, 900, 120, data.events.length]) assert.deepEqual(accumulator.at(count).quality, aggregate(data, data.events.slice(0, count)).quality, `cursor ${count}`);
  });

  test("highlights are prefix-only, one per event, in priority order", () => {
    const all = buildHighlights(data.events);
    assert.ok(all.length > 20 && all.length < 200, `${all.length} highlights should stay occasional`);
    assert.equal(new Set(all.map((highlight) => highlight.eventId)).size, all.length);
    for (const count of [200, 600, 1000]) {
      const prefix = data.events.slice(0, count);
      const ids = new Set(prefix.map((event) => event.event_id));
      assert.deepEqual(buildHighlights(prefix), all.filter((highlight) => ids.has(highlight.eventId)), `prefix ${count}`);
    }
    const fastShot = data.events.find((event) => event.type === "shot" && event.shot_speed_kmh! >= HIGHLIGHT_THRESHOLDS.shotKmh)!;
    assert.equal(all.find((highlight) => highlight.eventId === fastShot.event_id)?.kind, "shot_speed");
    const both = { ...eventOf(data, "pass"), outcome: "complete", distance_m: 25, difficulty_rating: 0.45, ball_speed_kmh: 70 };
    assert.deepEqual(buildHighlights([both]).map((highlight) => [highlight.kind, highlight.value]), [["difficult_pass", 0.45]]);
    assert.deepEqual(buildHighlights([{ ...both, outcome: "intercepted" }]).map((highlight) => highlight.kind), ["long_pass"]);
  });

  test("a highlight shows for a fixed window of match time and never before its event", () => {
    const pass = { ...eventOf(data, "pass"), match_time_seconds: 100, distance_m: 24 };
    const highlights = buildHighlights([pass]);
    assert.equal(activeHighlights(highlights, 99.9).length, 0);
    assert.equal(activeHighlights(highlights, 100).length, 1);
    assert.equal(activeHighlights(highlights, 100 + HIGHLIGHT_SECONDS - 0.1).length, 1);
    assert.equal(activeHighlights(highlights, 100 + HIGHLIGHT_SECONDS).length, 0);
  });

  test("player speed and distance tags need supplied tracking fields; distance fires once per new step", () => {
    assert.ok(buildHighlights(data.events).every((highlight) => highlight.kind !== "player_speed" && highlight.kind !== "player_distance"));
    const tackle = eventOf(data, "tackle");
    const tracked = [900, 1100, 1500, 2050].map((distance, index) => ({ ...tackle, event_id: `T-${index}`, match_time_seconds: index * 30, player_distance_m: distance }));
    assert.deepEqual(buildHighlights(tracked).map((highlight) => [highlight.eventId, highlight.kind, highlight.value]), [["T-1", "player_distance", 1000], ["T-3", "player_distance", 2000]]);
    assert.deepEqual(buildHighlights([{ ...tackle, player_speed_kmh: 27.4 }]).map((highlight) => highlight.kind), ["player_speed"]);
  });

  test("uploads accept optional non-negative tracking fields", () => {
    const event = { ...data.events[1], player_speed_kmh: 26.1, player_distance_m: 4200 };
    assert.equal(validateMatch({ ...data, events: [data.events[0], event] }).events[1].player_speed_kmh, 26.1);
    assert.throws(() => validateMatch({ ...data, events: [data.events[0], { ...event, player_distance_m: -1 }] }), /player_distance_m/);
  });
});

describe("why-it-matters rules", () => {
  const home = data.match.home_team_id, away = data.match.away_team_id;
  const homePlayer = data.players.find((player) => player.team_id === home)!.player_id;
  const awayPlayer = data.players.find((player) => player.team_id === away)!.player_id;
  const at = (time: number, fields: Partial<MatchEvent>, index: number): MatchEvent => ({ event_id: `W-${index}`, sequence: index + 1, match_time_seconds: time, period: 1, type: "pass", team_id: home, player_id: homePlayer, possession_id: 1, ...fields });
  const run = (events: Partial<MatchEvent & { time: number }>[]) => {
    const match = validateMatch({ ...data, events: events.map(({ time = 0, ...fields }, index) => at(time, fields, index)) });
    return ruleBasedProvider.generate(match, match.events, match.events.at(-1)!.match_time_seconds);
  };
  const goal = (time: number, team: string, possession: number): Partial<MatchEvent & { time: number }> => ({ time, type: "shot", outcome: "goal", team_id: team, player_id: team === home ? homePlayer : awayPlayer, possession_id: possession });

  test("goal context walks the scoring possession back to how the ball was won", () => {
    const prefix = data.events.filter((event) => event.match_time_seconds <= 1500);
    const cards = ruleBasedProvider.generate(data, prefix, 1500).filter((insight) => insight.rule === "goal_context");
    assert.equal(cards.length, 1);
    const scored = prefix.find((event) => event.type === "shot" && event.outcome === "goal")!;
    const move = prefix.filter((event) => event.possession_id === scored.possession_id && event.team_id === scored.team_id);
    assert.deepEqual(cards[0].eventIds, move.map((event) => event.event_id));
    assert.equal(cards[0].headline, "Arsenal open the scoring");
    assert.match(cards[0].explanation, /making it Arsenal 1–0 Chelsea\. The move lasted 43 seconds, included 3 completed passes and began when .+ won the ball with a tackle in the middle third\./);
    assert.deepEqual(cards[0].metrics.slice(0, 3).map((metric) => metric.value), ["1–0", "43 s", "3"]);
  });

  test("goal headlines follow the game state and every goal gets a card despite cooldowns", () => {
    const cards = run([goal(10, home, 1), goal(20, away, 2), goal(30, away, 3), goal(40, away, 4), goal(50, home, 5), goal(60, home, 6)]).filter((insight) => insight.rule === "goal_context");
    assert.deepEqual(cards.map((card) => card.headline), ["Arsenal open the scoring", "Chelsea draw level", "Chelsea go ahead", "Chelsea extend their lead", "Arsenal pull one back", "Arsenal draw level"]);
    assert.match(cards[0].explanation, /without a completed pass and began after a change of possession/);
  });

  test("pressing regains need the same team's pressure within five seconds", () => {
    const recovery = (time: number, possession: number) => ({ time, type: "possession_change" as const, reason: "interception", from_team_id: away, possession_id: possession });
    const pressed = run([{ time: 10, type: "pressure", intensity: "high" }, recovery(14, 2), { time: 40, type: "pressure", intensity: "high" }, recovery(45, 3)]);
    const card = pressed.find((insight) => insight.rule === "pressing");
    assert.ok(card);
    assert.deepEqual(card.eventIds, ["W-0", "W-1", "W-2", "W-3"]);
    assert.ok(!run([{ time: 10, type: "pressure" }, recovery(16, 2), { time: 40, type: "pressure" }, recovery(45, 3)]).some((insight) => insight.rule === "pressing"), "a regain six seconds later does not count");
    assert.ok(!run([{ time: 10, type: "pressure", team_id: away, player_id: awayPlayer }, recovery(12, 2), { time: 40, type: "pressure", team_id: away, player_id: awayPlayer }, recovery(42, 3)]).some((insight) => insight.rule === "pressing"), "the opponent's pressure does not count");
  });

  test("a shot drought is reported once, when it ends, from kick-off or the previous shot", () => {
    const shot = (time: number) => ({ time, type: "shot" as const, outcome: "saved" });
    const droughts = run([shot(800), shot(900), shot(1700)]).filter((insight) => insight.rule === "drought");
    assert.deepEqual(droughts.map((card) => card.metrics.map((metric) => metric.value)), [["13", "00:00"], ["13", "15:00"]]);
    assert.match(droughts[0].explanation, /first since kick-off, after 13 minutes/);
    assert.ok(!run([shot(700), shot(1400)]).some((insight) => insight.rule === "drought"));
  });

  test("a territory shift needs a clear swing in both teams' attacking-third actions", () => {
    const high = (time: number, team: string) => ({ time, start_position: { x: 80, y: 50 }, outcome: "complete", team_id: team, player_id: team === home ? homePlayer : awayPlayer });
    const swing = [...[10, 40, 70, 100, 130, 160].map((time) => high(time, away)), high(200, home), ...[320, 350, 380, 410, 440, 470].map((time) => high(time, home)), high(480, away)];
    const card = run(swing).find((insight) => insight.rule === "momentum" && insight.teamId === home);
    assert.ok(card);
    // First window with six actions on both sides: (02:50, 07:50] against (00:00, 02:50].
    assert.deepEqual(card.metrics.slice(0, 2).map((metric) => metric.value), ["7/7", "0/6"]);
    assert.ok(!run(swing.slice(0, 7)).some((insight) => insight.rule === "momentum"));
  });

  test("new rules cite only reached events and stay bounded on the full demo", () => {
    const all = ruleBasedProvider.generate(data, data.events, end);
    const reached = new Set(data.events.map((event) => event.event_id));
    for (const rule of ["goal_context", "pressing", "drought", "momentum"] as const) {
      for (const card of all.filter((insight) => insight.rule === rule)) for (const id of card.eventIds) assert.ok(reached.has(id), `${rule} ${id}`);
    }
    assert.ok(all.length <= 200);
  });
});
