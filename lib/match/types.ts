export const EVENT_TYPES = ["match_start", "kickoff", "pass", "shot", "tackle", "pressure", "possession_change", "half_time", "second_half_start", "full_time"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type Language = "en" | "fil";
export type ViewMode = "casual" | "analyst" | "player";
export type Position = { x: number; y: number };
export interface Team { team_id: string; name: string }
export interface Player { player_id: string; team_id: string; name: string; shirt_number?: number; position?: string; fictional?: boolean }
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
export interface Statistics { teams: Record<string, Metrics>; players: Record<string, Metrics> }
export interface Preferences { mode: ViewMode; language: Language; team: string; player: string }
export interface Insight {
    id: string; rule: "recoveries" | "shots" | "passing" | "player";
    teamId: string; playerId?: string; at: number; from: number;
    headline: Record<Language, string>;
    explanation: Record<Language, string>;
    casual: Record<Language, string>;
    interpretation: Record<Language, string>;
    metrics: { label: Record<Language, string>; value: string }[];
    eventIds: string[];
}
/** A remote provider can implement this contract later. The shipped implementation is local and deterministic. */
export interface InsightProvider {
    readonly kind: "rule-based" | "remote";
    generate(data: MatchData, events: readonly MatchEvent[], elapsed: number): Insight[];
}