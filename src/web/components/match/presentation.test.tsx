import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { countReached, initialPlayback, type PlaybackState } from "@/lib/match/playback";
import { validateMatch } from "@/lib/match/validation";
import { Pitch } from "./pitch";
import { PlaybackControls } from "./playback-controls";
import { PreferencesMenu, PerspectiveSelect } from "./view-controls";
import { DashboardHeader } from "./dashboard-header";
import { Select } from "@/components/ui/select";
import type { Preferences } from "@/lib/match/types";

const data = validateMatch(JSON.parse(readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8")));
const noop = () => { };

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

test("configured AI adds a pitch Analyze action with available and loading states", () => {
    const render = (disabled: boolean, loading = false, language: "en" | "fil" = "en") => renderToStaticMarkup(<Pitch data={data} events={data.events.slice(0, 1)} elapsed={0} pinned={false} language={language} onLive={noop} analysis={{ onAnalyze: noop, disabled, loading }} />);
    const ready = render(false);
    const stage = ready.indexOf('class="pitch-stage');
    const button = ready.indexOf('pitch-analyze-button', stage);
    const field = ready.indexOf('<svg viewBox="0 0 760 510"', stage);
    assert.ok(stage >= 0 && button > stage && field > button);
    assert.match(ready.slice(stage, field), /aria-haspopup="dialog"/);
    assert.match(ready.slice(stage, field), />Analyze<\/button>/);
    assert.ok(!ready.slice(stage, field).includes('disabled=""'));
    assert.ok(render(true).slice(stage, field).includes('disabled=""'));
    const loading = render(false, true);
    assert.match(loading, /Analyzing…<\/button>/);
    assert.match(loading, /class="pitch-analysis-loading" role="status" aria-live="polite"/);
    assert.match(loading, /Analyzing this moment…/);
    assert.match(render(false, false, "fil"), />Suriin<\/button>/);
});

function controls(state: PlaybackState, empty = false) {
    return renderToStaticMarkup(<PlaybackControls data={empty ? { ...data, events: [] } : data} state={state} language="en" statusText={state.status} dispatch={noop} onRestart={noop} onSeek={noop} onStep={noop} />);
}

test("one playback control set exposes a labeled native timeline and supported speeds", () => {
    const html = controls(initialPlayback());
    assert.equal((html.match(/id="playback-controls"/g) ?? []).length, 1);
    assert.equal((html.match(/type="range"/g) ?? []).length, 1);
    assert.match(html, /aria-label="Match timeline"/);
    assert.match(html, /role="combobox"[^>]*aria-label="Playback speed"/);
    for (const speed of [1, 5, 10, 30] as const) {
        assert.match(controls({ ...initialPlayback(), speed }), new RegExp(`class="dropdown-value">${speed}×</span>`));
    }
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

test("perspective selector exposes each selected mode with bilingual labels", () => {
    for (const [mode, en, fil] of [["casual", "Casual Fan", "Tagahanga"], ["analyst", "Analyst", "Analista"], ["player", "Player Focus", "Pokus sa Manlalaro"]] as const) {
        for (const language of ["en", "fil"] as const) {
            const html = renderToStaticMarkup(<PerspectiveSelect preferences={{ ...preferences, mode, language }} onChange={noop} />);
            assert.match(html, new RegExp(`role="combobox"[^>]*aria-label="${language === "en" ? "Perspective" : "Pananaw"}"`));
            assert.ok(html.includes(`class="dropdown-value">${language === "en" ? en : fil}</span>`));
        }
    }
});

test("preferences remain collapsed until requested", () => {
    const html = renderToStaticMarkup(<PreferencesMenu data={data} preferences={preferences} onChange={noop} compact />);
    assert.match(html, /aria-label="Preferences"[^>]*aria-expanded="false"/);
    assert.doesNotMatch(html, /role="combobox"/);
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
import { MatchCard } from "./match-library";
import { StudioNotes } from "./studio-notes";
import { StudioTimeline } from "./studio-timeline";
import { createLibraryMatch } from "@/lib/match/library";

test("library cards show local progress and annotations without a final result", () => {
    const match = createLibraryMatch("local-1", data, "review.json", "upload", 1);
    const html = renderToStaticMarkup(<MatchCard match={match} language="en" onRemove={noop} />);
    assert.equal((html.match(/href="\/studio\/local-1"/g) ?? []).length, 1);
    const link = html.slice(html.indexOf('<a '), html.indexOf('</a>'));
    assert.match(link, /class="game-preview"/);
    assert.match(link, /<h2 dir="ltr">/);
    assert.doesNotMatch(link, /<button/);
    assert.doesNotMatch(html, /class="open-studio"/);
    assert.match(html, /Ready to analyze/);
    assert.match(html, /Remove imported match/);
    assert.match(html, /review.json/);
    assert.doesNotMatch(html, /final_score|Full-time|data-testid="score"/);
});

test("match titles assign team colors by home/away identity and leave vs neutral", () => {
    for (const language of ["en", "fil"] as const) {
        for (const teams of [data.teams, [...data.teams].reverse()]) {
            const match = createLibraryMatch("team-colors", { ...data, teams }, "review.json", "upload", 1);
            const html = renderToStaticMarkup(<MatchCard match={match} language={language} />);
            assert.match(html, /<h2 dir="ltr"><span class="match-team-home">Arsenal<\/span> <span class="match-versus">vs<\/span> <span class="match-team-away">Chelsea<\/span><\/h2>/);
            assert.ok(html.includes(`${language === "en" ? "Open studio" : "Buksan ang studio"}: Arsenal vs Chelsea`));
        }
    }
});

test("studio timeline has one scrubber and never renders unprocessed markers", () => {
    const html = renderToStaticMarkup(<StudioTimeline data={data} events={[]} state={initialPlayback()} language="en" annotations={[]} selectedId={null} onAnnotation={noop} onEvent={noop} dispatch={noop} onSeek={noop} onRestart={noop} onStep={noop} statusText="Ready" />);
    assert.equal((html.match(/type="range"/g) ?? []).length, 1);
    assert.match(html, /Analysis timeline/);
    assert.match(html, /role="combobox"[^>]*aria-label="Timeline zoom"/);
    assert.equal((html.match(/role="combobox"/g) ?? []).length, 2);
    assert.doesNotMatch(html, /MATCH TIMELINE|Recorded events appear as playback reaches them/);
    assert.match(html, /Saved annotations/);
    assert.doesNotMatch(html, /class="event-marker/);
});

test("studio timeline remains bounded with 50,000 processed events", () => {
    const events = Array.from({ length: 50000 }, (_, i) => ({ ...data.events[0], event_id: `e${i}`, team_id: data.match.home_team_id, match_time_seconds: i / 50000 * data.match.duration_seconds }));
    const html = renderToStaticMarkup(<StudioTimeline data={data} events={events} state={initialPlayback()} language="en" annotations={[]} selectedId={null} onAnnotation={noop} onEvent={noop} dispatch={noop} onSeek={noop} onRestart={noop} onStep={noop} statusText="Paused" />);
    assert.ok((html.match(/class="event-marker/g) ?? []).length <= 40);
    assert.ok(html.length < 50000);
});

test("notes expose bilingual empty states and explicit moment navigation", () => {
    const props = { annotations: [], language: "fil" as const, selectedId: null, draft: null, onSelect: noop, onDraft: noop, onCreate: noop, onSave: noop, onDelete: noop, onGo: noop };
    const empty = renderToStaticMarkup(<StudioNotes {...props} />);
    assert.match(empty, /Magdagdag ng tala/);
    assert.match(empty, /Gawing iyo ang pagsusuri/);
    const note = { id: "n1", kind: "note" as const, text: "<script>test</script>", anchor: initialPlayback(), createdAt: 1 };
    const selected = renderToStaticMarkup(<StudioNotes {...props} annotations={[note]} selectedId="n1" />);
    assert.match(selected, /Pumunta sa sandali/);
    assert.match(selected, /&lt;script&gt;/);
    assert.doesNotMatch(selected, /<script>test/);
});


test("roster disclosures say only what the dataset itself claims", () => {
    const disclosure = (match: typeof data) => {
        const html = renderToStaticMarkup(<Pitch data={match} events={[]} elapsed={0} pinned={false} language="en" onLive={noop} />);
        return html.slice(html.indexOf('class="pitch-disclosure"'), html.indexOf('id="pitch-stage"'));
    };
    assert.match(disclosure(data), />Illustrative movement · Simulated match · real squad names</);
    const placeholder = { ...data, players: data.players.map((player, index) => index ? player : { ...player, fictional: true }) };
    assert.match(disclosure(placeholder), />Illustrative movement · Demo players are fictional</);
    const unmarked = { ...data, players: data.players.map((player) => ({ ...player, fictional: undefined })) };
    assert.match(disclosure(unmarked), />Illustrative movement · Simulated match</);
    assert.match(disclosure({ ...data, synthetic: false }), />Illustrative movement</);
});

test("roster lists each player's number, name, nationality and slot with the dataset note", () => {
    for (const language of ["en", "fil"] as const) {
        const html = renderToStaticMarkup(<Pitch data={data} events={[]} elapsed={0} pinned={false} language={language} onLive={noop} />);
        const saka = data.players.find((player) => player.name === "Bukayo Saka")!;
        assert.match(html, new RegExp(`roster-number"[^>]*>${saka.shirt_number}</span><span class="roster-name">Bukayo Saka</span><span class="roster-nation">ENG</span><span class="roster-position">RW</span>`));
        assert.ok(html.includes(language === "en" ? "The players are real, but the match is simulated" : "Totoo ang mga manlalaro, pero simulado ang laban"));
        assert.ok(html.includes(`${language === "en" ? "Dataset note" : "Tala ng dataset"}: ${data.disclaimer}`));
    }
});

test("pitch keeps disclosures visible, help collapsed and event IDs in details only", () => {
    for (const language of ["en", "fil"] as const) {
        const event = data.events[0];
        const html = renderToStaticMarkup(<Pitch compact data={data} events={[event]} elapsed={0} event={event} pinned language={language} onLive={noop} />);
        assert.match(html, /<details class="pitch-about">/);
        assert.ok(html.includes(language === "en" ? "About this view" : "Tungkol sa tanaw na ito"));
        const disclosure = html.slice(html.indexOf('class="pitch-disclosure"'), html.indexOf('id="pitch-stage"'));
        assert.ok(disclosure.includes(language === "en" ? "Illustrative movement" : "Halimbawang galaw"));
        assert.ok(disclosure.includes(language === "en" ? "Simulated match · real squad names" : "Simuladong laban · totoong pangalan ng mga manlalaro"));
        assert.match(html, /<time>00:00<\/time>/);
        const action = html.slice(html.indexOf('class="current-action"'), html.indexOf('class="pitch-about"'));
        assert.ok(!action.includes(event.event_id));
    }
});

test("the pitch tags a threshold-crossing action beside the player and shows its synthetic quality", () => {
    const shot = data.events.find(event => event.type === "shot" && event.shot_speed_kmh! >= 100)!;
    const events = data.events.slice(0, data.events.indexOf(shot) + 1);
    const html = renderToStaticMarkup(<Pitch data={data} events={events} elapsed={shot.match_time_seconds + 2} event={shot} pinned={false} language="en" onLive={noop} />);
    assert.match(html, new RegExp(`data-highlight="shot_speed" data-tag-for="${shot.player_id}"`));
    assert.ok(html.includes(`Shot ${shot.shot_speed_kmh!.toFixed(1)} km/h`));
    assert.match(html, /class="action-quality" title="Synthetic dataset values, not measurements"/);
    const later = renderToStaticMarkup(<Pitch data={data} events={events} elapsed={shot.match_time_seconds + 30} event={shot} pinned={false} language="en" onLive={noop} />);
    assert.doesNotMatch(later, /data-highlight=/, "tags expire with match time");
    const focus = renderToStaticMarkup(<Pitch data={data} events={[]} elapsed={0} pinned={false} language="en" onLive={noop} focusPlayer={data.players[3].player_id} />);
    assert.match(focus, new RegExp(`class="sim-player spotlight" data-player-id="${data.players[3].player_id}"`));
    assert.match(focus, /class="sim-player dimmed"/);
});

import { BroadcastOverlay, PitchBackdrop } from "./broadcast-view";
import { MyMetricBug, StoryPanel } from "./fan-widgets";
import { StatisticsPanel } from "./statistics-panel";
import { buildCues } from "@/lib/match/overlays";
import { ruleBasedProvider } from "@/lib/match/insights";
import { aggregate } from "@/lib/match/statistics";

const reachedBy = (at: number) => data.events.slice(0, countReached(data.events, at, at > data.match.period_seconds));
const viewer: Preferences = { mode: "casual", language: "en", team: data.match.home_team_id, player: "" };

test("the broadcast overlay shows the scorebug, a goal lower third and the roster disclosure, and stays transparent", () => {
    const goal = data.events.find(event => event.type === "shot" && event.outcome === "goal")!;
    const at = goal.match_time_seconds + 3, events = reachedBy(at);
    const html = renderToStaticMarkup(<BroadcastOverlay data={data} cues={buildCues(data, events, at, { ...viewer, metric: "shots" })} at={at} status="playing" language="en" />);
    assert.match(html, /class="broadcast-root"/);
    assert.match(html, /<b>1–0<\/b>/);
    assert.ok(html.includes(`data-cue="goal:${goal.event_id}"`));
    assert.ok(html.includes("Goal! "));
    assert.ok(html.includes("Arsenal open the scoring"));
    assert.ok(html.includes("Simulated match · real squad names"));
    assert.match(html, /class="broadcast-metric"/);
    const arabic = renderToStaticMarkup(<BroadcastOverlay data={data} cues={buildCues(data, events, at, { ...viewer, language: "ar" })} at={at} status="playing" language="ar" />);
    assert.match(arabic, /class="broadcast-scorebug" dir="ltr"/);
    assert.match(arabic, /class="broadcast-lower lower_third"[^>]*dir="rtl"/);
});

test("the casual story leads with the score and plain-language moments, favourites marked", () => {
    const events = reachedBy(1500);
    const html = renderToStaticMarkup(<StoryPanel data={data} events={events} stats={aggregate(data, events)} insights={ruleBasedProvider.generate(data, events, 1500)} preferences={viewer} elapsed={1500} onEvidence={noop} />);
    assert.match(html, /<h2 id="story-heading">The story so far<\/h2>/);
    assert.match(html, /<b>1–0<\/b>/);
    assert.ok(html.includes("Arsenal open the scoring"));
    assert.ok(html.includes("at the end of a 43-second move."));
    assert.match(html, /<li class="favorite"/);
    const empty = renderToStaticMarkup(<StoryPanel data={data} events={[]} stats={aggregate(data, [])} insights={[]} preferences={viewer} elapsed={0} onEvidence={noop} />);
    assert.ok(empty.includes("will appear here in plain words"));
});

test("My metric follows the focus player in Player Focus and shows a dash before any sample", () => {
    const stats = aggregate(data, data.events);
    const player = data.players.find(entry => stats.players[entry.player_id].shots > 0)!;
    const html = renderToStaticMarkup(<MyMetricBug data={data} stats={stats} preferences={{ ...viewer, mode: "player", player: player.player_id, metric: "fastest_shot" }} />);
    assert.ok(html.includes(`Fastest shot · ${player.name}`));
    assert.ok(html.includes(`${stats.quality.players[player.player_id].shot_speed_max.toFixed(1)} km/h`));
    assert.ok(renderToStaticMarkup(<MyMetricBug data={data} stats={aggregate(data, [])} preferences={{ ...viewer, metric: "pass_accuracy" }} />).includes("<b dir=\"ltr\">—</b>"));
    assert.equal(renderToStaticMarkup(<MyMetricBug data={data} stats={stats} preferences={viewer} />), "");
});

test("analysts get difficulty bands and an export; other perspectives do not", () => {
    const stats = aggregate(data, data.events);
    const analyst = renderToStaticMarkup(<StatisticsPanel data={data} stats={stats} preferences={{ ...viewer, mode: "analyst" }} events={data.events} elapsed={5400} />);
    assert.match(analyst, /Pass completion by difficulty/);
    assert.match(analyst, /<th scope="row">Elite<\/th>/);
    assert.match(analyst, /Export statistics so far/);
    assert.doesNotMatch(renderToStaticMarkup(<StatisticsPanel data={data} stats={stats} preferences={viewer} events={data.events} elapsed={5400} />), /band-table/);
    const imperial = renderToStaticMarkup(<StatisticsPanel data={data} stats={stats} preferences={viewer} units="imperial" />);
    assert.match(imperial, /\d+\.\d mph/);
    assert.match(imperial, /\d+\.\d yd/);
});

test("Player Focus adds the followed player's lane to the timeline", () => {
    const player = data.players[9];
    const events = reachedBy(1800);
    const html = renderToStaticMarkup(<StudioTimeline data={data} events={events} state={{ ...initialPlayback(), elapsed: 1800, cursor: events.length }} language="en" annotations={[]} selectedId={null} onAnnotation={noop} onEvent={noop} dispatch={noop} onSeek={noop} onRestart={noop} onStep={noop} statusText="Paused" focusPlayer={player.player_id} />);
    assert.match(html, new RegExp(`class="event-track player-track" aria-label="${player.name}"`));
    assert.doesNotMatch(renderToStaticMarkup(<StudioTimeline data={data} events={events} state={{ ...initialPlayback(), elapsed: 1800, cursor: events.length }} language="en" annotations={[]} selectedId={null} onAnnotation={noop} onEvent={noop} dispatch={noop} onSeek={noop} onRestart={noop} onStep={noop} statusText="Paused" />), /player-track/);
});

test("the broadcast preview draws the simulated pitch under the graphics, with tags on the players", () => {
    const shot = data.events.find(event => event.type === "shot" && event.shot_speed_kmh! >= 100)!;
    const at = shot.match_time_seconds + 2, events = reachedBy(at);
    const backdrop = <PitchBackdrop data={data} events={events} at={at} preferences={viewer} />;
    const html = renderToStaticMarkup(<BroadcastOverlay data={data} cues={buildCues(data, events, at, viewer)} at={at} status="playing" language="en" background="preview" backdrop={backdrop} />);
    assert.match(html, /^<div class="broadcast-root" data-testid="broadcast-overlay" data-background="preview" lang="en"><div class="broadcast-pitch" inert="" aria-hidden="true"><svg viewBox="-73 0 906 510"/);
    assert.equal((html.match(/class="sim-player[ "]/g) ?? []).length, data.players.length);
    assert.match(html, new RegExp(`data-highlight="shot_speed" data-tag-for="${shot.player_id}"`));
    assert.doesNotMatch(html, /broadcast-tags/, "tags sit on the players instead of the side stack");
    assert.ok(html.includes("Illustrative movement · Simulated match · real squad names"));
    const overFeed = renderToStaticMarkup(<BroadcastOverlay data={data} cues={buildCues(data, events, at, viewer)} at={at} status="playing" language="en" />);
    assert.doesNotMatch(overFeed, /broadcast-pitch|data-background/);
    assert.match(overFeed, /class="broadcast-tags"/);
});

