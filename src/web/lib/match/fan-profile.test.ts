import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { statisticsExport, statisticsRows } from "./export";
import { DEFAULT_PROFILE, preferencesFor, rememberChoice, validateProfile } from "./fan-profile";
import { aggregate, passBands } from "./statistics";
import { validateMatch } from "./validation";

const data = validateMatch(JSON.parse(readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8")));
const home = data.match.home_team_id, away = data.match.away_team_id;
const awayPlayer = data.players.find(player => player.team_id === away && player.position !== "GK")!;
const homePlayer = data.players.find(player => player.team_id === home && player.position === "ST")!;

test("an unreadable profile falls back to defaults and keeps only valid, bounded fields", () => {
    for (const raw of [null, "x", 3, []]) assert.deepEqual(validateProfile(raw), DEFAULT_PROFILE);
    const profile = validateProfile({ mode: "casual", clubs: ["Chelsea", 4, "", "Chelsea"], players: Array.from({ length: 20 }, (_, i) => `P${i}`), metric: "xg", units: "imperial", extra: true });
    assert.deepEqual(profile, { mode: "casual", clubs: ["Chelsea"], players: Array.from({ length: 8 }, (_, i) => `P${i}`), metric: null, units: "imperial" });
});

test("a profile applies by name: favourite club, favourite players present in this match, metric and units", () => {
    const prefs = preferencesFor(data, { mode: "player", clubs: ["Real Madrid", "Chelsea"], players: ["Someone Else", awayPlayer.name, homePlayer.name], metric: "shots", units: "imperial" }, "es");
    assert.deepEqual(prefs, { mode: "player", language: "es", team: away, player: awayPlayer.player_id, favorites: [awayPlayer.player_id, homePlayer.player_id], metric: "shots", units: "imperial" });
    const fresh = preferencesFor(data, DEFAULT_PROFILE, "en");
    assert.equal(fresh.team, home);
    assert.equal(data.players.find(player => player.player_id === fresh.player)?.team_id, home);
    assert.deepEqual(fresh.favorites, []);
});

test("explicit choices are remembered most-recent first, and favourites from other matches survive edits", () => {
    let profile = rememberChoice(DEFAULT_PROFILE, data, "team", away);
    profile = rememberChoice(profile, data, "team", home);
    assert.deepEqual(profile.clubs, [data.teams.find(team => team.team_id === home)!.name, data.teams.find(team => team.team_id === away)!.name]);
    profile = { ...profile, players: ["Elsewhere Star"] };
    profile = rememberChoice(profile, data, "player", awayPlayer.player_id);
    assert.deepEqual(profile.players, [awayPlayer.name, "Elsewhere Star"]);
    profile = rememberChoice(profile, data, "favorites", [homePlayer.player_id]);
    assert.deepEqual(profile.players, [homePlayer.name, "Elsewhere Star"]);
    assert.deepEqual(rememberChoice(profile, data, "language", "th"), profile, "language keeps its own cookie");
    assert.equal(rememberChoice(profile, data, "metric", "fastest_shot").metric, "fastest_shot");
});

test("pass bands partition rated passes and exports neutralize spreadsheet formulas", () => {
    const bands = passBands(data.events, event => event.team_id === home);
    const rated = data.events.filter(event => event.type === "pass" && event.team_id === home);
    assert.equal(Object.values(bands).reduce((sum, band) => sum + band.attempted, 0), rated.length);
    assert.equal(Object.values(bands).reduce((sum, band) => sum + band.completed, 0), rated.filter(event => event.outcome === "complete").length);
    const stats = aggregate(data, data.events);
    const rows = statisticsRows(data, stats);
    assert.equal(rows.filter(row => row.scope === "team").length, 2);
    assert.ok(rows.every(row => row.scope === "team" || row.actions > 0));
    const tricky = { ...data, teams: data.teams.map(team => team.team_id === home ? { ...team, name: '=HYPERLINK("x"), "FC"' } : team) };
    const csv = statisticsExport(tricky, stats, 5400, "csv");
    assert.ok(csv.includes(`"'=HYPERLINK(""x""), ""FC"""`));
    assert.equal(csv.split("\n")[0].split(",")[0], "scope");
    const json = JSON.parse(statisticsExport(data, stats, 5400, "json"));
    assert.equal(json.clock, "90:00");
    assert.equal(json.rows.length, rows.length);
});
