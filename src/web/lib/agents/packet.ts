import { isKeyMoment, isMeaningful } from "@/lib/match/commentary";
import { translate } from "@/lib/i18n/translate";
import { ruleBasedProvider } from "@/lib/match/insights";
import { formatTime, pitchPosition, type MatchStatus } from "@/lib/match/playback";
import { accuracy, addEvent, addQuality, emptyMetrics, emptyQuality } from "@/lib/match/statistics";
import type { Insight, Language, MatchData, MatchEvent, Metrics, Position, Preferences, Quality } from "@/lib/match/types";
import type { Bilingual } from "./contracts";

const BLOCK_SECONDS = 900;
const RECENT_LIMIT = 30;
const KEY_MOMENT_LIMIT = 12;
const RULE_INSIGHT_LIMIT = 8;
const RULE_EVIDENCE_LIMIT = 20;

export const THIRDS = ["defensive", "middle", "attacking"] as const;
export const FLANKS = ["top", "centre", "bottom"] as const;
export const ZONE_TYPES = ["passes", "shots", "recoveries", "turnovers", "pressures"] as const;
export type Third = (typeof THIRDS)[number];
export type Flank = (typeof FLANKS)[number];
export type ZoneType = (typeof ZONE_TYPES)[number];
const COUNTED = ["goals", "shots", "shots_on_target", "passes_attempted", "passes_completed", "tackles_won", "pressure_events", "actions"] as const satisfies readonly (keyof Metrics)[];
const QUALITY_COUNTED = ["long_passes_attempted", "long_passes_completed", "difficult_passes_attempted", "difficult_passes_completed"] as const satisfies readonly (keyof Quality)[];
/** Averages and maxima of the dataset's synthetic per-event values. Emitted only once an owner has a sample. */
const SAMPLED = ["avg_pass_distance", "avg_ball_speed", "avg_shot_speed", "max_shot_speed"] as const;
type SampledName = (typeof SAMPLED)[number];
type MetricName = (typeof COUNTED)[number] | (typeof QUALITY_COUNTED)[number] | SampledName | "pass_accuracy" | "high_pressure" | "recoveries" | "turnovers";
const QUALITY_TOTALS: readonly MetricName[] = [...QUALITY_COUNTED, ...SAMPLED];
const TEAM_TOTALS: readonly MetricName[] = ["goals", "shots", "shots_on_target", "passes_attempted", "passes_completed", "pass_accuracy", "tackles_won", "pressure_events", "high_pressure", "recoveries", "turnovers", ...QUALITY_TOTALS];
const BLOCK_METRICS: readonly MetricName[] = ["goals", "shots", "shots_on_target", "passes_attempted", "passes_completed", "pass_accuracy", "pressure_events", "recoveries", "turnovers"];
const PLAYER_TOTALS: readonly MetricName[] = ["actions", "goals", "shots", "shots_on_target", "passes_attempted", "passes_completed", "pass_accuracy", "tackles_won", "pressure_events", "recoveries", ...QUALITY_TOTALS];

