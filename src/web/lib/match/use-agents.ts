"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ASK_HISTORY_LIMIT, NARRATE_LIMIT, PROMPT_VERSION, type AgentAnswer, type AgentChatTurn, type AgentErrorCode, type AgentName, type AgentOutputs, type AgentRecap, type AgentRequest, type AgentResult } from "@/lib/agents/contracts";
import { isMeaningful } from "./commentary";
import type { MatchStatus } from "./playback";
import type { Insight, InsightProvider, InsightRequestOptions, MatchData, MatchEvent, PlaybackCheckpoint, Preferences } from "./types";

export interface AgentPosition { elapsed: number; secondHalf: boolean; status: MatchStatus }

export class AgentRequestError extends Error {
    constructor(readonly code: AgentErrorCode) { super(code); }
}
const errorCode = (error: unknown): AgentErrorCode => error instanceof AgentRequestError ? error.code : "upstream_error";

/** Only the processed prefix leaves the browser. Upload documentation is never needed by the agents. */
export function agentRequest(data: MatchData, events: readonly MatchEvent[], position: AgentPosition, preferences: Preferences, extra: Pick<AgentRequest, "question" | "history" | "narrate"> = {}): AgentRequest {
    return {
        match: { ...data, documentation: undefined, events: [...events] },
        cursor: events.length, elapsed: position.elapsed, secondHalf: position.secondHalf,
        // Every request describes a frozen moment: playback pauses before it is sent.
        status: position.status === "playing" ? "paused" : position.status,
        preferences, ...extra,
    };
}

