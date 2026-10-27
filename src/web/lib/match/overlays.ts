import { ruleBasedProvider } from "./insights";
import { countReached } from "./playback";
import { distanceText, highlightText, speedText, tr } from "./presentation";
import { accuracy, addEvent, addQuality, aggregate, averagePassDistance, emptyMetrics, emptyQuality } from "./statistics";
import { buildHighlights, HIGHLIGHT_SECONDS } from "./thresholds";
import { isLocale } from "@/lib/i18n/locales";
import { FOCUS_METRICS, type FocusMetric, type Language, type MatchData, type MatchEvent, type Metrics, type Preferences, type Quality, type Units, type ViewMode } from "./types";

/**
 * Timed, machine-readable graphics for a live feed: what to show, when (match seconds), and how important it is.
 * Built only from the processed prefix, so the same prefix and preferences always give the same cues.
 */
export const CUE_SCHEMA_VERSION = "1.0.0";
export const CUE_KINDS = ["scorebug", "lower_third", "insight", "player_tag", "stat_pop", "my_metric"] as const;
export type CueKind = (typeof CUE_KINDS)[number];
export interface OverlayCue {
    /** Stable for the same prefix and preferences, so renderers can diff successive cue lists. */
    id: string;
    kind: CueKind;
    eventId: string | null;
    /** Match seconds. A renderer shows the cue while in ≤ clock < out. */
    in: number;
    out: number;
    /** Higher wins when cues compete for one screen slot. */
    priority: number;
    teamId: string | null;
    playerId: string | null;
    text: string;
    detail: string | null;
    values: Record<string, string | number>;
}

export const OVERLAY_CUE_SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "PitchPulse overlay cue",
    description: `Version ${CUE_SCHEMA_VERSION}. Times are match seconds from kick-off, excluding the half-time break. Values derive only from events reached by the requested clock; synthetic dataset values are never tracking measurements.`,
    type: "object",
    additionalProperties: false,
    required: ["id", "kind", "eventId", "in", "out", "priority", "teamId", "playerId", "text", "detail", "values"],
    properties: {
        id: { type: "string" },
        kind: { enum: [...CUE_KINDS] },
        eventId: { type: ["string", "null"], description: "The dataset event that triggered the cue, when there is one" },
        in: { type: "number", minimum: 0, description: "Show from this match second" },
        out: { type: "number", minimum: 0, description: "Hide at this match second" },
        priority: { type: "integer" },
        teamId: { type: ["string", "null"] },
        playerId: { type: ["string", "null"] },
        text: { type: "string", description: "Localized primary line" },
        detail: { type: ["string", "null"], description: "Localized secondary line" },
        values: { type: "object", additionalProperties: { type: ["string", "number"] } },
    },
} as const;

const LOWER_THIRD_SECONDS = 15;
const INSIGHT_SECONDS = 12;
const STAT_POP_SECONDS = 10;
const STAT_POP_EVERY = 900;
const PRIORITY: Record<string, number> = { goal: 100, goal_context: 90, drought: 70, momentum: 60, pressing: 60, shots: 50, recoveries: 50, passing: 45, player: 40, milestone: 35, player_tag: 30, stat_pop: 20, my_metric: 10, scorebug: 5 };
const FAVORITE_BOOST = 5;
/** Casual viewers get stories and big swings; percentage-point passing comparisons stay with analysts. */
const CASUAL_RULES = new Set(["drought", "momentum", "pressing", "shots", "recoveries"]);

const FOCUS_LABELS: Record<FocusMetric, string> = { shots: "shots2", shots_on_target: "shotsOnTarget", pass_accuracy: "passAccuracy", pressure_events: "pressureEvents", long_passes: "longPassesCompleted", difficult_passes: "difficultPassesCompleted", fastest_shot: "fastestShot" };
/** A milestone ping fires each time a count crosses a new multiple; a new fastest shot also pings. */
const MILESTONES: Partial<Record<FocusMetric, number>> = { shots: 5, shots_on_target: 3, pressure_events: 10, long_passes: 5, difficult_passes: 5 };
export const focusMetricLabel = (metric: FocusMetric, language: Language): string => tr(language, FOCUS_LABELS[metric]);
function focusNumber(metric: FocusMetric, m: Metrics, q: Quality): number {
    switch (metric) {
        case "shots": return m.shots;
        case "shots_on_target": return m.shots_on_target;
        case "pass_accuracy": return accuracy(m);
        case "pressure_events": return m.pressure_events;
        case "long_passes": return q.long_passes_completed;
        case "difficult_passes": return q.difficult_passes_completed;
        case "fastest_shot": return q.shot_speed_max;
    }
}
/** Display text; an empty rate or speed is "—" rather than a measured zero. */
export function focusMetricText(metric: FocusMetric, m: Metrics, q: Quality, units: Units = "metric"): string {
    switch (metric) {
        case "pass_accuracy": return m.passes_attempted ? `${accuracy(m).toFixed(1)}%` : "—";
        case "long_passes": return `${q.long_passes_completed}/${q.long_passes_attempted}`;
        case "difficult_passes": return `${q.difficult_passes_completed}/${q.difficult_passes_attempted}`;
        case "fastest_shot": return q.shot_speed_count ? speedText(q.shot_speed_max, units) : "—";
        default: return String(focusNumber(metric, m, q));
    }
}
/** My metric follows the focus player in Player Focus, otherwise the favourite team. */
export function focusOwner(data: MatchData, preferences: Preferences): { teamId: string; playerId: string | null; name: string } {
    const player = preferences.mode === "player" ? data.players.find(entry => entry.player_id === preferences.player) : undefined;
    if (player) return { teamId: player.team_id, playerId: player.player_id, name: player.name };
    const team = data.teams.find(entry => entry.team_id === preferences.team) ?? data.teams.find(entry => entry.team_id === data.match.home_team_id)!;
    return { teamId: team.team_id, playerId: null, name: team.name };
}