const b = (en: string, fil: string): Bilingual => ({ en, fil });
const LABELS: Record<MetricName, Bilingual> = {
    goals: b("Goals", "Mga gol"),
    shots: b("Shots", "Mga tira"),
    shots_on_target: b("Shots on target", "Mga tirang sa target"),
    passes_attempted: b("Passes attempted", "Mga sinubukang pasa"),
    passes_completed: b("Passes completed", "Mga kumpletong pasa"),
    pass_accuracy: b("Pass accuracy", "Katumpakan ng pasa"),
    tackles_won: b("Tackles won", "Mga matagumpay na agaw"),
    pressure_events: b("Pressure events", "Mga pagdiin"),
    high_pressure: b("High-intensity pressure", "Mataas na pagdiin"),
    recoveries: b("Recoveries (interceptions and tackles)", "Mga pagbawi (interception at tackle)"),
    turnovers: b("Ball losses (interceptions and tackles)", "Mga nawalang bola (interception at tackle)"),
    actions: b("Recorded actions", "Naitalang aksyon"),
    long_passes_attempted: b("Long passes attempted (20 m or more)", "Mga sinubukang mahabang pasa (20 m pataas)"),
    long_passes_completed: b("Long passes completed (20 m or more)", "Mga kumpletong mahabang pasa (20 m pataas)"),
    difficult_passes_attempted: b("Difficult passes attempted (illustrative difficulty 0.3 or more)", "Mga sinubukang mahirap na pasa (ilustratibong hirap 0.3 pataas)"),
    difficult_passes_completed: b("Difficult passes completed (illustrative difficulty 0.3 or more)", "Mga kumpletong mahirap na pasa (ilustratibong hirap 0.3 pataas)"),
    avg_pass_distance: b("Average pass distance (synthetic)", "Karaniwang haba ng pasa (synthetic)"),
    avg_ball_speed: b("Average ball speed on passes (synthetic)", "Karaniwang bilis ng bola sa pasa (synthetic)"),
    avg_shot_speed: b("Average shot speed (synthetic)", "Karaniwang bilis ng tira (synthetic)"),
    max_shot_speed: b("Fastest shot (synthetic)", "Pinakamabilis na tira (synthetic)"),
};
const METRIC_KEYS: Record<MetricName, string> = {
    goals: "agentMetricGoals", shots: "agentMetricShots", shots_on_target: "agentMetricShotsOnTarget",
    passes_attempted: "agentMetricPassesAttempted", passes_completed: "agentMetricPassesCompleted",
    pass_accuracy: "agentMetricPassAccuracy", tackles_won: "agentMetricTacklesWon",
    pressure_events: "agentMetricPressureEvents", high_pressure: "agentMetricHighPressure",
    recoveries: "agentMetricRecoveries", turnovers: "agentMetricTurnovers", actions: "agentMetricActions",
    long_passes_attempted: "agentMetricLongPassesAttempted", long_passes_completed: "agentMetricLongPassesCompleted",
    difficult_passes_attempted: "agentMetricDifficultPassesAttempted", difficult_passes_completed: "agentMetricDifficultPassesCompleted",
    avg_pass_distance: "agentMetricAvgPassDistance", avg_ball_speed: "agentMetricAvgBallSpeed",
    avg_shot_speed: "agentMetricAvgShotSpeed", max_shot_speed: "agentMetricMaxShotSpeed",
};
const ZONE_LABELS: Record<ZoneType, Bilingual> = {
    passes: b("Passes started", "Mga pasang nagsimula"),
    shots: b("Shots", "Mga tira"),
    recoveries: b("Recoveries", "Mga pagbawi"),
    turnovers: b("Ball losses", "Mga nawalang bola"),
    pressures: b("Pressure events", "Mga pagdiin"),
};
const ZONE_KEYS: Record<ZoneType, string> = { passes: "agentZonePasses", shots: "agentZoneShots", recoveries: "agentZoneRecoveries", turnovers: "agentZoneTurnovers", pressures: "agentZonePressures" };
const THIRD_LABELS: Record<Third, Bilingual> = { defensive: b("defensive third", "defensive third"), middle: b("middle third", "middle third"), attacking: b("attacking third", "attacking third") };
const FLANK_LABELS: Record<Flank, Bilingual> = { top: b("top flank", "itaas na gilid"), centre: b("centre channel", "gitnang daan"), bottom: b("bottom flank", "ibabang gilid") };
const THIRD_KEYS: Record<Third, string> = { defensive: "agentThirdDefensive", middle: "agentThirdMiddle", attacking: "agentThirdAttacking" };
const FLANK_KEYS: Record<Flank, string> = { top: "agentFlankTop", centre: "agentFlankCentre", bottom: "agentFlankBottom" };

/** Team-relative x, with the same attacking-third boundary as the rule-based recovery insight. */
export const thirdOf = (x: number): Third => x >= 66.67 ? "attacking" : x > 33.33 ? "middle" : "defensive";
/** Display y (after pitchPosition), so "top" and "bottom" match the studio pitch for both teams. */
export const flankOf = (y: number): Flank => y <= 33.33 ? "top" : y >= 66.67 ? "bottom" : "centre";
export const locationOf = (event: MatchEvent): Position | undefined => event.type === "pass" ? event.start_position ?? event.position : event.position;
/** Interceptions and tackles only, as in the rule-based recovery insight. Shot-end changes never count. */
export const isRecovery = (event: MatchEvent): boolean => event.type === "possession_change" && (event.reason === "interception" || event.reason === "tackle");

