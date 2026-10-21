import { AGENT_TOPICS } from "@/lib/match/types";
import type { AgentName } from "./contracts";

/**
 * Strict Structured Outputs schemas for `text.format`. Strict mode requires every property and
 * forbids extras, so optional values are nullable instead. Counts and lengths are enforced by guards.ts.
 */
const bilingual = { type: "object", properties: { en: { type: "string" }, fil: { type: "string" } }, required: ["en", "fil"], additionalProperties: false };
const nullableBilingual = { anyOf: [bilingual, { type: "null" }] };
const strings = { type: "array", items: { type: "string" } };
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const ANALYST = object({
    cards: {
        type: "array",
        items: object({
            topic: { type: "string", enum: [...AGENT_TOPICS] },
            team_id: { type: "string" },
            player_id: { type: ["string", "null"] },
            headline: bilingual,
            observed: bilingual,
            casual: bilingual,
            interpretation: bilingual,
            metric_keys: strings,
            evidence_event_ids: strings,
        }),
    },
});

const RECAP = object({
    story: bilingual,
    turning_points: { type: "array", items: object({ event_id: { type: "string" }, caption: bilingual }) },
    team_notes: { type: "array", items: object({ team_id: { type: "string" }, observed: bilingual, interpretation: bilingual, metric_keys: strings }) },
    watch_next: nullableBilingual,
});

const ASK = object({
    answer: bilingual,
    evidence_event_ids: strings,
    caveat: nullableBilingual,
    out_of_scope: { type: "boolean" },
});

const COMMENTATOR = object({
    lines: { type: "array", items: object({ event_id: { type: "string" }, text: bilingual }) },
});

export const OUTPUT_SCHEMAS: Record<AgentName, { name: string; schema: Record<string, unknown> }> = {
    analyst: { name: "pitchpulse_analyst_cards", schema: ANALYST },
    recap: { name: "pitchpulse_recap", schema: RECAP },
    ask: { name: "pitchpulse_answer", schema: ASK },
    commentator: { name: "pitchpulse_commentary", schema: COMMENTATOR },
};
