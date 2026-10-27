import { EVENT_TYPES, type MatchData } from "./types";

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

/** Validate unknown uploads before they reach any renderer or reducer. Never trust embedded scores/summaries. */
export function validateMatch(raw: unknown): MatchData {
    requireValue(object(raw), "The file must contain a JSON object, not a list or text.");
    const { match, teams, players, events } = raw;
    requireValue(object(match), 'Missing required "match" object.');
    requireValue(text(match.match_id), "match.match_id must be a non-empty string.");
    requireValue(finite(match.duration_seconds) && match.duration_seconds > 0 && match.duration_seconds <= 86400, "match.duration_seconds must be between 0 and 86,400.");
    requireValue(finite(match.period_seconds) && match.period_seconds > 0 && match.period_seconds < match.duration_seconds, "match.period_seconds must be a positive half-time boundary before full-time.");
    requireValue(Array.isArray(teams) && teams.length === 2, "Exactly two teams are required.");
    const teamIds = new Set<string>();
    for (const team of teams) {
        requireValue(object(team) && text(team.team_id) && text(team.name), "Every team needs a team_id and name.");
        requireValue(!teamIds.has(team.team_id), `Duplicate team_id: ${team.team_id}.`);
        teamIds.add(team.team_id);
    }
    requireValue(text(match.home_team_id) && text(match.away_team_id) && teamIds.has(match.home_team_id) && teamIds.has(match.away_team_id) && match.home_team_id !== match.away_team_id, "Home and away team IDs must reference the two different teams.");
    requireValue(Array.isArray(players), 'Missing required "players" array.');
    const playerTeams = new Map<string, string>();
    for (const player of players) {
        requireValue(object(player) && text(player.player_id) && text(player.name) && text(player.team_id) && teamIds.has(player.team_id), "Every player needs a player_id, name, and valid team_id.");
        requireValue(!playerTeams.has(player.player_id), `Duplicate player_id: ${player.player_id}.`);
        if (player.shirt_number !== undefined) requireValue(finite(player.shirt_number) && Number.isInteger(player.shirt_number), `${player.player_id}: shirt_number must be an integer.`);
        if (player.position !== undefined) requireValue(text(player.position), `${player.player_id}: position must be text.`);
        if (player.nationality !== undefined) requireValue(text(player.nationality), `${player.player_id}: nationality must be text.`);
        playerTeams.set(player.player_id, player.team_id);
    }
    requireValue(Array.isArray(events) && events.length <= 50000, 'An "events" array with at most 50,000 entries is required.');
    if (raw.documentation !== undefined) {
        requireValue(object(raw.documentation), "documentation must be an object.");
        const coords = raw.documentation.coordinates;
        if (coords !== undefined) requireValue(typeof coords === "string" && /0.{0,3}100/.test(coords) && /acting team|team.relative/i.test(coords) && /rotat/i.test(coords), "Coordinates must use 0–100 team-relative positions with both axes rotated for the opposing team. Omit documentation.coordinates to use this default convention.");
    }
    const ids = new Set<string>();
    const sequences = new Set<number>();
    const controlTypes = new Set(["match_start", "half_time", "second_half_start", "full_time"]);
    for (const [index, event] of events.entries()) {
        const at = `Event ${index + 1}`;
        requireValue(object(event), `${at} must be an object.`);
        requireValue(text(event.event_id) && !ids.has(event.event_id), `${at}: event_id must be non-empty and unique.`);
        requireValue(finite(event.sequence) && Number.isInteger(event.sequence) && event.sequence >= 0 && !sequences.has(event.sequence), `${at}: sequence must be a unique, non-negative integer.`);
        requireValue(finite(event.match_time_seconds) && event.match_time_seconds >= 0 && event.match_time_seconds <= match.duration_seconds, `${at}: match_time_seconds must be within the match duration.`);
        requireValue(event.period === 1 || event.period === 2, `${at}: period must be 1 or 2.`);
        requireValue(event.period === 1 ? event.match_time_seconds <= match.period_seconds : event.match_time_seconds >= match.period_seconds, `${at}: period conflicts with its timestamp.`);
        requireValue(typeof event.type === "string" && (EVENT_TYPES as readonly string[]).includes(event.type), `${at}: unsupported event type. Supported: ${EVENT_TYPES.join(", ")}.`);
        requireValue(event.team_id === null || (text(event.team_id) && teamIds.has(event.team_id)), `${at}: team_id must reference a team or be null.`);
        requireValue(event.player_id === null || (text(event.player_id) && playerTeams.has(event.player_id)), `${at}: player_id must reference a player or be null.`);
        requireValue(event.possession_id === null || text(event.possession_id) || (finite(event.possession_id) && Number.isInteger(event.possession_id)), `${at}: possession_id must be a string, integer, or null.`);
        if (!controlTypes.has(event.type)) requireValue(text(event.team_id), `${at}: action events require a team_id.`);
        if (text(event.player_id)) requireValue(playerTeams.get(event.player_id) === event.team_id, `${at}: the acting player must belong to the acting team.`);
        for (const key of ["recipient_player_id", "target_player_id"]) if (event[key] != null) requireValue(text(event[key]) && playerTeams.has(event[key]), `${at}: ${key} references an unknown player.`);
        if (event.recipient_player_id != null) requireValue(playerTeams.get(event.recipient_player_id as string) === event.team_id, `${at}: pass recipient must belong to the acting team.`);
        if (event.from_team_id != null) requireValue(text(event.from_team_id) && teamIds.has(event.from_team_id), `${at}: from_team_id is unknown.`);
        for (const key of ["position", "start_position", "end_position"]) {
            const p = event[key];
            if (p !== undefined) requireValue(object(p) && finite(p.x) && finite(p.y) && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100, `${at}: ${key} must have numeric x and y between 0 and 100.`);
        }
        for (const key of ["outcome", "reason", "intensity"]) if (event[key] !== undefined) requireValue(text(event[key]), `${at}: ${key} must be text.`);
        const allowedOutcomes: Record<string, string[]> = { pass: ["complete", "intercepted", "incomplete"], shot: ["goal", "saved", "blocked", "off_target", "on_target"], tackle: ["won", "lost"] };
        if (event.outcome !== undefined && allowedOutcomes[event.type]) requireValue(allowedOutcomes[event.type].includes(event.outcome as string), `${at}: unsupported ${event.type} outcome "${event.outcome}".`);
        for (const key of ["distance_m", "difficulty_rating", "synthetic_xg", "ball_speed_kmh", "shot_speed_kmh", "player_speed_kmh", "player_distance_m"]) if (event[key] !== undefined) requireValue(finite(event[key]) && event[key] >= 0, `${at}: ${key} must be a non-negative number.`);
        if (event.type === "half_time") requireValue(event.period === 1 && event.match_time_seconds === match.period_seconds, `${at}: half_time must be at the end of period 1.`);
        if (event.type === "second_half_start") requireValue(event.period === 2 && event.match_time_seconds === match.period_seconds, `${at}: second_half_start must be at the start of period 2.`);
        if (event.type === "full_time") requireValue(event.period === 2 && event.match_time_seconds === match.duration_seconds, `${at}: full_time must be at the end of period 2.`);
        ids.add(event.event_id); sequences.add(event.sequence);
    }
    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < sorted.length; i++) requireValue(sorted[i].match_time_seconds >= sorted[i - 1].match_time_seconds && sorted[i].period >= sorted[i - 1].period, "Event sequence order must have non-decreasing timestamps and periods.");
    // Strip final_score, event score snapshots, and final_statistics at the boundary.
    return { schema_version: text(raw.schema_version) ? raw.schema_version : undefined, synthetic: raw.synthetic === true, disclaimer: text(raw.disclaimer) ? raw.disclaimer : undefined, match: { match_id: match.match_id, home_team_id: match.home_team_id, away_team_id: match.away_team_id, duration_seconds: match.duration_seconds, period_seconds: match.period_seconds }, teams, players, events: sorted.map(source => { const event = { ...source }; delete event.score; return event; }), documentation: raw.documentation } as MatchData;
}