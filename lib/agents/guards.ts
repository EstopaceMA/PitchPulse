import { AGENT_TOPICS, type AgentTopic, type Insight } from "@/lib/match/types";
import type { AgentAnswer, AgentCommentaryLine, AgentRecap, AgentRecapNote, Bilingual } from "./contracts";
import type { MatchPacket } from "./packet";

export const SHOWN_EVIDENCE = 40;
const CARD_LIMIT = 4;
const CARD_METRIC_LIMIT = 6;
const TURNING_POINT_LIMIT = 4;
const LIMITS = { headline: 120, observed: 600, casual: 400, interpretation: 500, story: 1400, caption: 240, note: 600, watch: 500, answer: 1500, caveat: 300, line: 240 } as const;

/** A whole response failed verification. Individual cards, notes and lines are dropped instead. */
export class UnverifiableOutput extends Error { }

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const TIME = /\b\d{1,3}:\d{2}\b/g;
const NUMBER = /\d+(?:[.,]\d+)?/g;
// Dataset references such as EVT-00450 or ARS10 are identifiers, not quantities.
const ID_TOKEN = /\b[A-Za-z]+[-_]?\d+[A-Za-z0-9_-]*\b/g;
// ID and name fields never contribute allowed numbers.
const SKIPPED = new Set(["event_id", "event_ids", "team_id", "player_id", "from_team_id", "favourite_team_id", "focus_player_id", "name", "player", "recipient", "target"]);
const canonicalNumber = (token: string): string => String(Number(token.replace(",", ".")));
const canonicalTime = (token: string): string => { const [minutes, seconds] = token.split(":"); return `${Number(minutes)}:${seconds}`; };

/**
 * Numbers and mm:ss times the model has seen (a time also allows its minute: "23rd minute" for 23:41), plus
 * code-like dataset IDs that must never appear in prose.
 */
export interface Grounding { numbers: Set<string>; times: Set<string>; names: readonly string[]; references: ReadonlySet<string> }
const codeLike = (id: string): boolean => (/\d/.test(id) && /[A-Za-z]/.test(id)) || /^[A-Z]{2,}$/.test(id);
export function createGrounding(names: readonly string[], references: Iterable<string> = []): Grounding {
    return { numbers: new Set(), times: new Set(), names: [...new Set(names)].filter(Boolean).sort((left, right) => right.length - left.length), references: new Set([...references].filter(codeLike)) };
}
function strip(text: string, names: readonly string[]): string {
    return names.reduce((rest, name) => rest.split(name).join(" "), text).replace(ID_TOKEN, " ");
}
export function addGrounding(grounding: Grounding, value: unknown, key?: string): void {
    if (key !== undefined && SKIPPED.has(key)) return;
    if (typeof value === "number") {
        if (Number.isFinite(value)) grounding.numbers.add(canonicalNumber(String(value)));
    } else if (typeof value === "string") {
        const rest = strip(value, grounding.names);
        for (const time of rest.match(TIME) ?? []) {
            grounding.times.add(canonicalTime(time));
            grounding.numbers.add(canonicalNumber(time.slice(0, time.indexOf(":"))));
        }
        for (const token of rest.replace(TIME, " ").match(NUMBER) ?? []) grounding.numbers.add(canonicalNumber(token));
    } else if (Array.isArray(value)) {
        for (const item of value) addGrounding(grounding, item);
    } else if (object(value)) {
        for (const [entry, item] of Object.entries(value)) addGrounding(grounding, item, entry);
    }
}
/** The first number or time that the model was never shown, or null when the text is grounded. */
export function ungrounded(text: string, grounding: Grounding): string | null {
    const rest = strip(text, grounding.names);
    for (const time of rest.match(TIME) ?? []) if (!grounding.times.has(canonicalTime(time))) return time;
    for (const token of rest.replace(TIME, " ").match(NUMBER) ?? []) if (!grounding.numbers.has(canonicalNumber(token))) return token;
    return null;
}

