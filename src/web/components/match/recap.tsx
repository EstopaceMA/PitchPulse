"use client";

import { useId } from "react";
import { formatTime } from "@/lib/match/playback";
import { tr } from "@/lib/match/presentation";
import { emptyMetrics } from "@/lib/match/statistics";
import type { Insight, MatchData, MatchEvent, Preferences, Statistics } from "@/lib/match/types";
import { InsightCard } from "./insights-panel";
import { Comparison } from "./statistics-panel";

export interface RecapProps {
    data: MatchData;
    events: readonly MatchEvent[];
    stats: Statistics;
    insights: Insight[];
    preferences: Preferences;
    kind: "half-time" | "full-time";
    onEvidence: (id: string) => void;
    onContinue: () => void;
}

export function Recap({ data, events, stats, insights, preferences, kind, onEvidence, onContinue }: RecapProps) {
    const id = useId();
    const language = preferences.language;
    const halfTime = kind === "half-time";
    const boundary = halfTime ? data.match.period_seconds : data.match.duration_seconds;
    const homeId = data.match.home_team_id;
    const awayId = data.match.away_team_id;
    const teamNames = new Map(data.teams.map(team => [team.team_id, team.name]));
    const playerNames = new Map(data.players.map(player => [player.player_id, player.name]));
    const home = stats.teams[homeId] ?? emptyMetrics();
    const away = stats.teams[awayId] ?? emptyMetrics();
    const comparisonStats: Statistics = {
        ...stats,
        teams: { ...stats.teams, [homeId]: home, [awayId]: away },
    };

    // Only the supplied processed prefix is eligible, including period-one events
    // at half-time but never period-two events sharing that timestamp.
    const reached = events.filter(event => event.match_time_seconds <= boundary && (!halfTime || event.period === 1));
    const reachedIds = new Set(reached.map(event => event.event_id));
    const lastEventTime = reached.reduce((latest, event) => Math.max(latest, event.match_time_seconds), 0);
    const goals = reached.filter(event => event.type === "shot" && event.outcome === "goal")
        .sort((a, b) => a.match_time_seconds - b.match_time_seconds || a.sequence - b.sequence);

    // Rank a single observed count, not an invented weighted performance score.
    const contributors = data.players.map(player => ({ player, metrics: stats.players[player.player_id] ?? emptyMetrics() }))
        .filter(({ metrics }) => metrics.actions > 0)
        .sort((a, b) => b.metrics.actions - a.metrics.actions
            || (a.player.player_id < b.player.player_id ? -1 : a.player.player_id > b.player.player_id ? 1 : 0))
        .slice(0, 3);

    const latestPatterns = new Map<string, Insight>();
    for (const insight of insights) {
        // Keep a card's complete evidence; omit it rather than truncate future or
        // missing evidence and leave its explanation unsupported.
        if (insight.at > lastEventTime || insight.eventIds.length === 0
            || !insight.eventIds.every(eventId => reachedIds.has(eventId))) continue;
        const key = JSON.stringify([insight.rule, insight.teamId]);
        const previous = latestPatterns.get(key);
        if (!previous || insight.at >= previous.at) latestPatterns.set(key, insight);
    }
    const patterns = [...latestPatterns.values()].sort((a, b) => b.at - a.at).slice(0, 3);

    return (
        <section className="panel recap-panel" aria-labelledby={`${id}-title`} lang={language}>
            <header className="recap-header">
                <div>
                    <h2 id={`${id}-title`}>{halfTime
                        ? tr(language, "halfTimeRecap")
                        : tr(language, "fullTimeRecap")}</h2>
                    <p>{teamNames.get(homeId) ?? homeId} <strong>{home.goals} – {away.goals}</strong> {teamNames.get(awayId) ?? awayId}</p>
                    <p className="data-note">{tr(language, "processedEventsOnlyThrough")} {formatTime(boundary)}.</p>
                </div>
                <button type="button" className="primary-action" onClick={onContinue}>
                    {halfTime
                        ? tr(language, "startSecondHalf")
                        : tr(language, "restartReplay")}
                </button>
            </header>

            <div className="recap-grid">
                <section className="recap-section" aria-labelledby={`${id}-goals`}>
                    <h3 id={`${id}-goals`}>{tr(language, "goalMoments")}</h3>
                    {goals.length ? <ul>{goals.map(event => {
                        const scorer = playerNames.get(event.player_id ?? "") ?? tr(language, "unknownScorer");
                        const team = teamNames.get(event.team_id ?? "") ?? event.team_id;
                        const time = formatTime(event.match_time_seconds);
                        return (
                            <li className="goal-moment" key={event.event_id}>
                                <time dateTime={`PT${event.match_time_seconds}S`}>{time}</time>
                                <div><strong>{scorer}</strong>{team && <span> · {team}</span>}</div>
                                <button type="button" onClick={() => onEvidence(event.event_id)}
                                    aria-label={`${tr(language, "viewEvidence")}: ${scorer}, ${time}`}>
                                    {tr(language, "viewEvidence")}
                                </button>
                            </li>
                        );
                    })}</ul> : <p>{tr(language, "noGoalsRecorded")}</p>}
                </section>

                <section className="recap-section" aria-labelledby={`${id}-statistics`}>
                    <h3 id={`${id}-statistics`}>{tr(language, "teamStatistics")}</h3>
                    <Comparison data={data} stats={comparisonStats} language={language} />
                    <p className="data-note">{tr(language, "statisticsDataNote")}</p>
                </section>

                <section className="recap-section" aria-labelledby={`${id}-contributions`}>
                    <h3 id={`${id}-contributions`}>{tr(language, "notablePlayerContributions")}</h3>
                    <p className="data-note">{tr(language,
                        "upToThreePlayersByRecordedActionCount")}</p>
                    {contributors.length ? <ul>{contributors.map(({ player, metrics }) => (
                        <li className="contribution-row" key={player.player_id}>
                            <div><strong>{player.name}</strong><span> · {teamNames.get(player.team_id) ?? player.team_id}</span></div>
                            <div className="personal-numbers">
                                <span><b>{metrics.actions}</b> {tr(language, "actions")}</span>
                                <span><b>{metrics.goals}</b> {tr(language, "goals")}</span>
                                <span><b>{metrics.shots}</b> {tr(language, "shots")}</span>
                                <span><b>{metrics.passes_completed}/{metrics.passes_attempted}</b> {tr(language, "passesCompletedAttempted")}</span>
                            </div>
                        </li>
                    ))}</ul> : <p>{tr(language, "noPlayerActionsRecorded")}</p>}
                </section>

                <section className="recap-section" aria-labelledby={`${id}-patterns`}>
                    <h3 id={`${id}-patterns`}>{tr(language, "keyPatterns")}</h3>
                    {patterns.length ? patterns.map(insight => (
                        <InsightCard key={insight.id} insight={insight} preferences={preferences} onEvidence={onEvidence} compact />
                    )) : <p>{tr(language, "noSupportedPatternsRecordedYet")}</p>}
                </section>
            </div>
        </section>
    );
}