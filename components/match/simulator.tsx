"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CircleHelp, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pitch } from "./pitch";
import { PlaybackControls } from "./playback-controls";
import { ViewControls } from "./view-controls";
import { Brand, DashboardHeader } from "./dashboard-header";
import { CommentaryPanel } from "./commentary-panel";
import { StatisticsPanel } from "./statistics-panel";
import { InsightsPanel } from "./insights-panel";
import { EventFeed } from "./event-feed";
import { Recap } from "./recap";
import { validateMatch } from "@/lib/match/validation";
import { useSimulation } from "@/lib/match/use-simulation";
import { formatTime } from "@/lib/match/playback";
import { initials, teamColor, tr } from "@/lib/match/presentation";
import { ruleBasedProvider } from "@/lib/match/insights";
import type { MatchData, Preferences } from "@/lib/match/types";

export default function Simulator() {
    const [loaded, setLoaded] = useState<{ data: MatchData; revision: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [source, setSource] = useState("Arsenal vs Chelsea · Demo dataset");
    const [sourceKind, setSourceKind] = useState<"demo" | "upload">("demo");
    const [attempt, setAttempt] = useState(0);
    const request = useRef(0);
    const uploadRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const controller = new AbortController(), current = ++request.current;
        fetch("/api/match", { signal: controller.signal }).then(response => { if (!response.ok) throw new Error("The default dataset could not be loaded. Retry or upload a compatible JSON file."); return response.json(); }).then(raw => {
            if (current !== request.current) return;
            setLoaded({ data: validateMatch(raw), revision: current }); setSource("Arsenal vs Chelsea · Demo dataset"); setSourceKind("demo"); setError(null);
        }).catch(err => { if (!controller.signal.aborted && current === request.current) setError(err instanceof Error ? err.message : "Unable to load match."); }).finally(() => { if (!controller.signal.aborted && current === request.current) setLoading(false); });
        return () => controller.abort();
    }, [attempt]);
    const upload = async (file?: File) => {
        if (!file) return;
        const current = ++request.current;
        setLoading(true); setError(null);
        try {
            if (file.size > 10 * 1024 * 1024) throw new Error("Please choose a JSON file smaller than 10 MB.");
            let raw: unknown;
            try { raw = JSON.parse(await file.text()); } catch { throw new Error("This file is not valid JSON. Check for missing commas or brackets and try again."); }
            const data = validateMatch(raw);
            if (current !== request.current) return;
            setLoaded({ data, revision: current }); setSource(file.name); setSourceKind("upload");
        } catch (err) { if (current === request.current) setError(err instanceof Error ? err.message : "Unable to load the file."); }
        finally { if (current === request.current) setLoading(false); if (uploadRef.current) uploadRef.current.value = ""; }
    };
    return <><input ref={uploadRef} type="file" accept=".json,application/json" className="sr-only" aria-label="Upload match JSON" onChange={e => void upload(e.target.files?.[0])} />{loaded ? <MatchDashboard key={loaded.revision} data={loaded.data} source={source} sourceKind={sourceKind} loading={loading} error={error} onDismissError={() => setError(null)} onUpload={() => uploadRef.current?.click()} onDemo={() => { setLoading(true); setAttempt(a => a + 1); }} /> : <div className="loading-screen"><Brand /><div className="panel loading-card">{loading ? <><LoaderCircle className="animate-spin" size={28} /><h1>Getting the pitch ready</h1><p>Loading the synthetic match dataset…</p></> : <><CircleHelp size={28} /><h1>We couldn’t load the match</h1><p role="alert">{error}</p><Button onClick={() => { setLoading(true); setAttempt(a => a + 1); }}>Try again</Button><Button variant="outline" onClick={() => uploadRef.current?.click()}>Upload match JSON</Button></>}</div></div>}</>;
}

