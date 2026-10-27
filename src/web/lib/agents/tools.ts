import { formatTime } from "@/lib/match/playback";
import { accuracy, aggregate, averageBallSpeed, averagePassDistance, averageShotSpeed } from "@/lib/match/statistics";
import { EVENT_TYPES, type MatchData, type MatchEvent } from "@/lib/match/types";
import { FLANKS, THIRDS, ZONE_TYPES, isRecovery, zonesOf, type Flank, type MatchPacket, type Third, type ZoneType } from "./packet";

/** Function tools run inside PitchPulse, never in Foundry, and see only the processed prefix. */
export interface FunctionToolDefinition { type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: true }
export interface ToolContext { data: MatchData; events: readonly MatchEvent[]; packet: MatchPacket }

const ROW_LIMIT = 50;
const DEFAULT_ROWS = 20;
const TOOL_EVIDENCE = 20;
const WINDOWS = [300, 600, 900] as const;
const COMPARABLE = ["goals", "shots", "shots_on_target", "passes_attempted", "passes_completed", "pass_accuracy", "pressure_events", "recoveries", "turnovers", "long_passes_completed", "difficult_passes_completed"] as const;

const seconds = { type: ["number", "null"], description: "Seconds from kick-off, or null" };
const tool = (name: string, description: string, properties: Record<string, unknown>): FunctionToolDefinition => ({
    type: "function", name, description, strict: true,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});

export const ASK_TOOLS: FunctionToolDefinition[] = [
    tool("get_match_context", "Every reached-match metric (key → formatted value) with its glossary, key moments, recent meaningful events and PitchPulse's rule-based insights.", {}),
    tool("get_stats", "Recorded statistics for one team or player in a time window: after from_seconds up to and including to_seconds. Kick-off events count when from_seconds is 0 or null; null to_seconds means the current clock. Pass distances and ball and shot speeds are synthetic dataset values (null when none were recorded); long passes are 20 m or more and difficult passes have an illustrative difficulty of 0.3 or more.", {
        scope: { type: "string", enum: ["team", "player"] },
        id: { type: "string", description: "team_id or player_id" },
        from_seconds: seconds,
        to_seconds: seconds,
    }),
    tool("query_events", "Reached events matching every given filter, oldest first. Returns the number of matches and the latest rows.", {
        types: { type: ["array", "null"], items: { type: "string", enum: [...EVENT_TYPES] } },
        team_id: { type: ["string", "null"] },
        player_id: { type: ["string", "null"] },
        result: { type: ["string", "null"], description: "Outcome, reason or intensity, for example goal, saved, intercepted, interception or high" },
        from_seconds: seconds,
        to_seconds: seconds,
        limit: { type: ["integer", "null"], description: "1–50 rows, default 20" },
    }),
    tool("zone_breakdown", "Where a team's events of one type happened: counts by third (relative to that team) and by flank (as drawn on the studio pitch). Only events with a recorded location count.", {
        team_id: { type: "string" },
        event_type: { type: "string", enum: [...ZONE_TYPES] },
        from_seconds: seconds,
        to_seconds: seconds,
    }),
    tool("compare_windows", "Compare a team's most recent window with the equal window before it, ending at the current clock. Early in the match the windows are clipped at kick-off.", {
        team_id: { type: "string" },
        metric: { type: "string", enum: [...COMPARABLE] },
        window_seconds: { type: "integer", enum: [...WINDOWS] },
    }),
    tool("get_rule_insights", "PitchPulse's transparent rule-based insights so far, newest first.", {}),
];

class ToolArgumentError extends Error { }
const fail = (message: string): never => { throw new ToolArgumentError(message); };
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : fail("Arguments must be an object.");
const optionalText = (value: unknown, field: string): string | null => value === null || value === undefined ? null : typeof value === "string" ? value : fail(`${field} must be text or null.`);
const range = (from: number, to: number) => `${formatTime(from)}–${formatTime(to)}`;

