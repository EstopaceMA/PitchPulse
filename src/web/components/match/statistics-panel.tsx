import { BarChart3, Download, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { statisticsExport } from "@/lib/match/export";
import { formatTime } from "@/lib/match/playback";
import { accuracy, averageBallSpeed, averagePassDistance, averageShotSpeed, DIFFICULTY_BANDS, emptyMetrics, emptyQuality, passBands } from "@/lib/match/statistics";
import { bandLabel, distanceText, initials, speedText, tr } from "@/lib/match/presentation";
import type { Language, MatchData, MatchEvent, Metrics, Preferences, Quality, Statistics, Units } from "@/lib/match/types";

/** Text is null when a side has no samples yet, so an empty average reads "—" rather than a measured zero. */
type Row = { label: string; values: [number, number]; text?: (value: number, index: number) => string | null };

export function Comparison({ data, stats, language, units = "metric" }: { data: MatchData; stats: Statistics; language: Language; units?: Units }) {
    const homeId = data.match.home_team_id, awayId = data.match.away_team_id;
    const home = stats.teams[homeId], away = stats.teams[awayId];
    const quality = [stats.quality.teams[homeId] ?? emptyQuality(), stats.quality.teams[awayId] ?? emptyQuality()] as const;
    const count = (key: keyof Metrics): Row => ({ label: "", values: [home[key], away[key]] });
    const sampled = (value: (q: Quality) => number, samples: (q: Quality) => number, format: (value: number) => string): Pick<Row, "values" | "text"> => ({
        values: [value(quality[0]), value(quality[1])],
        text: (shown, index) => samples(quality[index]) ? format(shown) : null,
    });
    const groups: { heading?: string; rows: Row[] }[] = [
        { rows: [
            { ...count("goals"), label: tr(language, "goals2") },
            { ...count("shots"), label: tr(language, "shots2") },
            { ...count("shots_on_target"), label: tr(language, "shotsOnTarget") },
            { ...count("passes_attempted"), label: tr(language, "passesAttempted") },
            { ...count("passes_completed"), label: tr(language, "passesCompleted") },
            { label: tr(language, "passAccuracy"), values: [accuracy(home), accuracy(away)], text: value => `${value.toFixed(1)}%` },
            { ...count("tackles_won"), label: tr(language, "tacklesWon") },
            { ...count("pressure_events"), label: tr(language, "pressureEvents") },
        ] },
        { heading: tr(language, "passQuality"), rows: [
            { label: tr(language, "averagePassDistance"), ...sampled(averagePassDistance, q => q.pass_distance_count, value => distanceText(value, units)) },
            { label: tr(language, "longPassesCompleted"), values: [quality[0].long_passes_completed, quality[1].long_passes_completed] },
            { label: tr(language, "difficultPassesCompleted"), values: [quality[0].difficult_passes_completed, quality[1].difficult_passes_completed] },
        ] },
        { heading: tr(language, "speedSynthetic"), rows: [
            { label: tr(language, "averageBallSpeed"), ...sampled(averageBallSpeed, q => q.ball_speed_count, value => speedText(value, units)) },
            { label: tr(language, "averageShotSpeed"), ...sampled(averageShotSpeed, q => q.shot_speed_count, value => speedText(value, units)) },
            { label: tr(language, "fastestShot"), ...sampled(q => q.shot_speed_max, q => q.shot_speed_count, value => speedText(value, units)) },
        ] },
    ];
    return <div className="comparison"><div className="comparison-teams" dir="ltr"><span><i className="tiny-dot home-dot" />{initials(data.match.home_team_id)}</span><span className="micro-label">{tr(language, "matchTotals")}</span><span>{initials(data.match.away_team_id)}<i className="tiny-dot away-dot" /></span></div>{groups.map(group => <div className="comparison-group" key={group.heading ?? "totals"}>{group.heading && <p className="comparison-group-heading micro-label">{group.heading}</p>}{group.rows.map(row => {
        const [a, b] = row.values;
        const total = a + b || 1;
        const [left, right] = row.values.map((value, index) => row.text ? row.text(value, index) ?? "—" : value);
        return <div className="stat-row" key={row.label}><div className="stat-numbers" dir="ltr"><strong>{left}</strong><span>{row.label}</span><strong>{right}</strong></div><div className="comparison-track" dir="ltr"><span style={{ width: `${a / total * 100}%` }} /><span style={{ width: `${b / total * 100}%` }} /></div></div>;
    })}</div>)}</div>;
}

/** Analyst extras: completion by difficulty band for both teams, and a download of the processed-prefix totals. */
function AnalystQuality({ data, stats, events, elapsed, language }: { data: MatchData; stats: Statistics; events: readonly MatchEvent[]; elapsed: number; language: Language }) {
    const teams = [data.match.home_team_id, data.match.away_team_id];
    const bands = teams.map(teamId => passBands(events, event => event.team_id === teamId));
    const download = (format: "csv" | "json") => {
        const url = URL.createObjectURL(new Blob([statisticsExport(data, stats, elapsed, format)], { type: format === "csv" ? "text/csv" : "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${data.match.match_id}-${formatTime(elapsed).replace(":", "")}.${format}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    return <div className="analyst-quality">
        <p className="comparison-group-heading micro-label">{tr(language, "passDifficultyBands")}</p>
        <table className="band-table"><thead><tr><th scope="col">{tr(language, "band")}</th>{teams.map(teamId => <th scope="col" key={teamId}>{initials(data.teams.find(team => team.team_id === teamId)?.name ?? teamId)}</th>)}</tr></thead>
            <tbody>{DIFFICULTY_BANDS.map(band => <tr key={band}><th scope="row">{bandLabel(band, language)}</th>{bands.map((entry, index) => <td key={teams[index]} dir="ltr">{entry[band].completed}/{entry[band].attempted}</td>)}</tr>)}</tbody></table>
        <div className="stats-export"><span>{tr(language, "exportStatistics")}</span><Button size="sm" variant="outline" onClick={() => download("csv")}><Download size={13} aria-hidden="true" />CSV</Button><Button size="sm" variant="outline" onClick={() => download("json")}><Download size={13} aria-hidden="true" />JSON</Button></div>
    </div>;
}

export function StatisticsPanel({ data, stats, preferences, units = "metric", events, elapsed = 0 }: { data: MatchData; stats: Statistics; preferences: Preferences; units?: Units; events?: readonly MatchEvent[]; elapsed?: number }) {
    const { language, mode, player: playerId } = preferences;
    const player = data.players.find(p => p.player_id === playerId), personal = stats.players[playerId] ?? emptyMetrics(), quality = stats.quality.players[playerId] ?? emptyQuality();
    return <section className="panel stats-panel" id="statistics"><div className="panel-heading"><div className="heading-icon"><BarChart3 size={17} /><h2>{tr(language, "matchStatistics")}</h2></div><span className="micro-label">{tr(language, "eventDerived")}</span></div>{mode === "player" && <div className="player-summary"><span className="player-avatar"><UserRound size={20} /></span><div><strong>{player?.name ?? tr(language, "chooseAPlayer")}</strong><p>{player?.position ?? ""} · {tr(language, "recordedContributions")}</p></div><div className="personal-numbers"><span><b>{personal.goals}</b>{tr(language, "goals")}</span><span><b>{personal.shots}</b>{tr(language, "shots")}</span><span><b>{personal.passes_completed}/{personal.passes_attempted}</b>{tr(language, "passes")}</span><span><b>{personal.tackles_won}</b>{tr(language, "tacklesWon2")}</span><span><b>{personal.pressure_events}</b>{tr(language, "pressures")}</span><span><b>{personal.actions}</b>{tr(language, "actions")}</span><span><b>{quality.pass_distance_count ? distanceText(averagePassDistance(quality), units) : "—"}</b>{tr(language, "averagePassShort")}</span><span><b>{quality.long_passes_completed}/{quality.long_passes_attempted}</b>{tr(language, "longPassesShort")}</span><span><b>{quality.difficult_passes_completed}/{quality.difficult_passes_attempted}</b>{tr(language, "difficultPassesShort")}</span><span><b>{quality.shot_speed_count ? speedText(quality.shot_speed_max, units) : "—"}</b>{tr(language, "fastestShotShort")}</span></div></div>}<Comparison data={data} stats={stats} language={language} units={units} />{mode === "analyst" && events && <AnalystQuality data={data} stats={stats} events={events} elapsed={elapsed} language={language} />}<p className="data-note">{tr(language, "statisticsDataNote")}</p></section>;
}