function MatchDashboard({ data, source, sourceKind, loading, error, onDismissError, onUpload, onDemo }: { data: MatchData; source: string; sourceKind: "demo" | "upload"; loading: boolean; error: string | null; onDismissError: () => void; onUpload: () => void; onDemo: () => void }) {
    const { state, dispatch, events, stats } = useSimulation(data);
    const [preferences, setPreferences] = useState<Preferences>({ mode: "casual", language: "en", team: data.match.home_team_id, player: data.players.find(p => p.team_id === data.match.home_team_id && p.position !== "GK")?.player_id ?? data.players[0]?.player_id ?? "" });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [analysisPanel, setAnalysisPanel] = useState<"feed" | "insights" | "statistics">("feed");
    const l = preferences.language;
    const reachedTime = events.at(-1)?.match_time_seconds ?? 0;
    const insights = useMemo(() => ruleBasedProvider.generate(data, events, reachedTime), [data, events, reachedTime]);
    const selected = events.find(e => e.event_id === selectedId);
    const current = selected ?? events.at(-1);
    const home = data.teams.find(t => t.team_id === data.match.home_team_id)!;
    const away = data.teams.find(t => t.team_id === data.match.away_team_id)!;
    const homeScore = stats.teams[home.team_id].goals, awayScore = stats.teams[away.team_id].goals;
    const goals = events.filter(e => e.type === "shot" && e.outcome === "goal");
    const halftime = state.status === "half-time", complete = state.status === "full-time";
    const statusText = { ready: tr(l, "Ready", "Handa"), playing: tr(l, "Playing", "Naglalaro"), paused: tr(l, "Paused", "Nakahinto"), "half-time": tr(l, "Half-time", "Pahinga"), "full-time": tr(l, "Full-time", "Tapos na") }[state.status];
    const phaseText = complete ? tr(l, "Full-time", "Tapos na") : halftime ? tr(l, "Half-time", "Pahinga") : state.status === "ready" ? tr(l, "Before kick-off", "Bago magsimula") : state.secondHalf ? tr(l, "Second half", "Ikalawang hati") : tr(l, "First half", "Unang hati");
    useEffect(() => { document.documentElement.lang = preferences.language; }, [preferences.language]);
    const selectEvidence = (id: string) => { if (events.some(e => e.event_id === id)) { setSelectedId(id); document.getElementById("pitch-heading")?.scrollIntoView({ block: "start" }); } };
    const restart = () => { setSelectedId(null); dispatch({ type: "restart" }); };
    const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => setPreferences(p => ({ ...p, [key]: value }));
    const loadMatch = () => { if (state.status === "playing") dispatch({ type: "toggle" }); onUpload(); };
    const showAnalysis = (panel: "feed" | "insights" | "statistics") => {
        setAnalysisPanel(panel);
        if (window.matchMedia("(max-width: 800px)").matches) {
            requestAnimationFrame(() => document.getElementById(`analysis-${panel}`)?.scrollIntoView({ block: "start" }));
        }
    };
    return <div className="app-shell">
        <a className="skip-link" href="#main-content">{tr(l, "Skip to match", "Lumaktaw sa laban")}</a>
        <DashboardHeader data={data} preferences={preferences} source={source} sourceKind={sourceKind} loading={loading} status={state.status} statusText={statusText} onChange={update} onUpload={loadMatch} onDemo={() => { if (state.status === "playing") dispatch({ type: "toggle" }); onDemo(); }} onInsights={() => showAnalysis("insights")} />
        <main id="main-content" className="dashboard">
            <h1 className="sr-only">{home.name} vs {away.name} · {tr(l, "Match centre", "Sentro ng laban")}</h1>
            {error && <div className="error-banner" role="alert"><CircleHelp size={18} /><div><strong>{tr(l, "Couldn't load this match", "Hindi ma-load ang laban")}</strong><p>{error}</p><small>{tr(l, "Your previous match is unchanged. Required: match, two teams, players, and events. Coordinates: 0–100, team-relative.", "Hindi nabago ang nakaraang laban. Kailangan: match, dalawang teams, players, at events. Coordinates: 0–100, ayon sa team.")}</small></div><Button variant="ghost" size="icon" aria-label={tr(l, "Dismiss upload error", "Isara ang error sa upload")} onClick={onDismissError}><X /></Button></div>}
            <div className="match-workspace">
                <div className="match-overview">
                    <section className="panel match-header" aria-label={tr(l, "Match scoreboard", "Iskor ng laban")}>
                        <div className="match-meta"><span><span className="tiny-dot green" />{tr(l, "Simulated Match", "Simuladong Laban")}</span><span>{tr(l, "Synthetic events · Fictional players", "Sintetikong aksiyon · Kathang-isip na mga manlalaro")}</span><span>{phaseText} · {Math.round(data.match.duration_seconds / 60)} {tr(l, "MIN", "MINUTO")}</span></div>
                        <div className="scoreboard">
                            <div className="team-block home"><div className="team-name"><h2>{home.name}</h2><span>{tr(l, "HOME", "TAHANAN")}</span></div><div className="team-crest home-crest">{initials(home.team_id)}</div></div>
                            <div className="score-center">
                                <div className="score" aria-label={`${home.name} ${homeScore}, ${away.name} ${awayScore}`} data-testid="score"><span>{homeScore}</span><span className="score-divider">:</span><span>{awayScore}</span></div>
                                <time className="match-clock" data-testid="match-clock">{formatTime(state.elapsed)}</time>
                                <div className={`match-status ${state.status}`}><span className="tiny-dot" /><span>{statusText}</span></div>
                            </div>
                            <div className="team-block away"><div className="team-crest away-crest">{initials(away.team_id)}</div><div className="team-name"><h2>{away.name}</h2><span>{tr(l, "AWAY", "DAYO")}</span></div></div>
                        </div>
                        <div className="score-subline">{goals.length ? goals.map(g => <button type="button" key={g.event_id} onClick={() => selectEvidence(g.event_id)} style={{ color: teamColor(g.team_id, home.team_id) }}>{data.players.find(p => p.player_id === g.player_id)?.name ?? g.team_id} <b>{formatTime(g.match_time_seconds)}</b></button>) : <span>{tr(l, "A match in motion. A story waiting to unfold.", "Isang laban. Isang kuwentong naghihintay.")}</span>}</div>
                    </section>
                    <PlaybackControls data={data} state={state} language={l} statusText={statusText} dispatch={dispatch} onRestart={restart} onSeek={elapsed => { setSelectedId(null); dispatch({ type: "seek", elapsed }); }} onStep={() => { setSelectedId(null); dispatch({ type: "step" }); }} />
                </div>
                <div className="analysis-tabs" role="group" aria-label={tr(l, "Analysis panels", "Mga panel ng pagsusuri")}>
                    {([
                        ["feed", tr(l, "Events", "Mga aksiyon")],
                        ["insights", tr(l, "Insights", "Pagsusuri")],
                        ["statistics", tr(l, "Statistics", "Estadistika")],
                    ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={analysisPanel === id} aria-controls={`analysis-${id}`} onClick={() => showAnalysis(id)}>{label}</button>)}
                </div>
                <div className="main-stage">
                    <div className="primary-analysis">
                        <div className="pitch-area">
                            <Pitch data={data} events={events} elapsed={state.elapsed} event={current} pinned={!!selected} language={l} onLive={() => setSelectedId(null)} />
                            {data.events.length === 0 && <div className="empty-banner"><CircleHelp size={18} />{tr(l, "This match has no recorded events. Load another JSON file to start a simulation.", "Walang naitalang aksiyon sa laban. Mag-load ng ibang JSON upang magsimula.")}</div>}
                        </div>
                        <div id="analysis-statistics" className="analysis-panel statistics-area" data-active={analysisPanel === "statistics"}>
                            <StatisticsPanel data={data} stats={stats} preferences={preferences} />
                        </div>
                    </div>
                    <aside className="match-sidebar" aria-label={tr(l, "Match commentary and perspective", "Komentaryo at pananaw sa laban")}>
                        <ViewControls data={data} preferences={preferences} onChange={update} showPreferences={false} />
                        <CommentaryPanel data={data} events={events} preferences={preferences} onEvidence={selectEvidence} />
                    </aside>
                </div>
                <div id="analysis-feed" className="analysis-panel feed-area" data-active={analysisPanel === "feed"}>
                    <EventFeed key={preferences.mode === "player" ? `player:${preferences.player}` : "match"} data={data} events={events} preferences={preferences} selectedId={selected?.event_id ?? null} onSelect={event => selectEvidence(event.event_id)} />
                </div>
                <div id="analysis-insights" className="analysis-panel insights-area" data-active={analysisPanel === "insights"}>
                    <InsightsPanel data={data} insights={insights} elapsed={state.elapsed} preferences={preferences} onEvidence={selectEvidence} />
                </div>
                {(halftime || complete) && <div className="recap-area"><Recap data={data} events={events} stats={stats} insights={insights} preferences={preferences} kind={halftime ? "half-time" : "full-time"} onEvidence={selectEvidence} onContinue={() => halftime ? dispatch({ type: "toggle" }) : restart()} /></div>}
            </div>
            <footer className="app-footer"><div><ShieldCheck size={14} /><span>{tr(l, "Fictional match. Real curiosity.", "Kathang-isip na laban. Tunay na pag-usisa.")}</span></div><p>{tr(l, "No video. No tracking. Just the story in the data.", "Walang video o tracking. Kuwento lamang mula sa datos.")}</p><span title={source}>{tr(l, "Powered by recorded events", "Mula sa mga naitalang aksiyon")}<ArrowRight size={12} /></span></footer>
        </main>
    </div>;
}