"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bookmark, ChevronLeft, ChevronRight, FilePenLine, FolderOpen, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { annotationAnchor, formatTime } from "@/lib/match/playback";
import { tr } from "@/lib/match/presentation";
import { ruleBasedProvider } from "@/lib/match/insights";
import { useSimulation } from "@/lib/match/use-simulation";
import { AgentRequestError, useStudioAgents } from "@/lib/match/use-agents";
import { saveReview, setLibraryLanguage, useLibrary } from "@/lib/match/use-library";
import type { LibraryMatch, MatchAnnotation, Preferences } from "@/lib/match/types";
import { Pitch } from "./pitch";
import { EventDetails, EventFeed } from "./event-feed";
import { StatisticsPanel } from "./statistics-panel";
import { InsightsPanel } from "./insights-panel";
import { CommentaryPanel } from "./commentary-panel";
import { Recap } from "./recap";
import { PreferencesMenu, perspectiveLabel } from "./view-controls";
import { ImportMatch, StorageStatus, StudioBrand } from "./match-library";
import { StudioSplitter } from "./studio-splitter";
import { useStudioLayout } from "./use-studio-layout";
import { StudioTimeline } from "./studio-timeline";
import { StudioNotes } from "./studio-notes";
import { AgentInsights, agentErrorText } from "./agent-insights";
import { AgentRecapPanel } from "./agent-recap";
import { AskAnalyst } from "./ask-analyst";

export default function Studio({ id, aiAvailable = false }: { id: string; aiAvailable?: boolean }) {
    const library = useLibrary();
    const record = library.matches.find(match => match.id === id);
    const l = library.language;
    if (!library.ready) return <div className="studio-loading"><StudioBrand /><p role="status">{tr(l, "Opening your studio…", "Binubuksan ang iyong studio…")}</p></div>;
    if (!record) return <div className="studio-loading"><StudioBrand /><FolderOpen size={40} /><h1>{tr(l, "This match isn’t in your library", "Wala sa iyong library ang laban")}</h1><p>{tr(l, "Imported games are saved in the browser where you added them. Open your library to import this match again.", "Naka-save ang mga laban sa browser kung saan sila na-import. Buksan ang library upang i-import muli ang laban.")}</p><StorageStatus language={l} /><Link className="open-studio" href="/">{tr(l, "Back to library", "Bumalik sa library")}<ArrowUpRight size={16} /></Link></div>;
    return <MatchStudio key={record.id} record={record} aiAvailable={aiAvailable} />;
}

