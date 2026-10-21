"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createLibraryMatch, DEMO_ID, validateLibraryMatch } from "./library";
import { libraryStorage } from "./library-storage";
import { validateMatch } from "./validation";
import type { Language, LibraryMatch, MatchAnnotation, PlaybackCheckpoint } from "./types";

interface LibrarySnapshot { matches: LibraryMatch[]; ready: boolean; saving: boolean; storageError: boolean; loadError: boolean; corruptCount: number; language: Language }
const empty: LibrarySnapshot = { matches: [], ready: false, saving: false, storageError: false, loadError: false, corruptCount: 0, language: "en" };
let snapshot = empty;
const listeners = new Set<() => void>();
const dirty = new Map<string, "match" | "review" | "delete">();
let queue = Promise.resolve();
let initialization: Promise<void> | undefined;
let readFailed = false;
function publish(update: Partial<LibrarySnapshot>) { snapshot = { ...snapshot, ...update }; listeners.forEach(fn => fn()); }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

async function hydrate() {
    const saved = await libraryStorage.list();
    const reviews = new Map(saved.reviews.filter((r): r is { id: string } => !!r && typeof r === "object" && "id" in r && typeof r.id === "string").map(r => [r.id, r]));
    const existing = new Map(snapshot.matches.map(m => [m.id, m]));
    let corruptCount = 0;
    for (const raw of saved.matches) {
        try {
            const id = (raw as { id: string }).id;
            if (!existing.has(id) && !dirty.has(id)) existing.set(id, validateLibraryMatch(raw, reviews.get(id)));
        } catch { corruptCount++; }
    }
    publish({ matches: [...existing.values()], corruptCount });
    readFailed = false;
}
async function initialize() {
    try { await hydrate(); } catch { readFailed = true; publish({ storageError: true }); }
    await loadDemo();
    publish({ ready: true });
}
async function loadDemo() {
    if (snapshot.matches.some(m => m.id === DEMO_ID)) return;
    try {
        const response = await fetch("/api/match");
        if (!response.ok) throw new Error("Demo unavailable");
        const match = createLibraryMatch(DEMO_ID, validateMatch(await response.json()), "Arsenal vs Chelsea", "demo", Date.now());
        publish({ matches: [...snapshot.matches, match], loadError: false });
        dirty.set(match.id, "match");
        flush();
    } catch { publish({ loadError: true }); }
}
/** A single writer and identity checks prevent older in-flight saves clearing newer changes. */
function flush(force = false) {
    queue = queue.then(async () => {
        if (snapshot.storageError && !force) return;
        publish({ saving: true });
        try {
            for (const [id, operation] of [...dirty]) {
                const match = snapshot.matches.find(m => m.id === id);
                if (operation === "delete") await libraryStorage.remove(id);
                else if (match) {
                    if (operation === "match") await libraryStorage.saveMatch(match);
                    else await libraryStorage.saveReview({ id, checkpoint: match.checkpoint, annotations: match.annotations, updatedAt: match.updatedAt });
                }
                if (dirty.get(id) === operation && snapshot.matches.find(m => m.id === id) === match) dirty.delete(id);
            }
            publish({ storageError: false });
        } catch { publish({ storageError: true }); }
        finally { publish({ saving: false }); }
    });
    return queue;
}
export function useLibrary() {
    const state = useSyncExternalStore(subscribe, () => snapshot, () => empty);
    useEffect(() => { initialization ??= initialize(); }, []);
    useEffect(() => { document.documentElement.lang = state.language; }, [state.language]);
    return state;
}
export function setLibraryLanguage(language: Language) { publish({ language }); }
export async function importMatch(file: File) {
    if (file.size > 10 * 1024 * 1024) throw new Error("Please choose a JSON file smaller than 10 MB.");
    let raw: unknown;
    try { raw = JSON.parse(await file.text()); } catch { throw new Error("This file is not valid JSON."); }
    const match = createLibraryMatch(crypto.randomUUID(), validateMatch(raw), file.name, "upload", Date.now());
    publish({ matches: [...snapshot.matches, match] });
    dirty.set(match.id, "match");
    await flush();
    return match.id;
}
export function saveReview(id: string, checkpoint: PlaybackCheckpoint, annotations?: MatchAnnotation[]) {
    const current = snapshot.matches.find(m => m.id === id);
    if (!current) return;
    const match = { ...current, checkpoint: { ...checkpoint }, annotations: annotations ?? current.annotations, updatedAt: Date.now() };
    publish({ matches: snapshot.matches.map(m => m.id === id ? match : m) });
    if (dirty.get(id) !== "match") dirty.set(id, "review");
    void flush();
}
export function removeMatch(id: string) {
    if (id === DEMO_ID) return;
    publish({ matches: snapshot.matches.filter(m => m.id !== id) });
    dirty.set(id, "delete");
    void flush();
}
export async function retryLibrary() {
    if (readFailed) {
        try { await hydrate(); } catch { publish({ storageError: true }); return; }
    }
    await flush(true);
    await loadDemo();
}
