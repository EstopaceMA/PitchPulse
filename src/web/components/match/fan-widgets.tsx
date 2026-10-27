"use client";

import { BookOpenText, Crosshair, Flame, Goal, Hourglass, History, Waves, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isKeyMoment } from "@/lib/match/commentary";
import { focusMetricLabel, focusMetricText, focusOwner } from "@/lib/match/overlays";
import { formatTime } from "@/lib/match/playback";
import { eventLabel, outcomeLabel, teamColor, tr } from "@/lib/match/presentation";
import { emptyMetrics, emptyQuality } from "@/lib/match/statistics";
import type { Insight, MatchData, MatchEvent, Preferences, Statistics } from "@/lib/match/types";

const STORY_LIMIT = 8;
const STORY_RULES = new Set<Insight["rule"]>(["goal_context", "drought", "momentum", "pressing", "shots"]);
const ICONS: Partial<Record<Insight["rule"], LucideIcon>> = { goal_context: Goal, drought: Hourglass, momentum: Waves, pressing: Flame };
interface StoryItem { id: string; at: number; teamId: string | null; playerId: string | null; headline: string; text: string; eventId: string; icon: LucideIcon }

/**
 * Plain-language moments from the processed prefix: why-it-matters cards in their casual wording, plus shots that
 * tested the goalkeeper. Goals appear through their goal-context card; a goal whose card left history still shows.
 */
export function storyItems(data: MatchData, events: readonly MatchEvent[], insights: readonly Insight[], preferences: Preferences): StoryItem[] {
    const l = preferences.language;
    const name = (id: string | null) => data.players.find(player => player.player_id === id)?.name ?? "";
    const favorites = new Set([preferences.player, ...preferences.favorites ?? []]);
    const fromRules = insights.filter(insight => STORY_RULES.has(insight.rule) || (insight.rule === "player" && insight.playerId && favorites.has(insight.playerId))).map(insight => ({
        id: insight.id, at: insight.at, teamId: insight.teamId, playerId: insight.playerId ?? null, headline: insight.headline, text: insight.casual,
        eventId: insight.eventIds.at(-1) ?? "", icon: ICONS[insight.rule] ?? Crosshair,
    }));
    const explained = new Set(fromRules.map(item => item.eventId));
    const moments = events.filter(event => isKeyMoment(event) && !explained.has(event.event_id)).map(event => ({
        id: event.event_id, at: event.match_time_seconds, teamId: event.team_id, playerId: event.player_id,
        headline: `${name(event.player_id)} · ${eventLabel(event, l)}`, text: `${data.teams.find(team => team.team_id === event.team_id)?.name ?? ""} · ${outcomeLabel(event, l)}`,
        eventId: event.event_id, icon: event.outcome === "goal" ? Goal : Crosshair,
    }));
    return [...fromRules, ...moments].filter(item => item.eventId).sort((left, right) => right.at - left.at).slice(0, STORY_LIMIT);
}

function Scoreline({ data, stats, elapsed }: { data: MatchData; stats: Statistics; elapsed: number }) {
    const home = data.match.home_team_id, away = data.match.away_team_id;
    const team = (id: string) => data.teams.find(entry => entry.team_id === id)?.name ?? id;
    return <div className="story-score" dir="ltr">
        <span style={{ color: teamColor(home, home) }}>{team(home)}</span>
        <b>{stats.teams[home]?.goals ?? 0}–{stats.teams[away]?.goals ?? 0}</b>
        <span style={{ color: teamColor(away, home) }}>{team(away)}</span>
        <time>{formatTime(elapsed)}</time>
    </div>;
}

/** The casual perspective's home tab: the score and the story so far, newest first, favourites marked. */
export function StoryPanel({ data, events, stats, insights, preferences, elapsed, onEvidence, aiLines }: { data: MatchData; events: readonly MatchEvent[]; stats: Statistics; insights: readonly Insight[]; preferences: Preferences; elapsed: number; onEvidence: (id: string) => void; aiLines?: ReadonlyMap<string, string> }) {
    const l = preferences.language;
    const favorites = new Set([preferences.player, ...preferences.favorites ?? []]);
    const items = storyItems(data, events, insights, preferences);
    return <section className="panel story-panel" aria-labelledby="story-heading">
        <div className="panel-heading"><div className="heading-icon"><BookOpenText size={17} /><h2 id="story-heading">{tr(l, "theStorySoFar")}</h2></div></div>
        <Scoreline data={data} stats={stats} elapsed={elapsed} />
        {items.length ? <ol className="story-list">{items.map(item => {
            const Icon = item.icon, favorite = item.teamId === preferences.team || (item.playerId !== null && favorites.has(item.playerId));
            return <li key={item.id} className={favorite ? "favorite" : undefined} style={{ borderColor: teamColor(item.teamId, data.match.home_team_id) }}>
                <time>{formatTime(item.at)}</time>
                <span className="story-icon"><Icon size={15} aria-hidden="true" /></span>
                <div><strong>{item.headline}</strong><p>{item.text}</p>{aiLines?.get(item.eventId) && <p className="commentary-ai"><span className="ai-tag">AI</span>{aiLines.get(item.eventId)}</p>}<Button size="sm" variant="ghost" onClick={() => onEvidence(item.eventId)}>{tr(l, "seeThisMoment")}</Button></div>
            </li>;
        })}</ol> : <p className="story-empty">{tr(l, "storyEmpty")}</p>}
    </section>;
}

/** Shown when a match reopens part-way through, until dismissed or playback moves on. */
export function CatchUpCard({ data, events, stats, insights, preferences, elapsed, onDismiss }: { data: MatchData; events: readonly MatchEvent[]; stats: Statistics; insights: readonly Insight[]; preferences: Preferences; elapsed: number; onDismiss: () => void }) {
    const l = preferences.language;
    const lines = storyItems(data, events, insights, { ...preferences, favorites: [] }).filter(item => item.icon !== Crosshair).slice(0, 3);
    return <section className="catch-up" aria-labelledby="catch-up-heading">
        <div className="catch-up-heading"><History size={15} aria-hidden="true" /><h2 id="catch-up-heading">{tr(l, "catchUp")}</h2><Button size="icon" variant="ghost" aria-label={tr(l, "dismissCatchUp")} onClick={onDismiss}><X size={14} /></Button></div>
        <Scoreline data={data} stats={stats} elapsed={elapsed} />
        {lines.length ? <ul>{lines.map(line => <li key={line.id}><time>{formatTime(line.at)}</time> {line.text}</li>)}</ul> : <p>{tr(l, "catchUpQuiet")}</p>}
    </section>;
}

/** The viewer's chosen number for their focus player or favourite team, pulsing when it changes. */
export function MyMetricBug({ data, stats, preferences }: { data: MatchData; stats: Statistics; preferences: Preferences }) {
    if (!preferences.metric) return null;
    const owner = focusOwner(data, preferences), label = focusMetricLabel(preferences.metric, preferences.language);
    const metrics = (owner.playerId ? stats.players[owner.playerId] : stats.teams[owner.teamId]) ?? emptyMetrics();
    const quality = (owner.playerId ? stats.quality.players[owner.playerId] : stats.quality.teams[owner.teamId]) ?? emptyQuality();
    const value = focusMetricText(preferences.metric, metrics, quality, preferences.units);
    return <div className="my-metric-bug" title={`${label} · ${owner.name}`} aria-label={`${tr(preferences.language, "myMetric")}: ${label}, ${owner.name}, ${value}`}>
        <small>{label} · {owner.name}</small><b key={value} dir="ltr">{value}</b>
    </div>;
}
