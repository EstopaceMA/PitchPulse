import dataset from "@/public/arsenal-vs-chelsea-match.json";
import { activeCues, buildCues, CUE_SCHEMA_VERSION, OVERLAY_CUE_SCHEMA, preferencesFromQuery } from "@/lib/match/overlays";
import { countReached } from "@/lib/match/playback";
import { validateMatch } from "@/lib/match/validation";

/**
 * Overlay cues for the bundled demo at a match clock, for a rendering partner or graphics engine.
 * ?schema returns the cue JSON Schema. Only events reached by `at` (and `half`) are used, as in the studio.
 */
export function GET(request: Request) {
    const query = new URL(request.url).searchParams;
    if (query.has("schema")) return Response.json(OVERLAY_CUE_SCHEMA);
    const data = validateMatch(dataset);
    const at = Number(query.get("at") ?? data.match.duration_seconds);
    if (!Number.isFinite(at) || at < 0 || at > data.match.duration_seconds) return Response.json({ error: `at must be match seconds from 0 to ${data.match.duration_seconds}.` }, { status: 400 });
    const secondHalf = at > data.match.period_seconds || query.get("half") === "2";
    const preferences = preferencesFromQuery(data, name => query.get(name));
    const events = data.events.slice(0, countReached(data.events, at, secondHalf));
    const cues = buildCues(data, events, at, preferences);
    return Response.json({ schema_version: CUE_SCHEMA_VERSION, match_id: data.match.match_id, at, half: secondHalf ? 2 : 1, reached_events: events.length, cues, active: activeCues(cues, at).map(cue => cue.id) });
}
