"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { formatTime, type PlaybackAction, type PlaybackState } from "@/lib/match/playback";
import { tr } from "@/lib/match/presentation";
import type { Language, MatchData } from "@/lib/match/types";

export function PlaybackControls({ data, state, language, statusText, dispatch, onRestart, onSeek, onStep, showTimeline = true, timelineControls }: {
    data: MatchData;
    state: PlaybackState;
    language: Language;
    statusText: string;
    dispatch: (action: PlaybackAction) => void;
    onRestart: () => void;
    onSeek: (elapsed: number) => void;
    onStep: () => void;
    showTimeline?: boolean;
    timelineControls?: ReactNode;
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

    return <section ref={ref} id="playback-controls" className="panel playback-panel" aria-label={tr(l, "playbackControls")}>
        <div className="playback-top">
            <div className="transport">
                <Button variant="ghost" className="reset-button" aria-label={tr(l, "restartMatch")} onClick={onRestart}><RotateCcw size={17} /><span>{tr(l, "reset")}</span></Button>
                <Button className="play-button" aria-label={halftime ? tr(l, "startSecondHalf") : complete ? tr(l, "matchCompleted") : playing ? tr(l, "pauseMatch") : tr(l, "playMatch")} disabled={complete || data.events.length === 0} onClick={() => dispatch({ type: "toggle" })}>
                    {playing ? <Pause fill="currentColor" size={15} /> : <Play fill="currentColor" size={15} />}
                    <span>{halftime ? tr(l, "startSecondHalf2") : playing ? tr(l, "pause") : complete ? tr(l, "completed") : state.status === "ready" ? tr(l, "start") : tr(l, "resume")}</span>
                </Button>
                <Button size="icon" variant="ghost" aria-label={tr(l, "stepToNextEvent")} disabled={halftime || complete || data.events.length === 0} onClick={onStep}><SkipForward size={17} /></Button>
                <span className="playback-time" dir="ltr"><b>{formatTime(state.elapsed)}</b><span>/ {formatTime(data.match.duration_seconds)}</span></span>
            </div>
            <div className="playback-options">
                <label className="speed-control"><span>{tr(l, "speed")}</span><Select label={tr(l, "playbackSpeed")} value={String(state.speed)} options={[1, 5, 10, 30].map(speed => ({ value: String(speed), label: `${speed}×` }))} onValueChange={value => dispatch({ type: "speed", speed: Number(value) as PlaybackState["speed"] })} /></label>
                {timelineControls}
            </div>
        </div>
        {showTimeline && <div className="timeline-wrap" dir="ltr">
            <div className="timeline-marker" style={{ left: `${data.match.period_seconds / data.match.duration_seconds * 100}%` }} />
            <input className="timeline" dir="ltr" type="range" min="0" max={data.match.duration_seconds} step="1" value={state.elapsed} aria-label={tr(l, "matchTimeline")} aria-valuetext={`${formatTime(state.elapsed)} ${statusText}`} style={{ "--progress": `${state.elapsed / data.match.duration_seconds * 100}%` } as CSSProperties} onChange={e => onSeek(Number(e.target.value))} />
            <div className="timeline-labels"><span>00:00</span><span>{tr(l, "halfTime")} · {formatTime(data.match.period_seconds)}</span><span>{formatTime(data.match.duration_seconds)}</span></div>
        </div>}
    </section>;
}
