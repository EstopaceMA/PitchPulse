"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, Bookmark, FolderOpen, Search, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/match/playback";
import { initials, tr } from "@/lib/match/presentation";
import { importMatch, removeMatch, retryLibrary, useLibrary } from "@/lib/match/use-library";
import { LOCALES, LOCALE_NAMES, isLocale } from "@/lib/i18n/locales";
import type { Language, LibraryMatch } from "@/lib/match/types";
import { FootballMark } from "./football-mark";
import { useAppLocale } from "./locale-provider";

export function StudioBrand() {
    return <Link href="/" className="studio-brand" aria-label="PitchPulse"><span className="studio-brand-icon"><Activity size={22} aria-hidden="true" /><span className="brand-ball"><FootballMark size={15} /></span></span><strong>pitch<span>pulse</span><i>.</i></strong></Link>;
}
export function StorageStatus({ language: l }: { language: Language }) {
    const library = useLibrary();
    if (!library.storageError && !library.saving) return null;
    return <div className={`save-status ${library.storageError ? "unsaved" : ""}`} role="status">
        <span className="tiny-dot" />{library.storageError ? tr(l, "unsavedThisSessionOnly") : tr(l, "saving")}
        {library.storageError && <button type="button" onClick={() => void retryLibrary()}>{tr(l, "retry")}</button>}
    </div>;
}
export function ImportMatch({ language: l }: { language: Language }) {
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    return <div className="import-control">
        <input ref={input} className="sr-only" type="file" accept=".json,application/json" aria-label={tr(l, "importMatchJson")} onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true); setError(null);
            try { await importMatch(file); } catch (err) {
                const reason = err instanceof Error ? err.message : "";
                setError(reason.includes("10 MB") ? tr(l, "importErrorSize") : reason.includes("valid JSON") ? tr(l, "importErrorJson") : tr(l, "importErrorInvalid"));
            }
            finally { setBusy(false); if (input.current) input.current.value = ""; }
        }} />
        <Button disabled={busy} onClick={() => input.current?.click()}><Upload size={15} />{busy ? tr(l, "importing") : tr(l, "importMatch")}</Button>
        {error && <div className="import-error" role="alert"><strong>{tr(l, "couldnTImportThisMatch")}</strong><p>{error}</p><p>{tr(l, "yourLibraryIsUnchangedUseCompatibleMatchJson")}</p><Button size="sm" variant="ghost" onClick={() => setError(null)}><X size={14} />{tr(l, "dismiss")}</Button></div>}
    </div>;
}
export function MatchCard({ match, language: l, onRemove }: { match: LibraryMatch; language: Language; onRemove?: () => void }) {
    const home = match.data.teams.find(t => t.team_id === match.data.match.home_team_id)!;
    const away = match.data.teams.find(t => t.team_id === match.data.match.away_team_id)!;
    const progress = match.checkpoint.elapsed / match.data.match.duration_seconds * 100;
    return <article className="game-card">
        <Link className="game-link" href={`/studio/${match.id}`} aria-label={`${tr(l, "openStudio")}: ${home.name} vs ${away.name}`}>
            <div className="game-preview"><div className="preview-grid" aria-hidden="true"><div className="mini-pitch"><span /><i /><b /><em /></div></div>
                <span className="source-badge">{match.kind === "demo" ? tr(l, "syntheticDemo") : tr(l, "importedMatch")}</span>
                <div className="preview-teams" dir="ltr" aria-hidden="true"><span>{initials(home.team_id)}</span><small>vs</small><span>{initials(away.team_id)}</span></div>
                <span className="preview-duration">{Math.round(match.data.match.duration_seconds / 60)} {tr(l, "min")}</span>
                <span className="preview-open"><ArrowUpRight size={18} /></span>
            </div>
            <div className="game-card-content game-title"><h2 dir="ltr"><span className="match-team-home">{home.name}</span> <span className="match-versus">vs</span> <span className="match-team-away">{away.name}</span></h2></div>
        </Link>
        {onRemove && <Button className="game-remove" size="icon" variant="ghost" aria-label={`${tr(l, "removeImportedMatch")}: ${home.name} vs ${away.name}`} onClick={onRemove}><Trash2 size={14} /></Button>}
        <div className="game-card-content game-metadata">
            <p className="game-source" title={match.source}>{match.source}</p>
            <div className="game-progress"><span style={{ width: `${progress}%` }} /></div>
            <div className="game-card-meta"><span>{progress > 0 ? `${formatTime(match.checkpoint.elapsed)} / ${formatTime(match.data.match.duration_seconds)}` : tr(l, "readyToAnalyze")}</span><span><Bookmark size={12} />{match.annotations.length} {tr(l, "saved")}</span></div>
        </div>
    </article>;
}
export default function MatchLibrary() {
    const library = useLibrary();
    const { locale: l, setLocale } = useAppLocale();
    const [search, setSearch] = useState("");
    const [removing, setRemoving] = useState<string | null>(null);
    const removalTrigger = useRef<HTMLElement | null>(null);
    useEffect(() => { if (!removing) { if (removalTrigger.current?.isConnected) removalTrigger.current.focus(); else if (removalTrigger.current) document.querySelector<HTMLInputElement>(".library-search input")?.focus(); } }, [removing]);
    const matches = library.matches.filter(m => `${m.data.teams.map(t => t.name).join(" ")} ${m.source}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt);
    return <div className="library-shell">
        <a className="skip-link" href="#library-content">{tr(l, "skipToLibrary")}</a>
        <header className="library-header" inert={!!removing}><StudioBrand /><div className="library-header-actions"><label className="language-control"><span className="sr-only">{tr(l, "language")}</span><select value={l} onChange={e => { if (isLocale(e.target.value)) setLocale(e.target.value); }}>{LOCALES.map(locale => <option key={locale} value={locale}>{LOCALE_NAMES[locale]}</option>)}</select></label><StorageStatus language={l} /></div></header>
        <main id="library-content" className="library-main" inert={!!removing}>
            <div className="library-toolbar">
                <h1><FolderOpen size={20} />{tr(l, "matchLibrary")}<span>{library.matches.length}</span></h1>
                <label className="library-search"><Search size={15} /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={tr(l, "searchMatches")} aria-label={tr(l, "searchMatches2")} /></label>
                <div className="library-import"><ImportMatch language={l} /><small>JSON · 10 MB {tr(l, "max")}</small></div>
            </div>
            {!library.ready && <p className="workspace-empty" role="status">{tr(l, "openingYourLibrary")}</p>}
            {library.loadError && <div className="workspace-notice" role="alert">{tr(l, "theDemoCouldnTLoadYourImportedGames")} <Button variant="outline" onClick={() => void retryLibrary()}>{tr(l, "retryDemo")}</Button></div>}
            {library.corruptCount > 0 && <p className="workspace-notice" role="alert">{tr(l, "damagedLocalRecords", { count: library.corruptCount })}</p>}
            <div className="games-grid">{matches.map(match => <MatchCard key={match.id} match={match} language={l} onRemove={match.kind === "upload" ? () => { removalTrigger.current = document.activeElement as HTMLElement; setRemoving(match.id); } : undefined} />)}</div>
            {library.ready && search && matches.length === 0 && <p className="workspace-empty">{tr(l, "noMatchesFoundTryAnotherTeamOrFilename")}</p>}

        </main>
        {removing && <div className="confirmation-backdrop"><section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-heading" aria-describedby="remove-description" onKeyDown={e => { if (e.key === "Escape") setRemoving(null); if (e.key === "Tab") { const buttons = e.currentTarget.querySelectorAll("button"); const first = buttons[0], last = buttons[buttons.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }}><Trash2 size={24} /><h2 id="remove-heading">{tr(l, "removeThisMatch")}</h2><p id="remove-description">{tr(l, "thisRemovesTheImportedGameNotesAndBookmarks")}</p><div><Button autoFocus variant="outline" onClick={() => setRemoving(null)}>{tr(l, "cancel")}</Button><Button variant="destructive" onClick={() => { removeMatch(removing); setRemoving(null); }}>{tr(l, "removeMatch")}</Button></div></section></div>}
    </div>;
}
