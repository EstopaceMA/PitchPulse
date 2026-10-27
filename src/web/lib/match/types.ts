export const EVENT_TYPES = ["match_start", "kickoff", "pass", "shot", "tackle", "pressure", "possession_change", "half_time", "second_half_start", "full_time"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type Language = "en" | "fil" | "es" | "pt-BR" | "id" | "ar" | "th";
export type ViewMode = "casual" | "analyst" | "player";
export type Units = "metric" | "imperial";
export type Position = { x: number; y: number };
export interface Team { team_id: string; name: string }
export interface Player { player_id: string; team_id: string; name: string; shirt_number?: number; position?: string; nationality?: string; fictional?: boolean }
export interface MatchEvent {
    event_id: string;
    sequence: number;
    match_time_seconds: number;
    period: 1 | 2;
    type: EventType;
    team_id: string | null;
    player_id: string | null;
    possession_id: number | string | null;
    position?: Position;
    start_position?: Position;
    end_position?: Position;
    recipient_player_id?: string;
    target_player_id?: string;
    from_team_id?: string;
    outcome?: string;
    reason?: string;
    intensity?: string;
    distance_m?: number;
    difficulty_rating?: number;
    synthetic_xg?: number;
    ball_speed_kmh?: number;
    shot_speed_kmh?: number;
    /** Optional tracking supplied by an import: the acting player's speed at this event. Never derived from movement. */
    player_speed_kmh?: number;
    /** Optional tracking supplied by an import: the acting player's cumulative distance covered so far. */
    player_distance_m?: number;
}
export interface MatchData {
    schema_version?: string;
    synthetic?: boolean;
    disclaimer?: string;
    match: { match_id: string; home_team_id: string; away_team_id: string; duration_seconds: number; period_seconds: number; stoppage_time_seconds?: number };
    teams: Team[];
    players: Player[];
    events: MatchEvent[];
    documentation?: { coordinates?: string;[key: string]: unknown };
}
export interface Metrics {
    goals: number; shots: number; shots_on_target: number;
    passes_attempted: number; passes_completed: number;
    tackles_won: number; pressure_events: number; actions: number;
}
/** Sums and maxima of the dataset's per-event synthetic quality fields; averages are derived when displayed. */
export interface Quality {
    pass_distance_total: number; pass_distance_count: number;
    long_passes_attempted: number; long_passes_completed: number;
    difficult_passes_attempted: number; difficult_passes_completed: number;
    ball_speed_total: number; ball_speed_count: number; ball_speed_max: number;
    shot_speed_total: number; shot_speed_count: number; shot_speed_max: number;
}
export interface Statistics { teams: Record<string, Metrics>; players: Record<string, Metrics>; quality: { teams: Record<string, Quality>; players: Record<string, Quality> } }
/** The single performance number a viewer chose to keep on screen. */
export const FOCUS_METRICS = ["shots", "shots_on_target", "pass_accuracy", "pressure_events", "long_passes", "difficult_passes", "fastest_shot"] as const;
export type FocusMetric = (typeof FOCUS_METRICS)[number];
/**
 * `team` and `player` are the primary favourite team and focus player that agents receive. `favorites` lists every
 * favourite player in this match (the focus player first). Agents and older callers ignore the optional fields.
 */
export interface Preferences { mode: ViewMode; language: Language; team: string; player: string; favorites?: string[]; metric?: FocusMetric | null; units?: Units; autoExplain?: boolean }
/** Cross-match fan profile, by club and player name so it applies to any dataset. Most recent choice first. */
export interface FanProfile { mode: ViewMode; clubs: string[]; players: string[]; metric: FocusMetric | null; units: Units }
export interface PlaybackCheckpoint {
    elapsed: number;
    cursor: number;
    secondHalf: boolean;
    status: "ready" | "playing" | "paused" | "half-time" | "full-time";
    speed: number;
}
export interface MatchAnnotation {
    id: string;
    kind: "note" | "bookmark";
    text: string;
    anchor: PlaybackCheckpoint;
    eventId?: string;
    createdAt: number;
}
export interface LibraryMatch {
    id: string;
    data: MatchData;
    source: string;
    kind: "demo" | "upload";
    createdAt: number;
    updatedAt: number;
    checkpoint: PlaybackCheckpoint;
    annotations: MatchAnnotation[];
}
export const AGENT_TOPICS = ["pressing", "build_up", "chance_creation", "turnovers", "flank_preference", "momentum", "player_involvement", "defensive_actions"] as const;
export type AgentTopic = (typeof AGENT_TOPICS)[number];
export interface Insight {
    id: string; rule: "recoveries" | "shots" | "passing" | "player" | "goal_context" | "pressing" | "drought" | "momentum" | "agent";
    teamId: string; playerId?: string; at: number; from: number;
    /** Set only on Microsoft Foundry agent cards. Local rule cards are never labeled AI. */
    source?: "foundry"; topic?: AgentTopic;
    headline: string;
    explanation: string;
    casual: string;
    interpretation: string;
    metrics: { label: string; value: string }[];
    eventIds: string[];
    /** When larger than eventIds.length, eventIds lists only the most recent supporting events. */
    evidenceTotal?: number;
}
export interface InsightRequestOptions { signal?: AbortSignal; preferences?: Preferences }
/** The local provider is synchronous and deterministic; the Microsoft Foundry adapter is remote, server-side and async. */
export interface InsightProvider {
    readonly kind: "rule-based" | "remote";
    generate(data: MatchData, events: readonly MatchEvent[], elapsed: number, options?: InsightRequestOptions): Insight[] | Promise<Insight[]>;
}
