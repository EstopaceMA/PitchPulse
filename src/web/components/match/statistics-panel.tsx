import { BarChart3, UserRound } from "lucide-react";
import { accuracy, emptyMetrics } from "@/lib/match/statistics";
import { initials, tr } from "@/lib/match/presentation";
import type { Language, MatchData, Metrics, Preferences, Statistics } from "@/lib/match/types";

export function Comparison({ data, stats, language }: { data: MatchData; stats: Statistics; language: Language }) {
    const home = stats.teams[data.match.home_team_id], away = stats.teams[data.match.away_team_id];
    const rows: { label: string; key?: keyof Metrics; values?: number[]; suffix?: string }[] = [
        { label: tr(language, "goals2"), key: "goals" },
        { label: tr(language, "shots2"), key: "shots" },
        { label: tr(language, "shotsOnTarget"), key: "shots_on_target" },
        { label: tr(language, "passesAttempted"), key: "passes_attempted" },
        { label: tr(language, "passesCompleted"), key: "passes_completed" },
        { label: tr(language, "passAccuracy"), values: [accuracy(home), accuracy(away)], suffix: "%" },
        { label: tr(language, "tacklesWon"), key: "tackles_won" },
        { label: tr(language, "pressureEvents"), key: "pressure_events" },
    ];
    return <div className="comparison"><div className="comparison-teams" dir="ltr"><span><i className="tiny-dot home-dot" />{initials(data.match.home_team_id)}</span><span className="micro-label">{tr(language, "matchTotals")}</span><span>{initials(data.match.away_team_id)}<i className="tiny-dot away-dot" /></span></div>{rows.map(row => {
        const [a, b] = row.values ?? [home[row.key!], away[row.key!]];
        const total = a + b || 1;
        return <div className="stat-row" key={row.label}><div className="stat-numbers" dir="ltr"><strong>{row.suffix ? a.toFixed(1) : a}{row.suffix}</strong><span>{row.label}</span><strong>{row.suffix ? b.toFixed(1) : b}{row.suffix}</strong></div><div className="comparison-track" dir="ltr"><span style={{ width: `${a / total * 100}%` }} /><span style={{ width: `${b / total * 100}%` }} /></div></div>;
    })}</div>;
}

export function StatisticsPanel({ data, stats, preferences }: { data: MatchData; stats: Statistics; preferences: Preferences }) {
    const { language, mode, player: playerId } = preferences;
    const player = data.players.find(p => p.player_id === playerId), personal = stats.players[playerId] ?? emptyMetrics();
    return <section className="panel stats-panel" id="statistics"><div className="panel-heading"><div className="heading-icon"><BarChart3 size={17} /><h2>{tr(language, "matchStatistics")}</h2></div><span className="micro-label">{tr(language, "eventDerived")}</span></div>{mode === "player" && <div className="player-summary"><span className="player-avatar"><UserRound size={20} /></span><div><strong>{player?.name ?? tr(language, "chooseAPlayer")}</strong><p>{player?.position ?? ""} · {tr(language, "recordedContributions")}</p></div><div className="personal-numbers"><span><b>{personal.goals}</b>{tr(language, "goals")}</span><span><b>{personal.shots}</b>{tr(language, "shots")}</span><span><b>{personal.passes_completed}/{personal.passes_attempted}</b>{tr(language, "passes")}</span><span><b>{personal.tackles_won}</b>{tr(language, "tacklesWon2")}</span><span><b>{personal.pressure_events}</b>{tr(language, "pressures")}</span><span><b>{personal.actions}</b>{tr(language, "actions")}</span></div></div>}<Comparison data={data} stats={stats} language={language} /><p className="data-note">{tr(language, "goalsCountAsShotsNoPossessionOrDistance")}</p></section>;
}