export async function postAgent<N extends AgentName>(agent: N, request: AgentRequest, signal?: AbortSignal): Promise<AgentOutputs[N]> {
    let response: Response;
    try {
        response = await fetch(`/api/agents/${agent}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal });
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new AgentRequestError("upstream_error");
    }
    let result: AgentResult<N>;
    try { result = await response.json() as AgentResult<N>; } catch { throw new AgentRequestError("upstream_error"); }
    if (!result.ok) throw new AgentRequestError(result.error);
    return result.result;
}

/** The Microsoft Foundry side of the InsightProvider boundary; ruleBasedProvider remains the always-on local fallback. */
export const foundryInsightProvider = {
    kind: "remote",
    generate(data: MatchData, events: readonly MatchEvent[], elapsed: number, options?: InsightRequestOptions): Promise<Insight[]> {
        const secondHalf = elapsed > data.match.period_seconds || events.some(event => event.period === 2);
        const status: MatchStatus = secondHalf && elapsed === data.match.duration_seconds ? "full-time" : !secondHalf && elapsed === data.match.period_seconds ? "half-time" : "paused";
        const preferences = options?.preferences ?? { mode: "analyst", language: "en", team: data.match.home_team_id, player: "" };
        return postAgent("analyst", agentRequest(data, events, { elapsed, secondHalf, status }, preferences), options?.signal);
    },
} satisfies InsightProvider;

export interface AgentTask<T> { status: "idle" | "loading" | "done" | "error"; result?: T; error?: AgentErrorCode; cursor: number; elapsed: number; key?: string }
export interface ChatEntry { id: string; role: "user" | "assistant"; cursor: number; elapsed: number; language: Preferences["language"]; question?: string; answer?: AgentAnswer; error?: AgentErrorCode }
const IDLE: AgentTask<never> = { status: "idle", cursor: 0, elapsed: 0 };
const EMPTY_LINES: ReadonlyMap<string, string> = new Map();
const NOTE_QUESTION = "Summarize this moment for my match notes in two or three sentences: what just happened and the pattern behind it. Facts first.";

// Session memory only: results are never persisted, and a reopened studio reuses them without a new call.
const results = new Map<string, unknown>();
const narration = new Map<string, ReadonlyMap<string, string>>();

export function agentCacheKeys(id: string, cursor: number, status: MatchStatus, preferences: Preferences) {
    return {
        analyst: `${id}:analyst:${cursor}:${preferences.mode}:${preferences.team}:${preferences.player}:${preferences.language}:${PROMPT_VERSION}`,
        recap: `${id}:recap:${status}:${cursor}:${preferences.language}:${PROMPT_VERSION}`,
        narration: `${id}:${preferences.language}:${PROMPT_VERSION}`,
    };
}

/** One cancellable request per task: a newer request or unmount aborts the older one. */
function useAgentTask<T>() {
    const [task, setTask] = useState<AgentTask<T>>(IDLE);
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    const start = useCallback((key: string, moment: { cursor: number; elapsed: number }, request: (signal: AbortSignal) => Promise<T>) => {
        controller.current?.abort();
        if (results.has(key)) { setTask({ status: "done", result: results.get(key) as T, ...moment, key }); return; }
        const current = controller.current = new AbortController();
        setTask({ status: "loading", ...moment, key });
        request(current.signal).then(result => {
            if (current.signal.aborted) return;
            results.set(key, result);
            setTask({ status: "done", result, ...moment, key });
        }, (error: unknown) => {
            if (!current.signal.aborted) setTask({ status: "error", error: errorCode(error), ...moment, key });
        });
    }, []);
    return [task, start] as const;
}

/** A finished task for this exact key, or one cached earlier in the session. */
function view<T>(task: AgentTask<T>, key: string, moment: { cursor: number; elapsed: number }): AgentTask<T> {
    if (task.status !== "idle" && task.key === key) return task;
    return results.has(key) ? { status: "done", result: results.get(key) as T, ...moment, key } : IDLE;
}

/**
 * AI state for one studio session. Every call is on demand. Results carry the cursor they were produced at;
 * callers show them only while that cursor is within the processed prefix.
 */
export function useStudioAgents(id: string, data: MatchData, events: readonly MatchEvent[], position: AgentPosition, preferences: Preferences) {
    const cursor = events.length;
    const moment = { cursor, elapsed: position.elapsed };
    const [analystTask, startAnalyst] = useAgentTask<Insight[]>();
    const [recapTask, startRecap] = useAgentTask<AgentRecap>();
    const [chat, setChat] = useState<ChatEntry[]>([]);
    const [asking, setAsking] = useState(false);
    const [askingLocale, setAskingLocale] = useState<Preferences["language"] | null>(null);
    const [narrating, setNarrating] = useState<{ loading: boolean; error?: AgentErrorCode; key?: string }>({ loading: false });
    const [, setRevision] = useState(0);
    const askController = useRef<AbortController | null>(null);
    const narrateController = useRef<AbortController | null>(null);
    useEffect(() => () => { askController.current?.abort(); narrateController.current?.abort(); }, []);

    const { analyst: analystKey, recap: recapKey, narration: narrationKey } = agentCacheKeys(id, cursor, position.status, preferences);
    const localizedChat = chat.filter(entry => entry.language === preferences.language);
    const lines = narration.get(narrationKey) ?? EMPTY_LINES;
    const pending = events.filter(event => event.team_id !== null && isMeaningful(event) && !lines.has(event.event_id)).slice(-NARRATE_LIMIT);

    const analyze = () => startAnalyst(analystKey, moment, signal => foundryInsightProvider.generate(data, events, position.elapsed, { signal, preferences }));
    const writeRecap = () => startRecap(recapKey, moment, signal => postAgent("recap", agentRequest(data, events, position, preferences), signal));

    const ask = (question: string) => {
        const text = question.trim();
        if (!text || (asking && askingLocale === preferences.language)) return;
        // Only exchanges produced at or before this playhead are context; later ones would leak future events.
        const history: AgentChatTurn[] = [];
        for (let index = 1; index < localizedChat.length; index++) {
            const asked = localizedChat[index - 1], reply = localizedChat[index];
            if (asked.role === "user" && asked.question && asked.language === preferences.language && reply.role === "assistant" && reply.answer && reply.language === preferences.language && reply.cursor <= cursor) {
                history.push({ role: "user", text: asked.question, cursor: asked.cursor }, { role: "assistant", text: reply.answer.answer, cursor: reply.cursor });
            }
        }
        const language = preferences.language;
        setChat(previous => [...previous, { id: crypto.randomUUID(), role: "user", question: text, language, ...moment }]);
        setAsking(true);
        setAskingLocale(language);
        askController.current?.abort();
        const controller = askController.current = new AbortController();
        postAgent("ask", agentRequest(data, events, position, preferences, { question: text, history: history.slice(-ASK_HISTORY_LIMIT) }), controller.signal).then(answer => {
            if (!controller.signal.aborted) setChat(previous => [...previous, { id: crypto.randomUUID(), role: "assistant", answer, language, ...moment }]);
        }, (error: unknown) => {
            if (!controller.signal.aborted) setChat(previous => [...previous, { id: crypto.randomUUID(), role: "assistant", error: errorCode(error), language, ...moment }]);
        }).finally(() => {
            if (askController.current === controller) setAsking(false);
        });
    };

    const narrate = () => {
        if (!pending.length || (narrating.loading && narrating.key === narrationKey)) return;
        narrateController.current?.abort();
        const controller = narrateController.current = new AbortController();
        setNarrating({ loading: true, key: narrationKey });
        postAgent("commentator", agentRequest(data, events, position, preferences, { narrate: pending.map(event => event.event_id) }), controller.signal).then(result => {
            if (controller.signal.aborted) return;
            const next = new Map(narration.get(narrationKey) ?? EMPTY_LINES);
            for (const line of result) next.set(line.eventId, line.text);
            narration.set(narrationKey, next);
            setRevision(revision => revision + 1);
            setNarrating({ loading: false, key: narrationKey });
        }, (error: unknown) => {
            if (!controller.signal.aborted) setNarrating({ loading: false, error: errorCode(error), key: narrationKey });
        });
    };

    /** A note draft from the annotation's own saved prefix, never the live playhead. */
    const draftNote = (anchor: PlaybackCheckpoint): Promise<string> => postAgent("ask", agentRequest(data, data.events.slice(0, anchor.cursor), anchor, preferences, { question: NOTE_QUESTION, history: [] })).then(answer => answer.answer);

    return {
        analyst: view(analystTask, analystKey, moment), analyze,
        recap: view(recapTask, recapKey, moment), writeRecap,
        chat: localizedChat, asking: asking && askingLocale === preferences.language, ask,
        lines, pending: pending.length, narrating: narrating.key === narrationKey ? narrating : { loading: false }, narrate,
        draftNote,
    };
}
export type StudioAgents = ReturnType<typeof useStudioAgents>;
