import type { FanProfile, LibraryMatch, MatchAnnotation, PlaybackCheckpoint } from "./types";

type StoredMatch = Pick<LibraryMatch, "id" | "data" | "source" | "kind" | "createdAt">;
export interface StoredReview { id: string; checkpoint: PlaybackCheckpoint; annotations: MatchAnnotation[]; updatedAt: number }
export interface LibraryStorage {
    list(): Promise<{ matches: unknown[]; reviews: unknown[] }>;
    saveMatch(match: LibraryMatch): Promise<void>;
    saveReview(review: StoredReview): Promise<void>;
    remove(id: string): Promise<void>;
}
let connection: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
    if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("pitchpulse-studio", 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore("matches", { keyPath: "id" });
            request.result.createObjectStore("reviews", { keyPath: "id" });
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => { db.close(); connection = undefined; };
            resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Storage is open in another version of the app."));
    }).catch(error => { connection = undefined; throw error; });
    return connection;
}
async function transaction(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => void): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Storage transaction aborted"));
        run(tx);
    });
}
export const libraryStorage: LibraryStorage = {
    async list() {
        let matches: unknown[] = [], reviews: unknown[] = [];
        await transaction(["matches", "reviews"], "readonly", tx => {
            const m = tx.objectStore("matches").getAll();
            const r = tx.objectStore("reviews").getAll();
            m.onsuccess = () => { matches = m.result; };
            r.onsuccess = () => { reviews = r.result; };
        });
        return { matches, reviews };
    },
    async saveMatch(match) {
        const { id, data, source, kind, createdAt, checkpoint, annotations, updatedAt } = match;
        const stored: StoredMatch = { id, data, source, kind, createdAt };
        await transaction(["matches", "reviews"], "readwrite", tx => {
            tx.objectStore("matches").put(stored);
            tx.objectStore("reviews").put({ id, checkpoint, annotations, updatedAt });
        });
    },
    async saveReview(review) { await transaction(["reviews"], "readwrite", tx => { tx.objectStore("reviews").put(review); }); },
    async remove(id) { await transaction(["matches", "reviews"], "readwrite", tx => { tx.objectStore("matches").delete(id); tx.objectStore("reviews").delete(id); }); },
};

// The fan profile is a few hundred bytes of per-browser preferences, so it lives in localStorage beside the library.
const PROFILE_KEY = "pitchpulse-fan-profile";
/** The stored profile as parsed JSON, or null when absent, unreadable or blocked. Validate before use. */
export function loadFanProfile(): unknown {
    try {
        const raw = localStorage.getItem(PROFILE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}
export function saveFanProfile(profile: FanProfile): boolean {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); return true; } catch { return false; }
}
