"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLibrary } from "@/lib/match/use-library";
import { useSimulation } from "@/lib/match/use-simulation";
import { useBroadcastSubscriber } from "@/lib/match/use-broadcast";
import { buildMovementTimeline, sampleMovement } from "@/lib/match/movement";
import { activeCues, buildCues, cueClock, preferencesFromQuery, type OverlayCue } from "@/lib/match/overlays";
import { formatTime, type MatchStatus } from "@/lib/match/playback";
import { initials, rosterDisclosure, teamColor, tr } from "@/lib/match/presentation";
import { activeHighlights, buildHighlights } from "@/lib/match/thresholds";
import { localeDirection } from "@/lib/i18n/locales";
import type { Language, MatchData, MatchEvent, Preferences } from "@/lib/match/types";
import { useAppLocale } from "./locale-provider";
import { PitchMarkings, useReducedMotion } from "./pitch";
import { TeamMotion } from "./team-motion";

/**
 * Preview draws the illustrative simulation as a stand-in for the camera feed; chroma paints keyable green for
 * window capture; transparent is for a browser source laid over a real feed.
 */
export type BroadcastBackground = "preview" | "chroma" | "transparent";
const backgroundFrom = (value: string | undefined): BroadcastBackground => value === "preview" || value === "chroma" ? value : "transparent";
const noop = () => { };

/** One frame of overlay graphics over an optional backdrop. Pure markup over cues, so tests and both modes share it. */
export function BroadcastOverlay({ data, cues, at, status, language, background = "transparent", backdrop }: { data: MatchData; cues: readonly OverlayCue[]; at: number; status: MatchStatus; language: Language; background?: BroadcastBackground; backdrop?: ReactNode }) {
    const active = activeCues(cues, at);
    const scorebug = cues.find(cue => cue.kind === "scorebug");
    const myMetric = cues.find(cue => cue.kind === "my_metric");
    const lower = active.find(cue => cue.kind === "lower_third") ?? active.find(cue => cue.kind === "insight");
    const pop = active.find(cue => cue.kind === "stat_pop");
    // Over the simulated pitch, tags sit on the players themselves, so the side stack would repeat them.
    const tags = backdrop ? [] : active.filter(cue => cue.kind === "player_tag").slice(0, 3);
    const home = data.match.home_team_id, away = data.match.away_team_id;
    const pinged = myMetric && active.some(cue => cue.kind === "stat_pop" && cue.values.metric === myMetric.values.metric);
    const dir = localeDirection(language);
    const phase = status === "half-time" ? tr(language, "halfTime2") : status === "full-time" ? tr(language, "fullTime") : null;
    const disclosure = [backdrop ? tr(language, "illustrativeMovement") : null, rosterDisclosure(data, language)].filter(Boolean).join(" · ");
    return <div className="broadcast-root" data-testid="broadcast-overlay" data-background={background === "transparent" ? undefined : background} lang={language}>
        {backdrop}
        {scorebug && <div className="broadcast-scorebug" dir="ltr" aria-label={scorebug.text}>
            <span className="broadcast-team" style={{ borderColor: teamColor(home, home) }}>{initials(data.teams.find(team => team.team_id === home)?.name ?? home)}</span>
            <b>{scorebug.values.homeGoals}–{scorebug.values.awayGoals}</b>
            <span className="broadcast-team" style={{ borderColor: teamColor(away, home) }}>{initials(data.teams.find(team => team.team_id === away)?.name ?? away)}</span>
            <time>{formatTime(at)}</time>{phase && <em>{phase}</em>}
        </div>}
        {myMetric && <div className={`broadcast-metric${pinged ? " pinged" : ""}`} dir={dir} data-cue={myMetric.id}><small>{myMetric.text} · {myMetric.detail}</small><b dir="ltr">{myMetric.values.value}</b></div>}
        {tags.length > 0 && <ul className="broadcast-tags" dir={dir}>{tags.map(tag => <li key={tag.id} data-cue={tag.id} style={{ borderColor: teamColor(tag.teamId, home) }}><strong>{tag.text}</strong><span>{tag.detail}</span></li>)}</ul>}
        {pop && <div className="broadcast-pop" key={pop.id} dir={dir} data-cue={pop.id}><strong>{pop.text}</strong><span>{pop.detail}</span></div>}
        {lower && <div className={`broadcast-lower ${lower.kind}`} key={lower.id} dir={dir} data-cue={lower.id} style={{ borderColor: teamColor(lower.teamId, home) }}>
            <strong>{lower.kind === "lower_third" && lower.values.headline ? `${lower.text} · ${lower.values.headline}` : lower.text}</strong>
            {lower.detail && <p>{lower.detail}</p>}
        </div>}
        {disclosure && <p className="broadcast-disclosure" dir={dir}>{disclosure}</p>}
    </div>;
}

/**
 * The studio's full-team simulation, full screen, on the same clock and processed prefix as the graphics.
 * Threshold tags are drawn on the players. It is decorative here, so it stays out of focus and accessibility trees.
 */
