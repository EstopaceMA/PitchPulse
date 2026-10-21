"use client";

import { useId, useMemo, useState } from "react";
import { ArrowLeftRight, ArrowUpRight, ChevronDown, Clock3, ListFilter, Target, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { formatTime } from "@/lib/match/playback";
import { eventLabel, outcomeLabel, teamColor, tr } from "@/lib/match/presentation";
import { EVENT_TYPES, type EventType, type Language, type MatchData, type MatchEvent, type Preferences } from "@/lib/match/types";

export interface EventFeedProps {
    data: MatchData;
    events: readonly MatchEvent[];
    preferences: Preferences;
    selectedId: string | null;
    onSelect: (event: MatchEvent) => void;
    hideDetails?: boolean;
}

type TeamFilter = "all" | "home" | "away";
type TypeFilter = "all" | EventType;
const PAGE_SIZE = 60;
const TYPE_LABELS: Record<EventType, readonly [string, string]> = {
    match_start: ["Match started", "Nagsimula ang laban"],
    kickoff: ["Kick-off", "Simula ng laro"],
    pass: ["Pass", "Pasa"],
    shot: ["Shot", "Tira"],
    tackle: ["Tackle", "Agaw"],
    pressure: ["Pressure", "Pagdiin"],
    possession_change: ["Possession change", "Pagpalit ng may bola"],
    half_time: ["Half-time", "Pahinga"],
    second_half_start: ["Second half", "Ikalawang hati"],
    full_time: ["Full-time", "Tapos na"],
};

function eventIcon(type: EventType) {
    switch (type) {
        case "pass":
        case "kickoff":
            return ArrowUpRight;
        case "shot":
            return Target;
        case "tackle":
        case "pressure":
            return Zap;
        case "possession_change":
            return ArrowLeftRight;
        default:
            return Clock3;
    }
}

function intensityLabel(intensity: string, language: Language): string {
    switch (intensity) {
        case "high": return tr(language, "High", "Mataas");
        case "medium": return tr(language, "Medium", "Katamtaman");
        case "low": return tr(language, "Low", "Mababa");
        default: return intensity.replaceAll("_", " ");
    }
}

export function EventDetails({ data, event, language, id }: { data: MatchData; event: MatchEvent; language: Language; id: string }) {
    const playerName = (playerId: string) => data.players.find(player => player.player_id === playerId)?.name ?? playerId;
    const intendedRecipient = event.outcome === "intercepted" || event.outcome === "incomplete";

    return (
        <section className="event-details evidence" id={id} aria-labelledby={`${id}-heading`}>
            <h3 id={`${id}-heading`}>{tr(language, "Event details", "Mga detalye ng pangyayari")}</h3>
            <p>
                <time>{formatTime(event.match_time_seconds)}</time> · {eventLabel(event, language)} · {outcomeLabel(event, language)}
            </p>
            <dl className="detail-grid">
                <div><dt>{tr(language, "Event ID", "ID ng pangyayari")}</dt><dd>{event.event_id}</dd></div>
                <div><dt>{tr(language, "Sequence", "Pagkakasunod")}</dt><dd>{event.sequence}</dd></div>
                <div><dt>{tr(language, "Period", "Hati")}</dt><dd>{event.period}</dd></div>
                <div><dt>{tr(language, "Possession ID", "ID ng paghawak ng bola")}</dt><dd>{event.possession_id ?? tr(language, "Not recorded", "Hindi naitala")}</dd></div>
                <div>
                    <dt>{tr(language, "Player", "Manlalaro")}</dt>
                    <dd>{event.player_id ? playerName(event.player_id) : tr(language, "Match event", "Pangyayari sa laban")}</dd>
                </div>
                <div>
                    <dt>{tr(language, "Team", "Koponan")}</dt>
                    <dd>{data.teams.find(team => team.team_id === event.team_id)?.name ?? event.team_id ?? tr(language, "Neutral", "Walang koponan")}</dd>
                </div>
                {event.recipient_player_id && (
                    <div>
                        <dt>{intendedRecipient ? tr(language, "Intended recipient", "Nilalayong tatanggap") : tr(language, "Recipient", "Tatanggap")}</dt>
                        <dd>{playerName(event.recipient_player_id)}</dd>
                    </div>
                )}
                {event.target_player_id && (
                    <div><dt>{tr(language, "Target player", "Pinuntiryang manlalaro")}</dt><dd>{playerName(event.target_player_id)}</dd></div>
                )}
                {event.distance_m !== undefined && (
                    <div><dt>{tr(language, "Distance", "Distansiya")}</dt><dd>{event.distance_m} m</dd></div>
                )}
                {event.difficulty_rating !== undefined && (
                    <div>
                        <dt>{tr(language, "Difficulty · illustrative estimate", "Hirap · halimbawang tantiya")}</dt>
                        <dd>{event.difficulty_rating}</dd>
                    </div>
                )}
                {event.synthetic_xg !== undefined && (
                    <div>
                        <dt>{tr(language, "Synthetic xG · illustrative estimate", "Sintetikong xG · halimbawang tantiya")}</dt>
                        <dd>{event.synthetic_xg}</dd>
                    </div>
                )}
                {event.intensity && (
                    <div><dt>{tr(language, "Intensity", "Tindi")}</dt><dd>{intensityLabel(event.intensity, language)}</dd></div>
                )}
            </dl>
            {event.difficulty_rating !== undefined && (
                <p className="data-note">{tr(language, "Difficulty is an illustrative estimate, not a completion probability.", "Ang hirap ay halimbawang tantiya, hindi probabilidad ng matagumpay na pasa.")}</p>
            )}
            {event.synthetic_xg !== undefined && (
                <p className="data-note">{tr(language, "Synthetic xG is an illustrative estimate, not a validated expected-goals model or calibrated scoring probability.", "Ang sintetikong xG ay halimbawang tantiya, hindi beripikadong modelo ng inaasahang gol o nasukat na probabilidad ng pag-iskor.")}</p>
            )}
            <p className="data-note">{tr(language, "Values come only from this processed event. No inferred movement or extra metrics.", "Mula lamang sa naprosesong pangyayaring ito ang mga halaga. Walang hinulaang galaw o dagdag na sukatan.")}</p>
        </section>
    );
}

export function EventFeed({ data, events, preferences, selectedId, onSelect, hideDetails = false }: EventFeedProps) {
    const id = useId();
    const { language, mode } = preferences;
    const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
    const [playerFilter, setPlayerFilter] = useState<string | null>(null);
    const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
    const [limit, setLimit] = useState(PAGE_SIZE);

    // Null follows player focus; an explicit choice (including "all") overrides it.
    const focusedPlayer = mode === "player" && data.players.some(player => player.player_id === preferences.player)
        ? preferences.player
        : "all";
    const effectivePlayer = playerFilter ?? focusedPlayer;
    const teamId = teamFilter === "home" ? data.match.home_team_id : teamFilter === "away" ? data.match.away_team_id : null;
    const filteredEvents = useMemo(() => events
        .filter(event => (teamId === null || event.team_id === teamId)
            && (effectivePlayer === "all" || event.player_id === effectivePlayer)
            && (typeFilter === "all" || event.type === typeFilter))
        .sort((a, b) => b.match_time_seconds - a.match_time_seconds || b.sequence - a.sequence),
        [events, teamId, effectivePlayer, typeFilter]);
    const visibleEvents = filteredEvents.slice(0, limit);
    // Selection must still be processed, but need not match the current filters/page.
    const selectedEvent = events.find(event => event.event_id === selectedId);
    const detailsId = `${id}-details`;
    const homeName = data.teams.find(team => team.team_id === data.match.home_team_id)?.name ?? data.match.home_team_id;
    const awayName = data.teams.find(team => team.team_id === data.match.away_team_id)?.name ?? data.match.away_team_id;

    return (
        <section className="panel event-feed" aria-labelledby={`${id}-heading`}>
            <div className="panel-heading">
                <div className="heading-icon"><ListFilter size={17} aria-hidden="true" /><h2 id={`${id}-heading`}>{tr(language, "Event feed", "Mga pangyayari")}</h2></div>
                <span className="micro-label">{filteredEvents.length} {tr(language, "matching", "tugma")} · {events.length} {tr(language, "processed", "naproseso")}</span>
            </div>
            <p className="data-note">{tr(language, "Latest first. Only events reached in playback are shown.", "Pinakabago muna. Mga pangyayaring naabot lamang sa pag-play ang ipinapakita.")}</p>
            <div className="feed-filters">
                <label className="select-field" htmlFor={`${id}-team`}>
                    <span>{tr(language, "Team", "Koponan")}</span>
                    <Select id={`${id}-team`} label={tr(language, "Team", "Koponan")} value={teamFilter} onValueChange={value => {
                        setTeamFilter(value as TeamFilter);
                        setLimit(PAGE_SIZE);
                    }} options={[
                        { value: "all", label: tr(language, "All teams", "Lahat ng koponan") },
                        { value: "home", label: `${tr(language, "Home", "Tahanan")} · ${homeName}` },
                        { value: "away", label: `${tr(language, "Away", "Dayo")} · ${awayName}` },
                    ]} />
                </label>
                <label className="select-field" htmlFor={`${id}-player`}>
                    <span>{tr(language, "Player", "Manlalaro")}</span>
                    <Select id={`${id}-player`} label={tr(language, "Player", "Manlalaro")} value={effectivePlayer} onValueChange={value => {
                        setPlayerFilter(value);
                        setLimit(PAGE_SIZE);
                    }} options={[
                        { value: "all", label: tr(language, "All players", "Lahat ng manlalaro") },
                        ...data.teams.flatMap(team => data.players.filter(player => player.team_id === team.team_id).map(player => ({ value: player.player_id, label: player.name, group: team.name }))),
                    ]} />
                </label>
                <label className="select-field" htmlFor={`${id}-type`}>
                    <span>{tr(language, "Event type", "Uri ng pangyayari")}</span>
                    <Select id={`${id}-type`} label={tr(language, "Event type", "Uri ng pangyayari")} value={typeFilter} onValueChange={value => {
                        setTypeFilter(value as TypeFilter);
                        setLimit(PAGE_SIZE);
                    }} options={[
                        { value: "all", label: tr(language, "All event types", "Lahat ng uri") },
                        ...EVENT_TYPES.map(type => ({ value: type, label: tr(language, ...TYPE_LABELS[type]) })),
                    ]} />
                </label>
            </div>

            {events.length === 0 ? (
                <div className="feed-empty" role="status">
                    <Clock3 size={24} aria-hidden="true" />
                    <h3>{tr(language, "No events reached yet", "Wala pang naabot na pangyayari")}</h3>
                    <p>{tr(language, "Play or step through the match to reveal recorded events.", "I-play o isa-isang isulong ang laban upang makita ang mga naitalang pangyayari.")}</p>
                </div>
            ) : filteredEvents.length === 0 ? (
                <div className="feed-empty" role="status">
                    <ListFilter size={24} aria-hidden="true" />
                    <h3>{tr(language, "No matching events", "Walang tugmang pangyayari")}</h3>
                    <p>{tr(language, "Processed events exist. Try another team, player, or event type.", "May mga naprosesong pangyayari. Pumili ng ibang koponan, manlalaro, o uri.")}</p>
                </div>
            ) : (
                <>
                    <ol className="feed-list" aria-label={tr(language, "Processed events, latest first", "Mga naprosesong pangyayari, pinakabago muna")}>
                        {visibleEvents.map(event => {
                            const Icon = eventIcon(event.type);
                            const player = data.players.find(player => player.player_id === event.player_id);
                            const team = data.teams.find(team => team.team_id === event.team_id);
                            const selected = event.event_id === selectedId;
                            const goal = event.type === "shot" && event.outcome === "goal";
                            const favorite = event.team_id === preferences.team || event.player_id === preferences.player;

                            return (
                                <li key={event.event_id}>
                                    <button
                                        type="button"
                                        className={`event-card${selected ? " selected" : ""}${goal ? " goal" : ""}${favorite ? " favorite" : ""}`}
                                        aria-pressed={selected}
                                        aria-controls={selected && !hideDetails ? detailsId : undefined}
                                        onClick={() => onSelect(event)}
                                    >
                                        <time className="event-time">{formatTime(event.match_time_seconds)}</time>
                                        <span className="event-icon"><Icon size={16} aria-hidden="true" /></span>
                                        <span className="event-content">
                                            <strong>{player?.name ?? event.player_id ?? tr(language, "Match event", "Pangyayari sa laban")}</strong>
                                            <span>
                                                <i className="tiny-dot" style={{ background: teamColor(event.team_id, data.match.home_team_id) }} aria-hidden="true" />
                                                {team?.name ?? event.team_id ?? tr(language, "Neutral", "Walang koponan")} · {eventLabel(event, language)}
                                            </span>
                                        </span>
                                        <span className="event-outcome">{outcomeLabel(event, language)}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                    <div className="feed-pagination">
                        <span className="data-note">{tr(language, `Showing ${visibleEvents.length} of ${filteredEvents.length} matching events`, `Ipinapakita ang ${visibleEvents.length} sa ${filteredEvents.length} tugmang pangyayari`)}</span>
                        {visibleEvents.length < filteredEvents.length && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => setLimit(current => current + PAGE_SIZE)}>
                                <ChevronDown size={14} aria-hidden="true" />{tr(language, "Show 60 more", "Ipakita ang 60 pa")}
                            </Button>
                        )}
                    </div>
                </>
            )}

            {!hideDetails && (selectedEvent ? (
                <EventDetails data={data} event={selectedEvent} language={language} id={detailsId} />
            ) : (
                <p className="data-note">{tr(language, "Select an event to inspect its recorded details and highlight it on the pitch.", "Pumili ng pangyayari upang suriin ang naitalang detalye at itampok ito sa pitch.")}</p>
            ))}
        </section>
    );
}
