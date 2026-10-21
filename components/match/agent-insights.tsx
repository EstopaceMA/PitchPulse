"use client";

import { useId } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentErrorCode } from "@/lib/agents/contracts";
import { formatTime } from "@/lib/match/playback";
import { tr } from "@/lib/match/presentation";
import type { AgentTask } from "@/lib/match/use-agents";
import type { Insight, Language, Preferences } from "@/lib/match/types";
import { InsightCard } from "./insights-panel";

/** AI output is always labeled; local rules never carry this badge. */
export function AiBadge({ language: l }: { language: Language }) {
    return <span className="ai-badge">{tr(l, "AI · MICROSOFT FOUNDRY", "AI · MICROSOFT FOUNDRY")}</span>;
}

export function agentErrorText(error: AgentErrorCode | undefined, l: Language): string {
    switch (error) {
        case "not_configured": return tr(l, "AI analysis isn’t configured on this server.", "Hindi naka-configure ang AI sa server na ito.");
        case "invalid_request": return tr(l, "This moment couldn’t be sent for analysis.", "Hindi maipadala ang sandaling ito para suriin.");
        case "rate_limited": return tr(l, "Too many AI requests. Try again in a few minutes.", "Masyadong maraming kahilingan sa AI. Subukang muli makalipas ang ilang minuto.");
        case "unverifiable_output": return tr(l, "The AI response didn’t match the recorded events, so it isn’t shown. Try again.", "Hindi tumugma ang sagot ng AI sa mga naitalang pangyayari, kaya hindi ito ipinapakita. Subukang muli.");
        case "timeout": return tr(l, "The AI request took too long. Try again.", "Masyadong natagalan ang kahilingan sa AI. Subukang muli.");
        default: return tr(l, "Microsoft Foundry didn’t respond. Local analysis is unaffected.", "Hindi tumugon ang Microsoft Foundry. Hindi apektado ang lokal na pagsusuri.");
    }
}

export const aiDisclosure = (l: Language) => tr(l,
    "Off by default. When on, only the buttons you press send this match’s reached events to your Microsoft Foundry project, where responses are stored. Local analysis always stays on.",
    "Naka-off bilang default. Kapag naka-on, ang mga button lamang na pipindutin mo ang magpapadala ng mga naabot na pangyayari ng laban sa iyong Microsoft Foundry project, kung saan naiimbak ang mga sagot. Laging bukas ang lokal na pagsusuri.");

export function AgentInsights({ preferences, available, enabled, task, cursor, canAnalyze, onAnalyze, onEnable, onEvidence }: {
    preferences: Preferences; available: boolean; enabled: boolean; task: AgentTask<Insight[]>; cursor: number; canAnalyze: boolean;
    onAnalyze: () => void; onEnable: () => void; onEvidence: (id: string) => void;
}) {
    const id = useId();
    const l = preferences.language;
    // Results from a later playhead stay hidden after a rewind, like every other derived panel.
    const ahead = task.status !== "idle" && task.cursor > cursor;
    const cards = task.status === "done" && !ahead ? (task.result ?? []).filter(card => preferences.mode !== "player" || !card.playerId || card.playerId === preferences.player) : [];
    const status = ahead ? tr(l, `Analysis from ${formatTime(task.elapsed)} is hidden until playback reaches that moment again.`, `Nakatago ang pagsusuri mula ${formatTime(task.elapsed)} hanggang maabot muli ang sandaling iyon.`)
        : task.status === "loading" ? tr(l, `Analyzing ${formatTime(task.elapsed)}…`, `Sinusuri ang ${formatTime(task.elapsed)}…`)
            : task.status === "error" ? agentErrorText(task.error, l)
                : task.status === "done" ? (cards.length ? tr(l, `As of ${formatTime(task.elapsed)} · ${cards.length} verified ${cards.length === 1 ? "card" : "cards"}`, `Hanggang ${formatTime(task.elapsed)} · ${cards.length} beripikadong card`) : tr(l, `No well-supported patterns yet at ${formatTime(task.elapsed)}.`, `Wala pang padrong may sapat na batayan sa ${formatTime(task.elapsed)}.`))
                    : tr(l, "Pause on any moment and ask the Tactical Analyst what the events show.", "Huminto sa anumang sandali at itanong sa Tactical Analyst kung ano ang ipinapakita ng mga pangyayari.");
    return <section className="panel agent-panel" aria-labelledby={`${id}-heading`}>
        <div className="panel-heading"><div className="heading-icon"><Sparkles size={17} aria-hidden="true" /><h2 id={`${id}-heading`}>{tr(l, "AI analysis", "Pagsusuri ng AI")}</h2></div><AiBadge language={l} /></div>
        {!available ? <p className="agent-note">{tr(l, "AI analysis isn’t configured on this server. The rule-based insights are unaffected.", "Hindi naka-configure ang AI sa server na ito. Hindi apektado ang mga pagsusuring batay sa tuntunin.")}</p>
            : !enabled ? <div className="agent-optin"><p>{aiDisclosure(l)}</p><Button size="sm" variant="outline" onClick={onEnable}><Sparkles size={14} aria-hidden="true" />{tr(l, "Turn on AI analysis", "I-on ang pagsusuri ng AI")}</Button></div>
                : <>
                    <div className="agent-actions">
                        <Button size="sm" onClick={onAnalyze} disabled={!canAnalyze || task.status === "loading"}><Sparkles size={14} aria-hidden="true" />{tr(l, "Analyze this moment", "Suriin ang sandaling ito")}</Button>
                        <p className="agent-status" role="status" aria-live="polite">{status}</p>
                    </div>
                    {cards.length > 0 && <div className="insight-list">{cards.map(card => <InsightCard key={card.id} insight={card} preferences={preferences} onEvidence={onEvidence} />)}</div>}
                    <p className="agent-note">{tr(l, "Numbers and evidence come from PitchPulse’s own event counts. Cards that fail verification are removed before display.", "Mula sa sariling bilang ng PitchPulse ang mga numero at ebidensiya. Inaalis ang mga card na hindi pumasa sa beripikasyon bago ipakita.")}</p>
                </>}
    </section>;
}