export function PitchBackdrop({ data, events, at, preferences }: { data: MatchData; events: readonly MatchEvent[]; at: number; preferences: Preferences }) {
    const reducedMotion = useReducedMotion();
    const timeline = useMemo(() => buildMovementTimeline(data, events), [data, events]);
    const visualTime = reducedMotion ? events.at(-1)?.match_time_seconds ?? 0 : at;
    const frame = useMemo(() => sampleMovement(timeline, visualTime), [timeline, visualTime]);
    const highlights = useMemo(() => buildHighlights(events), [events]);
    return <div className="broadcast-pitch" inert aria-hidden="true">
        {/* A 16:9 crop of the 760 × 510 pitch coordinates, centred. */}
        <svg viewBox="-73 0 906 510" preserveAspectRatio="xMidYMid meet">
            <PitchMarkings />
            <TeamMotion data={data} frame={frame} names selectedPlayer={null} onSelect={noop} language={preferences.language} highlights={activeHighlights(highlights, visualTime)} units={preferences.units} focusPlayer={preferences.mode === "player" ? preferences.player : undefined} />
        </svg>
    </div>;
}

function Frame({ data, events, at, status, preferences, background }: { data: MatchData; events: readonly MatchEvent[]; at: number; status: MatchStatus; preferences: Preferences; background: BroadcastBackground }) {
    const clock = cueClock(events, at);
    const cues = useMemo(() => buildCues(data, events, clock, preferences), [data, events, clock, preferences]);
    return <BroadcastOverlay data={data} cues={cues} at={at} status={status} language={preferences.language} background={background} backdrop={background === "preview" ? <PitchBackdrop data={data} events={events} at={at} preferences={preferences} /> : undefined} />;
}

/** Follows the studio window over BroadcastChannel; nothing renders until the studio answers. */
function SyncedBroadcast({ id, data, background }: { id: string; data: MatchData; background: BroadcastBackground }) {
    const state = useBroadcastSubscriber(id, true);
    const events = useMemo(() => data.events.slice(0, state?.cursor ?? 0), [data, state?.cursor]);
    return state ? <Frame data={data} events={events} at={state.elapsed} status={state.status} preferences={state.preferences} background={background} /> : <div className="broadcast-root" data-background={background === "transparent" ? undefined : background} />;
}

/** Runs its own shared clock from URL options, for an OBS or vMix browser source. */
function StandaloneBroadcast({ data, query }: { data: MatchData; query: Record<string, string> }) {
    const preferences = useMemo(() => preferencesFromQuery(data, name => query[name] ?? null), [data, query]);
    const { state, dispatch, events } = useSimulation(data);
    const autoplay = query.autoplay !== "0";
    useEffect(() => {
        const speed = Number(query.speed ?? 10), start = Number(query.start ?? 0);
        dispatch({ type: "speed", speed: [1, 5, 10, 30].includes(speed) ? speed : 10 });
        if (Number.isFinite(start) && start > 0) dispatch({ type: "seek", elapsed: start });
        if (autoplay) dispatch({ type: "toggle" });
    }, [autoplay, dispatch, query.speed, query.start]);
    // A broadcast loop has no operator to press "Start second half".
    useEffect(() => {
        if (!autoplay || state.status !== "half-time") return;
        const resume = setTimeout(() => dispatch({ type: "toggle" }), 3000);
        return () => clearTimeout(resume);
    }, [autoplay, dispatch, state.status]);
    return <Frame data={data} events={events} at={state.elapsed} status={state.status} preferences={preferences} background={backgroundFrom(query.bg)} />;
}

/** Appears on pointer movement or keyboard focus and fades out, so window capture normally never shows it. */
function BackgroundSwitch({ value, onChange }: { value: BroadcastBackground; onChange: (value: BroadcastBackground) => void }) {
    const { locale: l } = useAppLocale();
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const show = () => {
            setVisible(true);
            clearTimeout(timer);
            timer = setTimeout(() => setVisible(false), 2500);
        };
        window.addEventListener("pointermove", show);
        window.addEventListener("keydown", show);
        return () => { clearTimeout(timer); window.removeEventListener("pointermove", show); window.removeEventListener("keydown", show); };
    }, []);
    return <div className="broadcast-switch" data-visible={visible} role="group" aria-label={tr(l, "broadcastBackground")}>
        {(["preview", "chroma"] as const).map(option => <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>{tr(l, option === "preview" ? "backgroundPreview" : "backgroundChroma")}</button>)}
    </div>;
}

export default function Broadcast({ id, query }: { id: string; query: Record<string, string> }) {
    const library = useLibrary();
    const record = library.matches.find(match => match.id === id);
    const [background, setBackground] = useState(() => backgroundFrom(query.bg));
    const synced = query.sync === "1";
    // Keep the address in step so a reload or a copied link opens the same background.
    const choose = (next: BroadcastBackground) => {
        setBackground(next);
        const url = new URL(window.location.href);
        url.searchParams.set("bg", next);
        window.history.replaceState(null, "", url);
    };
    if (!record) return <div className="broadcast-root" data-background={background === "transparent" ? undefined : background} data-state={library.ready ? "missing" : "loading"} />;
    return synced
        ? <><SyncedBroadcast id={id} data={record.data} background={background} /><BackgroundSwitch value={background} onChange={choose} /></>
        : <StandaloneBroadcast data={record.data} query={query} />;
}
