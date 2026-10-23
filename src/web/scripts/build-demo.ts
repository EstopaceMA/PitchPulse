/**
 * Rebuilds the bundled demo's roster from data/squads.json and data/lineups.json, and hands shots the original
 * simulation gave to defenders to forwards and midfielders. No network; safe to re-run.
 * Run `npm run data:demo` after editing either file. README.md documents where the squad data comes from.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { aggregate } from "@/lib/match/statistics";
import type { Metrics } from "@/lib/match/types";
import { validateMatch } from "@/lib/match/validation";
import { rewriteBundle, type Bundle } from "./demo-data/bundle";
import { realignDefenderShots } from "./demo-data/realign";
import { applyLineup, type Lineups, type Squad } from "./demo-data/roster";

const MATCH = new URL("../public/arsenal-vs-chelsea-match.json", import.meta.url);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;

const DISCLAIMER = "Simulated demonstration match using real club names and real first-team squad names. None of these events happened: this is not an actual fixture, lineup or official match data.";
const SHOT_ATTRIBUTION = "Shots that the original simulation gave to defenders belong to a forward of the same team when taken inside the penalty area, or a midfielder when taken outside it, together with the pass, ball win or pressure that set them up. Event IDs, times, positions, outcomes and team totals are unchanged.";

function shotsByPosition(bundle: Bundle): string {
    const positions = new Map(bundle.players.map(player => [player.player_id, player.position ?? "?"]));
    const counts = new Map<string, number>();
    for (const event of bundle.events) if (event.type === "shot" && event.player_id) counts.set(positions.get(event.player_id)!, (counts.get(positions.get(event.player_id)!) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([position, count]) => `${position} ${count}`).join(", ");
}

function main(): void {
    const raw = readFileSync(MATCH, "utf8");
    const before = JSON.parse(raw) as Bundle;
    const snapshot = readJson<{ source: string; license: string; retrieved: string; clubs: Record<string, Squad> }>("../data/squads.json");
    const lineups = readJson<Lineups>("../data/lineups.json");

    const players = applyLineup(before.players, snapshot.clubs, lineups);
    const { events, changes } = realignDefenderShots(players, before.events);
    const sources = Object.values(snapshot.clubs).map(club => `${club.page} (revision ${club.revision}${club.updated ? `, updated ${club.updated}` : ""})`).join(" and ");
    const after: Bundle = {
        ...before, disclaimer: DISCLAIMER, players, events,
        documentation: {
            ...before.documentation,
            roster: `Player names, shirt numbers and nationality codes come from the ${snapshot.source} of ${sources}, retrieved ${snapshot.retrieved} (${snapshot.license}). Each starting XI is an editorial pick placed in a fixed 4-3-3. The players are real; every event in this match is simulated.`,
            shot_attribution: SHOT_ATTRIBUTION,
        },
    };

    // The rebuilt match must still validate, keep its goals and match its own team totals.
    const data = validateMatch(after);
    const goals = (bundle: Bundle) => bundle.events.filter(event => event.type === "shot" && event.outcome === "goal").map(event => `${event.event_id}:${event.player_id}`);
    if (goals(after).join() !== goals(before).join()) throw new Error("The goals changed.");
    const totals = aggregate(data, data.events).teams, summary = before.final_statistics as Record<string, Partial<Metrics>>;
    for (const [teamId, expected] of Object.entries(summary)) for (const [key, value] of Object.entries(expected)) {
        if (key in totals[teamId] && totals[teamId][key as keyof Metrics] !== value) throw new Error(`${teamId} ${key} is ${totals[teamId][key as keyof Metrics]}, but final_statistics says ${value}.`);
    }

    const names = new Map(players.map(player => [player.player_id, player.name]));
    for (const change of changes) console.log(`${change.shot}: ${names.get(change.from)} → ${names.get(change.to)} (${change.edited.length} events)`);
    console.log(`Players: ${players.map(player => `${player.player_id} ${player.name}`).join(", ")}`);
    console.log(`Shots by position, before: ${shotsByPosition(before)}`);
    console.log(`Shots by position, after:  ${shotsByPosition(after)}`);
    console.log(`Realigned ${changes.length} shots (${changes.reduce((sum, change) => sum + change.edited.length, 0)} events).`);
    writeFileSync(MATCH, rewriteBundle(raw, before, after));
    console.log("Wrote public/arsenal-vs-chelsea-match.json.");
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
