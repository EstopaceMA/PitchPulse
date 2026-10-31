import type { MatchData, MatchEvent, Position, PlaybackCheckpoint } from "./types";

export const MATCH_STATUSES = ["ready", "playing", "paused", "half-time", "full-time"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export interface PlaybackState { elapsed: number; cursor: number; status: MatchStatus; speed: number; secondHalf: boolean }
export type PlaybackAction = { type: "toggle" } | { type: "restart" } | { type: "restore"; checkpoint: PlaybackCheckpoint } | { type: "speed"; speed: number } | { type: "tick"; seconds: number } | { type: "seek"; elapsed: number } | { type: "step" };
export const initialPlayback = (): PlaybackState => ({ elapsed: 0, cursor: 0, status: "ready", speed: 5, secondHalf: false });

/** Validate exact prefixes, including partially stepped groups at an equal timestamp. */
export function validCheckpoint(data: MatchData, value: unknown): value is PlaybackCheckpoint {
    if (!value || typeof value !== "object") return false;
    const p = value as PlaybackCheckpoint;
    const half = data.match.period_seconds, end = data.match.duration_seconds;
    if (!Number.isFinite(p.elapsed) || p.elapsed < 0 || p.elapsed > end || !Number.isInteger(p.cursor) || p.cursor < 0 || p.cursor > data.events.length || typeof p.secondHalf !== "boolean" || ![1, 5, 10, 30].includes(p.speed) || !(MATCH_STATUSES as readonly string[]).includes(p.status)) return false;
    if (p.secondHalf ? p.elapsed < half : p.elapsed > half) return false;
    const previous = data.events[p.cursor - 1], next = data.events[p.cursor];
    if (previous && (previous.match_time_seconds > p.elapsed || (!p.secondHalf && previous.period === 2))) return false;
    if (next && next.match_time_seconds < p.elapsed && (p.secondHalf || next.period === 1)) return false;
    if (p.status === "ready" && (p.elapsed !== 0 || p.cursor !== 0 || p.secondHalf)) return false;
    if (p.status === "half-time" && (p.elapsed !== half || p.secondHalf || p.cursor !== countReached(data.events, half, false))) return false;
    if (p.status === "full-time" && (p.elapsed !== end || !p.secondHalf || p.cursor !== data.events.length)) return false;
    return true;
}

export function restorePlayback(data: MatchData, value: unknown): PlaybackState {
    if (!validCheckpoint(data, value)) return initialPlayback();
    const p = { ...value, status: value.status === "playing" ? "paused" as const : value.status };
    if (p.elapsed === data.match.period_seconds && !p.secondHalf && p.cursor === countReached(data.events, p.elapsed, false)) p.status = "half-time";
    if (p.elapsed === data.match.duration_seconds && p.cursor === data.events.length) p.status = "full-time";
    return p;
}

export function annotationAnchor(data: MatchData, state: PlaybackState, eventId?: string): PlaybackCheckpoint {
    const index = eventId ? data.events.slice(0, state.cursor).findIndex(event => event.event_id === eventId) : -1;
    if (index < 0) return restorePlayback(data, state);
    const event = data.events[index];
    return restorePlayback(data, { ...state, elapsed: event.match_time_seconds, cursor: index + 1, secondHalf: event.period === 2, status: "paused" });
}

export function countReached(events: readonly MatchEvent[], elapsed: number, secondHalf: boolean): number {
    let low = 0, high = events.length;
    while (low < high) { const mid = (low + high) >>> 1; const e = events[mid]; if (e.match_time_seconds <= elapsed && (secondHalf || e.period === 1)) low = mid + 1; else high = mid; }
    return low;
}
export function playbackReducer(data: MatchData, state: PlaybackState, action: PlaybackAction): PlaybackState {
    const half = data.match.period_seconds, end = data.match.duration_seconds;
    if (action.type === "restore") return restorePlayback(data, action.checkpoint);
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
