import { isDeepStrictEqual } from "node:util";
import type { MatchEvent, Player } from "@/lib/match/types";

/** The bundled demo file as written, including the summaries that validation strips. */
export type Bundle = Record<string, unknown> & { disclaimer?: string; players: Player[]; documentation?: Record<string, unknown>; events: (MatchEvent & Record<string, unknown>)[] };

// The file was written Python-style: two-space indent, ASCII-only strings and float tokens such as 95.0.
const ascii = (json: string) => json.replace(/[\u0080-￿]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
const block = (value: unknown, depth: number) => ascii(JSON.stringify(value, null, 2)).replaceAll("\n", `\n${" ".repeat(depth * 2)}`);
// Top-level members of the file are indented two spaces; their last line is "  ]" or "  }".
function replaceMember(raw: string, key: string, value: unknown): string {
    const start = raw.indexOf(`\n  "${key}": `);
    if (start < 0) throw new Error(`The bundle has no top-level "${key}".`);
    const valueStart = start + `\n  "${key}": `.length;
    const close = typeof value === "string" ? raw.indexOf("\n", valueStart) - (raw[raw.indexOf("\n", valueStart) - 1] === "," ? 1 : 0)
        : raw.indexOf(Array.isArray(value) ? "\n  ]" : "\n  }", valueStart) + 4;
    return raw.slice(0, valueStart) + block(value, 1) + raw.slice(close);
}

/**
 * Writes `after` by editing the original text, so the diff shows only real changes. Only the disclaimer, players,
 * documentation and string fields of events may change; anything else throws.
 */
export function rewriteBundle(raw: string, before: Bundle, after: Bundle): string {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) if (!["disclaimer", "players", "documentation", "events"].includes(key) && !isDeepStrictEqual(before[key], after[key])) throw new Error(`Refusing to rewrite top-level "${key}".`);
    if (before.events.length !== after.events.length) throw new Error("Events were added or removed.");
    let text = raw;
    if (after.disclaimer !== before.disclaimer) text = replaceMember(text, "disclaimer", after.disclaimer);
    if (!isDeepStrictEqual(after.players, before.players)) text = replaceMember(text, "players", after.players);
    if (!isDeepStrictEqual(after.documentation, before.documentation)) text = replaceMember(text, "documentation", after.documentation);
    for (const [index, event] of after.events.entries()) {
        const old = before.events[index];
        if (isDeepStrictEqual(event, old)) continue;
        if (event.event_id !== old.event_id) throw new Error(`Event ${index} changed identity.`);
        // Events sit at four spaces; nested positions close at six, so "\n    }" ends this event.
        const at = text.indexOf(`"event_id": "${event.event_id}",`), start = text.lastIndexOf("\n    {", at), end = text.indexOf("\n    }", at);
        let body = text.slice(start, end);
        for (const key of new Set([...Object.keys(old), ...Object.keys(event)])) {
            if (isDeepStrictEqual(old[key], event[key])) continue;
            if (typeof old[key] !== "string" || typeof event[key] !== "string") throw new Error(`${event.event_id}: only existing text fields may change (${key}).`);
            const field = new RegExp(`"${key}": "[^"]*"`);
            if (!field.test(body)) throw new Error(`${event.event_id}: "${key}" not found in the file.`);
            body = body.replace(field, `"${key}": ${ascii(JSON.stringify(event[key]))}`);
        }
        text = text.slice(0, start) + body + text.slice(end);
    }
    if (!isDeepStrictEqual(JSON.parse(text), after)) throw new Error("The rewritten file does not parse back to the intended data.");
    return text;
}