// Claims this event data cannot support, in English and Filipino. Plain mentions of possession changes stay allowed.
const BANNED = [
    /\bpossession\s*(?:share|percentage|rate|%)/i,
    /\d+(?:[.,]\d+)?\s*%\s+(?:of\s+(?:the\s+)?)?(?:ball\s+)?possession\b/i,
    /\bpossession\s+(?:of\s+|at\s+|was\s+|is\s+|stood\s+at\s+|share\s+of\s+)?\d+(?:[.,]\d+)?\s*%/i,
    /porsiyento\s+ng\s+(?:possession|pag-aari)/i,
    /\b(?:km|kms|kilomet(?:er|re)s?|kilometro)\b/i,
    /\b(?:distance|distansiya|layo)\s+(?:covered|run|natakbo|tinakbo)/i,
    /\bmet(?:er|re)s?\s+(?:run|covered|natakbo)/i,
    /\b(?:km\/h|kph|mph|top speed|sprint speed)\b|bilis ng takbo/i,
    /\bx\s?G\b|\bexpected goals?\b|inaasahang gol/i,
    /\b(?:probabilit(?:y|ies)|likelihood|odds|betting|bets?|wagers?)\b|probabilidad|pusta/i,
    /\d+(?:[.,]\d+)?\s*%\s*(?:chance|likely|probability|na\s+tsansa)|tsansa\s+na\s+\d/i,
    /\b(?:tracking data|heat ?maps?|gps)\b/i,
];
/** The first unsupported claim in the text, or null. */
export const bannedClaim = (text: string): string | null => BANNED.map(pattern => text.match(pattern)?.[0]).find(Boolean) ?? null;

// Metric keys, block codes and dataset IDs belong in ID fields and the evidence list, never in prose.
const METRIC_KEY = /\b[\w-]+\.(?:total|b\d+|zone)\.[\w.]*\w/;
const BLOCK_CODE = /\bb\d{1,2}\b/;
const TOKEN = /[A-Za-z0-9][A-Za-z0-9_-]*/g;
/** The first metric key, block code or dataset ID in the text, or null. */
export const internalReference = (text: string, grounding: Grounding): string | null =>
    text.match(METRIC_KEY)?.[0] ?? text.match(BLOCK_CODE)?.[0] ?? (text.match(TOKEN) ?? []).find(token => grounding.references.has(token)) ?? null;

/** One generated item failed a check; the message names the field and why. */
class Rejected extends Error { }
const reject = (reason: string): never => { throw new Rejected(reason); };
const quote = (text: string) => `"${text.length > 80 ? `${text.slice(0, 77)}…` : text}"`;
/** Runs one item's checks, recording a rejection instead of throwing it. */
function attempt<T>(reasons: string[], label: string, check: () => T): T | undefined {
    try { return check(); } catch (error) {
        if (!(error instanceof Rejected)) throw error;
        reasons.push(`${label}: ${error.message}`);
        return undefined;
    }
}
/** Items kept after verification; `reasons` explains every removed item. */
export interface Verified<T> { result: T; dropped: number; reasons: string[] }

// A parenthesis or leading label that only names dataset IDs is a citation, not prose; the evidence list
// already links those events. Anything mixed with words is left for the checks below to reject.
const CITATION = /\s*\(([^()]*)\)/g;
const LEADING_ID = /^\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*[—–:]\s*/;
function stripCitations(text: string, grounding: Grounding): string {
    const cited = (tokens: string[]) => tokens.length > 0 && tokens.every(token => grounding.references.has(token));
    const inline = text.replace(CITATION, (match, inner: string) => cited(inner.split(/[\s,;&]+/).filter(token => token && !/^(?:and|at)$/i.test(token))) ? "" : match);
    const leading = inline.match(LEADING_ID);
    return leading && cited([leading[1]]) ? inline.slice(leading[0].length) : inline;
}

function text(value: unknown, limit: number, grounding: Grounding, field: string): string {
    const trimmed = typeof value === "string" ? stripCitations(value, grounding).trim() : "";
    if (!trimmed) return reject(`${field} is missing`);
    if (trimmed.length > limit) return reject(`${field} is longer than ${limit} characters`);
    const claim = bannedClaim(trimmed);
    if (claim !== null) return reject(`${field} makes a claim this data cannot support: ${quote(claim)}`);
    const reference = internalReference(trimmed, grounding);
    if (reference !== null) return reject(`${field} contains the internal reference ${reference}; use plain words instead`);
    const unseen = ungrounded(trimmed, grounding);
    return unseen === null ? trimmed : reject(`${field} uses ${unseen}, which does not appear in the data`);
}
function bilingual(value: unknown, limit: number, grounding: Grounding, field: string): Bilingual {
    if (!object(value)) return reject(`${field} is missing`);
    return { en: text(value.en, limit, grounding, `${field}.en`), fil: text(value.fil, limit, grounding, `${field}.fil`) };
}
/** Known catalog keys only; at least one must survive. */
function metricKeys(value: unknown, packet: MatchPacket): string[] {
    const keys = Array.isArray(value) ? [...new Set(value.filter((key): key is string => typeof key === "string" && packet.catalog.has(key)))].slice(0, CARD_METRIC_LIMIT) : [];
    return keys.length ? keys : reject("metric_keys names no known metric");
}
/** Cited IDs must all be reached events; one unknown or future ID rejects the item. */
function citedIds(value: unknown, packet: MatchPacket): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) return reject("evidence_event_ids must be a list");
    const unknown = value.find(id => typeof id !== "string" || !packet.order.has(id));
    return unknown === undefined ? [...new Set(value as string[])] : reject(`evidence_event_ids cites ${String(unknown)}, which is not a reached event`);
}
const byOrder = (packet: MatchPacket) => (left: string, right: string) => packet.order.get(left)! - packet.order.get(right)!;
/** Metric evidence plus cited events, in replay order. The most recent are listed; the total is never truncated. */
function evidence(packet: MatchPacket, keys: readonly string[], cited: readonly string[]): { eventIds: string[]; total: number } {
    const all = new Set(cited);
    for (const key of keys) for (const id of packet.catalog.get(key)!.evidence) all.add(id);
    const ordered = [...all].sort(byOrder(packet));
    return { eventIds: ordered.slice(-SHOWN_EVIDENCE), total: ordered.length };
}
const metricsOf = (packet: MatchPacket, keys: readonly string[]): Insight["metrics"] => keys.map(key => { const metric = packet.catalog.get(key)!; return { label: metric.label, value: metric.value }; });

