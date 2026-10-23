import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Player } from "@/lib/match/types";
import { rewriteBundle, type Bundle } from "./bundle";
import { applyLineup, type Lineups, type Squad } from "./roster";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const bundle = readJson("../../public/arsenal-vs-chelsea-match.json") as Bundle;
const squads = (readJson("../../data/squads.json") as { clubs: Record<string, Squad> }).clubs;
const lineups = readJson("../../data/lineups.json") as Lineups;
const placeholders: Player[] = bundle.players.map(({ player_id, team_id, position }) => ({ player_id, team_id, name: player_id, position }));
const withPick = (slot: string, title: string): Lineups => {
    const teamId = slot.slice(0, 3);
    return { ...lineups, [teamId]: { ...lineups[teamId], [slot]: title } };
};

describe("lineups from the squad snapshot", () => {
    test("rebuild the bundled roster exactly", () => {
        assert.deepEqual(applyLineup(placeholders, squads, lineups), bundle.players);
    });

    test("every bundled player is a current squad member with the snapshot's number and nationality", () => {
        for (const player of bundle.players) {
            const entry = squads[player.team_id].players.find(candidate => candidate.name === player.name);
            assert.ok(entry, player.name);
            assert.equal(player.shirt_number, entry.number);
            assert.equal(player.nationality, entry.nationality);
        }
    });

    test("reject picks outside the squad, picks that do not fit the slot and duplicate numbers", () => {
        assert.throws(() => applyLineup(placeholders, squads, withPick("ARS10", "Thierry Henry")), /not in the Arsenal F\.C\. first-team squad/);
        assert.throws(() => applyLineup(placeholders, squads, withPick("ARS10", "David Raya")), /does not fit the ST slot/);
        assert.throws(() => applyLineup(placeholders, squads, withPick("ARS03", "Gabriel Magalhães")), /shirt number 6 is used twice/);
        const withoutKeeper = Object.fromEntries(Object.entries(lineups.ARS).filter(([slot]) => slot !== "ARS01"));
        assert.throws(() => applyLineup(placeholders, squads, { ...lineups, ARS: withoutKeeper }), /no pick for ARS01/);
        assert.throws(() => applyLineup(placeholders, squads, withPick("ARS12", "Ben White (footballer)")), /not a player slot/);
    });
});

describe("bundle rewriting", () => {
    const raw = `{
  "schema_version": "1.0",
  "disclaimer": "Old \\u2013 text",
  "players": [
    {
      "player_id": "A1",
      "name": "Old"
    }
  ],
  "documentation": {
    "coordinates": "0\\u2013100"
  },
  "events": [
    {
      "event_id": "E1",
      "player_id": "A1",
      "position": {
        "x": 95.0,
        "y": 2
      }
    }
  ]
}`;
    const before = JSON.parse(raw) as Bundle;

    test("edits only what changed and keeps the file's number and escape style", () => {
        const after = { ...before, disclaimer: "New", players: [{ ...before.players[0], name: "Martin Ødegaard" }], documentation: { ...before.documentation, roster: "Source" }, events: [{ ...before.events[0], player_id: "A2" }] } as Bundle;
        const text = rewriteBundle(raw, before, after);
        assert.deepEqual(JSON.parse(text), after);
        assert.match(text, /"disclaimer": "New",/);
        assert.match(text, /"name": "Martin \\u00d8degaard"/);
        assert.match(text, /"coordinates": "0\\u2013100",\n {4}"roster": "Source"\n {2}\}/);
        assert.match(text, /"player_id": "A2",\n {6}"position": \{\n {8}"x": 95\.0,/);
    });

    test("refuses to rewrite anything else", () => {
        assert.throws(() => rewriteBundle(raw, before, { ...before, schema_version: "2.0" }), /schema_version/);
        assert.throws(() => rewriteBundle(raw, before, { ...before, events: [{ ...before.events[0], position: { x: 1, y: 2 } }] } as Bundle), /only existing text fields/);
        assert.throws(() => rewriteBundle(raw, before, { ...before, events: [] }), /added or removed/);
    });
});
