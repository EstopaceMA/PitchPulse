import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { initialPlayback, type PlaybackState } from "@/lib/match/playback";
import { validateMatch } from "@/lib/match/validation";
import { Pitch } from "./pitch";
import { PlaybackControls } from "./playback-controls";
import { PreferencesMenu, ViewControls } from "./view-controls";
import { DashboardHeader } from "./dashboard-header";
import { Select } from "@/components/ui/select";
import type { Preferences } from "@/lib/match/types";

const data = validateMatch(JSON.parse(readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8")));
const noop = () => {};

test("full-team pitch defaults to fit while retaining every player and enabled names", () => {
    const html = renderToStaticMarkup(<Pitch data={data} events={[]} elapsed={0} pinned={false} language="en" onLive={noop} />);
    assert.match(html, /full-team-stage pitch-fit/);
    assert.match(html, /aria-label="Pitch size"/);
    assert.match(html, /aria-pressed="true"[^>]*aria-controls="pitch-stage"[^>]*>Fit pitch/);
    assert.match(html, /Detailed view/);
    assert.match(html, /type="checkbox" checked=""/);
    assert.equal((html.match(/data-player-id=/g) ?? []).length, data.players.length);
    assert.equal((html.match(/data-name-for=/g) ?? []).length, data.players.length);
    assert.ok(!html.includes("Follow live"));
});

test("historical inspection has one Follow live action in the pitch header", () => {
    const html = renderToStaticMarkup(<Pitch data={data} events={data.events.slice(0, 3)} elapsed={100} event={data.events[0]} pinned language="en" onLive={noop} />);
    assert.equal((html.match(/Follow live/g) ?? []).length, 1);
    assert.ok(html.indexOf("Follow live") < html.indexOf('class="pitch-view-controls"'));
    assert.match(html, /REVIEWING EVENT/);
});

test("pitch sizing and historical controls have Filipino labels", () => {
    const html = renderToStaticMarkup(<Pitch data={data} events={data.events.slice(0, 1)} elapsed={0} event={data.events[0]} pinned language="fil" onLive={noop} />);
    for (const label of ["Laki ng pitch", "Iangkop ang pitch", "Detalyadong tanaw", "Sundan ang laro"]) assert.ok(html.includes(label));
});

function controls(state: PlaybackState, empty = false) {
    return renderToStaticMarkup(<PlaybackControls data={empty ? { ...data, events: [] } : data} state={state} language="en" statusText={state.status} dispatch={noop} onRestart={noop} onSeek={noop} onStep={noop} />);
}

test("one playback control set exposes a labeled native timeline and supported speeds", () => {
    const html = controls(initialPlayback());
    assert.equal((html.match(/id="playback-controls"/g) ?? []).length, 1);
    assert.equal((html.match(/type="range"/g) ?? []).length, 1);
    assert.match(html, /aria-label="Match timeline"/);
    for (const speed of [1, 5, 10, 30]) assert.ok(html.includes(`>${speed}×</button>`));
});

test("half-time exposes the explicit transition and disables stepping", () => {
    const html = controls({ ...initialPlayback(), status: "half-time", elapsed: data.match.period_seconds });
    assert.match(html, /aria-label="Start second half"/);
    assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Step to next event"/);
});

test("full-time and empty uploads cannot play; restart remains available", () => {
    const completed = controls({ ...initialPlayback(), status: "full-time", elapsed: data.match.duration_seconds });
    assert.match(completed, /<button[^>]*disabled=""[^>]*aria-label="Match completed"/);
    assert.match(controls(initialPlayback(), true), /<button[^>]*disabled=""[^>]*aria-label="Play match"/);
    assert.match(completed, /aria-label="Restart match"/);
});

const preferences: Preferences = { mode: "casual", language: "en", team: data.match.home_team_id, player: data.players[0].player_id };

test("viewing controls group personalization and three modes in one named card", () => {
    const html = renderToStaticMarkup(<ViewControls data={data} preferences={preferences} onChange={noop} />);
    assert.match(html, /<section class="panel analysis-controls" aria-labelledby=/);
    assert.match(html, /Your perspective<\/h2>/);
    assert.ok(html.indexOf("Make it yours") < html.indexOf('class="view-modes"'));
    assert.equal((html.match(/aria-pressed="/g) ?? []).length, 3);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-describedby="[^"]+-description"/);
    assert.match(html, /The story, simply told/);
    assert.ok(!html.includes('class="focus-bar"'));
});

test("viewing controls expose the selected mode and its bilingual description", () => {
    const analyst = renderToStaticMarkup(<ViewControls data={data} preferences={{ ...preferences, mode: "analyst" }} onChange={noop} />);
    assert.match(analyst, /Every detail. All the evidence./);
    const html = renderToStaticMarkup(<ViewControls data={data} preferences={{ ...preferences, language: "fil", mode: "player" }} onChange={noop} />);
    for (const label of ["Iyong pananaw", "Iayon sa iyo", "Tagahanga", "Analista", "Pokus sa Manlalaro", "Sinusundan", "Sundan ang ambag ng manlalaro"]) assert.ok(html.includes(label));
    assert.match(html, /class="focus-bar"/);
    assert.match(html, /<label for="[^"]+-player">Sinusundan<\/label>/);
    assert.match(html, /<button[^>]*id="[^"]+-player"[^>]*role="combobox"[^>]*aria-label="Sinusundan"/);
});

test("player focus remains usable with an empty roster", () => {
    const html = renderToStaticMarkup(<ViewControls data={{ ...data, players: [] }} preferences={{ ...preferences, mode: "player", player: "" }} onChange={noop} />);
    assert.match(html, /<button[^>]*disabled=""[^>]*role="combobox"[^>]*aria-label="Following"/);
    assert.match(html, /class="dropdown-value">No players<\/span>/);
});

test("header personalization is reusable without duplicating the sidebar menu", () => {
    const header = renderToStaticMarkup(<PreferencesMenu data={data} preferences={preferences} onChange={noop} />);
    const sidebar = renderToStaticMarkup(<ViewControls data={data} preferences={preferences} onChange={noop} showPreferences={false} />);
    assert.match(header, /Make it yours/);
    assert.match(header, /aria-expanded="false"/);
    assert.doesNotMatch(sidebar, /Make it yours|preferences-anchor/);
    assert.equal((sidebar.match(/aria-pressed="/g) ?? []).length, 3);
});

test("event simulator transport shows Start, Pause, Resume and Reset labels", () => {
    assert.match(controls(initialPlayback()), />Start<\/span>/);
    assert.match(controls(initialPlayback()), />Reset<\/span>/);
    assert.match(controls({ ...initialPlayback(), status: "playing" }), />Pause<\/span>/);
    assert.match(controls({ ...initialPlayback(), status: "paused" }), />Resume<\/span>/);
});

function header(language: Preferences["language"] = "en", uploaded = false, loading = false) {
    return renderToStaticMarkup(<DashboardHeader data={data} preferences={{ ...preferences, language }} source="custom-match.json" sourceKind={uploaded ? "upload" : "demo"} loading={loading} status="ready" statusText={language === "en" ? "Ready" : "Handa"} onChange={noop} onUpload={noop} onDemo={noop} onInsights={noop} />);
}

test("header separates navigation from match actions without duplicate language or upload controls", () => {
    const html = header();
    const navigation = html.slice(0, html.indexOf('class="matchbar"'));
    const matchbar = html.slice(html.indexOf('class="matchbar"'));
    assert.match(navigation, /Main navigation/);
    assert.match(navigation, /aria-label="Preferences"/);
    assert.doesNotMatch(navigation, /<select|Load match|Match scenario/);
    assert.match(matchbar, /aria-label="Match scenario"/);
    assert.match(matchbar, /aria-label="Load match"/);
    assert.match(matchbar, /Simulation status: /);
    assert.equal((html.match(/role="combobox"/g) ?? []).length, 1);
    assert.equal((html.match(/aria-label="Load match"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /choose-upload|Language \/ Wika/);
});

test("compact header retains translated labels and an accessible settings trigger", () => {
    const html = header("fil");
    for (const label of ["Pangunahing nabigasyon", "Sentro ng laban", "Pagsusuri", "Mga setting", "Senaryo ng laban", "Mag-load ng laban", "Kalagayan ng simulasyon: ", "Handa"]) assert.ok(html.includes(label));
    assert.match(html, /aria-label="Mga setting"[^>]*aria-expanded="false"/);
});

test("match selection retains uploaded source and disables loading actions", () => {
    const html = header("en", true, true);
    assert.match(html, /class="dropdown-value">custom-match.json<\/span>/);
    assert.match(header(), /class="dropdown-value">Arsenal vs Chelsea · Demo<\/span>/);
    assert.match(html, /<button[^>]*disabled=""[^>]*role="combobox"/);
    assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Load match"/);
});

test("shared dropdown exposes a labeled collapsed combobox and selected text before opening", () => {
    const html = renderToStaticMarkup(<Select id="test-team" label="Favorite team" value="away" options={[{ value: "home", label: "Arsenal" }, { value: "away", label: "Chelsea" }]} onValueChange={noop} />);
    assert.match(html, /id="test-team"[^>]*role="combobox"[^>]*aria-expanded="false"[^>]*aria-haspopup="listbox"[^>]*aria-label="Favorite team"/);
    assert.match(html, /class="dropdown-value">Chelsea<\/span>/);
    assert.match(html, /title="Chelsea"/);
    assert.match(html, /aria-hidden="true" class="dropdown-chevron"/);
    assert.doesNotMatch(html, /role="option"/);
});

test("shared dropdown preserves and safely renders custom labels without firing changes", () => {
    let changes = 0;
    const html = renderToStaticMarkup(<Select label="Player" value="custom" options={[{ value: "custom", label: "<Player> & Team", group: "Uploaded team" }]} onValueChange={() => changes++} />);
    assert.match(html, /class="dropdown-value">&lt;Player&gt; &amp; Team<\/span>/);
    assert.equal(changes, 0);
});