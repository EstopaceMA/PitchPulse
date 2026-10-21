import type { MatchEvent } from "./types";

/** Milestones, shots, challenges and turnovers without routine-action noise. Shared by the commentary panel and the commentator agent. */
export function isMeaningful(event: MatchEvent): boolean {
    if (event.type === "pass") return event.outcome === "intercepted" || event.outcome === "incomplete";
    if (event.type === "pressure") return event.intensity === "high";
    if (event.type === "possession_change") return event.reason !== "shot_end";
    return true;
}

export function isKeyMoment(event: MatchEvent): boolean {
    return event.type === "shot" && (event.outcome === "goal" || event.outcome === "saved" || event.outcome === "on_target");
}
