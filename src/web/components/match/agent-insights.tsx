"use client";

import { useEffect, useId, useRef } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentErrorCode } from "@/lib/agents/contracts";
import { formatTime } from "@/lib/match/playback";
import { tr } from "@/lib/match/presentation";
import type { AgentTask } from "@/lib/match/use-agents";
import type { Insight, Language, Preferences } from "@/lib/match/types";
import { InsightCard } from "./insights-panel";

/** AI output is always labeled; local rules never carry this badge. */
export function AiBadge({ language: l }: { language: Language }) {
    return <span className="ai-badge">{tr(l, "aiMicrosoftFoundry")}</span>;
}

export function agentErrorText(error: AgentErrorCode | undefined, l: Language): string {
    switch (error) {
        case "not_configured": return tr(l, "aiAnalysisIsnTConfiguredOnThisServer");
        case "invalid_request": return tr(l, "thisMomentCouldnTBeSentForAnalysis");
        case "rate_limited": return tr(l, "tooManyAiRequestsTryAgainInA");
        case "unverifiable_output": return tr(l, "theAiResponseDidnTMatchTheRecorded");
        case "timeout": return tr(l, "theAiRequestTookTooLongTryAgain");
        default: return tr(l, "microsoftFoundryDidnTRespondLocalAnalysisIs");
    }
}

function analysisView(preferences: Preferences, task: AgentTask<Insight[]>, cursor: number) {
    const l = preferences.language;
    // Results from a later playhead stay hidden after a rewind, like every other derived panel.
    const ahead = task.status !== "idle" && task.cursor > cursor;
    const cards = task.status === "done" && !ahead ? (task.result ?? []).filter(card => preferences.mode !== "player" || !card.playerId || card.playerId === preferences.player) : [];
    const status = ahead ? tr(l, "analysisHiddenUntil", { time: formatTime(task.elapsed) })
        : task.status === "loading" ? tr(l, "analysisLoadingAt", { time: formatTime(task.elapsed) })
            : task.status === "error" ? agentErrorText(task.error, l)
                : task.status === "done" ? (cards.length ? tr(l, cards.length === 1 ? "analysisVerifiedCard" : "analysisVerifiedCards", { time: formatTime(task.elapsed), count: cards.length }) : tr(l, "analysisNoPatternsAt", { time: formatTime(task.elapsed) }))
                    : tr(l, "pauseOnAnyMomentAndAskTheTactical");
    return { cards, status };
}

export function AgentInsights({ preferences, available, task, cursor, canAnalyze, onAnalyze, onEvidence }: {
    preferences: Preferences; available: boolean; task: AgentTask<Insight[]>; cursor: number; canAnalyze: boolean;
    onAnalyze: () => void; onEvidence: (id: string) => void;
}) {
    const id = useId();
    const l = preferences.language;
    const { cards, status } = analysisView(preferences, task, cursor);
    return <section className="panel agent-panel" aria-labelledby={`${id}-heading`}>
        <div className="panel-heading"><div className="heading-icon"><Sparkles size={17} aria-hidden="true" /><h2 id={`${id}-heading`}>{tr(l, "aiAnalysis")}</h2></div><AiBadge language={l} /></div>
        {!available ? <p className="agent-note">{tr(l, "aiAnalysisIsnTConfiguredOnThisServer2")}</p>
            : <>
                    <div className="agent-actions">
                        <Button size="sm" onClick={onAnalyze} disabled={!canAnalyze || task.status === "loading"}><Sparkles size={14} aria-hidden="true" />{tr(l, "analyzeThisMoment")}</Button>
                        <p className="agent-status" role="status" aria-live="polite">{status}</p>
                    </div>
                    {cards.length > 0 && <div className="insight-list">{cards.map(card => <InsightCard key={card.id} insight={card} preferences={preferences} onEvidence={onEvidence} />)}</div>}
                    <p className="agent-note">{tr(l, "numbersAndEvidenceComeFromPitchpulseSOwn")}</p>
                </>}
    </section>;
}

export function AgentAnalysisModal({ open, preferences, task, cursor, onClose, onEvidence }: {
    open: boolean; preferences: Preferences; task: AgentTask<Insight[]>; cursor: number;
    onClose: () => void; onEvidence: (id: string) => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const headingId = useId();
    const l = preferences.language;
    const { cards, status } = analysisView(preferences, task, cursor);
    useEffect(() => {
        if (!open) return;
        const dialog = dialogRef.current;
        dialog?.showModal();
        return () => { if (dialog?.open) dialog.close(); };
    }, [open]);
    if (!open) return null;
    return <dialog ref={dialogRef} className="analysis-dialog" aria-labelledby={headingId} onClose={onClose} style={{ width: "min(820px, calc(100vw - 32px))", maxWidth: "calc(100vw - 32px)" }}>
        <header className="analysis-dialog-header">
            <div className="analysis-dialog-title"><span className="analysis-dialog-icon"><Sparkles size={20} aria-hidden="true" /></span><div><h2 id={headingId}>{tr(l, "aiMatchAnalysis")}</h2><p>{tr(l, "patternsFromReachedMatchEvents")}</p></div></div>
            <Button type="button" size="icon" variant="ghost" aria-label={tr(l, "closeAnalysis")} onClick={onClose}><X size={18} aria-hidden="true" /></Button>
        </header>
        <div className="analysis-dialog-meta"><span role="status">{cards.length ? status : tr(l, "asOfTime", { time: formatTime(task.elapsed) })}</span><AiBadge language={l} /></div>
        <div className="analysis-dialog-content">
            {cards.length > 0 ? <div className="analysis-dialog-list">{cards.map(card => <InsightCard key={card.id} insight={card} preferences={preferences} onEvidence={onEvidence} />)}</div> : <div className="analysis-dialog-empty"><Sparkles size={22} aria-hidden="true" /><p>{status}</p></div>}
        </div>
        <footer className="analysis-dialog-footer">{tr(l, "numbersAndEvidenceAreVerifiedAgainstReachedEvents")}</footer>
    </dialog>;
}