function toInsight(card: unknown, packet: MatchPacket, grounding: Grounding, matchId: string, index: number): Insight {
    if (!object(card)) return reject("the card is not an object");
    if (typeof card.topic !== "string" || !(AGENT_TOPICS as readonly string[]).includes(card.topic)) return reject(`topic ${String(card.topic)} is not allowed`);
    const teamId = typeof card.team_id === "string" && packet.teams.has(card.team_id) ? card.team_id : reject(`team_id ${String(card.team_id)} is unknown`);
    const playerId = card.player_id ?? null;
    if (playerId !== null && (typeof playerId !== "string" || packet.playerTeams.get(playerId) !== teamId)) return reject(`player_id ${String(playerId)} is not a ${teamId} player`);
    const keys = metricKeys(card.metric_keys, packet), cited = citedIds(card.evidence_event_ids, packet);
    const headline = bilingual(card.headline, LIMITS.headline, grounding, "headline"), observed = bilingual(card.observed, LIMITS.observed, grounding, "observed");
    const casual = bilingual(card.casual, LIMITS.casual, grounding, "casual"), interpretation = bilingual(card.interpretation, LIMITS.interpretation, grounding, "interpretation");
    const { eventIds, total } = evidence(packet, keys, cited);
    if (eventIds.length === 0) return reject("its metrics have no supporting events");
    return {
        id: JSON.stringify([matchId, "agent", card.topic, teamId, playerId, packet.cursor, index]),
        rule: "agent", source: "foundry", topic: card.topic as AgentTopic,
        teamId, ...(playerId === null ? {} : { playerId }),
        at: packet.elapsed, from: Math.min(...keys.map(key => packet.catalog.get(key)!.from)),
        headline, explanation: observed, casual, interpretation,
        metrics: metricsOf(packet, keys),
        eventIds, ...(total > eventIds.length ? { evidenceTotal: total } : {}),
    };
}

export function toAgentInsights(raw: unknown, packet: MatchPacket, grounding: Grounding, matchId: string): Verified<Insight[]> {
    if (!object(raw) || !Array.isArray(raw.cards)) throw new UnverifiableOutput("The output must contain a cards array.");
    const result: Insight[] = [], reasons: string[] = [];
    for (const [index, card] of raw.cards.entries()) {
        if (index >= CARD_LIMIT) { reasons.push(`card ${index + 1}: more than ${CARD_LIMIT} cards`); continue; }
        const insight = attempt(reasons, `card ${index + 1}`, () => toInsight(card, packet, grounding, matchId, result.length));
        if (insight) result.push(insight);
    }
    return { result, dropped: reasons.length, reasons };
}

