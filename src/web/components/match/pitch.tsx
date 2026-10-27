"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Activity, ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, Crosshair, Info, Radio, Settings2, Sparkles, UserRound, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime, pitchPosition } from "@/lib/match/playback";
import { buildMovementTimeline, sampleMovement } from "@/lib/match/movement";
import { bandLabel, distanceText, eventLabel, highlightText, outcomeLabel, rosterDisclosure, speedText, teamColor, tr } from "@/lib/match/presentation";
import { difficultyBand } from "@/lib/match/statistics";
import { activeHighlights, buildHighlights } from "@/lib/match/thresholds";
import type { Language, MatchData, MatchEvent, Position, Units } from "@/lib/match/types";
import { PitchLayers, type PitchLayer } from "./pitch-layers";
import { PlayerRoster, TeamMotion } from "./team-motion";

function subscribeMotion(callback: () => void) {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
}
const motionPreference = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverMotionPreference = () => false;
/** The viewer's reduced-motion preference; false during server rendering. */
export const useReducedMotion = () => useSyncExternalStore(subscribeMotion, motionPreference, serverMotionPreference);

/** Grass, lines and spots in the shared 760 × 510 pitch coordinates (playing area 38–722 × 34–476). */
export function PitchMarkings() {
    return <>
        <defs>
            <pattern id="grass" width="137" height="442" patternUnits="userSpaceOnUse"><rect width="68.5" height="442" fill="#ffffff" opacity=".018" /></pattern>
            <radialGradient id="field-glow"><stop offset="0" stopColor="#164333" /><stop offset="1" stopColor="#102a26" /></radialGradient>
        </defs>
        <rect x="25" y="21" width="710" height="468" rx="9" fill="url(#field-glow)" />
        <rect x="38" y="34" width="684" height="442" fill="url(#grass)" />
        <g fill="none" stroke="#9cbfb0" strokeOpacity=".32" strokeWidth="1.2">
            <rect x="38" y="34" width="684" height="442" rx="1" /><path d="M380 34V476" /><circle cx="380" cy="255" r="59.3" />
            <path d="M38 124H145.5V386H38 M722 124H614.5V386H722 M38 195H73.9V315H38 M722 195H686.1V315H722" />
            <path d="M145.5 208a59.3 59.3 0 0 1 0 94 M614.5 208a59.3 59.3 0 0 0 0 94" />
            <path d="M38 42a8 8 0 0 0 8-8 M714 34a8 8 0 0 0 8 8 M38 468a8 8 0 0 1 8 8 M714 476a8 8 0 0 1 8-8" />
            <path d="M38 231H25V279H38 M722 231H735V279H722" strokeOpacity=".7" />
        </g>
        <g fill="#b3d2c4" opacity=".5"><circle cx="380" cy="255" r="2.5" /><circle cx="110" cy="255" r="2" /><circle cx="650" cy="255" r="2" /></g>
    </>;
}

/** The synthetic per-event quality values worth showing beside an action, joined for one compact chip. */
export function qualitySummary(event: MatchEvent | undefined, language: Language, units: Units = "metric"): string | null {
    if (event?.type === "pass") {
        const parts = [
            event.distance_m !== undefined ? distanceText(event.distance_m, units) : null,
            event.difficulty_rating !== undefined ? bandLabel(difficultyBand(event.difficulty_rating), language) : null,
            event.ball_speed_kmh !== undefined ? speedText(event.ball_speed_kmh, units) : null,
        ].filter(Boolean);
        return parts.length ? parts.join(" · ") : null;
    }
    return event?.type === "shot" && event.shot_speed_kmh !== undefined ? speedText(event.shot_speed_kmh, units) : null;
}

