import type { Language, MatchData, MatchEvent } from "./types";
import { translate } from "@/lib/i18n/translate";

export function tr(language: Language, key: string): string;
export function tr(language: Language, key: string, values: Record<string, string | number>): string;
export function tr(language: Language, key: string, values?: Record<string, string | number>): string {
    return translate(language, key, values);
}
/**
 * What a dataset says about its roster: placeholder demo players, real people (every player marked fictional: false)
 * in a simulated match, a simulated match making no claim about names, or recorded data making no claim at all.
 */
export function rosterKind(data: Pick<MatchData, "players" | "synthetic">): "fictional" | "real-simulated" | "simulated" | "recorded" {
    if (data.players.some(player => player.fictional === true)) return "fictional";
    if (!data.synthetic) return "recorded";
    return data.players.length > 0 && data.players.every(player => player.fictional === false) ? "real-simulated" : "simulated";
}
/** The short roster disclosure shown above the pitch, or null when the dataset makes no claim to disclose. */
export function rosterDisclosure(data: Pick<MatchData, "players" | "synthetic">, language: Language): string | null {
    switch (rosterKind(data)) {
        case "fictional": return tr(language, "demoPlayersAreFictional");
        case "real-simulated": return tr(language, "simulatedMatchRealSquadNames");
        case "simulated": return tr(language, "simulatedMatch");
        default: return null;
    }
}
const actions: Record<string, string> = {
    match_start: "eventMatchStarted", kickoff: "eventKickoff", pass: "eventPass", shot: "eventShot", tackle: "eventTackle", pressure: "eventPressure", possession_change: "eventPossessionChange", half_time: "eventHalfTime", second_half_start: "eventSecondHalf", full_time: "eventFullTime",
};
const outcomes: Record<string, string> = {
    complete: "outcomeComplete", intercepted: "outcomeIntercepted", incomplete: "outcomeIncomplete", goal: "outcomeGoal", saved: "outcomeSaved", off_target: "outcomeOffTarget", on_target: "outcomeOnTarget", blocked: "outcomeBlocked", won: "outcomeWon", lost: "outcomeLost", high: "outcomeHigh", medium: "outcomeMedium", low: "outcomeLow", interception: "outcomeInterception", tackle: "outcomeTackle", shot_end: "outcomeAfterShot",
};
export function eventLabel(event: Pick<MatchEvent, "type" | "outcome">, language: Language): string { const key = actions[event.type]; return event.type === "shot" && event.outcome === "goal" ? tr(language, "goal") : key ? tr(language, key) : event.type; }
export function outcomeLabel(event: MatchEvent, language: Language): string { const raw = event.outcome ?? event.intensity ?? event.reason; if (!raw) return "—"; return outcomes[raw] ? tr(language, outcomes[raw]) : raw.replaceAll("_", " "); }
export function teamColor(id: string | null, home: string): string { return id === home ? "#ff6276" : id ? "#669cff" : "#9aa8c0"; }
export function initials(name: string): string { return name.length <= 3 ? name.toUpperCase() : name.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase(); }
