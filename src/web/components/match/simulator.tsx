"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bookmark, ChevronLeft, ChevronRight, FilePenLine, FolderOpen, ListFilter, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { isKeyMoment } from "@/lib/match/commentary";
import { preferencesFor, rememberChoice, validateProfile } from "@/lib/match/fan-profile";
import { loadFanProfile, saveFanProfile } from "@/lib/match/library-storage";
import { useBroadcastPublisher } from "@/lib/match/use-broadcast";
import { annotationAnchor, formatTime } from "@/lib/match/playback";
import { tr } from "@/lib/match/presentation";
import { ruleBasedProvider } from "@/lib/match/insights";
import { useSimulation } from "@/lib/match/use-simulation";
import { AgentRequestError, useStudioAgents } from "@/lib/match/use-agents";
import { saveReview, useLibrary } from "@/lib/match/use-library";
import type { LibraryMatch, MatchAnnotation, Preferences } from "@/lib/match/types";
import { Pitch } from "./pitch";
import { EventDetails, EventFeed } from "./event-feed";
import { StatisticsPanel } from "./statistics-panel";
import { InsightsPanel } from "./insights-panel";
import { CommentaryPanel } from "./commentary-panel";
import { Recap } from "./recap";
import { PreferencesMenu, perspectiveLabel } from "./view-controls";
import { StorageStatus, StudioBrand } from "./match-library";
import { StudioSplitter } from "./studio-splitter";
import { useStudioLayout } from "./use-studio-layout";
import { StudioTimeline } from "./studio-timeline";
import { StudioNotes } from "./studio-notes";
import { AgentAnalysisModal, AgentInsights, agentErrorText } from "./agent-insights";
import { AgentRecapPanel } from "./agent-recap";
import { AskAnalyst } from "./ask-analyst";
import { useAppLocale } from "./locale-provider";
import { CatchUpCard, MyMetricBug, StoryPanel } from "./fan-widgets";
import { PITCH_LAYERS, type PitchLayer } from "./pitch-layers";

/** Auto-explain is opt-in and capped per studio session, so an unattended replay cannot run up Foundry usage. */
const AUTO_EXPLAIN_LIMIT = 10;

export default function Studio({ id, aiAvailable = false }: { id: string; aiAvailable?: boolean }) {
    const library = useLibrary();
    const { locale: l } = useAppLocale();
    const record = library.matches.find(match => match.id === id);
    if (!library.ready) return <div className="studio-loading"><StudioBrand /><p role="status">{tr(l, "openingYourStudio")}</p></div>;
    if (!record) return <div className="studio-loading"><StudioBrand /><FolderOpen size={40} /><h1>{tr(l, "thisMatchIsnTInYourLibrary")}</h1><p>{tr(l, "importedGamesAreSavedInTheBrowserWhere")}</p><StorageStatus language={l} /><Link className="open-studio" href="/">{tr(l, "backToLibrary")}<ArrowUpRight size={16} /></Link></div>;
    return <MatchStudio key={record.id} record={record} aiAvailable={aiAvailable} />;
}