/** Clamped to the reached clock: tools can never look beyond the processed prefix. */
function window(context: ToolContext, from: unknown, to: unknown): { from: number; to: number } {
    const elapsed = context.packet.elapsed;
    const read = (value: unknown, fallback: number, field: string) => value === null || value === undefined ? fallback : typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(value, elapsed)) : fail(`${field} must be a number or null.`);
    const bounds = { from: read(from, 0, "from_seconds"), to: read(to, elapsed, "to_seconds") };
    return bounds.from > bounds.to ? fail("from_seconds must not be after to_seconds.") : bounds;
}
const within = (event: MatchEvent, bounds: { from: number; to: number }) => event.match_time_seconds <= bounds.to && (event.match_time_seconds > bounds.from || bounds.from === 0);

function teamId(context: ToolContext, value: unknown): string {
    return typeof value === "string" && context.packet.teams.has(value) ? value : fail("Unknown team_id.");
}
function statsOf(context: ToolContext, scope: "team" | "player", id: string, events: readonly MatchEvent[]) {
    const stats = aggregate(context.data, events);
    const metrics = scope === "team" ? stats.teams[id] : stats.players[id];
    const quality = scope === "team" ? stats.quality.teams[id] : stats.quality.players[id];
    const sampled = (count: number, value: number, unit: string) => count ? `${value.toFixed(1)} ${unit}` : null;
    const recoveries = events.filter(event => isRecovery(event) && (scope === "team" ? event.team_id === id : event.player_id === id)).length;
    return {
        ...(scope === "player" ? { actions: metrics.actions } : {}),
        goals: metrics.goals, shots: metrics.shots, shots_on_target: metrics.shots_on_target,
        passes_attempted: metrics.passes_attempted, passes_completed: metrics.passes_completed,
        pass_accuracy: `${accuracy(metrics).toFixed(1)}%`,
        tackles_won: metrics.tackles_won, pressure_events: metrics.pressure_events, recoveries,
        ...(scope === "team" ? { turnovers: events.filter(event => isRecovery(event) && event.from_team_id === id && event.team_id !== id).length } : {}),
        long_passes_attempted: quality.long_passes_attempted, long_passes_completed: quality.long_passes_completed,
        difficult_passes_attempted: quality.difficult_passes_attempted, difficult_passes_completed: quality.difficult_passes_completed,
        avg_pass_distance: sampled(quality.pass_distance_count, averagePassDistance(quality), "m"),
        avg_ball_speed: sampled(quality.ball_speed_count, averageBallSpeed(quality), "km/h"),
        avg_shot_speed: sampled(quality.shot_speed_count, averageShotSpeed(quality), "km/h"),
        max_shot_speed: sampled(quality.shot_speed_count, quality.shot_speed_max, "km/h"),
    };
}

function getStats(context: ToolContext, args: Record<string, unknown>) {
    const scope = args.scope === "team" || args.scope === "player" ? args.scope : fail("scope must be team or player.");
    const id = typeof args.id === "string" && (scope === "team" ? context.packet.teams.has(args.id) : context.packet.playerTeams.has(args.id)) ? args.id : fail(`Unknown ${scope} id.`);
    const bounds = window(context, args.from_seconds, args.to_seconds);
    const events = context.events.filter(event => within(event, bounds));
    const own = events.filter(event => scope === "team" ? event.team_id === id : event.player_id === id);
    return { scope, id, window: range(bounds.from, bounds.to), stats: statsOf(context, scope, id, events), event_ids: own.slice(-TOOL_EVIDENCE).map(event => event.event_id) };
}

function queryEvents(context: ToolContext, args: Record<string, unknown>) {
    const types = args.types === null || args.types === undefined ? null
        : Array.isArray(args.types) && args.types.every(type => (EVENT_TYPES as readonly unknown[]).includes(type)) ? new Set(args.types as string[]) : fail("types must list supported event types.");
    const team = args.team_id === null || args.team_id === undefined ? null : teamId(context, args.team_id);
    const player = optionalText(args.player_id, "player_id");
    if (player !== null && !context.packet.playerTeams.has(player)) fail("Unknown player_id.");
    const result = optionalText(args.result, "result");
    const limit = args.limit === null || args.limit === undefined ? DEFAULT_ROWS : Number.isInteger(args.limit) && (args.limit as number) >= 1 ? Math.min(args.limit as number, ROW_LIMIT) : fail("limit must be an integer from 1 to 50.");
    const bounds = window(context, args.from_seconds, args.to_seconds);
    const matches = context.events.filter(event => within(event, bounds)
        && (!types || types.has(event.type))
        && (team === null || event.team_id === team)
        && (player === null || event.player_id === player)
        && (result === null || (event.outcome ?? event.reason ?? event.intensity) === result));
    return { window: range(bounds.from, bounds.to), matches: matches.length, rows: matches.slice(-limit).map(context.packet.describe) };
}

