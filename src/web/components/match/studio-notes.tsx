"use client";

import { Bookmark, FilePenLine, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/match/playback";
import { tr } from "@/lib/match/presentation";
import type { Language, MatchAnnotation } from "@/lib/match/types";

export function StudioNotes({ annotations, language: l, selectedId, draft, onSelect, onDraft, onCreate, onSave, onDelete, onGo, onDraftWithAI, drafting = false, draftStatus = "" }: {
    annotations: MatchAnnotation[]; language: Language; selectedId: string | null; draft: MatchAnnotation | null;
    onSelect: (id: string) => void; onDraft: (draft: MatchAnnotation | null) => void;
    onCreate: (kind: MatchAnnotation["kind"]) => void; onSave: (note: MatchAnnotation) => void;
    onDelete: (id: string) => void; onGo: (note: MatchAnnotation) => void;
    /** AI drafting only fills the editor; saving keeps the note user-authored. */
    onDraftWithAI?: (draft: MatchAnnotation) => void; drafting?: boolean; draftStatus?: string;
}) {
    const selected = annotations.find(a => a.id === selectedId);
    return <section className="studio-notes" aria-labelledby="notes-heading">
        <div className="inspector-heading"><h2 id="notes-heading">{tr(l, "Your analysis", "Iyong pagsusuri")}</h2><span>{annotations.length}</span></div>
        <p className="data-note">{tr(l, "Capture a thought at the playhead or the event you’re inspecting.", "Magtala sa kasalukuyang oras o sa sinusuring pangyayari.")}</p>
        <div className="note-actions"><Button size="sm" onClick={() => onCreate("note")}><Plus size={14} />{tr(l, "Add note", "Magdagdag ng tala")}</Button><Button size="sm" variant="outline" onClick={() => onCreate("bookmark")}><Bookmark size={14} />{tr(l, "Bookmark", "Bookmark")}</Button></div>
        {draft && <form className="note-editor" onSubmit={e => { e.preventDefault(); if (draft.text.trim()) onSave({ ...draft, text: draft.text.trim() }); }}>
            <label htmlFor="note-text">{draft.kind === "note" ? tr(l, "Note", "Tala") : tr(l, "Bookmark title", "Pamagat ng bookmark")} <time>{formatTime(draft.anchor.elapsed)}</time></label>
            <textarea id="note-text" autoFocus rows={5} maxLength={4000} required value={draft.text} onChange={e => onDraft({ ...draft, text: e.target.value })} placeholder={tr(l, "What do you see in this moment?", "Ano ang nakikita mo sa sandaling ito?")} />
            <div><Button size="sm" type="submit" disabled={!draft.text.trim()}>{tr(l, "Save", "I-save")}</Button><Button size="sm" type="button" variant="ghost" onClick={() => onDraft(null)}>{tr(l, "Cancel", "Kanselahin")}</Button>{onDraftWithAI && draft.kind === "note" && <Button size="sm" type="button" variant="outline" disabled={drafting || draft.anchor.cursor === 0} onClick={() => onDraftWithAI(draft)}><Sparkles size={13} aria-hidden="true" />{tr(l, "Draft with AI", "Isulat gamit ang AI")}</Button>}</div>
            {onDraftWithAI && draft.kind === "note" && <p className="agent-status" role="status" aria-live="polite">{drafting ? tr(l, "Drafting from the events up to this moment…", "Isinusulat mula sa mga pangyayari hanggang sa sandaling ito…") : draftStatus}</p>}
        </form>}
        {!annotations.length && !draft && <div className="workspace-empty"><FilePenLine size={28} /><h3>{tr(l, "Make the match your own", "Gawing iyo ang pagsusuri")}</h3><p>{tr(l, "Save observations and bookmark moments to return to later.", "I-save ang mga obserbasyon at sandaling babalikan.")}</p></div>}
        <ol className="notes-list">{[...annotations].sort((a, b) => a.anchor.elapsed - b.anchor.elapsed || a.createdAt - b.createdAt).map(note => <li key={note.id}><button type="button" aria-pressed={note.id === selectedId} onClick={() => onSelect(note.id)}><span className="note-time">{note.kind === "bookmark" ? <Bookmark size={13} /> : <FilePenLine size={13} />}<time>{formatTime(note.anchor.elapsed)}</time></span><span>{note.text || tr(l, "Saved moment", "Naka-save na sandali")}</span></button></li>)}</ol>
        {selected && !draft && <div className="note-detail"><div className="eyebrow">{tr(l, "SAVED MOMENT", "NAKA-SAVE NA SANDALI")} · {formatTime(selected.anchor.elapsed)}</div><p>{selected.text || tr(l, "Saved moment", "Naka-save na sandali")}</p><Button size="sm" onClick={() => onGo(selected)}>{tr(l, "Go to moment", "Pumunta sa sandali")}</Button><div className="note-detail-actions"><Button size="sm" variant="ghost" onClick={() => onDraft({ ...selected })}><FilePenLine size={13} />{tr(l, "Edit", "Baguhin")}</Button><Button size="sm" variant="ghost" onClick={() => onDelete(selected.id)}><Trash2 size={13} />{tr(l, "Delete", "Burahin")}</Button></div></div>}
    </section>;
}
