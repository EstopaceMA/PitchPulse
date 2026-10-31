import type { MatchData, MatchEvent, Metrics, Quality, Statistics } from "./types";

/** Pass-quality thresholds over the dataset's synthetic per-event fields; never tracking measurements. */
export const LONG_PASS_METRES = 20;
export const DIFFICULT_PASS_RATING = 0.3;
export const DIFFICULTY_BANDS = ["routine", "moderate", "hard", "elite"] as const;
export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number];
/** Routine < 0.2, moderate < 0.3, hard < 0.4, elite from 0.4. Difficult passes are hard or elite. */
export const difficultyBand = (rating: number): DifficultyBand => rating >= 0.4 ? "elite" : rating >= DIFFICULT_PASS_RATING ? "hard" : rating >= 0.2 ? "moderate" : "routine";

export const emptyMetrics = (): Metrics => ({ goals: 0, shots: 0, shots_on_target: 0, passes_attempted: 0, passes_completed: 0, tackles_won: 0, pressure_events: 0, actions: 0 });
export const emptyQuality = (): Quality => ({
    pass_distance_total: 0, pass_distance_count: 0, long_passes_attempted: 0, long_passes_completed: 0,
    difficult_passes_attempted: 0, difficult_passes_completed: 0,
    ball_speed_total: 0, ball_speed_count: 0, ball_speed_max: 0, shot_speed_total: 0, shot_speed_count: 0, shot_speed_max: 0,
});
export const accuracy = (s: Metrics): number => s.passes_attempted ? s.passes_completed / s.passes_attempted * 100 : 0;
const average = (total: number, count: number): number => count ? total / count : 0;
export const averagePassDistance = (q: Quality): number => average(q.pass_distance_total, q.pass_distance_count);
export const averageBallSpeed = (q: Quality): number => average(q.ball_speed_total, q.ball_speed_count);
export const averageShotSpeed = (q: Quality): number => average(q.shot_speed_total, q.shot_speed_count);
export function addEvent(stats: Metrics, event: MatchEvent): void {
    stats.actions++;
    if (event.type === "pass") { stats.passes_attempted++; if (event.outcome === "complete") stats.passes_completed++; }
    if (event.type === "shot") {
        stats.shots++;
        if (["goal", "saved", "on_target"].includes(event.outcome ?? "")) stats.shots_on_target++;
        if (event.outcome === "goal") stats.goals++;
    }
    if (event.type === "tackle" && event.outcome === "won") stats.tackles_won++;
    if (event.type === "pressure") stats.pressure_events++;
}
/** Folds only the fields an event supplies: a missing distance, rating or speed counts nowhere. */
export function addQuality(quality: Quality, event: MatchEvent): void {
    if (event.type === "pass") {
        const complete = event.outcome === "complete";
        if (event.distance_m !== undefined) {
            quality.pass_distance_total += event.distance_m;
            quality.pass_distance_count++;
            if (event.distance_m >= LONG_PASS_METRES) { quality.long_passes_attempted++; if (complete) quality.long_passes_completed++; }
        }
        if (event.difficulty_rating !== undefined && event.difficulty_rating >= DIFFICULT_PASS_RATING) { quality.difficult_passes_attempted++; if (complete) quality.difficult_passes_completed++; }
        if (event.ball_speed_kmh !== undefined) {
            quality.ball_speed_total += event.ball_speed_kmh;
            quality.ball_speed_count++;
            quality.ball_speed_max = Math.max(quality.ball_speed_max, event.ball_speed_kmh);
        }
    }
    if (event.type === "shot" && event.shot_speed_kmh !== undefined) {
        quality.shot_speed_total += event.shot_speed_kmh;
        quality.shot_speed_count++;
        quality.shot_speed_max = Math.max(quality.shot_speed_max, event.shot_speed_kmh);
    }
}
export function createStatistics(data: MatchData): Statistics {
    return {
        teams: Object.fromEntries(data.teams.map(t => [t.team_id, emptyMetrics()])), players: Object.fromEntries(data.players.map(p => [p.player_id, emptyMetrics()])),
        quality: { teams: Object.fromEntries(data.teams.map(t => [t.team_id, emptyQuality()])), players: Object.fromEntries(data.players.map(p => [p.player_id, emptyQuality()])) },
    };
}
/** Every metric record is flat, so a shallow copy of each keeps the source untouched by later folds. */
export function cloneStatistics(stats: Statistics): Statistics {
    const copy = <T extends object>(records: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(records).map(([k, v]) => [k, { ...v }]));
    return { teams: copy(stats.teams), players: copy(stats.players), quality: { teams: copy(stats.quality.teams), players: copy(stats.quality.players) } };
}
export function reduceStatistics(stats: Statistics, event: MatchEvent): Statistics {
    if (event.team_id && stats.teams[event.team_id]) { addEvent(stats.teams[event.team_id], event); addQuality(stats.quality.teams[event.team_id], event); }
    if (event.player_id && stats.players[event.player_id]) { addEvent(stats.players[event.player_id], event); addQuality(stats.quality.players[event.player_id], event); }
    return stats;
}
export function aggregate(data: MatchData, events: readonly MatchEvent[]): Statistics {
    return events.reduce(reduceStatistics, createStatistics(data));
}
/** Statistics after a cursor move: forward folds only the new events into a copy; backwards rebuilds the prefix. */
export function advanceStatistics(data: MatchData, stats: Statistics, from: number, to: number): Statistics {
    if (to === from) return stats;
    if (to < from) return aggregate(data, data.events.slice(0, to));
    const next = cloneStatistics(stats);
    for (let i = from; i < to; i++) reduceStatistics(next, data.events[i]);
    return next;
}
/** Attempted and completed passes per difficulty band for the events an owner made; unrated passes count nowhere. */
export function passBands(events: readonly MatchEvent[], owns: (event: MatchEvent) => boolean): Record<DifficultyBand, { attempted: number; completed: number }> {
    const bands = Object.fromEntries(DIFFICULTY_BANDS.map(band => [band, { attempted: 0, completed: 0 }])) as Record<DifficultyBand, { attempted: number; completed: number }>;
    for (const event of events) {
        if (event.type !== "pass" || event.difficulty_rating === undefined || !owns(event)) continue;
        const band = bands[difficultyBand(event.difficulty_rating)];
        band.attempted++;
        if (event.outcome === "complete") band.completed++;
    }
    return bands;
}
