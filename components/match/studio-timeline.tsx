"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Bookmark, Layers3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { groupTimelineEvents } from "@/lib/match/library";
import { formatTime, type PlaybackAction, type PlaybackState } from "@/lib/match/playback";
import { eventLabel, tr } from "@/lib/match/presentation";
import type { Language, MatchAnnotation, MatchData, MatchEvent } from "@/lib/match/types";
import { PlaybackControls } from "./playback-controls";

export function StudioTimeline({ data, events, state, language: l, annotations, selectedId, onAnnotation, onEvent, dispatch, onSeek, onRestart, onStep, statusText }: {
    data: MatchData; events: readonly MatchEvent[]; state: PlaybackState; language: Language; annotations: MatchAnnotation[]; selectedId: string | null;
    onAnnotation: (id: string) => void; onEvent: (id: string) => void; dispatch: (action: PlaybackAction) => void;
    onSeek: (elapsed: number) => void; onRestart: () => void; onStep: () => void; statusText: string;
}) {
    const [zoom, setZoom] = useState(1);
    const viewport = useRef<HTMLDivElement>(null);
    const [group, setGroup] = useState<{ lane: string; bucket: number } | null>(null);
    const [limit, setLimit] = useState(60);
    const duration = data.match.duration_seconds;
    const buckets = 40 * zoom;
    const lanes = useMemo(() => data.teams.map(team => ({ ...team, groups: groupTimelineEvents(events.filter(e => e.team_id === team.team_id), duration, buckets) })), [data.teams, events, duration, buckets]);
    const activeGroup = lanes.find(lane => lane.team_id === group?.lane)?.groups.find(g => g.bucket === group?.bucket);
    return <section className="studio-timeline" aria-label={tr(l, "Analysis timeline", "Timeline ng pagsusuri")}>
        <PlaybackControls data={data} state={state} language={l} statusText={statusText} dispatch={dispatch} onRestart={onRestart} onSeek={onSeek} onStep={onStep} showTimeline={false} />
        <div className="timeline-toolbar"><span><Layers3 size={14} />{tr(l, "MATCH TIMELINE", "TIMELINE NG LABAN")}</span><small>{tr(l, "Recorded events appear as playback reaches them", "Lumilitaw ang mga pangyayari kapag naabot sa replay")}</small><div role="group" aria-label={tr(l, "Timeline zoom", "Pag-zoom sa timeline")}>{[1, 2, 4, 8].map(value => <button key={value} type="button" aria-pressed={zoom === value} onClick={() => { setZoom(value); setGroup(null); requestAnimationFrame(() => { if (viewport.current) viewport.current.scrollLeft = state.elapsed / duration * viewport.current.clientWidth * value - viewport.current.clientWidth / 2; }); }}>{value === 1 ? tr(l, "Fit", "Iangkop") : `${value}×`}</button>)}</div></div>
        <div ref={viewport} className="timeline-scroll" tabIndex={0} aria-label={tr(l, "Timeline tracks. Scroll horizontally when zoomed.", "Mga track ng timeline. Mag-scroll pahalang kapag naka-zoom.")}>
            <div className="timeline-canvas" style={{ width: `${zoom * 100}%` }}>
                <div className="timeline-ruler"><span>00:00</span>{[.25, .5, .75].filter(fraction => Math.abs(fraction - data.match.period_seconds / duration) > .08).map(fraction => <span key={fraction} style={{ left: `${fraction * 100}%` }}>{formatTime(duration * fraction)}</span>)}<span className="half-time-label" style={{ left: `${data.match.period_seconds / duration * 100}%` }}>{tr(l, "HT", "PAHINGA")} · {formatTime(data.match.period_seconds)}</span><span>{formatTime(duration)}</span></div>
                <input className="timeline studio-scrubber" type="range" min={0} max={duration} step={1} value={state.elapsed} aria-label={tr(l, "Match timeline", "Timeline ng laban")} aria-valuetext={`${formatTime(state.elapsed)} ${statusText}`} style={{ "--progress": `${state.elapsed / duration * 100}%` } as CSSProperties} onChange={e => { setGroup(null); onSeek(Number(e.target.value)); }} />
                <div className="track-field"><div className="studio-playhead" style={{ left: `${state.elapsed / duration * 100}%` }} aria-hidden="true" /><div className="half-divider" style={{ left: `${data.match.period_seconds / duration * 100}%` }} title={tr(l, "Half-time", "Pahinga")} />
                    {lanes.map(lane => <div key={lane.team_id} className={`event-track ${lane.team_id === data.match.home_team_id ? "home-track" : "away-track"}`} aria-label={lane.name}><span className="track-label">{lane.name}</span>{lane.groups.map(g => <button key={g.bucket} type="button" className={`event-marker ${g.events.some(e => e.event_id === selectedId) ? "selected" : ""}`} style={{ left: `${g.events[0].match_time_seconds / duration * 100}%` }} aria-label={`${lane.name} · ${formatTime(g.events[0].match_time_seconds)} · ${g.events.length === 1 ? eventLabel(g.events[0], l) : `${g.events.length} ${tr(l, "events", "pangyayari")}`}`} onClick={() => { if (g.events.length === 1) { setGroup(null); onEvent(g.events[0].event_id); } else { setGroup({ lane: lane.team_id, bucket: g.bucket }); setLimit(60); } }}>{g.events.length > 1 ? g.events.length : "•"}</button>)}</div>)}
                    <div className="annotation-track" aria-label={tr(l, "Saved annotations", "Mga naka-save na tala")}><span className="track-label"><Bookmark size={11} />{tr(l, "Notes", "Mga tala")}</span>{annotations.map((note, index) => <button type="button" key={note.id} className="annotation-marker" style={{ left: `${note.anchor.elapsed / duration * 100}%`, top: `${4 + index % 2 * 8}px` }} title={note.text} aria-label={`${tr(l, "Saved moment", "Naka-save na sandali")} ${formatTime(note.anchor.elapsed)}: ${note.text}`} onClick={() => onAnnotation(note.id)}><Bookmark size={12} fill="currentColor" /></button>)}</div>
                </div>
            </div>
        </div>
        {activeGroup && <div className="timeline-group"><div><strong>{activeGroup.events.length} {tr(l, "events in this group", "pangyayari sa pangkat")}</strong><Button size="icon" variant="ghost" aria-label={tr(l, "Close event group", "Isara ang pangkat")} onClick={() => setGroup(null)}><X size={14} /></Button></div><ol>{activeGroup.events.slice(0, limit).map(event => <li key={event.event_id}><button type="button" onClick={() => onEvent(event.event_id)}><time>{formatTime(event.match_time_seconds)}</time><span>{eventLabel(event, l)}</span><small>#{event.sequence}</small></button></li>)}</ol>{activeGroup.events.length > limit && <Button size="sm" variant="ghost" onClick={() => setLimit(n => n + 60)}>{tr(l, "Show 60 more", "Ipakita ang 60 pa")}</Button>}</div>}
    </section>;
}
