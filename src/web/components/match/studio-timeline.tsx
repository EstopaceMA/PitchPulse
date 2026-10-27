"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Bookmark, X } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { groupTimelineEvents } from "@/lib/match/library";
import { formatTime, type PlaybackAction, type PlaybackState } from "@/lib/match/playback";
import { eventLabel, tr } from "@/lib/match/presentation";
import type { Language, MatchAnnotation, MatchData, MatchEvent } from "@/lib/match/types";
import { PlaybackControls } from "./playback-controls";

export function StudioTimeline({ data, events, state, language: l, annotations, selectedId, onAnnotation, onEvent, dispatch, onSeek, onRestart, onStep, statusText, focusPlayer }: {
    data: MatchData; events: readonly MatchEvent[]; state: PlaybackState; language: Language; annotations: MatchAnnotation[]; selectedId: string | null; focusPlayer?: string;
    onAnnotation: (id: string) => void; onEvent: (id: string) => void; dispatch: (action: PlaybackAction) => void;
    onSeek: (elapsed: number) => void; onRestart: () => void; onStep: () => void; statusText: string;
}) {
    const [zoom, setZoom] = useState(1);
    const viewport = useRef<HTMLDivElement>(null);
    const [group, setGroup] = useState<{ lane: string; bucket: number } | null>(null);
    const [limit, setLimit] = useState(60);
    const duration = data.match.duration_seconds;
    const buckets = 40 * zoom;
    // Player Focus adds the followed player's own actions as a third lane under the team lanes.
    const focus = data.players.find(player => player.player_id === focusPlayer);
    const lanes = useMemo(() => [
        ...data.teams.map(team => ({ team_id: team.team_id, name: team.name, groups: groupTimelineEvents(events.filter(e => e.team_id === team.team_id), duration, buckets) })),
        ...focus ? [{ team_id: `player:${focus.player_id}`, name: focus.name, groups: groupTimelineEvents(events.filter(e => e.player_id === focus.player_id), duration, buckets) }] : [],
    ], [data.teams, events, duration, buckets, focus]);
    const activeGroup = lanes.find(lane => lane.team_id === group?.lane)?.groups.find(g => g.bucket === group?.bucket);
    return <section className="studio-timeline" aria-label={tr(l, "analysisTimeline")}>
        <PlaybackControls data={data} state={state} language={l} statusText={statusText} dispatch={dispatch} onRestart={onRestart} onSeek={onSeek} onStep={onStep} showTimeline={false} timelineControls={<label className="timeline-zoom"><span>{tr(l, "zoom")}</span><Select label={tr(l, "timelineZoom")} value={String(zoom)} options={[1, 2, 4, 8].map(value => ({ value: String(value), label: value === 1 ? tr(l, "fit") : `${value}×` }))} onValueChange={value => { const next = Number(value); setZoom(next); setGroup(null); requestAnimationFrame(() => { if (viewport.current) viewport.current.scrollLeft = state.elapsed / duration * viewport.current.clientWidth * next - viewport.current.clientWidth / 2; }); }} /></label>} />

        <div ref={viewport} className="timeline-scroll" dir="ltr" tabIndex={0} aria-label={tr(l, "timelineTracksScrollHorizontallyWhenZoomed")}>
            <div className="timeline-canvas" style={{ width: `${zoom * 100}%` }}>
                <div className="timeline-ruler"><span>00:00</span>{[.25, .5, .75].filter(fraction => Math.abs(fraction - data.match.period_seconds / duration) > .08).map(fraction => <span key={fraction} style={{ left: `${fraction * 100}%` }}>{formatTime(duration * fraction)}</span>)}<span className="half-time-label" style={{ left: `${data.match.period_seconds / duration * 100}%` }}>{tr(l, "ht")} · {formatTime(data.match.period_seconds)}</span><span>{formatTime(duration)}</span></div>
                <input className="timeline studio-scrubber" dir="ltr" type="range" min={0} max={duration} step={1} value={state.elapsed} aria-label={tr(l, "matchTimeline")} aria-valuetext={`${formatTime(state.elapsed)} ${statusText}`} style={{ "--progress": `${state.elapsed / duration * 100}%` } as CSSProperties} onChange={e => { setGroup(null); onSeek(Number(e.target.value)); }} />
                <div className="track-field"><div className="studio-playhead" style={{ left: `${state.elapsed / duration * 100}%` }} aria-hidden="true" /><div className="half-divider" style={{ left: `${data.match.period_seconds / duration * 100}%` }} title={tr(l, "halfTime2")} />
                    {lanes.map(lane => <div key={lane.team_id} className={`event-track ${lane.team_id.startsWith("player:") ? "player-track" : lane.team_id === data.match.home_team_id ? "home-track" : "away-track"}`} aria-label={lane.name}><span className="track-label">{lane.name}</span>{lane.groups.map(g => <button key={g.bucket} type="button" className={`event-marker ${g.events.some(e => e.event_id === selectedId) ? "selected" : ""}`} style={{ left: `${g.events[0].match_time_seconds / duration * 100}%` }} aria-label={`${lane.name} · ${formatTime(g.events[0].match_time_seconds)} · ${g.events.length === 1 ? eventLabel(g.events[0], l) : `${g.events.length} ${tr(l, "events")}`}`} onClick={() => { if (g.events.length === 1) { setGroup(null); onEvent(g.events[0].event_id); } else { setGroup({ lane: lane.team_id, bucket: g.bucket }); setLimit(60); } }}>{g.events.length > 1 ? g.events.length : "•"}</button>)}</div>)}
                    <div className="annotation-track" aria-label={tr(l, "savedAnnotations")}><span className="track-label"><Bookmark size={11} />{tr(l, "notes")}</span>{annotations.map((note, index) => <button type="button" key={note.id} className="annotation-marker" style={{ left: `${note.anchor.elapsed / duration * 100}%`, top: `${4 + index % 2 * 8}px` }} title={note.text} aria-label={`${tr(l, "savedMoment")} ${formatTime(note.anchor.elapsed)}: ${note.text}`} onClick={() => onAnnotation(note.id)}><Bookmark size={12} fill="currentColor" /></button>)}</div>
                </div>
            </div>
        </div>
        {activeGroup && <div className="timeline-group"><div><strong>{activeGroup.events.length} {tr(l, "eventsInThisGroup")}</strong><Button size="icon" variant="ghost" aria-label={tr(l, "closeEventGroup")} onClick={() => setGroup(null)}><X size={14} /></Button></div><ol>{activeGroup.events.slice(0, limit).map(event => <li key={event.event_id}><button type="button" onClick={() => onEvent(event.event_id)}><time>{formatTime(event.match_time_seconds)}</time><span>{eventLabel(event, l)}</span><small>#{event.sequence}</small></button></li>)}</ol>{activeGroup.events.length > limit && <Button size="sm" variant="ghost" onClick={() => setLimit(n => n + 60)}>{tr(l, "show60More")}</Button>}</div>}
    </section>;
}
