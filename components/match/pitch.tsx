"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, Crosshair, Info, Radio, UserRound, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime, pitchPosition } from "@/lib/match/playback";
import { buildMovementTimeline, sampleMovement } from "@/lib/match/movement";
import { eventLabel, outcomeLabel, teamColor, tr } from "@/lib/match/presentation";
import type { Language, MatchData, MatchEvent, Position } from "@/lib/match/types";
import { PlayerRoster, TeamMotion } from "./team-motion";

function subscribeMotion(callback: () => void) {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
}
const motionPreference = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverMotionPreference = () => false;

export function Pitch({ data, events, elapsed, event, pinned, language, onLive }: { data: MatchData; events: readonly MatchEvent[]; elapsed: number; event?: MatchEvent; pinned: boolean; language: Language; onLive: () => void }) {
    const [view, setView] = useState<"simulation" | "events">("simulation");
    const [sizing, setSizing] = useState<"fit" | "detailed">("fit");
    const [names, setNames] = useState(true);
    const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
    const reducedMotion = useSyncExternalStore(subscribeMotion, motionPreference, serverMotionPreference);
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
    const activeIds = new Set(frame.players.filter(p => p.active).map(p => p.playerId));
    const selectPlayer = (id: string) => setSelectedPlayer(previous => previous === id ? null : id);
    const home = data.match.home_team_id;
    const color = teamColor(event?.team_id ?? null, home);
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
    return (
        <section className="panel pitch-panel" id="pitch" aria-labelledby="pitch-heading">
            <div className="panel-heading">
                <div className="heading-icon"><Crosshair size={17} /><h2 id="pitch-heading">{tr(language, "The pitch", "Ang pitch")}</h2><span className="subtle-label">2D</span></div>
                <div className="pitch-heading-status">
                    <span className="micro-label"><span className={`tiny-dot ${pinned ? "amber" : "green"}`} />{pinned ? tr(language, "REVIEWING EVENT", "SINUSURI ANG PANGYAYARI") : simulation ? tr(language, "SIMULATED MOVEMENT", "SIMULADONG GALAW") : tr(language, "EVENT VIEW", "TANAW NG PANGYAYARI")}</span>
                    {pinned && <Button type="button" size="sm" variant="outline" onClick={onLive}><X size={13} aria-hidden="true" />{tr(language, "Follow live", "Sundan ang laro")}</Button>}
                </div>
            </div>
            <div className="pitch-view-controls">
                <div role="group" aria-label={tr(language, "Pitch view", "Tanaw ng pitch")}><button type="button" aria-pressed={simulation} onClick={() => setView("simulation")}><Users size={13} />{tr(language, "Full-team simulation", "Simulasyon ng lahat")}</button><button type="button" aria-pressed={!simulation} onClick={() => setView("events")}><Crosshair size={13} />{tr(language, "Recorded events", "Naitalang aksiyon")}</button></div>
                {simulation && <>
                    <div className="pitch-sizing-controls" role="group" aria-label={tr(language, "Pitch size", "Laki ng pitch")}>
                        <Button type="button" size="sm" variant="ghost" aria-pressed={sizing === "fit"} aria-controls="pitch-stage" onClick={() => setSizing("fit")}>{tr(language, "Fit pitch", "Iangkop ang pitch")}</Button>
                        <Button type="button" size="sm" variant="ghost" aria-pressed={sizing === "detailed"} aria-controls="pitch-stage" onClick={() => setSizing("detailed")}>{tr(language, "Detailed view", "Detalyadong tanaw")}</Button>
                    </div>
                    <label><input type="checkbox" checked={names} onChange={e => setNames(e.target.checked)} />{tr(language, "Player names", "Mga pangalan")}</label>
                </>}
            </div>
            <div className="pitch-toolbar"><span style={{ color: teamColor(data.match.away_team_id, home) }}><ArrowLeft size={13} />{awayName}</span><span>{tr(language, "Fixed attacking directions", "Nakapirming direksiyon")}</span><span style={{ color: teamColor(home, home) }}>{homeName}<ArrowRight size={13} /></span></div>
            <div id="pitch-stage" className={`pitch-stage${simulation ? ` full-team-stage pitch-${sizing}` : ""}`} tabIndex={simulation ? 0 : undefined} role={simulation ? "region" : undefined} aria-label={simulation ? sizing === "fit" ? tr(language, "Full-team pitch. Fit pitch view.", "Pitch ng lahat. Nakaangkop na tanaw ng pitch.") : tr(language, "Full-team pitch. Scroll horizontally on small screens.", "Pitch ng lahat. Mag-scroll pahalang sa maliit na screen.") : undefined}>
                <svg viewBox="0 0 760 510" role={simulation ? "group" : "img"} aria-label={simulation ? tr(language, `${frame.players.length} players with illustrative movement and dataset names.`, `${frame.players.length} manlalaro na may halimbawang galaw at mga pangalan mula sa dataset.`) : event ? `${formatTime(event.match_time_seconds)} ${actor?.name ?? ""} ${eventLabel(event, language)}. ${tr(language, "Only recorded event positions are shown.", "Mga naitalang posisyon lamang ang ipinapakita.")}` : tr(language, "Empty pitch. Start playback to see recorded actions.", "Walang aksiyon. Simulan ang laro.")}>
                    <defs>
                        <pattern id="grass" width="137" height="442" patternUnits="userSpaceOnUse"><rect width="68.5" height="442" fill="#ffffff" opacity=".018" /></pattern>
                        <radialGradient id="field-glow"><stop offset="0" stopColor="#164333" /><stop offset="1" stopColor="#102a26" /></radialGradient>
                        <marker id="pass-arrow" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke={failed ? "#f4bb63" : color} strokeWidth="1.5" /></marker>
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
                    {!simulation && !from && <g><rect x="226" y="218" width="308" height="74" rx="12" fill="#0a1d1b" fillOpacity=".8" stroke="#34564b" /><text x="380" y="249" textAnchor="middle" fill="#e0eee8" fontSize="14" fontWeight="600">{event ? eventLabel(event, language) : tr(language, "The story starts at kick-off", "Magsisimula sa kick-off")}</text><text x="380" y="273" textAnchor="middle" fill="#8eada0" fontSize="11">{event ? tr(language, "No location recorded for this event", "Walang naitalang lokasyon") : tr(language, "Press play. Follow every moment.", "Pindutin ang play. Sundan ang bawat sandali.")}</text></g>}
                    {from && <g key={event?.event_id} className="event-arrival">
                        {event?.type === "pressure" && <><circle cx={from.x} cy={from.y} r="43" fill={color} fillOpacity=".08" stroke={color} strokeOpacity=".4" strokeDasharray="4 5" /><circle cx={from.x} cy={from.y} r="29" fill="none" stroke={color} strokeOpacity=".25" /></>}
                        {event?.type === "tackle" && <><path d={`M${from.x - 29} ${from.y}l29 -29 29 29 -29 29Z`} fill={color} fillOpacity=".1" stroke={color} strokeWidth="1.5" /><text x={from.x + 32} y={from.y - 18} fill={color} fontSize="17">×</text></>}
                        {event?.type === "shot" && <><circle cx={from.x} cy={from.y} r="31" fill={color} fillOpacity=".08" stroke={color} strokeWidth="1.2" /><path d={`M${from.x - 38} ${from.y}h13 M${from.x + 25} ${from.y}h13 M${from.x} ${from.y - 38}v13 M${from.x} ${from.y + 25}v13`} stroke={color} strokeWidth="2" /></>}
                        {to && <><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={failed ? "#f4bb63" : color} strokeWidth="2.5" strokeDasharray={failed ? "7 6" : undefined} markerEnd="url(#pass-arrow)" /><circle cx={to.x} cy={to.y} r="14" fill={color} fillOpacity=".1" stroke={failed ? "#f4bb63" : color} strokeDasharray="3 3" />{recipient && !simulation && <text x={Math.max(100, Math.min(660, to.x))} y={to.y > 435 ? to.y - 24 : to.y + 32} textAnchor="middle" fill="#b9c8c6" fontSize="10">{failed ? tr(language, "Intended: ", "Pakay: ") : ""}{recipient.name}</text>}</>}
                        {!simulation && <><circle cx={from.x} cy={from.y} r="23" fill={color} fillOpacity=".12" /><circle cx={from.x} cy={from.y} r="15" fill={color} stroke="#f6f8fc" strokeWidth="2" />
                            <text x={from.x} y={from.y + 4} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">{actor?.shirt_number ?? "•"}</text>
                            <g transform={`translate(${Math.max(106, Math.min(654, from.x))},${from.y < 80 ? from.y + 37 : from.y - 34})`}><rect x="-83" y="-15" width="166" height="26" rx="5" fill="#0a141e" fillOpacity=".94" stroke={color} strokeOpacity=".35" /><text textAnchor="middle" y="2" fill="#f0f4f8" fontSize="11" fontWeight="500">{actor?.name ?? tr(language, "Recorded action", "Naitalang aksiyon")}</text></g>
                            {ball && <g transform={`translate(${ball.x},${ball.y})`}><circle r="5.5" fill="#fff" stroke="#0e1a23" strokeWidth="1.5" /><path d="M0-3l3 2-1 3h-4l-1-3Z" fill="#1c2936" /></g>}</>}
                    </g>}
                    {simulation && <TeamMotion data={data} frame={frame} names={names} selectedPlayer={selectedPlayer} onSelect={selectPlayer} language={language} />}
                </svg>
            </div>
            {simulation && sizing === "detailed" && <p className="pitch-scroll-hint">{tr(language, "Scroll the pitch sideways to see every player on smaller screens.", "Mag-scroll pahalang sa pitch upang makita ang lahat sa maliit na screen.")}</p>}
            {simulation && sizing === "fit" && <p className="pitch-fit-hint">{tr(language, "Tap a player for their name. Detailed view shows every label.", "Piliin ang manlalaro para sa pangalan. Makikita ang lahat sa detalyadong tanaw.")}</p>}
            <div className="pitch-legend"><span><i className="legend-line" />{tr(language, "Completed pass", "Kumpletong pasa")}</span><span><i className="legend-line intercepted" />{tr(language, "Incomplete / intercepted", "Hindi kumpleto / naagaw")}</span><span><Crosshair size={12} />{tr(language, "Shot", "Tira")}</span><span><Radio size={12} />{tr(language, "Pressure", "Pagdiin")}</span></div>
            <div className="current-action"><div className="action-symbol" style={{ color }}><Crosshair size={18} /></div><div><strong>{event ? `${eventLabel(event, language)} ${event.outcome ? `· ${outcomeLabel(event, language)}` : ""}` : tr(language, "Ready when you are", "Handa na")}</strong><p>{event ? `${formatTime(event.match_time_seconds)} · ${actor?.name ?? tr(language, "Match event", "Pangyayari sa laban")} · ${event.event_id}` : tr(language, "Synthetic events. A different way to see the game.", "Sintetikong aksiyon. Bagong paraan ng pagtingin sa laro.")}</p></div></div>
            {simulation && selected && <div className="pitch-player-selection" role="status" aria-atomic="true"><UserRound size={16} aria-hidden="true" /><strong>{selected.name}</strong><span>{selected.position ?? tr(language, "Player", "Manlalaro")}{selected.shirt_number !== undefined ? ` · #${selected.shirt_number}` : ""}</span></div>}
            <p className="data-note"><Info size={12} />{simulation ? tr(language, "All player paths and ball-flight timing are illustrative. Pausing or reviewing an event freezes this view. Recorded events alone drive statistics.", "Halimbawa lamang ang mga galaw at oras ng paglipad ng bola. Humihinto ang tanaw kapag naka-pause o sinusuri ang aksiyon. Naitalang aksiyon lamang ang batayan ng estadistika.") : tr(language, "Event locations only. No continuous tracking or inferred player movement.", "Mga lokasyon ng aksiyon lamang. Walang tuloy-tuloy na pagsubaybay o inimbentong galaw.")}</p>
            {simulation && <PlayerRoster data={data} language={language} selectedPlayer={selectedPlayer} onSelect={selectPlayer} activeIds={activeIds} />}
        </section>
    );
}