function zoneBreakdown(context: ToolContext, args: Record<string, unknown>) {
    const team = teamId(context, args.team_id);
    const type = (ZONE_TYPES as readonly unknown[]).includes(args.event_type) ? args.event_type as ZoneType : fail("Unsupported event_type.");
    const bounds = window(context, args.from_seconds, args.to_seconds);
    const thirds = Object.fromEntries(THIRDS.map(third => [third, 0])) as Record<Third, number>;
    const flanks = Object.fromEntries(FLANKS.map(flank => [flank, 0])) as Record<Flank, number>;
    const ids: string[] = [];
    for (const event of context.events) {
        if (!within(event, bounds)) continue;
        for (const zone of zonesOf(event, context.data.match.home_team_id, id => context.packet.teams.has(id))) {
            if (zone.owner !== team || zone.type !== type) continue;
            thirds[zone.third]++;
            flanks[zone.flank]++;
            ids.push(event.event_id);
        }
    }
    return { team_id: team, event_type: type, window: range(bounds.from, bounds.to), located_events: ids.length, thirds, flanks, event_ids: ids.slice(-TOOL_EVIDENCE) };
}

function compareWindows(context: ToolContext, args: Record<string, unknown>) {
    const team = teamId(context, args.team_id);
    const metric = (COMPARABLE as readonly unknown[]).includes(args.metric) ? args.metric as (typeof COMPARABLE)[number] : fail("Unsupported metric.");
    const length = (WINDOWS as readonly unknown[]).includes(args.window_seconds) ? args.window_seconds as number : fail("window_seconds must be 300, 600 or 900.");
    const at = context.packet.elapsed, split = at - length, start = at - 2 * length;
    // Same disjoint windows as the rule-based insights: recent (at - w, at], previous (at - 2w, at - w].
    const recent = context.events.filter(event => event.match_time_seconds > split && event.match_time_seconds <= at);
    const previous = context.events.filter(event => event.match_time_seconds > start && event.match_time_seconds <= split);
    const value = (events: MatchEvent[]) => statsOf(context, "team", team, events)[metric];
    const evidence = (events: MatchEvent[]) => events.filter(event => event.team_id === team || event.from_team_id === team).slice(-TOOL_EVIDENCE).map(event => event.event_id);
    return {
        team_id: team, metric, clipped_at_kickoff: at < 2 * length,
        recent: { window: range(Math.max(0, split), at), value: value(recent), event_ids: evidence(recent) },
        previous: { window: range(Math.max(0, start), Math.max(0, split)), value: value(previous), event_ids: evidence(previous) },
    };
}

/** Invalid arguments come back as { error } so the model can correct its call; other failures propagate. */
export function executeTool(context: ToolContext, name: string, rawArguments: string): unknown {
    try {
        let parsed: unknown;
        try { parsed = rawArguments ? JSON.parse(rawArguments) : {}; } catch { return { error: "Arguments must be valid JSON." }; }
        const args = record(parsed);
        switch (name) {
            case "get_match_context": return context.packet.facts;
            case "get_stats": return getStats(context, args);
            case "query_events": return queryEvents(context, args);
            case "zone_breakdown": return zoneBreakdown(context, args);
            case "compare_windows": return compareWindows(context, args);
            case "get_rule_insights": return context.packet.facts.rule_insights;
            default: return { error: `Unknown tool: ${name}.` };
        }
    } catch (error) {
        if (error instanceof ToolArgumentError) return { error: error.message };
        throw error;
    }
}
