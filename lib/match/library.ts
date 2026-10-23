import { initialPlayback, restorePlayback, validCheckpoint } from "./playback";
import { validateMatch } from "./validation";
import type { LibraryMatch, MatchAnnotation, MatchData } from "./types";

export const DEMO_ID = "demo-arsenal-chelsea";
export function createLibraryMatch(id: string, data: MatchData, source: string, kind: LibraryMatch["kind"], now: number): LibraryMatch {
    return { id, data, source, kind, createdAt: now, updatedAt: now, checkpoint: initialPlayback(), annotations: [] };
}
export function validateAnnotations(data: MatchData, value: unknown): MatchAnnotation[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((a): a is MatchAnnotation => {
        if (!a || typeof a !== "object" || typeof a.id !== "string" || !a.id || seen.has(a.id) || !["note", "bookmark"].includes(a.kind) || typeof a.text !== "string" || a.text.length > 4000 || !Number.isFinite(a.createdAt) || !validCheckpoint(data, a.anchor)) return false;
        if (a.eventId !== undefined && (typeof a.eventId !== "string" || !data.events.slice(0, a.anchor.cursor).some(e => e.event_id === a.eventId))) return false;
        seen.add(a.id);
        return true;
    });
}
/** The stored demo with newly bundled data, or null when nothing changed. Saved progress and notes stay while they still fit. */
export function refreshDemo(stored: LibraryMatch, fresh: MatchData): LibraryMatch | null {
    if (JSON.stringify(stored.data) === JSON.stringify(fresh)) return null;
    return { ...stored, data: fresh, checkpoint: restorePlayback(fresh, stored.checkpoint), annotations: validateAnnotations(fresh, stored.annotations) };
}
export function validateLibraryMatch(raw: unknown, review?: unknown): LibraryMatch {
    if (!raw || typeof raw !== "object") throw new Error("Invalid library record");
    const row = raw as LibraryMatch;
    if (typeof row.id !== "string" || !row.id || typeof row.source !== "string" || !["demo", "upload"].includes(row.kind) || !Number.isFinite(row.createdAt)) throw new Error("Invalid library metadata");
    const data = validateMatch(row.data);
    const saved = review && typeof review === "object" ? review as Partial<LibraryMatch> : row;
    return { ...createLibraryMatch(row.id, data, row.source, row.kind, row.createdAt), updatedAt: typeof saved.updatedAt === "number" && Number.isFinite(saved.updatedAt) ? saved.updatedAt : row.createdAt, checkpoint: restorePlayback(data, saved.checkpoint), annotations: validateAnnotations(data, saved.annotations) };
}

export interface TimelineGroup { bucket: number; events: readonly MatchData["events"][number][] }
/** Work is linear in the processed prefix; rendered markers are bounded by buckets. */
export function groupTimelineEvents(events: readonly MatchData["events"][number][], duration: number, buckets: number): TimelineGroup[] {
    const groups = new Map<number, MatchData["events"]>();
    for (const event of events) {
        const bucket = Math.min(buckets - 1, Math.floor(event.match_time_seconds / duration * buckets));
        const group = groups.get(bucket);
        if (group) group.push(event); else groups.set(bucket, [event]);
    }
    return Array.from(groups, ([bucket, events]) => ({ bucket, events }));
}