export function Pitch({ data, events, elapsed, event, pinned, language, onLive, compact = false, actions, panelActions, analysis, units = "metric", focusPlayer, layer = "none" }: { data: MatchData; events: readonly MatchEvent[]; elapsed: number; event?: MatchEvent; pinned: boolean; language: Language; onLive: () => void; compact?: boolean; actions?: ReactNode; panelActions?: ReactNode; analysis?: { onAnalyze: () => void; disabled: boolean; loading: boolean }; units?: Units; focusPlayer?: string; layer?: PitchLayer }) {
    const [view, setView] = useState<"simulation" | "events">("simulation");
    const [sizing, setSizing] = useState<"fit" | "detailed">("fit");
    const [names, setNames] = useState(true);
    const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
    const reducedMotion = useReducedMotion();
    const simulation = view === "simulation";
    const prefix = useMemo(() => {
        const index = pinned && event ? events.findIndex(e => e.event_id === event.event_id) : -1;
        return index >= 0 ? events.slice(0, index + 1) : events;
    }, [events, event, pinned]);
    const timeline = useMemo(() => buildMovementTimeline(data, prefix), [data, prefix]);
    // A pinned event or reduced-motion preference shows a fixed event snapshot.
    // There is no animation timer: the shared simulation clock controls every move.
    const visualTime = pinned || reducedMotion ? prefix.at(-1)?.match_time_seconds ?? 0 : elapsed;
    const frame = useMemo(() => sampleMovement(timeline, visualTime), [timeline, visualTime]);
    // Built once per prefix; the per-frame window filter walks back only over recent highlights.
    const highlights = useMemo(() => buildHighlights(prefix), [prefix]);
    const shownHighlights = activeHighlights(highlights, visualTime);
    const latestHighlight = shownHighlights.at(-1);
    const quality = qualitySummary(event, language, units);
    const activeIds = new Set(frame.players.filter(p => p.active).map(p => p.playerId));
    const selectPlayer = (id: string) => setSelectedPlayer(previous => previous === id ? null : id);
    const home = data.match.home_team_id;
    const color = teamColor(event?.team_id ?? null, home);
    const ActionIcon = event?.type === "pass" || event?.type === "kickoff" ? ArrowUpRight : event?.type === "pressure" ? Radio : event?.type === "shot" ? Crosshair : Activity;
    const actor = data.players.find(p => p.player_id === event?.player_id);
    const recipient = data.players.find(p => p.player_id === event?.recipient_player_id);
    const selected = data.players.find(p => p.player_id === selectedPlayer);
    const origin = event?.start_position ?? event?.position;
    const endpoint = event?.end_position;
    const convert = (p: Position) => { const c = pitchPosition(p, event?.team_id ?? null, home); return { x: 38 + c.x * 6.84, y: 34 + c.y * 4.42 }; };
    const from = origin && convert(origin), to = endpoint && convert(endpoint);
    const ball = to ?? from;
    const failed = event?.type === "pass" && event.outcome !== "complete";
    const awayName = data.teams.find(t => t.team_id === data.match.away_team_id)?.name;
    const homeName = data.teams.find(t => t.team_id === home)?.name;
    const viewControls = (
        <div className="pitch-view-controls">
            <div role="group" aria-label={tr(language, "pitchView")}><button type="button" aria-pressed={simulation} onClick={() => setView("simulation")}><Users size={13} />{tr(language, "fullTeamSimulation")}</button><button type="button" aria-pressed={!simulation} onClick={() => setView("events")}><Crosshair size={13} />{tr(language, "recordedEvents")}</button></div>
            {simulation && <>
                <div className="pitch-sizing-controls" role="group" aria-label={tr(language, "pitchSize")}>
                    <Button type="button" size="sm" variant="ghost" aria-pressed={sizing === "fit"} aria-controls="pitch-stage" onClick={() => setSizing("fit")}>{tr(language, "fitPitch")}</Button>
                    <Button type="button" size="sm" variant="ghost" aria-pressed={sizing === "detailed"} aria-controls="pitch-stage" onClick={() => setSizing("detailed")}>{tr(language, "detailedView")}</Button>
                </div>
                <label><input type="checkbox" checked={names} onChange={e => setNames(e.target.checked)} />{tr(language, "playerNames")}</label>
            </>}
        </div>
    );
    return (
        <section className={`panel pitch-panel${compact ? " pitch-compact" : ""}`} id="pitch" aria-labelledby="pitch-heading">
            <div className="panel-heading">
                {panelActions && <div className="pitch-panel-actions">{panelActions}</div>}
                <div className={compact ? "sr-only" : "heading-icon"}><Crosshair size={17} /><h2 id="pitch-heading">{tr(language, "thePitch")}</h2><span className="subtle-label">2D</span></div>
                <div className="pitch-header-tools">
                    <div className="pitch-heading-status">
                        <span className="micro-label"><span className={`tiny-dot ${pinned ? "amber" : "green"}`} />{pinned ? tr(language, "reviewingEvent") : simulation ? tr(language, "simulatedMovement") : tr(language, "eventView")}</span>
                        {pinned && event && <time>{formatTime(event.match_time_seconds)}</time>}
                        {pinned && <Button type="button" size="sm" variant="outline" onClick={onLive}><X size={13} aria-hidden="true" />{tr(language, "followLive")}</Button>}
                    </div>
                    {compact && <details className="pitch-settings" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); e.stopPropagation(); } }}>
                        <summary aria-label={tr(language, "pitchViewSettings")}><Settings2 size={14} aria-hidden="true" />{tr(language, "view")}</summary>
                        {viewControls}
                    </details>}
                    {actions && <div className="pitch-header-actions">{actions}</div>}
                </div>
            </div>
            {!compact && viewControls}
            <div className="pitch-toolbar" dir="ltr"><span style={{ color: teamColor(data.match.away_team_id, home) }}><ArrowLeft size={13} />{awayName}</span><span>{tr(language, "fixedAttackingDirections")}</span><span style={{ color: teamColor(home, home) }}>{homeName}<ArrowRight size={13} /></span></div>
            <p className="pitch-disclosure">{[simulation ? tr(language, "illustrativeMovement") : tr(language, "recordedPositionsOnly"), rosterDisclosure(data, language)].filter(Boolean).join(" · ")}</p>
            <div id="pitch-stage" className={`pitch-stage${simulation ? ` full-team-stage pitch-${sizing}` : ""}`} tabIndex={simulation ? 0 : undefined} role={simulation ? "region" : undefined} aria-label={simulation ? sizing === "fit" ? tr(language, "fullTeamPitchFitPitchView") : tr(language, "fullTeamPitchScrollHorizontallyOnSmallScreens") : undefined}>
                <div className="pitch-canvas">
                {analysis && <Button type="button" size="sm" className="pitch-analyze-button" aria-haspopup="dialog" onClick={analysis.onAnalyze} disabled={analysis.disabled || analysis.loading}><Sparkles size={14} aria-hidden="true" />{analysis.loading ? tr(language, "analyzing") : tr(language, "analyze")}</Button>}
                {analysis?.loading && <div className="pitch-analysis-loading" role="status" aria-live="polite"><span className="pitch-analysis-spinner" aria-hidden="true" /><span>{tr(language, "analyzingThisMoment")}</span></div>}
                <svg viewBox="0 0 760 510" role={simulation ? "group" : "img"} aria-label={simulation ? tr(language, "illustrativePlayers", { count: frame.players.length }) : event ? `${formatTime(event.match_time_seconds)} ${actor?.name ?? ""} ${eventLabel(event, language)}. ${tr(language, "onlyRecordedEventPositionsAreShown")}` : tr(language, "emptyPitchStartPlaybackToSeeRecordedActions")}>
                    <defs><marker id="pass-arrow" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke={failed ? "#f4bb63" : color} strokeWidth="1.5" /></marker></defs>
                    <PitchMarkings />
                    {!simulation && !from && <g><rect x="226" y="218" width="308" height="74" rx="12" fill="#0a1d1b" fillOpacity=".8" stroke="#34564b" /><text x="380" y="249" textAnchor="middle" fill="#e0eee8" fontSize="14" fontWeight="600">{event ? eventLabel(event, language) : tr(language, "theStoryStartsAtKickOff")}</text><text x="380" y="273" textAnchor="middle" fill="#8eada0" fontSize="11">{event ? tr(language, "noLocationRecordedForThisEvent") : tr(language, "pressPlayFollowEveryMoment")}</text></g>}
                    {from && <g key={event?.event_id} className="event-arrival">
                        {event?.type === "pressure" && <><circle cx={from.x} cy={from.y} r="43" fill={color} fillOpacity=".08" stroke={color} strokeOpacity=".4" strokeDasharray="4 5" /><circle cx={from.x} cy={from.y} r="29" fill="none" stroke={color} strokeOpacity=".25" /></>}
                        {event?.type === "tackle" && <><path d={`M${from.x - 29} ${from.y}l29 -29 29 29 -29 29Z`} fill={color} fillOpacity=".1" stroke={color} strokeWidth="1.5" /><text x={from.x + 32} y={from.y - 18} fill={color} fontSize="17">×</text></>}
                        {event?.type === "shot" && <><circle cx={from.x} cy={from.y} r="31" fill={color} fillOpacity=".08" stroke={color} strokeWidth="1.2" /><path d={`M${from.x - 38} ${from.y}h13 M${from.x + 25} ${from.y}h13 M${from.x} ${from.y - 38}v13 M${from.x} ${from.y + 25}v13`} stroke={color} strokeWidth="2" /></>}
                        {to && <><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={failed ? "#f4bb63" : color} strokeWidth="2.5" strokeDasharray={failed ? "7 6" : undefined} markerEnd="url(#pass-arrow)" /><circle cx={to.x} cy={to.y} r="14" fill={color} fillOpacity=".1" stroke={failed ? "#f4bb63" : color} strokeDasharray="3 3" />{recipient && !simulation && <text x={Math.max(100, Math.min(660, to.x))} y={to.y > 435 ? to.y - 24 : to.y + 32} textAnchor="middle" fill="#b9c8c6" fontSize="10">{failed ? tr(language, "intended") : ""}{recipient.name}</text>}</>}
                        {!simulation && <><circle cx={from.x} cy={from.y} r="23" fill={color} fillOpacity=".12" /><circle cx={from.x} cy={from.y} r="15" fill={color} stroke="#f6f8fc" strokeWidth="2" />
                            <text x={from.x} y={from.y + 4} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">{actor?.shirt_number ?? "•"}</text>
                            <g transform={`translate(${Math.max(106, Math.min(654, from.x))},${from.y < 80 ? from.y + 37 : from.y - 34})`}><rect x="-83" y="-15" width="166" height="26" rx="5" fill="#0a141e" fillOpacity=".94" stroke={color} strokeOpacity=".35" /><text textAnchor="middle" y="2" fill="#f0f4f8" fontSize="11" fontWeight="500">{actor?.name ?? tr(language, "recordedAction")}</text></g>
                            {ball && <g transform={`translate(${ball.x},${ball.y})`}><circle r="5.5" fill="#fff" stroke="#0e1a23" strokeWidth="1.5" /><path d="M0-3l3 2-1 3h-4l-1-3Z" fill="#1c2936" /></g>}</>}
                    </g>}
                    <PitchLayers data={data} events={prefix} layer={layer} playerId={focusPlayer} language={language} units={units} />
                    {simulation && <TeamMotion data={data} frame={frame} names={names} selectedPlayer={selectedPlayer} onSelect={selectPlayer} language={language} highlights={shownHighlights} units={units} focusPlayer={focusPlayer} />}
                </svg>
                </div>
            </div>
            <div className="pitch-context">
                <div className="current-action">
                    <div className="action-symbol" style={{ color }}><ActionIcon size={20} aria-hidden="true" /></div>
                    <div className="action-copy">
                        <div className="action-heading"><strong>{event ? eventLabel(event, language) : tr(language, "readyWhenYouAre")}</strong>{event?.outcome && <span className="action-outcome">{outcomeLabel(event, language)}</span>}{quality && <span className="action-quality" title={tr(language, "syntheticDatasetValues")}>{quality}</span>}</div>
                        <p>{event ? actor?.name ?? tr(language, "matchEvent") : tr(language, "pressPlayToFollowTheMatch")}</p>
                    </div>
                    {event && <time className="action-time" aria-label={tr(language, "eventTime")}>{formatTime(event.match_time_seconds)}</time>}
                </div>
                <p className="sr-only" role="status" aria-live="polite">{simulation && latestHighlight ? `${data.players.find(player => player.player_id === latestHighlight.playerId)?.name ?? ""}: ${highlightText(latestHighlight, language, units)}` : ""}</p>
                {simulation && selected && <div className="pitch-player-selection" role="status" aria-atomic="true"><UserRound size={16} aria-hidden="true" /><strong>{selected.name}</strong><span>{selected.position ?? tr(language, "player")}{selected.shirt_number !== undefined ? ` · #${selected.shirt_number}` : ""}{selected.nationality ? ` · ${selected.nationality}` : ""}</span></div>}

                <div className="pitch-info-grid">
                    <details className="pitch-about"><summary className="pitch-info-summary"><Info size={16} aria-hidden="true" /><span className="pitch-info-title">{tr(language, "aboutThisView")}</span><ChevronDown className="disclosure-chevron" size={16} aria-hidden="true" /></summary>
                        <div className="pitch-guide-content">
                            {simulation && sizing === "detailed" && <p className="pitch-scroll-hint">{tr(language, "scrollThePitchSidewaysToSeeEveryPlayer")}</p>}
                            {simulation && sizing === "fit" && <p className="pitch-fit-hint">{tr(language, "tapAPlayerForTheirNameDetailedView")}</p>}
                            <div className="pitch-legend"><span><i className="legend-line" />{tr(language, "completedPass")}</span><span><i className="legend-line intercepted" />{tr(language, "incompleteIntercepted")}</span><span><Crosshair size={12} />{tr(language, "shot")}</span><span><Radio size={12} />{tr(language, "pressure")}</span></div>
                            <p className="data-note"><Info size={12} />{simulation ? tr(language, "allPlayerPathsAndBallFlightTimingAre") : tr(language, "eventLocationsOnlyNoContinuousTrackingOrInferred")}</p>
                        </div>
                    </details>
                    {simulation && <PlayerRoster data={data} language={language} selectedPlayer={selectedPlayer} onSelect={selectPlayer} activeIds={activeIds} />}
                </div>
            </div>
        </section>
    );
}
