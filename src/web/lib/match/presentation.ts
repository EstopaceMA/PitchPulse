import type { Language, MatchData, MatchEvent, Units } from "./types";
import { difficultyBand, type DifficultyBand } from "./statistics";
import type { Highlight } from "./thresholds";
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
/** Synthetic dataset speeds and distances, one decimal, in the viewer's units. Digits stay Latin in every locale. */
export const speedText = (kmh: number, units: Units = "metric"): string => units === "imperial" ? `${(kmh / 1.609344).toFixed(1)} mph` : `${kmh.toFixed(1)} km/h`;
export const distanceText = (metres: number, units: Units = "metric"): string => units === "imperial" ? `${(metres * 1.0936133).toFixed(1)} yd` : `${metres.toFixed(1)} m`;
const bands: Record<DifficultyBand, string> = { routine: "bandRoutine", moderate: "bandModerate", hard: "bandHard", elite: "bandElite" };
export const bandLabel = (band: DifficultyBand, language: Language): string => tr(language, bands[band]);
export function highlightText(highlight: Highlight, language: Language, units: Units = "metric"): string {
    switch (highlight.kind) {
        case "shot_speed": return tr(language, "highlightShotSpeed", { value: speedText(highlight.value, units) });
        case "ball_speed": return tr(language, "highlightBallSpeed", { value: speedText(highlight.value, units) });
        case "player_speed": return tr(language, "highlightPlayerSpeed", { value: speedText(highlight.value, units) });
        case "long_pass": return tr(language, "highlightLongPass", { value: distanceText(highlight.value, units) });
        case "difficult_pass": return tr(language, "highlightDifficultPass", { band: bandLabel(difficultyBand(highlight.value), language) });
        case "player_distance": return tr(language, "highlightPlayerDistance", { value: units === "imperial" ? `${(highlight.value / 1609.344).toFixed(1)} mi` : `${highlight.value / 1000} km` });
    }
}
