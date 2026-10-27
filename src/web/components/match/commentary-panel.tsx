"use client";

import { useId } from "react";
import { ArrowLeftRight, ArrowUpRight, Clock3, MessageSquareText, Sparkles, Target, Trophy, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isKeyMoment, isMeaningful } from "@/lib/match/commentary";
import { formatTime } from "@/lib/match/playback";
import { eventLabel, outcomeLabel, tr } from "@/lib/match/presentation";
import type { Language, MatchData, MatchEvent, Preferences } from "@/lib/match/types";

export interface CommentaryPanelProps {
    data: MatchData;
    /** Ordered, processed events only; match metadata must not supply the timeline. */
    events: readonly MatchEvent[];
    preferences: Preferences;
    onEvidence: (id: string) => void;
    /** Present only when the Live Commentator agent is enabled; rows keep their templated facts either way. */
    narration?: { lines: ReadonlyMap<string, string>; pending: number; loading: boolean; errorText?: string; onNarrate: () => void };
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

function CommentaryItem({ data, event, language, onEvidence, line }: { data: MatchData; event: MatchEvent; language: Language; onEvidence: (id: string) => void; line?: string }) {
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
                <strong className="commentary-player">{player?.name ?? event.player_id ?? tr(language, "matchEvent")}</strong>
                <p className="commentary-description">
                    <span className="commentary-team">{team?.name ?? event.team_id ?? tr(language, "neutral")}</span>
                    {" · "}{label}{" · "}<span className="commentary-outcome">{outcomeLabel(event, language)}</span>
                </p>
                {line && <p className="commentary-ai"><span className="ai-tag">AI</span>{line}</p>}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="commentary-evidence"
                    aria-label={tr(language, "evidenceForEvent", { label, time, id: event.event_id })}
                    onClick={() => onEvidence(event.event_id)}
                >
                    {tr(language, "evidence")} <span className="commentary-evidence-id">{event.event_id}</span>
                </Button>
            </div>
        </li>
    );
}

export function CommentaryPanel({ data, events, preferences, onEvidence, narration }: CommentaryPanelProps) {
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
                <div className="heading-icon"><MessageSquareText size={17} aria-hidden="true" /><h2 id={`${id}-heading`}>{tr(language, "liveCommentary")}</h2></div>
                <span className="micro-label">{tr(language, "simulatedEventBased")}</span>
            </div>
            {narration && <div className="agent-actions commentary-narrate">
                <Button size="sm" variant="outline" onClick={narration.onNarrate} disabled={narration.loading || narration.pending === 0}><Sparkles size={14} aria-hidden="true" />{tr(language, "narrateWithAi")}</Button>
                <p className="agent-status" role="status" aria-live="polite">{narration.loading ? tr(language, "writingCommentary") : narration.errorText ?? (narration.pending === 0 ? tr(language, "everyReachedMomentIsNarrated") : tr(language, "narrateRecentMoments", { count: narration.pending }))}</p>
            </div>}
            {recent.length ? (
                <ol className="commentary-list" aria-label={tr(language, "recentCommentaryLatestFirst")}>
                    {recent.map(event => <CommentaryItem key={event.event_id} data={data} event={event} language={language} onEvidence={onEvidence} line={narration?.lines.get(event.event_id)} />)}
                </ol>
            ) : (
                <p className="commentary-empty data-note">{tr(language, "noMeaningfulEventsReachedYetPlayOrStep")}</p>
            )}
            <section className="key-moments" aria-labelledby={`${id}-moments-heading`}>
                <h3 id={`${id}-moments-heading`}>{tr(language, "keyMoments")}</h3>
                {moments.length ? (
                    <ol className="key-moments-list" aria-label={tr(language, "goalsAndShotsOnTargetLatestFirst")}>
                        {moments.map(event => <CommentaryItem key={event.event_id} data={data} event={event} language={language} onEvidence={onEvidence} line={narration?.lines.get(event.event_id)} />)}
                    </ol>
                ) : (
                    <p className="key-moments-empty data-note">{tr(language, "noGoalsOrShotsOnTargetReachedYet")}</p>
                )}
            </section>
        </section>
    );
}
