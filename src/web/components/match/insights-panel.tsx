import { ArrowUpRight, ChevronDown, Flame, Goal, Hourglass, Lightbulb, ShieldCheck, Sparkles, TrendingUp, UserRound, Waves, Zap } from "lucide-react";
import { formatTime } from "@/lib/match/playback";
import { teamColor, tr } from "@/lib/match/presentation";
import type { Insight, MatchData, Preferences } from "@/lib/match/types";

const RULE_ICONS: Partial<Record<Insight["rule"], typeof ArrowUpRight>> = { shots: TrendingUp, recoveries: Zap, player: UserRound, goal_context: Goal, drought: Hourglass, pressing: Flame, momentum: Waves };

export function InsightCard({ insight, preferences, onEvidence, compact = false }: { insight: Insight; preferences: Preferences; onEvidence: (id: string) => void; compact?: boolean }) {
    const l = preferences.language, detailed = preferences.mode === "analyst", ai = insight.source === "foundry";
    const Icon = ai ? Sparkles : RULE_ICONS[insight.rule] ?? ArrowUpRight;
    const label = ai ? tr(l, "aiAnalysis2") : insight.rule === "player" ? tr(l, "playerImpact") : insight.rule === "goal_context" || insight.rule === "drought" ? tr(l, "whyItMatters") : tr(l, "matchPattern");
    // A capped evidence list always states the full count instead of implying it is complete.
    const supporting = insight.evidenceTotal && insight.evidenceTotal > insight.eventIds.length
        ? tr(l, "latestSupportingEventsLower", { shown: insight.eventIds.length, total: insight.evidenceTotal })
        : `${insight.eventIds.length} ${tr(l, "supportingEvents")}`;
    return <article className={`insight-card ${compact ? "compact" : ""} ${ai ? "ai" : ""}`}><div className="insight-topline"><span className={`insight-icon ${ai ? "agent" : insight.rule}`}><Icon size={16} /></span><span className="micro-label">{label}</span><time>{formatTime(insight.at)}</time></div><h3>{insight.headline}</h3><p>{detailed ? insight.explanation : insight.casual}</p><div className="insight-metrics">{insight.metrics.map((metric, i) => <span key={i}><b>{metric.value}</b> {metric.label}</span>)}</div><div className="insight-window">{formatTime(insight.from)}–{formatTime(insight.at)} <span>· {supporting}</span></div>{detailed && <p className="inference"><b>{tr(l, "possibleMeaning")}</b>{insight.interpretation}</p>}<details className="evidence"><summary>{tr(l, "whyThisInsight")}<ChevronDown size={13} /></summary><p><b>{tr(l, "observed")}</b>{insight.explanation}</p><p><b>{tr(l, "interpretationNotACertainty")}</b>{insight.interpretation}</p><div className="evidence-ids">{insight.eventIds.map(id => <button type="button" key={id} onClick={() => onEvidence(id)}>{id}</button>)}</div></details></article>;
}

export function InsightsPanel({ data, insights, elapsed, preferences, onEvidence, aiConnected = false }: { data: MatchData; insights: Insight[]; elapsed: number; preferences: Preferences; onEvidence: (id: string) => void; aiConnected?: boolean }) {
    const l = preferences.language;
    const unique = new Map<string, Insight>();
    for (const insight of insights) {
        if (elapsed - insight.at > 600) continue;
        if (preferences.mode === "player" && insight.playerId !== preferences.player) continue;
        unique.set(`${insight.rule}:${insight.teamId}:${insight.playerId ?? ""}`, insight);
    }
    const visible = [...unique.values()].sort((a, b) => Number(b.teamId === preferences.team) - Number(a.teamId === preferences.team) || b.at - a.at).slice(0, 4);
    return <section className="panel insight-panel" id="insights"><div className="panel-heading"><div className="heading-icon purple-text"><Sparkles size={17} /><h2>{tr(l, "beyondTheScore")}</h2></div><span className="rule-badge">{tr(l, "ruleBased")}</span></div><div className="insight-intro"><p>{tr(l, "thePatternsBehindThePlay")}</p><span><i className="tiny-dot" style={{ background: teamColor(preferences.team, data.match.home_team_id) }} />{data.teams.find(t => t.team_id === preferences.team)?.name} {tr(l, "first")}</span></div><div className="insight-list">{visible.length ? visible.map(insight => <InsightCard key={insight.id} insight={insight} preferences={preferences} onEvidence={onEvidence} />) : <div className="insights-empty"><div className="empty-orbit"><Lightbulb size={25} /></div><h3>{tr(l, "letTheGameTellItsStory")}</h3><p>{preferences.mode === "player" ? tr(l, "aPlayerInsightAppearsAfterFourRecentActions") : tr(l, "asEventsUnfoldWeLlConnectTheDots")}</p><div className="empty-rule"><span><Zap size={14} />{tr(l, "highRecoveries")}</span><span><TrendingUp size={14} />{tr(l, "shotPatterns")}</span><span><ArrowUpRight size={14} />{tr(l, "passingShifts")}</span></div></div>}</div><div className="insight-footer"><ShieldCheck size={14} /><span>{aiConnected ? tr(l, "transparentRulesAiAnalysisIsSeparateAndLabeled") : tr(l, "transparentRulesNoAiServiceConnected")}</span></div></section>;
}
