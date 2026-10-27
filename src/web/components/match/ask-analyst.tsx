"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MessageCircleQuestion, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ASK_QUESTION_LIMIT } from "@/lib/agents/contracts";
import { formatTime } from "@/lib/match/playback";
import { tr } from "@/lib/match/presentation";
import type { ChatEntry } from "@/lib/match/use-agents";
import type { Language } from "@/lib/match/types";
import { AiBadge, agentErrorText } from "./agent-insights";

const SUGGESTIONS = ["suggestionMostActions", "suggestionBallRecovery", "suggestionPassingBlocks"] as const;

export function AskAnalyst({ entries, cursor, elapsed, language: l, asking, onAsk, onEvidence }: {
    entries: ChatEntry[]; cursor: number; elapsed: number; language: Language; asking: boolean;
    onAsk: (question: string) => void; onEvidence: (id: string) => void;
}) {
    const id = useId();
    const thread = useRef<HTMLOListElement>(null);
    const [question, setQuestion] = useState("");
    // Seconds waited for the pending answer; unknown after a remount mid-request, so the counter then stays hidden.
    const [waited, setWaited] = useState<number | null>(null);
    useEffect(() => {
        if (!asking) return;
        const timer = setInterval(() => setWaited(seconds => seconds === null ? null : seconds + 1), 1000);
        return () => clearInterval(timer);
    }, [asking]);
    // Messages produced at a later playhead behave like future events: hidden until replay reaches them.
    const visible = entries.filter(entry => entry.cursor <= cursor);
    // Keep the newest exchange in view above the pinned question box.
    useEffect(() => { thread.current?.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [visible.length, asking]);
    const hidden = entries.filter(entry => entry.cursor > cursor);
    const returnsAt = Math.min(...hidden.map(entry => entry.elapsed));
    const submit = (text: string) => {
        if (!text.trim() || asking) return;
        setWaited(0);
        onAsk(text);
        setQuestion("");
    };
    return <section className="panel agent-panel ask-analyst" aria-labelledby={`${id}-heading`}>
        <div className="panel-heading"><div className="heading-icon"><MessageCircleQuestion size={17} aria-hidden="true" /><h2 id={`${id}-heading`}>{tr(l, "askTheAnalyst")}</h2></div><AiBadge language={l} /></div>
        <p className="agent-note">{tr(l, "answersReachedBy", { time: formatTime(elapsed) })}</p>
        {hidden.length > 0 && <p className="agent-note">{tr(l, hidden.length === 1 ? "laterMessageHiddenOne" : "laterMessagesHidden", { count: hidden.length, time: formatTime(returnsAt) })}</p>}
        <ol ref={thread} className="ask-thread" aria-label={tr(l, "conversationWithTheAnalyst")}>
            {visible.map(entry => <li key={entry.id} className={entry.role === "user" ? "ask-user" : "ask-assistant"}>
                <span className="ask-meta">{entry.role === "user" ? tr(l, "you") : tr(l, "analystAi")} · <time>{formatTime(entry.elapsed)}</time></span>
                {entry.role === "user" ? <p>{entry.question}</p>
                    : entry.answer ? <>
                        <p>{entry.answer.answer}</p>
                        {entry.answer.outOfScope && <p className="ask-caveat">{tr(l, "outsideWhatThisEventDataCanShow")}</p>}
                        {entry.answer.caveat && <p className="ask-caveat">{entry.answer.caveat}</p>}
                        {entry.answer.eventIds.length > 0 && <div className="evidence-ids" aria-label={tr(l, "supportingEvents2")}>{entry.answer.eventIds.map(eventId => <button type="button" key={eventId} onClick={() => onEvidence(eventId)}>{eventId}</button>)}</div>}
                    </> : <p className="ask-error">{agentErrorText(entry.error, l)}</p>}
            </li>)}
            {asking && <li className="ask-assistant ask-pending" aria-hidden="true">
                <span className="ask-meta">{tr(l, "analystAi")} · <time>{formatTime(elapsed)}</time></span>
                <p className="ask-pending-line"><span className="ask-typing"><i /><i /><i /></span>{tr(l, "checkingTheRecordedEvents")}</p>
                <p className="ask-wait">{tr(l, "askPendingHint")}{waited !== null && asking && <> · <time dir="ltr">{tr(l, "askWaitedSeconds", { seconds: waited })}</time></>}</p>
            </li>}
        </ol>
        <p className="sr-only" role="status" aria-live="polite">{asking ? tr(l, "checkingTheRecordedEvents") : ""}</p>
        {!visible.length && !asking && <div className="ask-suggestions">{SUGGESTIONS.map(key => <button type="button" key={key} onClick={() => submit(tr(l, key))}>{tr(l, key)}</button>)}</div>}
        <form className="ask-form" onSubmit={event => { event.preventDefault(); submit(question); }}>
            <label htmlFor={`${id}-question`}>{tr(l, "yourQuestion")}</label>
            <textarea id={`${id}-question`} rows={3} maxLength={ASK_QUESTION_LIMIT} value={question} placeholder={tr(l, "askAboutTheReachedMatch")}
                onChange={event => setQuestion(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(question); } }} />
            <Button size="sm" type="submit" disabled={!question.trim() || asking}><SendHorizontal size={14} aria-hidden="true" />{tr(l, "ask")}</Button>
        </form>
    </section>;
}
