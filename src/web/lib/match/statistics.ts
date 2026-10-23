import type { MatchData, MatchEvent, Metrics, Statistics } from "./types";

export const emptyMetrics = (): Metrics => ({ goals: 0, shots: 0, shots_on_target: 0, passes_attempted: 0, passes_completed: 0, tackles_won: 0, pressure_events: 0, actions: 0 });
export const accuracy = (s: Metrics): number => s.passes_attempted ? s.passes_completed / s.passes_attempted * 100 : 0;
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
export function createStatistics(data: MatchData): Statistics {
    return { teams: Object.fromEntries(data.teams.map(t => [t.team_id, emptyMetrics()])), players: Object.fromEntries(data.players.map(p => [p.player_id, emptyMetrics()])) };
}
export function reduceStatistics(stats: Statistics, event: MatchEvent): Statistics {
    if (event.team_id && stats.teams[event.team_id]) addEvent(stats.teams[event.team_id], event);
    if (event.player_id && stats.players[event.player_id]) addEvent(stats.players[event.player_id], event);
    return stats;
}
export function aggregate(data: MatchData, events: readonly MatchEvent[]): Statistics {
    return events.reduce(reduceStatistics, createStatistics(data));
}
/** Incremental for forward playback; replay from zero on backwards seeks. Owned by one simulation hook. */
export class StatisticsAccumulator {
    private count = 0;
    private stats: Statistics;
    constructor(private readonly data: MatchData) { this.stats = createStatistics(data); }
    at(count: number): Statistics {
        if (count < this.count) { this.stats = createStatistics(this.data); this.count = 0; }
        while (this.count < count) reduceStatistics(this.stats, this.data.events[this.count++]);
        return { teams: Object.fromEntries(Object.entries(this.stats.teams).map(([k, v]) => [k, { ...v }])), players: Object.fromEntries(Object.entries(this.stats.players).map(([k, v]) => [k, { ...v }])) };
    }
}