import type { Player } from "@/lib/match/types";

/** One row of a club's Wikipedia "First-team squad" list, as recorded in data/squads.json. */
export type SquadPosition = "GK" | "DF" | "MF" | "FW";
export interface SquadPlayer { number: number; name: string; title: string; nationality: string; position: SquadPosition }
export interface Squad { page: string; revision: number; updated: string | null; players: SquadPlayer[] }

/** Per team: slot player_id → Wikipedia article title of the player picked for that slot. */
export type Lineups = Record<string, Record<string, string>>;

// Which coarse Wikipedia squad positions may fill each 4-3-3 slot.
const SLOT_FITS: Record<string, readonly SquadPosition[]> = {
    GK: ["GK"], RB: ["DF"], CB: ["DF"], LB: ["DF"], DM: ["MF", "DF"], CM: ["MF"], RW: ["FW", "MF"], ST: ["FW"], LW: ["FW", "MF"],
};

/**
 * Puts real squad members into the existing player slots. Player IDs and slot positions stay, so every event,
 * reference and formation lane is unchanged; name, shirt number and nationality come from the squad.
 */
export function applyLineup(players: readonly Player[], squads: Record<string, Squad>, lineups: Lineups): Player[] {
    const slots = new Set(players.map(player => player.player_id));
    for (const [teamId, picks] of Object.entries(lineups)) for (const slot of Object.keys(picks)) if (!slots.has(slot)) throw new Error(`lineups.${teamId}.${slot} is not a player slot in the match.`);
    const numbers = new Map<string, Set<number>>();
    return players.map(player => {
        const squad = squads[player.team_id], title = lineups[player.team_id]?.[player.player_id];
        if (!squad) throw new Error(`No squad snapshot for team ${player.team_id}.`);
        if (!title) throw new Error(`lineups.${player.team_id} has no pick for ${player.player_id} (${player.position}).`);
        const pick = squad.players.find(entry => entry.title === title);
        if (!pick) throw new Error(`${player.player_id}: "${title}" is not in the ${squad.page} first-team squad (revision ${squad.revision}) in data/squads.json. Choose another player or update the snapshot.`);
        const slot = player.position ?? "";
        if (!SLOT_FITS[slot]?.includes(pick.position)) throw new Error(`${player.player_id}: ${pick.name} is listed as ${pick.position}, which does not fit the ${slot || "unknown"} slot.`);
        const used = numbers.get(player.team_id) ?? new Set<number>();
        if (used.has(pick.number)) throw new Error(`${player.team_id}: shirt number ${pick.number} is used twice.`);
        used.add(pick.number);
        numbers.set(player.team_id, used);
        // fictional: false declares a real person, which is what lets the studio say "real squad names".
        return { player_id: player.player_id, team_id: player.team_id, name: pick.name, shirt_number: pick.number, position: player.position, nationality: pick.nationality, fictional: false };
    });
}