export interface ZoneEntry { owner: string; type: ZoneType; third: Third; flank: Flank }
/** Zone entries for one event with a recorded location: the owning team, its third (owner-relative) and the drawn flank. */
export function zonesOf(event: MatchEvent, homeId: string, isTeam: (teamId: string) => boolean): ZoneEntry[] {
    const location = locationOf(event);
    if (!location || event.team_id === null || !isTeam(event.team_id)) return [];
    const flank = flankOf(pitchPosition(location, event.team_id, homeId).y);
    const own = (type: ZoneType): ZoneEntry => ({ owner: event.team_id!, type, third: thirdOf(location.x), flank });
    if (event.type === "pass") return [own("passes")];
    if (event.type === "shot") return [own("shots")];
    if (event.type === "pressure") return [own("pressures")];
    if (!isRecovery(event)) return [];
    const loser = event.from_team_id;
    // Positions use the recovering team's coordinates: the losing team's third rotates x; the drawn flank is shared.
    return loser && loser !== event.team_id && isTeam(loser) ? [own("recoveries"), { owner: loser, type: "turnovers", third: thirdOf(100 - location.x), flank }] : [own("recoveries")];
}

/** 15-minute blocks. An event exactly on the half-time or full-time boundary closes the block it ends. */
function blockOf(event: MatchEvent, data: MatchData): number {
    const t = event.match_time_seconds;
    const closing = t > 0 && ((event.period === 1 && t === data.match.period_seconds) || t === data.match.duration_seconds);
    return Math.floor((closing ? t - 1 : t) / BLOCK_SECONDS) + 1;
}

/** `evidence` lists every supporting reached event, oldest first. */
export interface CatalogMetric { label: string; value: string; evidence: readonly string[]; from: number; to: number; teamId?: string; playerId?: string }
export interface PacketEvent {
    event_id: string; time: string; period: 1 | 2; type: string;
    team_id: string | null; player_id: string | null; player: string | null;
    result: string | null; zone: string | null;
    recipient?: string; target?: string; from_team_id?: string;
}
export interface PacketContext { elapsed: number; status: MatchStatus; secondHalf: boolean; preferences?: Preferences }
/** `facts` is the only part the model sees. Labels, evidence and validation sets stay on the server. */
export interface MatchPacket {
    facts: Record<string, unknown>;
    catalog: ReadonlyMap<string, CatalogMetric>;
    describe: (event: MatchEvent) => PacketEvent;
    /** Reached event ID → prefix index; anything absent is unknown or in the future. */
    order: ReadonlyMap<string, number>;
    names: readonly string[];
    teams: ReadonlyMap<string, string>;
    playerTeams: ReadonlyMap<string, string>;
    elapsed: number; cursor: number; status: MatchStatus;
    language: Language;
}

class Tally {
    readonly ids: string[] = [];
    add(id: string): void { this.ids.push(id); }
}
class Sample {
    readonly ids: string[] = [];
    total = 0;
    max = -Infinity;
    maxId = "";
    add(value: number, id: string): void {
        this.ids.push(id);
        this.total += value;
        if (value > this.max) { this.max = value; this.maxId = id; }
    }
}
const SAMPLE_SOURCE: Record<SampledName, { total: keyof Quality; count: keyof Quality; unit: string; max?: true }> = {
    avg_pass_distance: { total: "pass_distance_total", count: "pass_distance_count", unit: "m" },
    avg_ball_speed: { total: "ball_speed_total", count: "ball_speed_count", unit: "km/h" },
    avg_shot_speed: { total: "shot_speed_total", count: "shot_speed_count", unit: "km/h" },
    max_shot_speed: { total: "shot_speed_total", count: "shot_speed_count", unit: "km/h", max: true },
};

