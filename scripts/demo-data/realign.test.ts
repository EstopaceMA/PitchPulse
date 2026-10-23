import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { aggregate } from "@/lib/match/statistics";
import type { MatchEvent, Player } from "@/lib/match/types";
import { validateMatch } from "@/lib/match/validation";
import { realignDefenderShots } from "./realign";

const ROLES = ["GK", "RB", "CB", "CB", "LB", "DM", "CM", "CM", "RW", "ST", "LW"];
const players: Player[] = ["A", "B"].flatMap(team => ROLES.map((position, index) => ({ player_id: `${team}${String(index + 1).padStart(2, "0")}`, team_id: team, name: `${team} ${index + 1}`, position })));
type Event = MatchEvent & { related_event_id?: string };
const event = (sequence: number, fields: Partial<Event>): Event => ({ event_id: `E${sequence}`, sequence, match_time_seconds: sequence, period: 1, type: "pass", team_id: "A", player_id: null, possession_id: 1, ...fields });

const bundle = JSON.parse(readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8"));
const data = validateMatch(bundle);
const positionOf = new Map(data.players.map(player => [player.player_id, player.position]));

describe("defender shot realignment", () => {
    const source = [
        event(1, { player_id: "A10", recipient_player_id: "A04", outcome: "complete" }),
        event(2, { type: "pressure", team_id: "B", player_id: "B06", target_player_id: "A04" }),
        event(3, { type: "shot", player_id: "A04", outcome: "saved", position: { x: 95, y: 50 } }),
        event(4, { type: "tackle", team_id: "B", player_id: "B04", target_player_id: "A09", outcome: "won", position: { x: 80, y: 31 } }),
        event(5, { type: "possession_change", team_id: "B", player_id: "B04", possession_id: 2, from_team_id: "A", reason: "tackle", related_event_id: "E4" }),
        event(6, { type: "shot", team_id: "B", player_id: "B04", possession_id: 2, outcome: "off_target", position: { x: 80, y: 31 } }),
        event(7, { type: "shot", team_id: "B", player_id: "B10", possession_id: 2, outcome: "goal", position: { x: 92, y: 50 } }),
    ];
    const { events, changes } = realignDefenderShots(players, source);
    const by = (id: string) => events.find(entry => entry.event_id === id)!;

    test("a fed shot moves with its pass and the pressure on it, never to the passer", () => {
        // The striker made the feeding pass, so the nearest other forward to y 50 takes the shot.
        assert.equal(by("E3").player_id, "A09");
        assert.equal(by("E1").recipient_player_id, "A09");
        assert.equal(by("E1").player_id, "A10");
        assert.equal(by("E2").target_player_id, "A09");
    });

    test("a shot after a ball win moves with the possession change and its tackle", () => {
        // Outside the penalty area, the midfielder nearest y 31 is the first central midfielder.
        for (const id of ["E4", "E5", "E6"]) assert.equal(by(id).player_id, "B07", id);
        assert.equal(by("E4").target_player_id, "A09");
    });

    test("reports each change, leaves other shots alone and changes nothing on a second run", () => {
        assert.deepEqual(changes, [{ shot: "E3", from: "A04", to: "A09", edited: ["E1", "E2", "E3"] }, { shot: "E6", from: "B04", to: "B07", edited: ["E4", "E5", "E6"] }]);
        assert.equal(by("E7").player_id, "B10");
        assert.equal(source[2].player_id, "A04", "the source events are not modified");
        assert.deepEqual(realignDefenderShots(players, events).changes, []);
    });
});

describe("bundled demo after realignment", () => {
    test("no defender or goalkeeper takes a shot", () => {
        for (const shot of data.events.filter(entry => entry.type === "shot")) assert.ok(!["GK", "CB", "LB", "RB"].includes(positionOf.get(shot.player_id!) ?? ""), shot.event_id);
    });

    test("the build is already applied, and team totals still match the published summary", () => {
        assert.deepEqual(realignDefenderShots(data.players, data.events).changes, []);
        const totals = aggregate(data, data.events).teams;
        for (const [teamId, summary] of Object.entries(bundle.final_statistics as Record<string, Record<string, number>>)) {
            for (const key of ["goals", "shots", "shots_on_target", "passes_attempted", "passes_completed", "tackles_won", "pressure_events"] as const) assert.equal(totals[teamId][key], summary[key], `${teamId} ${key}`);
        }
    });

    test("the goals keep their scorers, times and score", () => {
        const goals = data.events.filter(entry => entry.type === "shot" && entry.outcome === "goal").map(entry => [entry.match_time_seconds, entry.player_id, positionOf.get(entry.player_id!)]);
        assert.deepEqual(goals, [[1380, "ARS07", "CM"], [3240, "CHE10", "ST"], [4680, "ARS11", "LW"]]);
    });
});