function MatchStudio({ record, aiAvailable }: { record: LibraryMatch; aiAvailable: boolean }) {
    const data = record.data;
    const panelId = useId();
    const bodyRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<HTMLElement>(null);
    const inspectorRef = useRef<HTMLElement>(null);
    const library = useLibrary();
    const { state, dispatch, events, stats } = useSimulation(data, record.checkpoint);
    const [preferences, setPreferences] = useState<Preferences>({ mode: "analyst", language: library.language, team: data.match.home_team_id, player: data.players.find(p => p.team_id === data.match.home_team_id && p.position !== "GK")?.player_id ?? data.players[0]?.player_id ?? "" });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [leftTab, setLeftTab] = useState<"events" | "library">("events");
    const [inspector, setInspector] = useState<"details" | "statistics" | "insights" | "ask" | "notes">("statistics");
    const [leftOpen, setLeftOpen] = useState(false);
    const [rightOpen, setRightOpen] = useState(true);
    const layout = useStudioLayout(bodyRef, leftOpen, rightOpen);
    const [annotations, setAnnotations] = useState(record.annotations);
    const [draft, setDraft] = useState<MatchAnnotation | null>(null);
    const [selectedNote, setSelectedNote] = useState<string | null>(null);
    // AI is opt-in per session and every agent call is on demand.
    const [aiEnabled, setAiEnabled] = useState(false);
    const [drafting, setDrafting] = useState(false);
    const [draftStatus, setDraftStatus] = useState("");
    const l = preferences.language;
    const selected = events.find(e => e.event_id === selectedId);
    const home = data.teams.find(t => t.team_id === data.match.home_team_id)!;
    const away = data.teams.find(t => t.team_id === data.match.away_team_id)!;
    const reachedTime = events.at(-1)?.match_time_seconds ?? 0;
    const insights = useMemo(() => ruleBasedProvider.generate(data, events, reachedTime), [data, events, reachedTime]);
    const ai = useStudioAgents(record.id, data, events, { elapsed: state.elapsed, secondHalf: state.secondHalf, status: state.status }, preferences);
    const aiOn = aiAvailable && aiEnabled;
    const activeInspector = inspector === "ask" && !aiOn ? "insights" : inspector;
    const statusText = { ready: tr(l, "Ready", "Handa"), playing: tr(l, "Playing", "Naglalaro"), paused: tr(l, "Paused", "Nakahinto"), "half-time": tr(l, "Half-time", "Pahinga"), "full-time": tr(l, "Full-time", "Tapos na") }[state.status];
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
        setPreferences(p => ({ ...p, [key]: value }));
        if (key === "language") setLibraryLanguage(value as Preferences["language"]);
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
    const setAi = (enabled: boolean) => { setAiEnabled(enabled); if (!enabled && inspector === "ask") setInspector("insights"); };
    // Drafts come from the note's own anchor prefix and only fill the editor; saving keeps them user-authored.
    const draftWithAI = (note: MatchAnnotation) => {
        const language = l;
        setDrafting(true); setDraftStatus("");
        ai.draftNote(note.anchor).then(text => setDraft(current => current?.id === note.id ? { ...current, text: (current.text.trim() ? `${current.text.trim()}\n\n${text[language]}` : text[language]).slice(0, 4000) } : current),
            (error: unknown) => setDraftStatus(agentErrorText(error instanceof AgentRequestError ? error.code : "upstream_error", language)))
            .finally(() => setDrafting(false));
    };
    const showRecap = state.status === "half-time" || state.status === "full-time";
    return <div className="studio-shell" data-left-open={leftOpen} data-right-open={rightOpen}>
        <a className="skip-link" href={`#${panelId}-viewer`}>{tr(l, "Skip to match", "Lumaktaw sa laban")}</a>
        <header className="studio-topbar">
            <Link className="back-library" href="/" aria-label={tr(l, "Back to library", "Bumalik sa library")}><ArrowLeft size={17} /><span>{tr(l, "Library", "Library")}</span></Link>
            <div className="studio-match-title"><h1>{home.name} <span>vs</span> {away.name}</h1></div>
            <div className="studio-score" aria-label={`${home.name} ${stats.teams[home.team_id].goals}, ${away.name} ${stats.teams[away.team_id].goals}`} data-testid="score"><span>{stats.teams[home.team_id].goals}</span><b>:</b><span>{stats.teams[away.team_id].goals}</span></div>
            <div className="studio-clock"><time data-testid="match-clock">{formatTime(state.elapsed)}</time><span>{statusText}</span></div>
            <div className="studio-topbar-actions"><StorageStatus language={l} /><PreferencesMenu data={data} preferences={preferences} onChange={update} compact ai={{ available: aiAvailable, enabled: aiEnabled, onChange: setAi }} /></div>
        </header>

        <div ref={bodyRef} className="studio-body" style={layout.style}>
            <aside id={`${panelId}-browser`} className="studio-browser" hidden={!leftOpen} aria-label={tr(l, "Match browser", "Browser ng laban")}>
                <div className="studio-tabs" role="group" aria-label={tr(l, "Browser panels", "Mga panel ng browser")}><button type="button" aria-pressed={leftTab === "events"} onClick={() => setLeftTab("events")}><ListFilter size={14} />{tr(l, "Events", "Mga aksiyon")}</button><button type="button" aria-pressed={leftTab === "library"} onClick={() => setLeftTab("library")}><FolderOpen size={14} />{tr(l, "Library", "Library")}</button></div>
                <div className="studio-pane-scroll">{leftTab === "events" ? <EventFeed key={preferences.mode === "player" ? `player:${preferences.player}` : "match"} data={data} events={events} preferences={preferences} selectedId={selected?.event_id ?? null} onSelect={event => inspect(event.event_id)} hideDetails /> : <div className="studio-library-list"><div className="inspector-heading"><h2>{tr(l, "Your matches", "Iyong mga laban")}</h2><span>{library.matches.length}</span></div>{library.matches.map(match => <Link key={match.id} href={`/studio/${match.id}`} aria-current={match.id === record.id ? "page" : undefined}><span className="mini-match-icon"><FolderOpen size={18} /></span><span><strong>{match.data.teams.map(team => team.name).join(" vs ")}</strong><small>{formatTime(match.checkpoint.elapsed)} · {match.annotations.length} {tr(l, "saved", "naka-save")}</small></span><ArrowUpRight size={14} /></Link>)}<ImportMatch language={l} onBeforeImport={pause} /><p className="data-note">{tr(l, "Imports are added to your library. Open a match above to switch.", "Nadadagdag sa library ang mga import. Pumili ng laban sa itaas upang lumipat.")}</p></div>}</div>
            </aside>
            {layout.desktop && leftOpen && <StudioSplitter {...layout.browser} panelId={`${panelId}-browser`} language={l} cancelKey={layout.cancelKey} />}
            <main ref={viewerRef} id={`${panelId}-viewer`} className="studio-viewer">

                <div className="viewer-content"><Pitch compact panelActions={<><Button size="sm" variant="ghost" aria-expanded={leftOpen} aria-controls={`${panelId}-browser`} onClick={() => setLeftOpen(value => !value)}><ListFilter size={14} />{tr(l, "Browser", "Browser")}{leftOpen ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}</Button><Button size="sm" variant="ghost" aria-expanded={rightOpen} aria-controls={`${panelId}-inspector`} onClick={() => setRightOpen(value => !value)}><FilePenLine size={14} />{tr(l, "Inspector", "Tagasuri")}{rightOpen ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}</Button></>} actions={<><Button size="sm" variant="ghost" onClick={() => createAnnotation("note")}><FilePenLine size={14} />{tr(l, "Note", "Tala")}</Button><Button size="sm" variant="ghost" onClick={() => createAnnotation("bookmark")}><Bookmark size={14} />{tr(l, "Bookmark", "Bookmark")}</Button></>} data={data} events={events} elapsed={state.elapsed} event={selected ?? events.at(-1)} pinned={!!selected} language={l} onLive={() => setSelectedId(null)} />{data.events.length === 0 && <p className="workspace-notice">{tr(l, "This match has no recorded events. Import another dataset to replay a game.", "Walang naitalang pangyayari sa laban. Mag-import ng ibang dataset upang mag-replay.")}</p>}</div>

            </main>
            {layout.desktop && rightOpen && <StudioSplitter {...layout.inspector} panelId={`${panelId}-inspector`} language={l} cancelKey={layout.cancelKey} />}
            <aside ref={inspectorRef} id={`${panelId}-inspector`} className="studio-inspector" hidden={!rightOpen} aria-label={tr(l, "Analysis inspector", "Tagasuri ng laban")}>
                <div className="studio-tabs inspector-tabs" role="group" aria-label={tr(l, "Analysis panels", "Mga panel ng pagsusuri")}>{([
                    ["details", tr(l, "Details", "Detalye")], ["statistics", tr(l, "Stats", "Datos")], ["insights", tr(l, "Insights", "Pagsusuri")], ...(aiOn ? [["ask", tr(l, "Ask", "Magtanong")] as const] : []), ["notes", tr(l, "Notes", "Mga tala")],
                ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={activeInspector === id} onClick={() => setInspector(id)}>{label}{id === "notes" && annotations.length > 0 && <small>{annotations.length}</small>}</button>)}</div>
                <p className="inspector-perspective">{tr(l, "Perspective", "Pananaw")}: <strong>{perspectiveLabel(preferences.mode, l)}</strong>{preferences.mode === "player" && <span> · {data.players.find(player => player.player_id === preferences.player)?.name ?? tr(l, "No players", "Walang manlalaro")}</span>}</p>
                <div className="studio-pane-scroll">
                    {activeInspector === "details" && <>{selected ? <EventDetails data={data} event={selected} language={l} id="studio-event-details" /> : <div className="workspace-empty"><ListFilter size={28} /><h2>{tr(l, "A closer look", "Mas malapit na pagtingin")}</h2><p>{tr(l, "Select a reached event in the browser or timeline to inspect its recorded details.", "Pumili ng naabot na pangyayari sa browser o timeline upang suriin ang mga detalye.")}</p></div>}</>}
                    {activeInspector === "statistics" && <><StatisticsPanel data={data} stats={stats} preferences={preferences} /></>}
                    {activeInspector === "insights" && <><InsightsPanel data={data} insights={insights} elapsed={state.elapsed} preferences={preferences} onEvidence={inspect} aiConnected={aiOn} /><AgentInsights preferences={preferences} available={aiAvailable} enabled={aiEnabled} task={ai.analyst} cursor={events.length} canAnalyze={events.length > 0} onAnalyze={() => { pause(); ai.analyze(); }} onEnable={() => setAi(true)} onEvidence={inspect} /><CommentaryPanel data={data} events={events} preferences={preferences} onEvidence={inspect} narration={aiOn ? { lines: ai.lines, pending: ai.pending, loading: ai.narrating.loading, errorText: ai.narrating.error ? agentErrorText(ai.narrating.error, l) : undefined, onNarrate: () => { pause(); ai.narrate(); } } : undefined} /></>}
                    {activeInspector === "ask" && <AskAnalyst entries={ai.chat} cursor={events.length} elapsed={state.elapsed} language={l} asking={ai.asking} onAsk={question => { pause(); ai.ask(question); }} onEvidence={inspect} />}
                    {activeInspector === "notes" && <StudioNotes annotations={annotations} language={l} selectedId={selectedNote} draft={draft} onDraftWithAI={aiOn ? draftWithAI : undefined} drafting={drafting} draftStatus={draftStatus} onSelect={selectNote} onDraft={setDraft} onCreate={createAnnotation} onSave={note => { setAnnotations(previous => previous.some(a => a.id === note.id) ? previous.map(a => a.id === note.id ? note : a) : [...previous, note]); setDraft(null); setSelectedNote(note.id); }} onDelete={id => { setAnnotations(previous => previous.filter(a => a.id !== id)); setSelectedNote(null); }} onGo={note => { dispatch({ type: "restore", checkpoint: note.anchor }); setSelectedId(note.eventId ?? null); }} />}
                    {showRecap && <Recap data={data} events={events} stats={stats} insights={insights} preferences={preferences} kind={state.status === "half-time" ? "half-time" : "full-time"} onEvidence={inspect} onContinue={() => state.status === "half-time" ? dispatch({ type: "toggle" }) : restart()} />}
                    {showRecap && aiOn && <AgentRecapPanel data={data} events={events} preferences={preferences} kind={state.status === "half-time" ? "half-time" : "full-time"} task={ai.recap} onWrite={ai.writeRecap} onEvidence={inspect} />}
                </div>
            </aside>
        </div>
        <StudioTimeline data={data} events={events} state={state} language={l} annotations={annotations} selectedId={selected?.event_id ?? null} onAnnotation={selectNote} onEvent={inspect} dispatch={dispatch} statusText={statusText} onRestart={restart} onSeek={elapsed => { setSelectedId(null); dispatch({ type: "seek", elapsed }); }} onStep={() => { setSelectedId(null); dispatch({ type: "step" }); }} />
    </div>;
}
