import { FOCUS_METRICS, type FanProfile, type FocusMetric, type Language, type MatchData, type Preferences, type ViewMode } from "./types";

/**
 * A fan's choices carried across matches and visits: favourite clubs and players by name (most recent first),
 * perspective, My metric and units. Language keeps its own cookie; auto-explain stays session-only.
 */
export const DEFAULT_PROFILE: FanProfile = { mode: "analyst", clubs: [], players: [], metric: null, units: "metric" };
const LIMIT = 8;
const MODES: readonly ViewMode[] = ["casual", "analyst", "player"];
const names = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map(entry => entry.slice(0, 120)))].slice(0, LIMIT) : [];

/** Tolerant: anything unreadable falls back to the default rather than failing the studio. */
export function validateProfile(raw: unknown): FanProfile {
    if (!raw || typeof raw !== "object") return DEFAULT_PROFILE;
    const value = raw as Record<string, unknown>;
    return {
        mode: MODES.includes(value.mode as ViewMode) ? value.mode as ViewMode : DEFAULT_PROFILE.mode,
        clubs: names(value.clubs),
        players: names(value.players),
        metric: FOCUS_METRICS.includes(value.metric as FocusMetric) ? value.metric as FocusMetric : null,
        units: value.units === "imperial" ? "imperial" : "metric",
    };
}

/** This match's preferences from the profile: the first favourite club and players that appear in it. */
export function preferencesFor(data: MatchData, profile: FanProfile, language: Language): Preferences {
    const favorites = profile.players.flatMap(name => data.players.filter(player => player.name === name).map(player => player.player_id));
    const team = profile.clubs.map(name => data.teams.find(entry => entry.name === name)?.team_id).find(Boolean) ?? data.match.home_team_id;
    const player = favorites[0] ?? data.players.find(entry => entry.team_id === team && entry.position !== "GK")?.player_id ?? data.players[0]?.player_id ?? "";
    return { mode: profile.mode, language, team, player, favorites, metric: profile.metric, units: profile.units };
}

const front = (list: readonly string[], name: string | undefined) => name ? [name, ...list.filter(entry => entry !== name)].slice(0, LIMIT) : [...list];

/** Records one explicit change. Choosing a player in the studio makes them a favourite, as its label says. */
export function rememberChoice<K extends keyof Preferences>(profile: FanProfile, data: MatchData, key: K, value: Preferences[K]): FanProfile {
    const playerName = (id: unknown) => data.players.find(player => player.player_id === id)?.name;
    switch (key) {
        case "team": return { ...profile, clubs: front(profile.clubs, data.teams.find(team => team.team_id === value)?.name) };
        case "player": return { ...profile, players: front(profile.players, playerName(value)) };
        case "favorites": {
            const chosen = (value as string[] | undefined ?? []).map(playerName).filter((name): name is string => !!name);
            // Favourites from other matches stay; this match's players follow the new list.
            const inMatch = new Set(data.players.map(player => player.name));
            return { ...profile, players: [...new Set([...chosen, ...profile.players.filter(name => !inMatch.has(name))])].slice(0, LIMIT) };
        }
        case "mode": return { ...profile, mode: value as ViewMode };
        case "metric": return { ...profile, metric: value as FocusMetric | null };
        case "units": return { ...profile, units: value === "imperial" ? "imperial" : "metric" };
        default: return profile;
    }
}
