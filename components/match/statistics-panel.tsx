import { BarChart3, UserRound } from "lucide-react";
import { accuracy, emptyMetrics } from "@/lib/match/statistics";
import { initials, tr } from "@/lib/match/presentation";
import type { Language, MatchData, Metrics, Preferences, Statistics } from "@/lib/match/types";

export function Comparison({ data, stats, language }: { data: MatchData; stats: Statistics; language: Language }) {
    const home = stats.teams[data.match.home_team_id], away = stats.teams[data.match.away_team_id];
    const rows: { label: string; key?: keyof Metrics; values?: number[]; suffix?: string }[] = [
        { label: tr(language, "Goals", "Mga gol"), key: "goals" },
        { label: tr(language, "Shots", "Mga tira"), key: "shots" },
        { label: tr(language, "Shots on target", "Mga tirang sa target"), key: "shots_on_target" },
        { label: tr(language, "Passes attempted", "Mga sinubukang pasa"), key: "passes_attempted" },
        { label: tr(language, "Passes completed", "Mga kumpletong pasa"), key: "passes_completed" },
        { label: tr(language, "Pass accuracy", "Katumpakan ng pasa"), values: [accuracy(home), accuracy(away)], suffix: "%" },
        { label: tr(language, "Tackles won", "Mga matagumpay na agaw"), key: "tackles_won" },
        { label: tr(language, "Pressure events", "Mga pagdiin"), key: "pressure_events" },
    ];
    return <div className="comparison"><div className="comparison-teams"><span><i className="tiny-dot home-dot" />{initials(data.match.home_team_id)}</span><span className="micro-label">{tr(language, "MATCH TOTALS", "KABUUAN NG LABAN")}</span><span>{initials(data.match.away_team_id)}<i className="tiny-dot away-dot" /></span></div>{rows.map(row => {
        const [a, b] = row.values ?? [home[row.key!], away[row.key!]];
        const total = a + b || 1;
        return <div className="stat-row" key={row.label}><div className="stat-numbers"><strong>{row.suffix ? a.toFixed(1) : a}{row.suffix}</strong><span>{row.label}</span><strong>{row.suffix ? b.toFixed(1) : b}{row.suffix}</strong></div><div className="comparison-track"><span style={{ width: `${a / total * 100}%` }} /><span style={{ width: `${b / total * 100}%` }} /></div></div>;
    })}</div>;
}

export function StatisticsPanel({ data, stats, preferences }: { data: MatchData; stats: Statistics; preferences: Preferences }) {
    const { language, mode, player: playerId } = preferences;
    const player = data.players.find(p => p.player_id === playerId), personal = stats.players[playerId] ?? emptyMetrics();
    return <section className="panel stats-panel" id="statistics"><div className="panel-heading"><div className="heading-icon"><BarChart3 size={17} /><h2>{tr(language, "Match statistics", "Estadistika ng laban")}</h2></div><span className="micro-label">{tr(language, "EVENT-DERIVED", "MULA SA AKSIYON")}</span></div>{mode === "player" && <div className="player-summary"><span className="player-avatar"><UserRound size={20} /></span><div><strong>{player?.name ?? tr(language, "Choose a player", "Pumili ng manlalaro")}</strong><p>{player?.position ?? ""} · {tr(language, "Recorded contributions", "Mga naitalang ambag")}</p></div><div className="personal-numbers"><span><b>{personal.goals}</b>{tr(language, "goals", "gol")}</span><span><b>{personal.shots}</b>{tr(language, "shots", "tira")}</span><span><b>{personal.passes_completed}/{personal.passes_attempted}</b>{tr(language, "passes", "pasa")}</span><span><b>{personal.tackles_won}</b>{tr(language, "tackles won", "agaw")}</span><span><b>{personal.pressure_events}</b>{tr(language, "pressures", "pagdiin")}</span><span><b>{personal.actions}</b>{tr(language, "actions", "aksiyon")}</span></div></div>}<Comparison data={data} stats={stats} language={language} /><p className="data-note">{tr(language, "Goals count as shots. No possession or distance estimates.", "Kasama ang gol sa mga tira. Walang tantiya ng possession o distansiya.")}</p></section>;
}