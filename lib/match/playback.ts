import type { MatchData, MatchEvent, Position } from "./types";

export type MatchStatus = "ready" | "playing" | "paused" | "half-time" | "full-time";
export interface PlaybackState { elapsed: number; cursor: number; status: MatchStatus; speed: number; secondHalf: boolean }
export type PlaybackAction = { type: "toggle" } | { type: "restart" } | { type: "speed"; speed: number } | { type: "tick"; seconds: number } | { type: "seek"; elapsed: number } | { type: "step" };
export const initialPlayback = (): PlaybackState => ({ elapsed: 0, cursor: 0, status: "ready", speed: 5, secondHalf: false });

export function countReached(events: readonly MatchEvent[], elapsed: number, secondHalf: boolean): number {
    let low = 0, high = events.length;
    while (low < high) { const mid = (low + high) >>> 1; const e = events[mid]; if (e.match_time_seconds <= elapsed && (secondHalf || e.period === 1)) low = mid + 1; else high = mid; }
    return low;
}
export function playbackReducer(data: MatchData, state: PlaybackState, action: PlaybackAction): PlaybackState {
    const half = data.match.period_seconds, end = data.match.duration_seconds;
    if (action.type === "restart") return { ...initialPlayback(), speed: state.speed };
    if (action.type === "speed") return [1, 5, 10, 30].includes(action.speed) ? { ...state, speed: action.speed } : state;
    if (action.type === "toggle") {
        if (state.status === "full-time") return state;
        if (state.status === "playing") return { ...state, status: "paused" };
        const secondHalf = state.secondHalf || state.status === "half-time";
        return { ...state, secondHalf, status: "playing", cursor: countReached(data.events, state.elapsed, secondHalf) };
    }
    if (action.type === "seek") {
        if (!Number.isFinite(action.elapsed)) return state;
        const elapsed = Math.max(0, Math.min(end, action.elapsed));
        const secondHalf = elapsed > half;
        return { ...state, elapsed, secondHalf, cursor: countReached(data.events, elapsed, secondHalf), status: elapsed === end ? "full-time" : elapsed === half ? "half-time" : "paused" };
    }
    if (action.type === "step") {
        if (state.status === "full-time" || state.status === "half-time") return state;
        const next = data.events[state.cursor];
        if (!state.secondHalf && (!next || next.period === 2 || next.match_time_seconds >= half)) return { ...state, elapsed: half, cursor: countReached(data.events, half, false), status: "half-time" };
        if (!next) return { ...state, elapsed: end, cursor: data.events.length, status: "full-time" };
        return { ...state, elapsed: next.match_time_seconds, cursor: state.cursor + 1, status: next.type === "full_time" || (next.match_time_seconds >= end && state.cursor + 1 === data.events.length) ? "full-time" : "paused" };
    }
    if (state.status !== "playing" || !Number.isFinite(action.seconds) || action.seconds < 0) return state;
    let elapsed = Math.min(end, state.elapsed + action.seconds * state.speed);
    let status: MatchStatus = "playing";
    if (!state.secondHalf && elapsed >= half) { elapsed = half; status = "half-time"; }
    else if (elapsed >= end) status = "full-time";
    return { ...state, elapsed, status, cursor: countReached(data.events, elapsed, state.secondHalf) };
}

export function formatTime(seconds: number): string { const n = Math.max(0, Math.floor(seconds)); return `${Math.floor(n / 60).toString().padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`; }
/** Fixed home-right / away-left orientation. Rotate BOTH axes for away-team coordinates. */
export function pitchPosition(position: Position, teamId: string | null, homeId: string): Position { return teamId === homeId || !teamId ? position : { x: 100 - position.x, y: 100 - position.y }; }