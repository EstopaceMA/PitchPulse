import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentRecap } from "@/lib/agents/contracts";
import { isMeaningful } from "@/lib/match/commentary";
import type { AgentTask, ChatEntry } from "@/lib/match/use-agents";
import type { Insight, MatchAnnotation, Preferences } from "@/lib/match/types";
import { validateMatch } from "@/lib/match/validation";
import { AgentAnalysisModal, AgentInsights } from "./agent-insights";
import { AgentRecapPanel } from "./agent-recap";
import { AskAnalyst } from "./ask-analyst";
import { CommentaryPanel } from "./commentary-panel";
import { InsightsPanel } from "./insights-panel";
import { StudioNotes } from "./studio-notes";

const data = validateMatch(JSON.parse(readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8")));
const preferences: Preferences = { mode: "analyst", language: "en", team: data.match.home_team_id, player: data.players[0].player_id };
const events = data.events.slice(0, 300);
const both = (en: string, fil = en) => ({ en, fil });
const noop = () => { };
const card: Insight = {
    id: "ai-1", rule: "agent", source: "foundry", topic: "turnovers", teamId: data.match.home_team_id, at: 1800, from: 0,
    headline: both("Ball losses cluster in midfield", "Nasa gitna ang mga nawalang bola"), explanation: both("Observed fact."), casual: both("Casual fact."), interpretation: both("May suggest pressure."),
    metrics: [{ label: both("Ball losses (Arsenal)"), value: "12" }], eventIds: events.slice(-40).map(event => event.event_id), evidenceTotal: 120,
};
const done = (cursor: number): AgentTask<Insight[]> => ({ status: "done", result: [card], cursor, elapsed: 1800 });
const panel = (overrides: Partial<Parameters<typeof AgentInsights>[0]> = {}) => renderToStaticMarkup(<AgentInsights preferences={preferences} available task={{ status: "idle", cursor: 0, elapsed: 0 }} cursor={events.length} canAnalyze onAnalyze={noop} onEvidence={noop} {...overrides} />);

test("AI analysis is available without a preference when the server is configured", () => {
    const unavailable = panel({ available: false });
    assert.match(unavailable, /AI · MICROSOFT FOUNDRY/);
    assert.match(unavailable, /isn’t configured on this server/);
    assert.ok(!unavailable.includes("Analyze this moment"));
    const available = panel();
    assert.match(available, /Analyze this moment/);
    assert.ok(!available.includes("Turn on AI analysis"));
    assert.match(panel({ canAnalyze: false }), /<button[^>]*disabled=""[^>]*>.*Analyze this moment/);
});

test("verified AI cards carry the AI label, catalog metrics and an honest evidence count", () => {
    const html = panel({ task: done(events.length) });
    assert.match(html, /class="insight-card [^"]*\bai\b/);
    assert.match(html, /AI ANALYSIS/);
    assert.match(html, /latest 40 of 120 supporting events/);
    assert.match(html, /As of 30:00 · 1 verified card/);
    assert.equal((html.match(/<div class="evidence-ids">.*?<\/div>/)?.[0].match(/<button/g) ?? []).length, 40);
});

test("AI results from a later playhead are hidden after a rewind", () => {
    const html = panel({ task: done(events.length + 1) });
    assert.match(html, /hidden until playback reaches that moment again/);
    assert.ok(!html.includes(card.headline.en));
});

test("the analysis dialog shows verified cards, a close action, and hides later results", () => {
    const render = (task: AgentTask<Insight[]>, cursor = events.length) => renderToStaticMarkup(<AgentAnalysisModal open preferences={preferences} task={task} cursor={cursor} onClose={noop} onEvidence={noop} />);
    const current = render(done(events.length));
    assert.match(current, /<dialog[^>]*class="analysis-dialog"[^>]*aria-labelledby=/);
    assert.match(current, /AI match analysis/);
    assert.match(current, /class="analysis-dialog-content"/);
    assert.match(current, /Close analysis/);
    assert.match(current, /Ball losses cluster in midfield/);
    assert.ok(!current.includes("Analyze this moment"));
    const rewound = render(done(events.length + 1));
    assert.match(rewound, /hidden until playback reaches that moment again/);
    assert.ok(!rewound.includes(card.headline.en));
    assert.match(render({ status: "error", error: "timeout", cursor: events.length, elapsed: 1800 }), /took too long/);
    assert.equal(renderToStaticMarkup(<AgentAnalysisModal open={false} preferences={preferences} task={done(events.length)} cursor={events.length} onClose={noop} onEvidence={noop} />), "");
});

test("AI analysis controls and status have Filipino labels", () => {
    const html = panel({ preferences: { ...preferences, language: "fil" }, task: done(events.length) });
    for (const label of ["Pagsusuri ng AI", "Suriin ang sandaling ito", "PAGSUSURI NG AI", "huling 40 sa 120 batayang aksiyon", card.headline.fil]) assert.ok(html.includes(label), label);
});

test("the rule-based footer stays accurate when AI is connected", () => {
    const render = (aiConnected: boolean) => renderToStaticMarkup(<InsightsPanel data={data} insights={[]} elapsed={0} preferences={preferences} onEvidence={noop} aiConnected={aiConnected} />);
    assert.match(render(false), /No AI service connected/);
    assert.match(render(true), /AI analysis is separate and labeled/);
    assert.match(render(true), /RULE-BASED/);
});

test("Ask the Analyst hides messages from a later playhead and links reached evidence", () => {
    const evidence = events.at(-1)!.event_id;
    const entries: ChatEntry[] = [
        { id: "1", role: "user", question: "Who is busiest?", cursor: 100, elapsed: 600 },
        { id: "2", role: "assistant", answer: { answer: both("Arsenal 10 leads."), eventIds: [evidence], caveat: both("Counts only."), outOfScope: false }, cursor: 100, elapsed: 600 },
        { id: "3", role: "user", question: "Later question", cursor: 900, elapsed: 4000 },
    ];
    const html = renderToStaticMarkup(<AskAnalyst entries={entries} cursor={200} elapsed={1200} language="en" asking={false} onAsk={noop} onEvidence={noop} />);
    assert.match(html, /Arsenal 10 leads\./);
    assert.ok(!html.includes("Later question"));
    assert.match(html, /1 later message is hidden until playback reaches 66:40 again/);
    assert.match(html, new RegExp(`<button type="button">${evidence}</button>`));
    assert.match(html, /<label for="[^"]+">Your question<\/label><textarea id="[^"]+"[^>]*maxLength="500"/);
});

test("commentary narration is optional and every AI line is tagged", () => {
    const plain = renderToStaticMarkup(<CommentaryPanel data={data} events={events} preferences={preferences} onEvidence={noop} />);
    assert.ok(!plain.includes("Narrate with AI"));
    assert.ok(!plain.includes("commentary-ai"));
    const latest = events.filter(event => event.team_id !== null && isMeaningful(event)).at(-1)!;
    const lines = new Map([[latest.event_id, both("A lively, accurate line.", "Isang masiglang linya.")]]);
    const narrated = renderToStaticMarkup(<CommentaryPanel data={data} events={events} preferences={preferences} onEvidence={noop} narration={{ lines, pending: 3, loading: false, onNarrate: noop }} />);
    assert.match(narrated, /Narrate with AI/);
    assert.match(narrated, /<p class="commentary-ai"><span class="ai-tag">AI<\/span>A lively, accurate line\.<\/p>/);
    assert.match(narrated, /narrates up to 3 recent moments/);
});

test("the AI recap links turning points to evidence and keeps questions for half-time", () => {
    const point = events.at(-1)!;
    const recap: AgentRecap = { kind: "half-time", story: both("A story."), turningPoints: [{ eventId: point.event_id, caption: both("A turning point.") }], teamNotes: [{ teamId: data.match.home_team_id, observed: both("Observed."), interpretation: both("Maybe."), metrics: [{ label: both("Shots (Arsenal)"), value: "4" }], eventIds: [point.event_id], evidenceTotal: 4 }], watchNext: both("Can they keep it up?") };
    const idle = renderToStaticMarkup(<AgentRecapPanel data={data} events={events} preferences={preferences} kind="half-time" task={{ status: "idle", cursor: events.length, elapsed: 2700 }} onWrite={noop} onEvidence={noop} />);
    assert.match(idle, /Write AI recap/);
    const html = renderToStaticMarkup(<AgentRecapPanel data={data} events={events} preferences={preferences} kind="half-time" task={{ status: "done", result: recap, cursor: events.length, elapsed: 2700 }} onWrite={noop} onEvidence={noop} />);
    assert.match(html, /AI half-time story/);
    assert.match(html, /Questions for the second half: <\/b>Can they keep it up\?/);
    assert.match(html, /Latest 1 of 4 supporting events/);
    assert.match(html, /aria-label="View evidence: \d\d:\d\d"/);
});

test("notes offer AI drafting only for notes and only when enabled", () => {
    const anchor = { elapsed: 600, cursor: 100, secondHalf: false, status: "paused" as const, speed: 5 };
    const note: MatchAnnotation = { id: "n", kind: "note", text: "", anchor, createdAt: 0 };
    const render = (draft: MatchAnnotation, onDraftWithAI?: (draft: MatchAnnotation) => void) => renderToStaticMarkup(<StudioNotes annotations={[]} language="en" selectedId={null} draft={draft} onSelect={noop} onDraft={noop} onCreate={noop} onSave={noop} onDelete={noop} onGo={noop} onDraftWithAI={onDraftWithAI} />);
    assert.match(render(note, noop), /Draft with AI/);
    assert.ok(!render(note).includes("Draft with AI"));
    assert.ok(!render({ ...note, kind: "bookmark" }, noop).includes("Draft with AI"));
});
