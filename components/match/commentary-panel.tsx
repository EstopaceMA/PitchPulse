"use client";

import { useId } from "react";
import { ArrowLeftRight, ArrowUpRight, Clock3, MessageSquareText, Target, Trophy, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/match/playback";
import { eventLabel, outcomeLabel, tr } from "@/lib/match/presentation";
import type { Language, MatchData, MatchEvent, Preferences } from "@/lib/match/types";

export interface CommentaryPanelProps {
    data: MatchData;
    /** Ordered, processed events only; match metadata must not supply the timeline. */
    events: readonly MatchEvent[];
    preferences: Preferences;
    onEvidence: (id: string) => void;
}

function isMeaningful(event: MatchEvent): boolean {
    // Keep milestones, shots, challenges and turnovers without routine-action noise.
    if (event.type === "pass") return event.outcome === "intercepted" || event.outcome === "incomplete";
    if (event.type === "pressure") return event.intensity === "high";
    if (event.type === "possession_change") return event.reason !== "shot_end";
    return true;
}

function isKeyMoment(event: MatchEvent): boolean {
    return event.type === "shot" && (event.outcome === "goal" || event.outcome === "saved" || event.outcome === "on_target");
}

function EventIcon({ event }: { event: MatchEvent }) {
    switch (event.type) {
        case "shot": return event.outcome === "goal" ? <Trophy size={16} aria-hidden="true" /> : <Target size={16} aria-hidden="true" />;
        case "pass":
        case "kickoff": return <ArrowUpRight size={16} aria-hidden="true" />;
        case "tackle":
        case "pressure": return <Zap size={16} aria-hidden="true" />;
        case "possession_change": return <ArrowLeftRight size={16} aria-hidden="true" />;
        default: return <Clock3 size={16} aria-hidden="true" />;
    }
}

function CommentaryItem({ data, event, language, onEvidence }: { data: MatchData; event: MatchEvent; language: Language; onEvidence: (id: string) => void }) {
    const player = data.players.find(candidate => candidate.player_id === event.player_id);
    const team = data.teams.find(candidate => candidate.team_id === event.team_id);
    const side = event.team_id === data.match.home_team_id ? "home" : event.team_id === data.match.away_team_id ? "away" : "neutral";
    const goal = event.type === "shot" && event.outcome === "goal";
    const time = formatTime(event.match_time_seconds);
    const label = eventLabel(event, language);

    return (
        <li className={`commentary-item ${side}${goal ? " goal" : ""}`} data-event-id={event.event_id}>
            <time className="commentary-time">{time}</time>
            <span className="commentary-icon"><EventIcon event={event} /></span>
            <div className="commentary-content">
                <strong className="commentary-player">{player?.name ?? event.player_id ?? tr(language, "Match event", "Pangyayari sa laban")}</strong>
                <p className="commentary-description">
                    <span className="commentary-team">{team?.name ?? event.team_id ?? tr(language, "Neutral", "Walang koponan")}</span>
                    {" · "}{label}{" · "}<span className="commentary-outcome">{outcomeLabel(event, language)}</span>
                </p>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="commentary-evidence"
                    aria-label={tr(language, `Evidence for ${label} at ${time}: ${event.event_id}`, `Ebidensiya para sa ${label} sa ${time}: ${event.event_id}`)}
                    onClick={() => onEvidence(event.event_id)}
                >
                    {tr(language, "Evidence", "Ebidensiya")} <span className="commentary-evidence-id">{event.event_id}</span>
                </Button>
            </div>
        </li>
    );
}

export function CommentaryPanel({ data, events, preferences, onEvidence }: CommentaryPanelProps) {
    const id = useId();
    const { language } = preferences;
    const recent: MatchEvent[] = [];
    const moments: MatchEvent[] = [];
    // Reverse traversal preserves sequence order at equal timestamps without mutating the prefix.
    // Key moments have their own limit, so older shots remain visible after recent challenges.
    for (let index = events.length - 1; index >= 0 && (recent.length < 5 || moments.length < 3); index--) {
        const event = events[index];
        if (recent.length < 5 && isMeaningful(event)) recent.push(event);
        if (moments.length < 3 && isKeyMoment(event)) moments.push(event);
    }

    return (
        <section className="panel commentary-panel" aria-labelledby={`${id}-heading`}>
            <div className="panel-heading">
                <div className="heading-icon"><MessageSquareText size={17} aria-hidden="true" /><h2 id={`${id}-heading`}>{tr(language, "Live commentary", "Live na komentaryo")}</h2></div>
                <span className="micro-label">{tr(language, "Simulated · event-based", "Simulado · batay sa pangyayari")}</span>
            </div>
            <p className="data-note">{tr(language, "Latest first. Only events reached in playback are shown.", "Pinakabago muna. Mga pangyayaring naabot lamang sa pag-play ang ipinapakita.")}</p>
            {recent.length ? (
                <ol className="commentary-list" aria-label={tr(language, "Recent commentary, latest first", "Kamakailang komentaryo, pinakabago muna")}>
                    {recent.map(event => <CommentaryItem key={event.event_id} data={data} event={event} language={language} onEvidence={onEvidence} />)}
                </ol>
            ) : (
                <p className="commentary-empty data-note">{tr(language, "No meaningful events reached yet. Play or step through the match to reveal commentary.", "Wala pang naabot na mahalagang pangyayari. I-play o isa-isang isulong ang laban upang makita ang komentaryo.")}</p>
            )}
            <section className="key-moments" aria-labelledby={`${id}-moments-heading`}>
                <h3 id={`${id}-moments-heading`}>{tr(language, "Key moments", "Mahahalagang sandali")}</h3>
                {moments.length ? (
                    <ol className="key-moments-list" aria-label={tr(language, "Goals and shots on target, latest first", "Mga gol at tirang sa target, pinakabago muna")}>
                        {moments.map(event => <CommentaryItem key={event.event_id} data={data} event={event} language={language} onEvidence={onEvidence} />)}
                    </ol>
                ) : (
                    <p className="key-moments-empty data-note">{tr(language, "No goals or shots on target reached yet.", "Wala pang naabot na gol o tirang sa target.")}</p>
                )}
            </section>
        </section>
    );
}