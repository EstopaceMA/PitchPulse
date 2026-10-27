"use client";

import { useId } from "react";
import { ChevronDown, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentRecap } from "@/lib/agents/contracts";
import { formatTime } from "@/lib/match/playback";
import { tr } from "@/lib/match/presentation";
import type { AgentTask } from "@/lib/match/use-agents";
import type { MatchData, MatchEvent, Preferences } from "@/lib/match/types";
import { AiBadge, agentErrorText } from "./agent-insights";

/** Shown below the unchanged deterministic recap; it never replaces it. */
export function AgentRecapPanel({ data, events, preferences, kind, task, onWrite, onEvidence }: {
    data: MatchData; events: readonly MatchEvent[]; preferences: Preferences; kind: AgentRecap["kind"];
    task: AgentTask<AgentRecap>; onWrite: () => void; onEvidence: (id: string) => void;
}) {
    const id = useId();
    const l = preferences.language;
    const recap = task.status === "done" ? task.result : undefined;
    const times = new Map(events.map(event => [event.event_id, event.match_time_seconds]));
    const teamNames = new Map(data.teams.map(team => [team.team_id, team.name]));
    return <section className="panel agent-panel agent-recap" aria-labelledby={`${id}-heading`} lang={l}>
        <div className="panel-heading"><div className="heading-icon"><ScrollText size={17} aria-hidden="true" /><h2 id={`${id}-heading`}>{kind === "half-time" ? tr(l, "aiHalfTimeStory") : tr(l, "aiFullTimeStory")}</h2></div><AiBadge language={l} /></div>
        {!recap && <div className="agent-actions">
            <Button size="sm" onClick={onWrite} disabled={task.status === "loading"}><ScrollText size={14} aria-hidden="true" />{tr(l, "writeAiRecap")}</Button>
            <p className="agent-status" role="status" aria-live="polite">{task.status === "loading" ? tr(l, "writingTheRecap") : task.status === "error" ? agentErrorText(task.error, l) : tr(l, "aNarrativeOfTheReachedMatchCheckedAgainst")}</p>
        </div>}
        {recap && <div className="agent-recap-body">
            <p className="agent-story">{recap.story}</p>
            {recap.turningPoints.length > 0 && <>
                <h3>{tr(l, "turningPoints")}</h3>
                <ol className="agent-points">{recap.turningPoints.map(point => {
                    const time = formatTime(times.get(point.eventId) ?? 0);
                    return <li key={point.eventId}><time>{time}</time><span>{point.caption}</span><button type="button" onClick={() => onEvidence(point.eventId)} aria-label={`${tr(l, "viewEvidence")}: ${time}`}>{tr(l, "viewEvidence")}</button></li>;
                })}</ol>
            </>}
            {recap.teamNotes.map(note => <div className="agent-team-note" key={note.teamId}>
                <h3>{teamNames.get(note.teamId) ?? note.teamId}</h3>
                <p>{note.observed}</p>
                <div className="insight-metrics">{note.metrics.map((metric, index) => <span key={index}><b>{metric.value}</b> {metric.label}</span>)}</div>
                <p className="inference"><b>{tr(l, "possibleMeaning")}</b>{note.interpretation}</p>
                <details className="evidence"><summary>{note.evidenceTotal > note.eventIds.length ? tr(l, "latestSupportingEvents", { shown: note.eventIds.length, total: note.evidenceTotal }) : `${note.eventIds.length} ${tr(l, "supportingEvents")}`}<ChevronDown size={13} aria-hidden="true" /></summary><div className="evidence-ids">{note.eventIds.map(eventId => <button type="button" key={eventId} onClick={() => onEvidence(eventId)}>{eventId}</button>)}</div></details>
            </div>)}
            {recap.watchNext && <p className="agent-watch"><b>{tr(l, "questionsForTheSecondHalf")}</b>{recap.watchNext}</p>}
            <p className="agent-note">{tr(l, "processedEventsOnlyInterpretationsArePossibilitiesNotPredictions")}</p>
        </div>}
    </section>;
}