export function toAgentRecap(raw: unknown, packet: MatchPacket, grounding: Grounding, kind: AgentRecap["kind"]): Verified<AgentRecap> {
    if (!object(raw)) throw new UnverifiableOutput("The output must be an object.");
    const reasons: string[] = [];
    const story = attempt(reasons, "story", () => bilingual(raw.story, LIMITS.story, grounding, "story"));
    if (!story) throw new UnverifiableOutput(reasons[0]);
    const points = Array.isArray(raw.turning_points) ? raw.turning_points : [];
    const turningPoints: AgentRecap["turningPoints"] = [];
    for (const [index, point] of points.entries()) {
        if (index >= TURNING_POINT_LIMIT) { reasons.push(`turning point ${index + 1}: more than ${TURNING_POINT_LIMIT} turning points`); continue; }
        const entry = attempt(reasons, `turning point ${index + 1}`, () => {
            if (!object(point)) return reject("it is not an object");
            const eventId = typeof point.event_id === "string" && packet.order.has(point.event_id) ? point.event_id : reject(`event_id ${String(point.event_id)} is not a reached event`);
            if (turningPoints.some(existing => existing.eventId === eventId)) return reject(`${eventId} is listed twice`);
            return { eventId, caption: bilingual(point.caption, LIMITS.caption, grounding, "caption") };
        });
        if (entry) turningPoints.push(entry);
    }
    turningPoints.sort((left, right) => byOrder(packet)(left.eventId, right.eventId));
    const notes = Array.isArray(raw.team_notes) ? raw.team_notes : [];
    const teamNotes: AgentRecapNote[] = [];
    for (const [index, note] of notes.entries()) {
        const entry = attempt(reasons, `team note ${index + 1}`, (): AgentRecapNote => {
            if (!object(note)) return reject("it is not an object");
            const teamId = typeof note.team_id === "string" && packet.teams.has(note.team_id) ? note.team_id : reject(`team_id ${String(note.team_id)} is unknown`);
            if (teamNotes.some(existing => existing.teamId === teamId)) return reject(`${teamId} has two notes`);
            const keys = metricKeys(note.metric_keys, packet);
            const observed = bilingual(note.observed, LIMITS.note, grounding, "observed"), interpretation = bilingual(note.interpretation, LIMITS.interpretation, grounding, "interpretation");
            const { eventIds, total } = evidence(packet, keys, []);
            if (eventIds.length === 0) return reject("its metrics have no supporting events");
            return { teamId, observed, interpretation, metrics: metricsOf(packet, keys), eventIds, evidenceTotal: total };
        });
        if (entry) teamNotes.push(entry);
    }
    // Questions for the second half belong to half-time only; they are never predictions.
    const watchNext = kind === "half-time" && raw.watch_next !== null && raw.watch_next !== undefined
        ? attempt(reasons, "watch_next", () => bilingual(raw.watch_next, LIMITS.watch, grounding, "watch_next")) ?? null : null;
    return { result: { kind, story, turningPoints, teamNotes, watchNext }, dropped: reasons.length, reasons };
}

export function toAgentAnswer(raw: unknown, packet: MatchPacket, grounding: Grounding): Verified<AgentAnswer> {
    if (!object(raw)) throw new UnverifiableOutput("The output must be an object.");
    const reasons: string[] = [];
    const answer = attempt(reasons, "answer", () => bilingual(raw.answer, LIMITS.answer, grounding, "answer"));
    const cited = answer && attempt(reasons, "answer", () => citedIds(raw.evidence_event_ids, packet));
    if (!answer || !cited) throw new UnverifiableOutput(reasons[0]);
    // An unverifiable caveat is removed; the answer stands on its own.
    const caveat = raw.caveat === null || raw.caveat === undefined ? null : attempt(reasons, "caveat", () => bilingual(raw.caveat, LIMITS.caveat, grounding, "caveat")) ?? null;
    return { result: { answer, eventIds: cited.sort(byOrder(packet)).slice(-SHOWN_EVIDENCE), caveat, outOfScope: raw.out_of_scope === true }, dropped: reasons.length, reasons };
}

export function toCommentaryLines(raw: unknown, grounding: Grounding, requested: readonly string[]): Verified<AgentCommentaryLine[]> {
    if (!object(raw) || !Array.isArray(raw.lines)) throw new UnverifiableOutput("The output must contain a lines array.");
    const wanted = new Set(requested), lines = new Map<string, Bilingual>(), reasons: string[] = [];
    for (const [index, line] of raw.lines.entries()) {
        const entry = attempt(reasons, `line ${index + 1}`, () => {
            if (!object(line)) return reject("it is not an object");
            const eventId = typeof line.event_id === "string" && wanted.has(line.event_id) ? line.event_id : reject(`event_id ${String(line.event_id)} was not requested`);
            if (lines.has(eventId)) return reject(`${eventId} is narrated twice`);
            return { eventId, text: bilingual(line.text, LIMITS.line, grounding, "text") };
        });
        if (entry) lines.set(entry.eventId, entry.text);
    }
    return { result: requested.filter(id => lines.has(id)).map(id => ({ eventId: id, text: lines.get(id)! })), dropped: reasons.length, reasons };
}
