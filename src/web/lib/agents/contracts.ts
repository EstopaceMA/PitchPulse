import type { MatchStatus } from "@/lib/match/playback";
import type { Insight, MatchData, Preferences } from "@/lib/match/types";

export const AGENT_NAMES = ["analyst", "recap", "ask", "commentator"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
export const isAgentName = (value: unknown): value is AgentName => typeof value === "string" && (AGENT_NAMES as readonly string[]).includes(value);

/** Bump when instructions or schemas change. Client caches and agent metadata carry it. */
export const PROMPT_VERSION = "2026-10-27.1";
export const ASK_QUESTION_LIMIT = 500;
export const ASK_HISTORY_LIMIT = 8;
export const NARRATE_LIMIT = 12;

export type Bilingual = { en: string; fil: string };
/** Each chat turn remembers the cursor it was produced at, so a rewind never sends later answers back. */
export interface AgentChatTurn { role: "user" | "assistant"; text: string; cursor: number }

/** match.events must be the processed prefix only: data.events.slice(0, cursor). */
export interface AgentRequest {
    match: MatchData;
    cursor: number; elapsed: number; secondHalf: boolean; status: MatchStatus;
    preferences: Preferences;
    question?: string;
    history?: AgentChatTurn[];
    narrate?: string[];
}

export interface AgentRecapNote { teamId: string; observed: string; interpretation: string; metrics: Insight["metrics"]; eventIds: string[]; evidenceTotal: number }
export interface AgentRecap { kind: "half-time" | "full-time"; story: string; turningPoints: { eventId: string; caption: string }[]; teamNotes: AgentRecapNote[]; watchNext: string | null }
export interface AgentAnswer { answer: string; eventIds: string[]; caveat: string | null; outOfScope: boolean }
export interface AgentCommentaryLine { eventId: string; text: string }
export interface AgentOutputs { analyst: Insight[]; recap: AgentRecap; ask: AgentAnswer; commentator: AgentCommentaryLine[] }

export const AGENT_ERRORS = ["not_configured", "invalid_request", "rate_limited", "upstream_error", "unverifiable_output", "timeout"] as const;
export type AgentErrorCode = (typeof AGENT_ERRORS)[number];

/** `dropped` counts generated items removed by the deterministic guards. */
export type AgentResult<N extends AgentName = AgentName> =
    | { ok: true; agent: N; cursor: number; elapsed: number; result: AgentOutputs[N]; dropped: number }
    | { ok: false; agent: N; error: AgentErrorCode; message: string };