/**
 * Deterministic features over the processed prefix only. Values reuse the statistics reducers (addEvent and
 * addQuality), so every AI-cited number matches the Stats tab. Pass distances and ball and shot speeds are the
 * dataset's synthetic per-event values, aggregated as supplied. No possession share, durations, running data,
 * xG or difficulty values are derived or exposed. Each event is visited once: O(n + metrics).
 */
export function buildMatchPacket(data: MatchData, events: readonly MatchEvent[], context: PacketContext): MatchPacket {
    const { elapsed } = context;
    const language = context.preferences?.language ?? "en";
    const t = (key: string, values?: Record<string, string>) => translate(language, key, values);
    const metricText = (metric: MetricName) => language === "en" || language === "fil" ? LABELS[metric][language] : t(METRIC_KEYS[metric]);
    const zoneText = (zone: ZoneType) => language === "en" || language === "fil" ? ZONE_LABELS[zone][language] : t(ZONE_KEYS[zone]);
    const thirdText = (third: Third) => language === "en" || language === "fil" ? THIRD_LABELS[third][language] : t(THIRD_KEYS[third]);
    const flankText = (flank: Flank) => language === "en" || language === "fil" ? FLANK_LABELS[flank][language] : t(FLANK_KEYS[flank]);
    const homeId = data.match.home_team_id;
    const teams = new Map(data.teams.map(team => [team.team_id, team.name]));
    const players = new Map(data.players.map(player => [player.player_id, player]));
    const playerName = (id: string | null | undefined): string | null => id ? players.get(id)?.name ?? id : null;
    const tallies = new Map<string, Tally>();
    const tally = (key: string): Tally => {
        let found = tallies.get(key);
        if (!found) tallies.set(key, found = new Tally());
        return found;
    };
    const ids = (key: string): string[] => tallies.get(key)?.ids ?? [];
    const samples = new Map<string, Sample>();
    const sample = (key: string, value: number, id: string): void => {
        let found = samples.get(key);
        if (!found) samples.set(key, found = new Sample());
        found.add(value, id);
    };
    let blockCount = Math.ceil(elapsed / BLOCK_SECONDS);

    for (const event of events) {
        const teamId = event.team_id;
        if (teamId === null || !teams.has(teamId)) continue;
        const id = event.event_id;
        const block = blockOf(event, data);
        blockCount = Math.max(blockCount, block);
        const player = event.player_id !== null && players.has(event.player_id) ? event.player_id : null;
        const delta = emptyMetrics();
        addEvent(delta, event);
        for (const metric of COUNTED) {
            if (!delta[metric]) continue;
            if (metric !== "actions") {
                tally(`${teamId}.total.${metric}`).add(id);
                tally(`${teamId}.b${block}.${metric}`).add(id);
            }
            if (player) tally(`${player}.total.${metric}`).add(id);
        }
        const quality = emptyQuality();
        addQuality(quality, event);
        for (const metric of QUALITY_COUNTED) {
            if (!quality[metric]) continue;
            tally(`${teamId}.total.${metric}`).add(id);
            if (player) tally(`${player}.total.${metric}`).add(id);
        }
        for (const metric of SAMPLED) {
            const source = SAMPLE_SOURCE[metric];
            if (!quality[source.count]) continue;
            sample(`${teamId}.total.${metric}`, quality[source.total], id);
            if (player) sample(`${player}.total.${metric}`, quality[source.total], id);
        }
        if (event.type === "pressure" && event.intensity === "high") tally(`${teamId}.total.high_pressure`).add(id);
        const loser = isRecovery(event) && event.from_team_id && event.from_team_id !== teamId && teams.has(event.from_team_id) ? event.from_team_id : null;
        if (isRecovery(event)) {
            tally(`${teamId}.total.recoveries`).add(id);
            tally(`${teamId}.b${block}.recoveries`).add(id);
            if (player) tally(`${player}.total.recoveries`).add(id);
        }
        if (loser) {
            tally(`${loser}.total.turnovers`).add(id);
            tally(`${loser}.b${block}.turnovers`).add(id);
        }
        for (const zone of zonesOf(event, homeId, team => teams.has(team))) {
            tally(`${zone.owner}.zone.${zone.type}.${zone.third}`).add(id);
            tally(`${zone.owner}.zone.${zone.type}.${zone.flank}`).add(id);
        }
    }

    const catalog = new Map<string, CatalogMetric>();
    const named = (label: string, owner: string, suffix?: string): string => suffix === undefined
        ? t("agentLabelOwner", { metric: label, owner })
        : t("agentLabelWindow", { metric: label, window: suffix, owner });
    const emit = (key: string, label: string, value: string, evidence: string[], from: number, to: number, owner: { teamId?: string; playerId?: string }) => {
        catalog.set(key, { label, value, evidence, from, to, ...owner });
    };
    const emitMetric = (prefix: string, metric: MetricName, label: string, from: number, to: number, owner: { teamId?: string; playerId?: string }) => {
        if ((SAMPLED as readonly string[]).includes(metric)) {
            const found = samples.get(`${prefix}.${metric}`), source = SAMPLE_SOURCE[metric as SampledName];
            if (!found) return;
            const value = source.max ? found.max : found.total / found.ids.length;
            emit(`${prefix}.${metric}`, label, `${value.toFixed(1)} ${source.unit}`, source.max ? [found.maxId] : found.ids, from, to, owner);
        } else if (metric === "pass_accuracy") {
            const attempted = ids(`${prefix}.passes_attempted`);
            // No attempts means no rate, not 0%: like the sampled values, the metric is left out.
            if (!attempted.length) return;
            const rate = accuracy({ ...emptyMetrics(), passes_attempted: attempted.length, passes_completed: ids(`${prefix}.passes_completed`).length });
            emit(`${prefix}.${metric}`, label, `${rate.toFixed(1)}%`, attempted, from, to, owner);
        } else emit(`${prefix}.${metric}`, label, String(ids(`${prefix}.${metric}`).length), ids(`${prefix}.${metric}`), from, to, owner);
    };
    for (const team of data.teams) {
        const owner = { teamId: team.team_id };
        for (const metric of TEAM_TOTALS) emitMetric(`${team.team_id}.total`, metric, named(metricText(metric), team.name), 0, elapsed, owner);
        for (let block = 1; block <= blockCount; block++) {
            const from = (block - 1) * BLOCK_SECONDS, to = Math.max(from, Math.min(block * BLOCK_SECONDS, elapsed));
            const window = `${formatTime(from)}–${formatTime(to)}`;
            for (const metric of BLOCK_METRICS) emitMetric(`${team.team_id}.b${block}`, metric, named(metricText(metric), team.name, window), from, to, owner);
        }
        for (const type of ZONE_TYPES) {
            for (const third of THIRDS) {
                const key = `${team.team_id}.zone.${type}.${third}`;
                emit(key, t("agentLabelInThird", { metric: zoneText(type), area: thirdText(third), owner: team.name }), String(ids(key).length), ids(key), 0, elapsed, owner);
            }
            for (const flank of FLANKS) {
                const key = `${team.team_id}.zone.${type}.${flank}`;
                emit(key, t("agentLabelOnFlank", { metric: zoneText(type), area: flankText(flank), owner: team.name }), String(ids(key).length), ids(key), 0, elapsed, owner);
            }
        }
    }
    for (const player of data.players) {
        if (!tallies.has(`${player.player_id}.total.actions`)) continue;
        const owner = { teamId: player.team_id, playerId: player.player_id };
        for (const metric of PLAYER_TOTALS) emitMetric(`${player.player_id}.total`, metric, named(metricText(metric), player.name), 0, elapsed, owner);
    }

    const describe = (event: MatchEvent): PacketEvent => {
        const location = locationOf(event);
        return {
            event_id: event.event_id, time: formatTime(event.match_time_seconds), period: event.period, type: event.type,
            team_id: event.team_id, player_id: event.player_id, player: playerName(event.player_id),
            result: event.outcome ?? event.reason ?? event.intensity ?? null,
            zone: location && event.team_id ? `${thirdText(thirdOf(location.x))}, ${flankText(flankOf(pitchPosition(location, event.team_id, homeId).y))}` : null,
            ...(event.recipient_player_id ? { recipient: playerName(event.recipient_player_id)! } : {}),
            ...(event.target_player_id ? { target: playerName(event.target_player_id)! } : {}),
            ...(event.from_team_id ? { from_team_id: event.from_team_id } : {}),
        };
    };
    const moments = events.filter(isKeyMoment);
    const goals = moments.filter(event => event.outcome === "goal");
    const keyMoments = [...goals, ...moments.filter(event => event.outcome !== "goal").slice(-KEY_MOMENT_LIMIT)].sort((left, right) => left.sequence - right.sequence);
    const recent: MatchEvent[] = [];
    for (let index = events.length - 1; index >= 0 && recent.length < RECENT_LIMIT; index--) {
        if (events[index].team_id !== null && isMeaningful(events[index])) recent.unshift(events[index]);
    }
    const latestRules = new Map<string, Insight>();
    for (const insight of ruleBasedProvider.generate(data, events, elapsed, { preferences: context.preferences })) latestRules.set(`${insight.rule}:${insight.teamId}:${insight.playerId ?? ""}`, insight);
    const ruleInsights = [...latestRules.values()].sort((left, right) => right.at - left.at).slice(0, RULE_INSIGHT_LIMIT);
    const score = Object.fromEntries(data.teams.map(team => [team.team_id, ids(`${team.team_id}.total.goals`).length]));

    const facts: Record<string, unknown> = {
        match: {
            synthetic: data.synthetic === true,
            fictional_roster: data.players.some(player => player.fictional === true),
            half_time_at: formatTime(data.match.period_seconds),
            full_time_at: formatTime(data.match.duration_seconds),
        },
        clock: { elapsed: formatTime(elapsed), period: context.secondHalf ? 2 : 1, status: context.status, reached_events: events.length },
        teams: data.teams.map(team => ({ team_id: team.team_id, name: team.name, side: team.team_id === homeId ? "home" : "away" })),
        score,
        roster: data.players.map(player => ({ player_id: player.player_id, name: player.name, team_id: player.team_id, ...(player.position ? { position: player.position } : {}) })),
        // Labels give the model plain words for each number, so keys stay out of its prose.
        metrics: Object.fromEntries([...catalog].map(([key, metric]) => [key, { label: metric.label, value: metric.value }])),
        metric_glossary: {
            key_format: "<team_id or player_id>.<scope>.<metric>; keys are for metric_keys only, and text uses the label wording",
            total: "from kick-off to the current clock",
            blocks: "b1, b2, … are 15-minute blocks (b1 is 00:00–15:00); the latest block ends at the current clock",
            zones: "<team_id>.zone.<type>.<area> counts that team's events with a recorded location in that area",
            areas: "defensive, middle and attacking third are relative to the team's own attacking direction; top flank, centre channel and bottom flank are as drawn on the studio pitch",
            recoveries: "possession won by interception or tackle; turnovers are the same events counted for the team that lost the ball",
            pass_accuracy: "passes completed divided by passes attempted, already formatted",
            pass_quality: "long passes are 20 m or more; difficult passes have an illustrative difficulty of 0.3 or more, which is not a completion probability",
            synthetic_values: "pass distances, ball speeds and shot speeds are synthetic values sampled by the dataset, not tracking measurements; say so when citing them, and never describe player running speed or distance",
        },
        key_moments: keyMoments.map(describe),
        recent_events: recent.map(describe),
        rule_insights: ruleInsights.map(insight => ({
            rule: insight.rule, team_id: insight.teamId, player_id: insight.playerId ?? null,
            window: `${formatTime(insight.from)}–${formatTime(insight.at)}`,
            headline: insight.headline, observed: insight.explanation, interpretation: insight.interpretation,
            event_ids: insight.eventIds.slice(-RULE_EVIDENCE_LIMIT),
        })),
        ...(context.preferences ? { viewer: { language, mode: context.preferences.mode, favourite_team_id: context.preferences.team, focus_player_id: context.preferences.player || null } } : {}),
    };

    return {
        facts, catalog, describe,
        order: new Map(events.map((event, index) => [event.event_id, index])),
        names: [...data.teams.map(team => team.name), ...data.players.map(player => player.name)],
        teams,
        playerTeams: new Map(data.players.map(player => [player.player_id, player.team_id])),
        elapsed, cursor: events.length, status: context.status, language,
    };
}
