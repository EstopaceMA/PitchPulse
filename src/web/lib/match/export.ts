import { formatTime } from "./playback";
import { accuracy, averageBallSpeed, averagePassDistance, averageShotSpeed, emptyQuality } from "./statistics";
import type { MatchData, Metrics, Quality, Statistics } from "./types";

/** One row per team and per player with recorded actions, from processed-prefix statistics only. */
export function statisticsRows(data: MatchData, stats: Statistics) {
    const row = (scope: "team" | "player", id: string, name: string, teamId: string, m: Metrics, q: Quality) => ({
        scope, id, name, team_id: teamId,
        goals: m.goals, shots: m.shots, shots_on_target: m.shots_on_target, passes_attempted: m.passes_attempted, passes_completed: m.passes_completed,
        pass_accuracy_pct: m.passes_attempted ? Number(accuracy(m).toFixed(1)) : null, tackles_won: m.tackles_won, pressure_events: m.pressure_events, actions: m.actions,
        long_passes_completed: q.long_passes_completed, long_passes_attempted: q.long_passes_attempted,
        difficult_passes_completed: q.difficult_passes_completed, difficult_passes_attempted: q.difficult_passes_attempted,
        // Synthetic dataset values; null when the prefix has no sample.
        avg_pass_distance_m: q.pass_distance_count ? Number(averagePassDistance(q).toFixed(1)) : null,
        avg_ball_speed_kmh: q.ball_speed_count ? Number(averageBallSpeed(q).toFixed(1)) : null,
        avg_shot_speed_kmh: q.shot_speed_count ? Number(averageShotSpeed(q).toFixed(1)) : null,
        max_shot_speed_kmh: q.shot_speed_count ? q.shot_speed_max : null,
    });
    return [
        ...data.teams.map(team => row("team", team.team_id, team.name, team.team_id, stats.teams[team.team_id], stats.quality.teams[team.team_id] ?? emptyQuality())),
        ...data.players.filter(player => stats.players[player.player_id]?.actions).map(player => row("player", player.player_id, player.name, player.team_id, stats.players[player.player_id], stats.quality.players[player.player_id] ?? emptyQuality())),
    ];
}

const csvField = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    // Quote separators and quotes, and neutralize spreadsheet formulas in names.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export function statisticsExport(data: MatchData, stats: Statistics, elapsed: number, format: "csv" | "json"): string {
    const rows = statisticsRows(data, stats);
    if (format === "json") return JSON.stringify({ match_id: data.match.match_id, synthetic: data.synthetic === true, clock: formatTime(elapsed), note: "Event-derived statistics up to the clock. Distances and speeds are synthetic dataset values.", rows }, null, 2);
    const columns = Object.keys(rows[0] ?? {});
    return [columns.join(","), ...rows.map(row => columns.map(column => csvField(row[column as keyof typeof row])).join(","))].join("\n") + "\n";
}
