import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { formatTime } from "@/lib/match/playback";
import { eventLabel, outcomeLabel } from "@/lib/match/presentation";
import { aggregate, createStatistics } from "@/lib/match/statistics";
import type { Language, MatchData, MatchEvent, Preferences, Statistics } from "@/lib/match/types";
import { validateMatch } from "@/lib/match/validation";
import { CommentaryPanel } from "./commentary-panel";
import { StatisticsPanel } from "./statistics-panel";

const data = validateMatch(JSON.parse(readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8")));
const preferences: Preferences = { mode: "casual", language: "en", team: data.match.home_team_id, player: data.players[0].player_id };
const homePlayer = data.players.find(player => player.team_id === data.match.home_team_id)!;
const awayPlayer = data.players.find(player => player.team_id === data.match.away_team_id)!;
const noop = () => {};

function makeEvent(sequence: number, fields: Partial<MatchEvent> = {}): MatchEvent {
    return { event_id: `SUMMARY-${sequence}`, sequence, match_time_seconds: sequence * 10, period: 1, type: "pass", team_id: data.match.home_team_id, player_id: homePlayer.player_id, possession_id: sequence, ...fields };
}

const away = { team_id: data.match.away_team_id, player_id: awayPlayer.player_id };
const sample = validateMatch({ ...data, events: [
    makeEvent(1, { outcome: "complete" }),
    makeEvent(2, { outcome: "complete" }),
    makeEvent(3, { outcome: "incomplete" }),
    makeEvent(4, { ...away, outcome: "complete" }),
    makeEvent(5, { ...away, outcome: "intercepted" }),
    makeEvent(6, { type: "shot", outcome: "goal" }),
    makeEvent(7, { type: "shot", outcome: "saved" }),
    makeEvent(8, { type: "shot", outcome: "blocked" }),
    makeEvent(9, { ...away, type: "shot", outcome: "on_target" }),
    makeEvent(10, { ...away, type: "shot", outcome: "off_target" }),
    makeEvent(11, { ...away, type: "shot", outcome: "goal" }),
    makeEvent(12, { ...away, outcome: "complete" }),
] });

function statistics(stats: Statistics = createStatistics(data), language: Language = "en", match = data): string {
    return renderToStaticMarkup(<StatisticsPanel data={match} stats={stats} preferences={{ ...preferences, language }} />);
}

function commentary(events: readonly MatchEvent[], language: Language = "en", match = data): string {
    return renderToStaticMarkup(<CommentaryPanel data={match} events={events} preferences={{ ...preferences, language }} onEvidence={noop} />);
}

function values(html: string, label: string): string[] {
    const row = html.match(new RegExp(`<div class="stat-numbers"><strong>([^<]*)</strong><span>${label}</span><strong>([^<]*)</strong></div>`));
    assert.ok(row, `Missing statistics row: ${label}`);
    return [row[1], row[2]];
}

function eventIds(html: string): string[] {
    return [...html.matchAll(/data-event-id="([^"]+)"/g)].map(match => match[1]);
}

function listIds(html: string, className: string): string[] {
    const list = html.match(new RegExp(`<ol class="${className}"[^>]*>([\\s\\S]*?)</ol>`));
    return list ? eventIds(list[1]) : [];
}

function metadataOnly(match: MatchData): MatchData {
    return { ...match, get events(): MatchEvent[] { throw new Error("Summary panels must not read data.events"); } };
}

test("match statistics retain shots, on-target shots and pass accuracy without duplicate KPI cards", () => {
    const html = statistics();
    assert.match(html, /<h2>Match statistics<\/h2>/);
    assert.doesNotMatch(html, /kpi-row|kpi-card/);
    assert.deepEqual(values(html, "Shots"), ["0", "0"]);
    assert.deepEqual(values(html, "Shots on target"), ["0", "0"]);
    assert.deepEqual(values(html, "Pass accuracy"), ["0.0%", "0.0%"]);
    assert.doesNotMatch(html, /NaN|Infinity|undefined/);
});

test("statistics values use the supplied prefix, including goals and saved shots, and one decimal accuracy", () => {
    const stats = aggregate(sample, sample.events.slice(0, 10));
    const html = statistics(stats, "en", sample);
    assert.deepEqual(values(html, "Shots"), ["3", "2"]);
    assert.deepEqual(values(html, "Shots on target"), ["2", "1"]);
    assert.deepEqual(values(html, "Pass accuracy"), ["66.7%", "50.0%"]);
    assert.notDeepEqual(values(statistics(aggregate(sample, sample.events), "en", sample), "Shots"), values(html, "Shots"));
});

test("statistics comparison follows home/away IDs rather than team array order", () => {
    const stats = aggregate(sample, sample.events.slice(0, 10));
    const html = statistics(stats, "en", { ...sample, teams: [...sample.teams].reverse() });
    assert.deepEqual(values(html, "Shots"), ["3", "2"]);
    assert.equal(html, statistics(stats, "en", sample));
});

test("statistics never invent possession even for a complete match", () => {
    const html = statistics(aggregate(data, data.events));
    assert.match(html, /No possession or distance estimates\./);
    assert.doesNotMatch(html, /<span>Possession<\/span>|data-metric="possession"/);
});

test("statistics headings and data limitations remain bilingual", () => {
    const html = statistics(createStatistics(data), "fil");
    for (const label of ["Estadistika ng laban", "Mga tira", "Mga tirang sa target", "Katumpakan ng pasa", "Walang tantiya ng possession o distansiya."]) assert.ok(html.includes(label));
    assert.deepEqual(values(html, "Katumpakan ng pasa"), ["0.0%", "0.0%"]);
});

test("neither panel accesses the match timeline or mutates supplied prefix data", () => {
    const events = Object.freeze(sample.events.slice(0, 10).map(event => Object.freeze({ ...event })));
    const stats = aggregate(sample, events);
    const snapshot = structuredClone(stats);
    const match = metadataOnly(sample);
    assert.deepEqual(values(statistics(stats, "en", match), "Shots"), ["3", "2"]);
    const html = commentary(events, "en", match);
    assert.equal(commentary(events, "en", match), html);
    assert.deepEqual(stats, snapshot);
    assert.deepEqual(events.map(event => event.event_id), sample.events.slice(0, 10).map(event => event.event_id));
});

test("empty commentary reveals no future events and has bilingual empty states without live announcements", () => {
    for (const language of ["en", "fil"] as const) {
        const html = commentary([], language);
        const labels = language === "en"
            ? ["Live commentary", "Simulated · event-based", "Key moments", "No meaningful events reached yet", "No goals or shots on target reached yet"]
            : ["Live na komentaryo", "Simulado · batay sa pangyayari", "Mahahalagang sandali", "Wala pang naabot na mahalagang pangyayari", "Wala pang naabot na gol o tirang sa target"];
        for (const label of labels) assert.ok(html.includes(label));
        assert.match(html, /<section class="panel commentary-panel" aria-labelledby=/);
        assert.match(html, /<section class="key-moments" aria-labelledby=/);
        assert.deepEqual(eventIds(html), []);
        assert.doesNotMatch(html, /<button|Goal!|Gol!|aria-live|role="(?:alert|status)"/);
    }
});

test("partial fixture commentary renders only processed IDs, never a future goal, including after rewind", () => {
    const firstGoal = data.events.findIndex(event => event.type === "shot" && event.outcome === "goal");
    assert.ok(firstGoal > 0);
    const prefix = data.events.slice(0, firstGoal);
    const html = commentary(prefix);
    const processed = new Set(prefix.map(event => event.event_id));
    assert.ok(eventIds(html).length > 0);
    for (const id of eventIds(html)) assert.ok(processed.has(id), `Future event leaked: ${id}`);
    for (const event of data.events.slice(firstGoal)) assert.ok(!html.includes(event.event_id));
    assert.doesNotMatch(html, /Goal!|Gol!/);
    const goal = data.events[firstGoal];
    const advanced = commentary(data.events.slice(0, firstGoal + 1));
    assert.ok(listIds(advanced, "key-moments-list").includes(goal.event_id));
    assert.match(advanced, /Goal!/);
    assert.equal(commentary(prefix), html);
});

test("commentary includes recorded time, icon, player, team, bilingual action/outcome and evidence button", () => {
    const events = sample.events.slice(0, 7);
    const event = events[6];
    for (const language of ["en", "fil"] as const) {
        const html = commentary(events, language, sample);
        for (const text of [formatTime(event.match_time_seconds), homePlayer.name, data.teams.find(team => team.team_id === event.team_id)!.name, eventLabel(event, language), outcomeLabel(event, language)]) assert.ok(html.includes(text));
        assert.match(html, /class="commentary-icon"><svg[^>]*aria-hidden="true"/);
        const evidence = language === "en" ? "Evidence for Shot at 01:10: SUMMARY-7" : "Ebidensiya para sa Tira sa 01:10: SUMMARY-7";
        assert.ok(html.includes(`aria-label="${evidence}"`));
        assert.match(html, /<button[^>]*type="button"[^>]*class="[^"]*commentary-evidence/);
        assert.match(html, /class="commentary-evidence-id">SUMMARY-7<\/span>/);
    }
});

test("recent commentary is bounded to five and key moments to three, latest first", () => {
    const html = commentary(sample.events, "en", sample);
    assert.deepEqual(listIds(html, "commentary-list"), ["SUMMARY-11", "SUMMARY-10", "SUMMARY-9", "SUMMARY-8", "SUMMARY-7"]);
    assert.deepEqual(listIds(html, "key-moments-list"), ["SUMMARY-11", "SUMMARY-9", "SUMMARY-7"]);
    assert.equal((html.match(/<button\b/g) ?? []).length, 8);
    assert.ok(!eventIds(html).includes("SUMMARY-6"));
});

test("key moments include saved shots, exclude blocked/off-target shots and survive later commentary", () => {
    const prefix = sample.events.slice(0, 10);
    assert.deepEqual(listIds(commentary(prefix, "en", sample), "key-moments-list"), ["SUMMARY-9", "SUMMARY-7", "SUMMARY-6"]);
    const later = validateMatch({ ...sample, events: [...prefix, ...Array.from({ length: 6 }, (_, index) => makeEvent(index + 11, { type: "tackle", outcome: "won" }))] });
    const html = commentary(later.events, "en", later);
    assert.deepEqual(listIds(html, "commentary-list"), ["SUMMARY-16", "SUMMARY-15", "SUMMARY-14", "SUMMARY-13", "SUMMARY-12"]);
    assert.deepEqual(listIds(html, "key-moments-list"), ["SUMMARY-9", "SUMMARY-7", "SUMMARY-6"]);
});

test("routine actions do not crowd out meaningful commentary or invent key moments", () => {
    const match = validateMatch({ ...data, events: [
        makeEvent(1, { outcome: "complete" }),
        makeEvent(2),
        makeEvent(3, { type: "pressure", intensity: "medium" }),
        makeEvent(4, { type: "pressure", intensity: "low" }),
        makeEvent(5, { type: "possession_change", reason: "shot_end" }),
        makeEvent(6, { type: "pressure", intensity: "high" }),
        makeEvent(7, { type: "possession_change", reason: "interception" }),
        makeEvent(8, { outcome: "intercepted" }),
    ] });
    assert.deepEqual(eventIds(commentary(match.events.slice(0, 5), "en", match)), []);
    const html = commentary(match.events, "en", match);
    assert.deepEqual(listIds(html, "commentary-list"), ["SUMMARY-8", "SUMMARY-7", "SUMMARY-6"]);
    assert.deepEqual(listIds(html, "key-moments-list"), []);
});

test("missing optional fields and neutral events remain factual in both languages", () => {
    const match = validateMatch({ ...data, players: [], events: [
        makeEvent(1, { type: "match_start", player_id: null, team_id: null, possession_id: null }),
        makeEvent(2, { type: "shot", player_id: null }),
    ] });
    for (const language of ["en", "fil"] as const) {
        const html = commentary(match.events, language, match);
        assert.ok(html.includes(language === "en" ? "Match event" : "Pangyayari sa laban"));
        assert.ok(html.includes(language === "en" ? "Neutral" : "Walang koponan"));
        assert.match(html, /class="commentary-outcome">—<\/span>/);
        assert.deepEqual(listIds(html, "commentary-list"), ["SUMMARY-2", "SUMMARY-1"]);
        assert.deepEqual(listIds(html, "key-moments-list"), []);
        assert.doesNotMatch(html, /Goal!|Gol!|undefined|NaN/);
    }
});

test("equal-time half boundaries honor the event cursor, not timestamps or future periods", () => {
    const match = validateMatch({ ...data, events: [
        makeEvent(1, { type: "half_time", match_time_seconds: data.match.period_seconds, team_id: null, player_id: null }),
        makeEvent(2, { type: "second_half_start", period: 2, match_time_seconds: data.match.period_seconds, team_id: null, player_id: null }),
    ] });
    const paused = commentary(match.events.slice(0, 1), "en", match);
    assert.deepEqual(listIds(paused, "commentary-list"), ["SUMMARY-1"]);
    assert.doesNotMatch(paused, /Second half/);
    assert.deepEqual(listIds(commentary(match.events, "en", match), "commentary-list"), ["SUMMARY-2", "SUMMARY-1"]);
});