function MatchStudio({ record, aiAvailable }: { record: LibraryMatch; aiAvailable: boolean }) {
    const { locale: l, setLocale } = useAppLocale();
    const data = record.data;
    const panelId = useId();
    const bodyRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<HTMLElement>(null);
    const inspectorRef = useRef<HTMLElement>(null);
    const { state, dispatch, events, stats } = useSimulation(data, record.checkpoint);
    // The fan profile carries favourite clubs and players, perspective, My metric and units across matches.
    const [profile, setProfile] = useState(() => validateProfile(loadFanProfile()));
    const [viewPreferences, setPreferences] = useState<Preferences>(() => preferencesFor(data, profile, l));
    const preferences = useMemo(() => ({ ...viewPreferences, language: l }), [viewPreferences, l]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [inspector, setInspector] = useState<"story" | "details" | "statistics" | "insights" | "ask" | "notes">(() => viewPreferences.mode === "casual" ? "story" : "statistics");
    const [layer, setLayer] = useState<PitchLayer>("none");
    // A reopened match shows a catch-up card until playback moves or the viewer dismisses it.
    const [catchUpAt] = useState(record.checkpoint.cursor);
    const [catchUpDismissed, setCatchUpDismissed] = useState(false);
    const autoExplained = useRef({ cursor: record.checkpoint.cursor, count: 0 });
    const [leftOpen, setLeftOpen] = useState(false);
    const [rightOpen, setRightOpen] = useState(true);
    const layout = useStudioLayout(bodyRef, leftOpen, rightOpen);
    const [annotations, setAnnotations] = useState(record.annotations);
    const [draft, setDraft] = useState<MatchAnnotation | null>(null);
    const [selectedNote, setSelectedNote] = useState<string | null>(null);
    const [pitchAnalysisRequested, setPitchAnalysisRequested] = useState(false);
    const [analysisModalDismissed, setAnalysisModalDismissed] = useState(false);
    const [drafting, setDrafting] = useState(false);
    const [draftStatus, setDraftStatus] = useState("");
    const selected = events.find(e => e.event_id === selectedId);
    const home = data.teams.find(t => t.team_id === data.match.home_team_id)!;
    const away = data.teams.find(t => t.team_id === data.match.away_team_id)!;
    const reachedTime = events.at(-1)?.match_time_seconds ?? 0;
    const insights = useMemo(() => ruleBasedProvider.generate(data, events, reachedTime, { preferences }), [data, events, reachedTime, preferences]);
    const ai = useStudioAgents(record.id, data, events, { elapsed: state.elapsed, secondHalf: state.secondHalf, status: state.status }, preferences);
    const aiOn = aiAvailable;
    const units = preferences.units ?? "metric";
    const focusPlayer = preferences.mode === "player" ? preferences.player : undefined;
    const broadcastState = useMemo(() => ({ elapsed: state.elapsed, cursor: state.cursor, secondHalf: state.secondHalf, status: state.status, preferences }), [state.elapsed, state.cursor, state.secondHalf, state.status, preferences]);
    useBroadcastPublisher(record.id, broadcastState);
    // Opt-in only: explain each newly reached key moment without pausing, within the session cap.
    useEffect(() => {
        const seen = autoExplained.current, fresh = events.slice(Math.min(seen.cursor, events.length)).some(isKeyMoment);
        seen.cursor = events.length;
        if (!aiOn || !preferences.autoExplain || !fresh || seen.count >= AUTO_EXPLAIN_LIMIT || ai.narrating.loading) return;
        seen.count++;
        ai.narrate();
    }, [events, aiOn, preferences.autoExplain, ai]);
    const analysisModalOpen = pitchAnalysisRequested && !analysisModalDismissed && (ai.analyst.status === "done" || ai.analyst.status === "error");
    const activeInspector = inspector === "ask" && !aiOn ? "insights" : inspector;
    const statusText = { ready: tr(l, "ready"), playing: tr(l, "playing"), paused: tr(l, "paused"), "half-time": tr(l, "halfTime2"), "full-time": tr(l, "fullTime") }[state.status];
    const latest = useRef({ state, annotations });
    useEffect(() => {
        const viewer = viewerRef.current;
        const content = viewer?.querySelector<HTMLElement>(".viewer-content");
        const pitch = viewer?.querySelector<HTMLElement>(".pitch-stage");
        const panel = viewer?.querySelector<HTMLElement>(".pitch-panel");
        if (!viewer || !content || !pitch || !panel) return;
        const resize = new ResizeObserver(() => {
            if (window.matchMedia("(max-width: 900px)").matches) {
                viewer.style.removeProperty("--studio-pitch-height");
                return;
            }
            // Include translated/wrapped toolbars in the available fit height.
            const inset = pitch.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
            const height = `${Math.max(120, Math.floor(content.clientHeight - inset - 8))}px`;
            if (viewer.style.getPropertyValue("--studio-pitch-height") !== height) viewer.style.setProperty("--studio-pitch-height", height);
        });
        resize.observe(content);
        resize.observe(panel);
        return () => resize.disconnect();
    }, []);
    useEffect(() => {
        latest.current = { state, annotations };
        if (state.status !== "playing") saveReview(record.id, state, annotations);
    }, [state, annotations, record.id]);
    useEffect(() => {
        const save = () => { const current = latest.current; saveReview(record.id, current.state, current.annotations); };
        const timer = setInterval(() => { if (latest.current.state.status === "playing") save(); }, 2000);
        const hidden = () => { if (document.visibilityState === "hidden") save(); };
        document.addEventListener("visibilitychange", hidden);
        window.addEventListener("pagehide", save);
        return () => { clearInterval(timer); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", save); save(); };
    }, [record.id]);
    const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
        // Choosing a player makes them a favourite, as the selector's label says.
        setPreferences(p => key === "player" && value ? { ...p, player: value as string, favorites: [value as string, ...(p.favorites ?? []).filter(id => id !== value)] } : { ...p, [key]: value });
        const remembered = rememberChoice(profile, data, key, value);
        setProfile(remembered);
        saveFanProfile(remembered);
        if (key === "mode") { setInspector(value === "casual" ? "story" : "statistics"); if (value === "casual") setLayer("none"); }
        if (key === "language") { setLocale(value as Preferences["language"]); setPitchAnalysisRequested(false); setAnalysisModalDismissed(true); }
    };
    const inspect = (id: string) => {
        if (!events.some(event => event.event_id === id)) return;
        setSelectedId(id); setInspector("details"); setRightOpen(true);
        if (window.matchMedia("(max-width: 900px)").matches) requestAnimationFrame(() => viewerRef.current?.scrollIntoView({ block: "start" }));
    };
    const pause = () => { if (state.status === "playing") dispatch({ type: "toggle" }); };
    const createAnnotation = (kind: MatchAnnotation["kind"]) => {
        pause(); setInspector("notes"); setRightOpen(true);
        const note: MatchAnnotation = { id: crypto.randomUUID(), kind, text: "", anchor: annotationAnchor(data, state, selected?.event_id), eventId: selected?.event_id, createdAt: Date.now() };
        if (kind === "bookmark") { setAnnotations(previous => [...previous, note]); setSelectedNote(note.id); }
        else setDraft(note);
    };
    const selectNote = (id: string) => {
        setSelectedNote(id); setInspector("notes"); setRightOpen(true); setDraft(null);
        if (window.matchMedia("(max-width: 900px)").matches) requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({ block: "start" }));
    };
    const restart = () => { setSelectedId(null); dispatch({ type: "restart" }); };
    const closeAnalysisModal = () => {
        setAnalysisModalDismissed(true);
        requestAnimationFrame(() => viewerRef.current?.querySelector<HTMLButtonElement>(".pitch-analyze-button")?.focus());
    };
    // Drafts come from the note's own anchor prefix and only fill the editor; saving keeps them user-authored.
    const draftWithAI = (note: MatchAnnotation) => {
        const language = l;
        setDrafting(true); setDraftStatus("");
        ai.draftNote(note.anchor).then(text => setDraft(current => current?.id === note.id ? { ...current, text: (current.text.trim() ? `${current.text.trim()}\n\n${text}` : text).slice(0, 4000) } : current),
            (error: unknown) => setDraftStatus(agentErrorText(error instanceof AgentRequestError ? error.code : "upstream_error", language)))
            .finally(() => setDrafting(false));
    };
    const showRecap = state.status === "half-time" || state.status === "full-time";
    return <div className="studio-shell" data-mode={preferences.mode} data-left-open={leftOpen} data-right-open={rightOpen}>
        <a className="skip-link" href={`#${panelId}-viewer`}>{tr(l, "skipToMatch")}</a>
        <header className="studio-topbar">
            <Link className="back-library" href="/" aria-label={tr(l, "backToLibrary")}><ArrowLeft size={17} /><span>{tr(l, "library")}</span></Link>
            <div className="studio-match-title"><h1 dir="ltr"><span className="match-team-home">{home.name}</span> <span className="match-versus">vs</span> <span className="match-team-away">{away.name}</span></h1></div>
            <div className="studio-score" dir="ltr" aria-label={`${home.name} ${stats.teams[home.team_id].goals}, ${away.name} ${stats.teams[away.team_id].goals}`} data-testid="score"><span>{stats.teams[home.team_id].goals}</span><b>:</b><span>{stats.teams[away.team_id].goals}</span></div>
            <div className="studio-clock"><time data-testid="match-clock">{formatTime(state.elapsed)}</time><span>{statusText}</span></div>
            <div className="studio-topbar-actions"><MyMetricBug data={data} stats={stats} preferences={preferences} /><StorageStatus language={l} /><PreferencesMenu data={data} preferences={preferences} onChange={update} compact aiAvailable={aiOn} /></div>
        </header>

        <div ref={bodyRef} className="studio-body" style={layout.style}>
            <aside id={`${panelId}-browser`} className="studio-browser" hidden={!leftOpen} aria-label={tr(l, "matchBrowser")}>
                <div className="studio-pane-scroll"><EventFeed key={preferences.mode === "player" ? `player:${preferences.player}` : "match"} data={data} events={events} preferences={preferences} selectedId={selected?.event_id ?? null} onSelect={event => inspect(event.event_id)} hideDetails /></div>
            </aside>
            {layout.desktop && leftOpen && <StudioSplitter {...layout.browser} panelId={`${panelId}-browser`} language={l} cancelKey={layout.cancelKey} />}
            <main ref={viewerRef} id={`${panelId}-viewer`} className="studio-viewer">

                <div className="viewer-content"><Pitch compact panelActions={<><Button size="sm" variant="ghost" aria-expanded={leftOpen} aria-controls={`${panelId}-browser`} onClick={() => setLeftOpen(value => !value)}><ListFilter size={14} />{tr(l, "browser")}{leftOpen ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}</Button><Button size="sm" variant="ghost" aria-expanded={rightOpen} aria-controls={`${panelId}-inspector`} onClick={() => setRightOpen(value => !value)}><FilePenLine size={14} />{tr(l, "inspector")}{rightOpen ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}</Button></>} actions={<>{preferences.mode !== "casual" && <label className="pitch-layer-select"><span className="sr-only">{tr(l, "pitchLayer")}</span><Select label={tr(l, "pitchLayer")} value={layer} onValueChange={value => setLayer(value as PitchLayer)} options={PITCH_LAYERS.map(value => ({ value, label: tr(l, { none: "layerNone", shots: "layerShots", passes: "layerPasses" }[value]) }))} /></label>}<Button size="sm" variant="ghost" onClick={() => createAnnotation("note")}><FilePenLine size={14} />{tr(l, "note")}</Button><Button size="sm" variant="ghost" onClick={() => createAnnotation("bookmark")}><Bookmark size={14} />{tr(l, "bookmark")}</Button><Button size="sm" variant="ghost" title={tr(l, "broadcastViewHint")} onClick={() => window.open(`/broadcast/${encodeURIComponent(record.id)}?sync=1&bg=preview`, `pitchpulse-broadcast-${record.id}`, "popup,width=1280,height=720")}><MonitorPlay size={14} />{tr(l, "broadcastView")}</Button></>} analysis={aiOn ? { disabled: events.length === 0, loading: ai.analyst.status === "loading", onAnalyze: () => { pause(); setSelectedId(null); setPitchAnalysisRequested(true); setAnalysisModalDismissed(false); ai.analyze(); } } : undefined} data={data} events={events} elapsed={state.elapsed} event={selected ?? events.at(-1)} pinned={!!selected} language={l} onLive={() => setSelectedId(null)} units={units} focusPlayer={focusPlayer} layer={preferences.mode === "casual" ? "none" : layer} />{data.events.length === 0 && <p className="workspace-notice">{tr(l, "thisMatchHasNoRecordedEventsImportAnother")}</p>}</div>

            </main>
            {layout.desktop && rightOpen && <StudioSplitter {...layout.inspector} panelId={`${panelId}-inspector`} language={l} cancelKey={layout.cancelKey} />}
            <aside ref={inspectorRef} id={`${panelId}-inspector`} className="studio-inspector" hidden={!rightOpen} aria-label={tr(l, "analysisInspector")}>
                <div className="studio-tabs inspector-tabs" role="group" aria-label={tr(l, "analysisPanels")}>{([
                    ["story", tr(l, "story")], ["details", tr(l, "details")], ["statistics", tr(l, "stats")], ["insights", tr(l, "insights")], ...(aiOn ? [["ask", tr(l, "ask2")] as const] : []), ["notes", tr(l, "notes")],
                ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={activeInspector === id} onClick={() => setInspector(id)}>{label}{id === "notes" && annotations.length > 0 && <small>{annotations.length}</small>}</button>)}</div>
                <p className="inspector-perspective">{tr(l, "perspective")}: <strong>{perspectiveLabel(preferences.mode, l)}</strong>{preferences.mode === "player" && <span> · {data.players.find(player => player.player_id === preferences.player)?.name ?? tr(l, "noPlayers")}</span>}</p>
                <div className="studio-pane-scroll">
                    {!catchUpDismissed && catchUpAt > 0 && state.cursor === catchUpAt && state.status !== "full-time" && <CatchUpCard data={data} events={events} stats={stats} insights={insights} preferences={preferences} elapsed={state.elapsed} onDismiss={() => setCatchUpDismissed(true)} />}
                    {activeInspector === "story" && <StoryPanel data={data} events={events} stats={stats} insights={insights} preferences={preferences} elapsed={state.elapsed} onEvidence={inspect} aiLines={aiOn ? ai.lines : undefined} />}
                    {activeInspector === "details" && <>{selected ? <EventDetails data={data} event={selected} language={l} id="studio-event-details" /> : <div className="workspace-empty"><ListFilter size={28} /><h2>{tr(l, "aCloserLook")}</h2><p>{tr(l, "selectAReachedEventInTheBrowserOr")}</p></div>}</>}
                    {activeInspector === "statistics" && <><StatisticsPanel data={data} stats={stats} preferences={preferences} units={units} events={events} elapsed={state.elapsed} /></>}
                    {activeInspector === "insights" && <><InsightsPanel data={data} insights={insights} elapsed={state.elapsed} preferences={preferences} onEvidence={inspect} aiConnected={aiOn} /><AgentInsights preferences={preferences} available={aiAvailable} task={ai.analyst} cursor={events.length} canAnalyze={events.length > 0} onAnalyze={() => { pause(); ai.analyze(); }} onEvidence={inspect} /><CommentaryPanel data={data} events={events} preferences={preferences} onEvidence={inspect} narration={aiOn ? { lines: ai.lines, pending: ai.pending, loading: ai.narrating.loading, errorText: ai.narrating.error ? agentErrorText(ai.narrating.error, l) : undefined, onNarrate: () => { pause(); ai.narrate(); } } : undefined} /></>}
                    {activeInspector === "ask" && <AskAnalyst entries={ai.chat} cursor={events.length} elapsed={state.elapsed} language={l} asking={ai.asking} onAsk={question => { pause(); ai.ask(question); }} onEvidence={inspect} />}
                    {activeInspector === "notes" && <StudioNotes annotations={annotations} language={l} selectedId={selectedNote} draft={draft} onDraftWithAI={aiOn ? draftWithAI : undefined} drafting={drafting} draftStatus={draftStatus} onSelect={selectNote} onDraft={setDraft} onCreate={createAnnotation} onSave={note => { setAnnotations(previous => previous.some(a => a.id === note.id) ? previous.map(a => a.id === note.id ? note : a) : [...previous, note]); setDraft(null); setSelectedNote(note.id); }} onDelete={id => { setAnnotations(previous => previous.filter(a => a.id !== id)); setSelectedNote(null); }} onGo={note => { dispatch({ type: "restore", checkpoint: note.anchor }); setSelectedId(note.eventId ?? null); }} />}
                    {showRecap && <Recap data={data} events={events} stats={stats} insights={insights} preferences={preferences} kind={state.status === "half-time" ? "half-time" : "full-time"} onEvidence={inspect} onContinue={() => state.status === "half-time" ? dispatch({ type: "toggle" }) : restart()} />}
                    {showRecap && aiOn && <AgentRecapPanel data={data} events={events} preferences={preferences} kind={state.status === "half-time" ? "half-time" : "full-time"} task={ai.recap} onWrite={ai.writeRecap} onEvidence={inspect} />}
                </div>
            </aside>
        </div>
        <StudioTimeline data={data} events={events} state={state} language={l} focusPlayer={focusPlayer} annotations={annotations} selectedId={selected?.event_id ?? null} onAnnotation={selectNote} onEvent={inspect} dispatch={dispatch} statusText={statusText} onRestart={restart} onSeek={elapsed => { setSelectedId(null); dispatch({ type: "seek", elapsed }); }} onStep={() => { setSelectedId(null); dispatch({ type: "step" }); }} />
        <AgentAnalysisModal open={analysisModalOpen} preferences={preferences} task={ai.analyst} cursor={events.length} onClose={closeAnalysisModal} onEvidence={id => { setAnalysisModalDismissed(true); inspect(id); }} />
    </div>;
}
