import type { MatchEvent } from "./types";

/**
 * On-screen highlight thresholds. Defaults sit near the bundled demo's 95th percentiles (pass 22 m, completed
 * pass difficulty 0.35, ball 67 km/h) and its fastest fifth of shots (100 km/h), so tags stay occasional.
 * Player speed and distance come only from optional tracking fields in an import, never from illustrative movement.
 */
export const HIGHLIGHT_THRESHOLDS = { passMetres: 22, passDifficulty: 0.35, ballKmh: 67, shotKmh: 100, sprintKmh: 25, distanceStepMetres: 1000 } as const;
/** Match seconds a tag stays on screen after its event. */
export const HIGHLIGHT_SECONDS = 8;

/** Highest priority first; an event shows at most one tag. */
export const HIGHLIGHT_KINDS = ["shot_speed", "player_speed", "player_distance", "difficult_pass", "long_pass", "ball_speed"] as const;
export type HighlightKind = (typeof HIGHLIGHT_KINDS)[number];
export interface Highlight { eventId: string; playerId: string; teamId: string; kind: HighlightKind; value: number; at: number }

/**
 * Every highlight in a processed prefix, oldest first. Pure and prefix-only: the result for a prefix never depends
 * on later events. Distance milestones fire when a player's supplied cumulative distance crosses a new step.
 */
export function buildHighlights(events: readonly MatchEvent[], thresholds = HIGHLIGHT_THRESHOLDS): Highlight[] {
    const distances = new Map<string, number>();
    const highlights: Highlight[] = [];
    for (const event of events) {
        if (event.player_id === null || event.team_id === null) continue;
        const candidates: [HighlightKind, number][] = [];
        if (event.type === "shot" && event.shot_speed_kmh !== undefined && event.shot_speed_kmh >= thresholds.shotKmh) candidates.push(["shot_speed", event.shot_speed_kmh]);
        if (event.player_speed_kmh !== undefined && event.player_speed_kmh >= thresholds.sprintKmh) candidates.push(["player_speed", event.player_speed_kmh]);
        if (event.player_distance_m !== undefined) {
            const previous = distances.get(event.player_id) ?? 0;
            const step = Math.floor(event.player_distance_m / thresholds.distanceStepMetres);
            if (step > Math.floor(previous / thresholds.distanceStepMetres)) candidates.push(["player_distance", step * thresholds.distanceStepMetres]);
            distances.set(event.player_id, Math.max(previous, event.player_distance_m));
        }
        if (event.type === "pass") {
            if (event.outcome === "complete" && event.difficulty_rating !== undefined && event.difficulty_rating >= thresholds.passDifficulty) candidates.push(["difficult_pass", event.difficulty_rating]);
            if (event.distance_m !== undefined && event.distance_m >= thresholds.passMetres) candidates.push(["long_pass", event.distance_m]);
            if (event.ball_speed_kmh !== undefined && event.ball_speed_kmh >= thresholds.ballKmh) candidates.push(["ball_speed", event.ball_speed_kmh]);
        }
        if (!candidates.length) continue;
        const [kind, value] = candidates.reduce((best, next) => HIGHLIGHT_KINDS.indexOf(next[0]) < HIGHLIGHT_KINDS.indexOf(best[0]) ? next : best);
        highlights.push({ eventId: event.event_id, playerId: event.player_id, teamId: event.team_id, kind, value, at: event.match_time_seconds });
    }
    return highlights;
}

/** Highlights whose event time is within (at − seconds, at], newest last. Walks back from the end only. */
export function activeHighlights(highlights: readonly Highlight[], at: number, seconds = HIGHLIGHT_SECONDS): Highlight[] {
    const active: Highlight[] = [];
    for (let index = highlights.length - 1; index >= 0 && highlights[index].at > at - seconds; index--) {
        if (highlights[index].at <= at) active.unshift(highlights[index]);
    }
    return active;
}
