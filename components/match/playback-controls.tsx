"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime, type PlaybackAction, type PlaybackState } from "@/lib/match/playback";
import { tr } from "@/lib/match/presentation";
import type { Language, MatchData } from "@/lib/match/types";

export function PlaybackControls({ data, state, language, statusText, dispatch, onRestart, onSeek, onStep, showTimeline = true }: {
    data: MatchData;
    state: PlaybackState;
    language: Language;
    statusText: string;
    dispatch: (action: PlaybackAction) => void;
    onRestart: () => void;
    onSeek: (elapsed: number) => void;
    onStep: () => void;
    showTimeline?: boolean;
}) {
    const ref = useRef<HTMLElement>(null);
    const halftime = state.status === "half-time", complete = state.status === "full-time";
    const playing = state.status === "playing";
    const l = language;

    useEffect(() => {
        const panel = ref.current;
        if (!panel) return;
        // Reserve the actual dock height, including translated text and safe-area padding.
        const observer = new ResizeObserver(() => {
            document.documentElement.style.setProperty("--playback-dock-height", `${Math.ceil(panel.getBoundingClientRect().height)}px`);
        });
        observer.observe(panel);
        return () => {
            observer.disconnect();
            document.documentElement.style.removeProperty("--playback-dock-height");
        };
    }, []);

    return <section ref={ref} id="playback-controls" className="panel playback-panel" aria-label={tr(l, "Playback controls", "Mga kontrol sa replay")}>
        <div className="playback-top">
            <div className="transport">
                <Button variant="ghost" className="reset-button" aria-label={tr(l, "Restart match", "Simulang muli ang laban")} onClick={onRestart}><RotateCcw size={17} /><span>{tr(l, "Reset", "Ulitin")}</span></Button>
                <Button className="play-button" aria-label={halftime ? tr(l, "Start second half", "Simulan ang ikalawang hati") : complete ? tr(l, "Match completed", "Tapos na ang laban") : playing ? tr(l, "Pause match", "Ihinto ang laban") : tr(l, "Play match", "I-play ang laban")} disabled={complete || data.events.length === 0} onClick={() => dispatch({ type: "toggle" })}>
                    {playing ? <Pause fill="currentColor" size={15} /> : <Play fill="currentColor" size={15} />}
                    <span>{halftime ? tr(l, "Start second half", "Ikalawang hati") : playing ? tr(l, "Pause", "Ihinto") : complete ? tr(l, "Completed", "Tapos na") : state.status === "ready" ? tr(l, "Start", "Simulan") : tr(l, "Resume", "Ituloy")}</span>
                </Button>
                <Button size="icon" variant="ghost" aria-label={tr(l, "Step to next event", "Susunod na aksiyon")} disabled={halftime || complete || data.events.length === 0} onClick={onStep}><SkipForward size={17} /></Button>
                <span className="playback-time"><b>{formatTime(state.elapsed)}</b><span>/ {formatTime(data.match.duration_seconds)}</span></span>
            </div>
            <div className="speed-control">
                <span>{tr(l, "Playback speed", "Bilis ng replay")}</span>
                <div role="group" aria-label={tr(l, "Playback speed", "Bilis ng replay")}>
                    {[1, 5, 10, 30].map(speed => <button key={speed} type="button" aria-pressed={speed === state.speed} className={speed === state.speed ? "active" : ""} onClick={() => dispatch({ type: "speed", speed })}>{speed}×</button>)}
                </div>
            </div>
        </div>
        {showTimeline && <div className="timeline-wrap">
            <div className="timeline-marker" style={{ left: `${data.match.period_seconds / data.match.duration_seconds * 100}%` }} />
            <input className="timeline" type="range" min="0" max={data.match.duration_seconds} step="1" value={state.elapsed} aria-label={tr(l, "Match timeline", "Timeline ng laban")} aria-valuetext={`${formatTime(state.elapsed)} ${statusText}`} style={{ "--progress": `${state.elapsed / data.match.duration_seconds * 100}%` } as CSSProperties} onChange={e => onSeek(Number(e.target.value))} />
            <div className="timeline-labels"><span>00:00</span><span>{tr(l, "HALF-TIME", "PAHINGA")} · {formatTime(data.match.period_seconds)}</span><span>{formatTime(data.match.duration_seconds)}</span></div>
        </div>}
    </section>;
}
