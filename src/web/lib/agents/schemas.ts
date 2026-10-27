import { AGENT_TOPICS } from "@/lib/match/types";
import type { AgentName } from "./contracts";

/**
 * Strict Structured Outputs schemas for `text.format`. Strict mode requires every property and
 * forbids extras, so optional values are nullable instead. Counts and lengths are enforced by guards.ts.
 */
const localizedText = { type: "string" };
const nullableLocalizedText = { anyOf: [localizedText, { type: "null" }] };
const strings = { type: "array", items: { type: "string" } };
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const ANALYST = object({
    cards: {
        type: "array",
        items: object({
            topic: { type: "string", enum: [...AGENT_TOPICS] },
            team_id: { type: "string" },
            player_id: { type: ["string", "null"] },
            headline: localizedText,
            observed: localizedText,
            casual: localizedText,
            interpretation: localizedText,
            metric_keys: strings,
            evidence_event_ids: strings,
        }),
    },
});

const RECAP = object({
    story: localizedText,
    turning_points: { type: "array", items: object({ event_id: { type: "string" }, caption: localizedText }) },
    team_notes: { type: "array", items: object({ team_id: { type: "string" }, observed: localizedText, interpretation: localizedText, metric_keys: strings }) },
    watch_next: nullableLocalizedText,
});

const ASK = object({
    answer: localizedText,
    evidence_event_ids: strings,
    caveat: nullableLocalizedText,
    out_of_scope: { type: "boolean" },
});

const COMMENTATOR = object({
    lines: { type: "array", items: object({ event_id: { type: "string" }, text: localizedText }) },
});

export const OUTPUT_SCHEMAS: Record<AgentName, { name: string; schema: Record<string, unknown> }> = {
    analyst: { name: "pitchpulse_analyst_cards", schema: ANALYST },
    recap: { name: "pitchpulse_recap", schema: RECAP },
    ask: { name: "pitchpulse_answer", schema: ASK },
    commentator: { name: "pitchpulse_commentary", schema: COMMENTATOR },
};
