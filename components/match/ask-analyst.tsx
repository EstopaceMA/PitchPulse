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

const SUGGESTIONS: [string, string][] = [
    ["Which player has the most recorded actions so far?", "Sinong manlalaro ang may pinakamaraming naitalang aksiyon sa ngayon?"],
    ["Where is each team winning the ball back?", "Saan nababawi ng bawat koponan ang bola?"],
    ["How has passing changed between the 15-minute blocks?", "Paano nagbago ang pagpasa sa bawat 15 minuto?"],
];

export function AskAnalyst({ entries, cursor, elapsed, language: l, asking, onAsk, onEvidence }: {
    entries: ChatEntry[]; cursor: number; elapsed: number; language: Language; asking: boolean;
    onAsk: (question: string) => void; onEvidence: (id: string) => void;
}) {
    const id = useId();
    const thread = useRef<HTMLOListElement>(null);
    const [question, setQuestion] = useState("");
    // Messages produced at a later playhead behave like future events: hidden until replay reaches them.
    const visible = entries.filter(entry => entry.cursor <= cursor);
    // Keep the newest exchange in view above the pinned question box.
    useEffect(() => { thread.current?.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [visible.length]);
    const hidden = entries.filter(entry => entry.cursor > cursor);
    const returnsAt = Math.min(...hidden.map(entry => entry.elapsed));
    const submit = (text: string) => {
        if (!text.trim() || asking) return;
        onAsk(text);
        setQuestion("");
    };
    return <section className="panel agent-panel ask-analyst" aria-labelledby={`${id}-heading`}>
        <div className="panel-heading"><div className="heading-icon"><MessageCircleQuestion size={17} aria-hidden="true" /><h2 id={`${id}-heading`}>{tr(l, "Ask the Analyst", "Magtanong sa Analista")}</h2></div><AiBadge language={l} /></div>
        <p className="agent-note">{tr(l, `Answers use only events reached by ${formatTime(elapsed)}. Asking pauses playback.`, `Mga pangyayaring naabot hanggang ${formatTime(elapsed)} lamang ang batayan ng sagot. Humihinto ang laro kapag nagtanong.`)}</p>
        {hidden.length > 0 && <p className="agent-note">{tr(l, `${hidden.length} later ${hidden.length === 1 ? "message is" : "messages are"} hidden until playback reaches ${formatTime(returnsAt)} again.`, `Nakatago ang ${hidden.length} mensahe hanggang maabot muli ang ${formatTime(returnsAt)}.`)}</p>}
        <ol ref={thread} className="ask-thread" aria-label={tr(l, "Conversation with the analyst", "Usapan kasama ang analista")}>
            {visible.map(entry => <li key={entry.id} className={entry.role === "user" ? "ask-user" : "ask-assistant"}>
                <span className="ask-meta">{entry.role === "user" ? tr(l, "You", "Ikaw") : tr(l, "Analyst · AI", "Analista · AI")} · <time>{formatTime(entry.elapsed)}</time></span>
                {entry.role === "user" ? <p>{entry.question}</p>
                    : entry.answer ? <>
                        <p>{entry.answer.answer[l]}</p>
                        {entry.answer.outOfScope && <p className="ask-caveat">{tr(l, "Outside what this event data can show.", "Labas sa kayang ipakita ng datos na ito.")}</p>}
                        {entry.answer.caveat && <p className="ask-caveat">{entry.answer.caveat[l]}</p>}
                        {entry.answer.eventIds.length > 0 && <div className="evidence-ids" aria-label={tr(l, "Supporting events", "Mga batayang aksiyon")}>{entry.answer.eventIds.map(eventId => <button type="button" key={eventId} onClick={() => onEvidence(eventId)}>{eventId}</button>)}</div>}
                    </> : <p className="ask-error">{agentErrorText(entry.error, l)}</p>}
            </li>)}
        </ol>
        <p className="agent-status" role="status" aria-live="polite">{asking ? tr(l, "Checking the recorded events…", "Sinusuri ang mga naitalang pangyayari…") : ""}</p>
        {!visible.length && !asking && <div className="ask-suggestions">{SUGGESTIONS.map(([en, fil]) => <button type="button" key={en} onClick={() => submit(tr(l, en, fil))}>{tr(l, en, fil)}</button>)}</div>}
        <form className="ask-form" onSubmit={event => { event.preventDefault(); submit(question); }}>
            <label htmlFor={`${id}-question`}>{tr(l, "Your question", "Iyong tanong")}</label>
            <textarea id={`${id}-question`} rows={3} maxLength={ASK_QUESTION_LIMIT} value={question} placeholder={tr(l, "Ask about the reached match…", "Magtanong tungkol sa naabot na laban…")}
                onChange={event => setQuestion(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(question); } }} />
            <Button size="sm" type="submit" disabled={!question.trim() || asking}><SendHorizontal size={14} aria-hidden="true" />{tr(l, "Ask", "Itanong")}</Button>
        </form>
    </section>;
}