/** Every cue the processed prefix has produced so far, ordered by start time then priority. */
export function buildCues(data: MatchData, events: readonly MatchEvent[], elapsed: number, preferences: Preferences): OverlayCue[] {
    const language = preferences.language, units = preferences.units ?? "metric", mode = preferences.mode;
    const t = (key: string, values?: Record<string, string | number>) => values ? tr(language, key, values) : tr(language, key);
    const homeId = data.match.home_team_id, awayId = data.match.away_team_id;
    const teamName = (id: string | null) => data.teams.find(team => team.team_id === id)?.name ?? id ?? "";
    const playerName = (id: string | null) => data.players.find(player => player.player_id === id)?.name ?? id ?? "";
    const favorites = new Set([preferences.player, ...preferences.favorites ?? []].filter(Boolean));
    const cues: OverlayCue[] = [];
    const cue = (entry: Omit<OverlayCue, "teamId" | "playerId" | "detail" | "values"> & Partial<OverlayCue>) => cues.push({ teamId: null, playerId: null, detail: null, values: {}, ...entry });
    const reached = events.filter(event => event.match_time_seconds <= elapsed);

    const score = new Map([[homeId, 0], [awayId, 0]]);
    for (const event of reached) if (event.type === "shot" && event.outcome === "goal" && event.team_id) score.set(event.team_id, (score.get(event.team_id) ?? 0) + 1);
    cue({ id: "scorebug", kind: "scorebug", eventId: null, in: 0, out: data.match.duration_seconds, priority: PRIORITY.scorebug, text: `${teamName(homeId)} ${score.get(homeId)}–${score.get(awayId)} ${teamName(awayId)}`, values: { home: teamName(homeId), away: teamName(awayId), homeGoals: score.get(homeId)!, awayGoals: score.get(awayId)! } });

    const insights = ruleBasedProvider.generate(data, reached, elapsed, { preferences });
    const running = new Map([[homeId, 0], [awayId, 0]]);
    for (const event of reached) {
        if (event.type !== "shot" || event.outcome !== "goal" || !event.team_id) continue;
        running.set(event.team_id, (running.get(event.team_id) ?? 0) + 1);
        const context = insights.find(insight => insight.rule === "goal_context" && insight.eventIds.at(-1) === event.event_id);
        cue({
            id: `goal:${event.event_id}`, kind: "lower_third", eventId: event.event_id, in: event.match_time_seconds, out: event.match_time_seconds + LOWER_THIRD_SECONDS,
            priority: PRIORITY.goal + (event.team_id === preferences.team ? FAVORITE_BOOST : 0), teamId: event.team_id, playerId: event.player_id,
            text: `${t("goal")} ${playerName(event.player_id)}`, detail: context ? mode === "casual" ? context.casual : context.explanation : null,
            values: { score: `${running.get(homeId)}–${running.get(awayId)}`, team: teamName(event.team_id), ...context ? { headline: context.headline } : {} },
        });
    }
    for (const insight of insights) {
        if (insight.rule === "goal_context") continue;
        if (insight.rule === "player" ? !insight.playerId || !favorites.has(insight.playerId) : mode === "casual" && !CASUAL_RULES.has(insight.rule)) continue;
        cue({
            id: `insight:${insight.id}`, kind: "insight", eventId: insight.eventIds.at(-1) ?? null, in: insight.at, out: insight.at + INSIGHT_SECONDS,
            priority: (PRIORITY[insight.rule] ?? 40) + (insight.teamId === preferences.team ? FAVORITE_BOOST : 0), teamId: insight.teamId, playerId: insight.playerId ?? null,
            text: insight.headline, detail: mode === "casual" ? insight.casual : insight.explanation,
            values: Object.fromEntries(insight.metrics.map(metric => [metric.label, metric.value])),
        });
    }
    for (const highlight of buildHighlights(reached)) {
        cue({
            id: `tag:${highlight.eventId}`, kind: "player_tag", eventId: highlight.eventId, in: highlight.at, out: highlight.at + HIGHLIGHT_SECONDS,
            priority: PRIORITY.player_tag + (favorites.has(highlight.playerId) ? FAVORITE_BOOST : 0), teamId: highlight.teamId, playerId: highlight.playerId,
            text: playerName(highlight.playerId), detail: highlightText(highlight, language, units), values: { kind: highlight.kind, value: highlight.value },
        });
    }
    for (let at = STAT_POP_EVERY; at <= elapsed && at <= data.match.duration_seconds; at += STAT_POP_EVERY) {
        const stats = aggregate(data, reached.slice(0, countReached(reached, at, at > data.match.period_seconds)));
        const [home, away] = [stats.teams[homeId], stats.teams[awayId]];
        const [homeQ, awayQ] = [stats.quality.teams[homeId], stats.quality.teams[awayId]];
        const pair = (label: string, left: string | number, right: string | number) => `${label} ${left}–${right}`;
        const lines = mode === "casual"
            ? [pair(t("shots2"), home.shots, away.shots), pair(t("shotsOnTarget"), home.shots_on_target, away.shots_on_target)]
            : [pair(t("shots2"), home.shots, away.shots), pair(t("passAccuracy"), `${accuracy(home).toFixed(1)}%`, `${accuracy(away).toFixed(1)}%`), ...homeQ.pass_distance_count && awayQ.pass_distance_count ? [pair(t("averagePassDistance"), distanceText(averagePassDistance(homeQ), units), distanceText(averagePassDistance(awayQ), units))] : []];
        cue({
            id: `stats:${at}`, kind: "stat_pop", eventId: null, in: at, out: at + STAT_POP_SECONDS, priority: PRIORITY.stat_pop,
            text: t("cueStatsAt", { time: `${Math.round(at / 60)}'` }), detail: lines.join(" · "),
            values: { homeShots: home.shots, awayShots: away.shots, homeOnTarget: home.shots_on_target, awayOnTarget: away.shots_on_target, homePassAccuracy: Number(accuracy(home).toFixed(1)), awayPassAccuracy: Number(accuracy(away).toFixed(1)) },
        });
    }
    if (preferences.metric) {
        const metric = preferences.metric, owner = focusOwner(data, preferences);
        const m = emptyMetrics(), q = emptyQuality();
        let last = 0;
        for (const event of reached) {
            if (event.team_id !== owner.teamId || (owner.playerId !== null && event.player_id !== owner.playerId)) continue;
            addEvent(m, event);
            addQuality(q, event);
            const now = focusNumber(metric, m, q), step = MILESTONES[metric];
            const milestone = step ? Math.floor(now / step) > Math.floor(last / step) : metric === "fastest_shot" && now > last && q.shot_speed_count > 1;
            if (milestone) cue({
                id: `milestone:${metric}:${event.event_id}`, kind: "stat_pop", eventId: event.event_id, in: event.match_time_seconds, out: event.match_time_seconds + STAT_POP_SECONDS,
                priority: PRIORITY.milestone, teamId: owner.teamId, playerId: owner.playerId, text: owner.name, detail: `${focusMetricLabel(metric, language)}: ${focusMetricText(metric, m, q, units)}`, values: { metric, value: focusMetricText(metric, m, q, units) },
            });
            last = now;
        }
        cue({
            id: `my-metric:${metric}:${owner.playerId ?? owner.teamId}`, kind: "my_metric", eventId: null, in: 0, out: data.match.duration_seconds, priority: PRIORITY.my_metric,
            teamId: owner.teamId, playerId: owner.playerId, text: focusMetricLabel(metric, language), detail: owner.name, values: { metric, value: focusMetricText(metric, m, q, units), owner: owner.name },
        });
    }
    return cues.sort((left, right) => left.in - right.in || right.priority - left.priority || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/**
 * The latest clock at which the cue list can change: the last reached event or stat-pop checkpoint. Building cues
 * at this clock gives the same list as at `at`, so renderers can memoize between ticks.
 */
export const cueClock = (events: readonly MatchEvent[], at: number): number => Math.max(events.at(-1)?.match_time_seconds ?? 0, Math.floor(at / STAT_POP_EVERY) * STAT_POP_EVERY);

/** Cues on screen at a match second, most important first. */
export function activeCues(cues: readonly OverlayCue[], at: number): OverlayCue[] {
    return cues.filter(cue => cue.in <= at && at < cue.out).sort((left, right) => right.priority - left.priority);
}

const MODES: readonly ViewMode[] = ["casual", "analyst", "player"];
/**
 * Viewer preferences from URL parameters (lang, mode, team, player, metric, units), for the cue API and the
 * standalone broadcast view. Unknown values fall back to defaults instead of failing.
 */
export function preferencesFromQuery(data: MatchData, get: (name: string) => string | null): Preferences {
    const option = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => allowed.includes(get(name) as T) ? get(name) as T : fallback;
    const language = get("lang"), mode = option("mode", MODES, "analyst");
    const team = option("team", data.teams.map(entry => entry.team_id), data.match.home_team_id);
    const player = option("player", data.players.map(entry => entry.player_id), mode === "player" ? data.players.find(entry => entry.team_id === team && entry.position !== "GK")?.player_id ?? "" : "");
    return {
        mode, language: isLocale(language) ? language : "en", team, player,
        metric: option<FocusMetric | "">("metric", FOCUS_METRICS, "") || null,
        units: option("units", ["metric", "imperial"] as const, "metric"),
    };
}

