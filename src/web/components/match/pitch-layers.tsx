import { formatTime, pitchPosition } from "@/lib/match/playback";
import { bandLabel, distanceText, outcomeLabel, speedText, teamColor, tr } from "@/lib/match/presentation";
import { DIFFICULT_PASS_RATING, difficultyBand, LONG_PASS_METRES } from "@/lib/match/statistics";
import type { Language, MatchData, MatchEvent, Position, Units } from "@/lib/match/types";

export const PITCH_LAYERS = ["none", "shots", "passes"] as const;
export type PitchLayer = (typeof PITCH_LAYERS)[number];
const PASS_LIMIT = 150;
const screen = (p: Position) => ({ x: 38 + p.x * 6.84, y: 34 + p.y * 4.42 });

/**
 * Analyst overlays drawn under the player markers from recorded positions only: a shot map sized by the
 * illustrative synthetic xG, or the long and difficult passes. Optional `playerId` narrows to one player.
 */
export function PitchLayers({ data, events, layer, playerId, language, units = "metric" }: { data: MatchData; events: readonly MatchEvent[]; layer: PitchLayer; playerId?: string; language: Language; units?: Units }) {
    if (layer === "none") return null;
    const home = data.match.home_team_id;
    const name = (id: string | null) => data.players.find(player => player.player_id === id)?.name ?? "";
    const own = (event: MatchEvent) => !playerId || event.player_id === playerId;
    if (layer === "shots") {
        const shots = events.filter(event => event.type === "shot" && event.position && own(event));
        return <g className="pitch-layer" data-layer="shots" role="img" aria-label={tr(language, "shotMapSummary", { count: shots.length })}>
            {shots.map(event => {
                const p = screen(pitchPosition(event.position!, event.team_id, home)), color = teamColor(event.team_id, home), goal = event.outcome === "goal";
                const details = [formatTime(event.match_time_seconds), name(event.player_id), outcomeLabel(event, language), event.shot_speed_kmh !== undefined ? speedText(event.shot_speed_kmh, units) : null, event.synthetic_xg !== undefined ? `${tr(language, "syntheticXgIllustrativeEstimate")} ${event.synthetic_xg}` : null];
                return <circle key={event.event_id} data-event-id={event.event_id} cx={p.x} cy={p.y} r={5 + Math.min(.5, event.synthetic_xg ?? .05) * 40} fill={color} fillOpacity={goal ? .6 : .12} stroke={color} strokeWidth={goal ? 2.2 : 1.3} strokeDasharray={event.outcome === "blocked" || event.outcome === "off_target" ? "3 3" : undefined}><title>{details.filter(Boolean).join(" · ")}</title></circle>;
            })}
        </g>;
    }
    const passes = events.filter(event => event.type === "pass" && own(event) && event.start_position && event.end_position && ((event.distance_m ?? 0) >= LONG_PASS_METRES || (event.difficulty_rating ?? 0) >= DIFFICULT_PASS_RATING)).slice(-PASS_LIMIT);
    return <g className="pitch-layer" data-layer="passes" role="img" aria-label={tr(language, "passMapSummary", { count: passes.length })}>
        {passes.map(event => {
            const a = screen(pitchPosition(event.start_position!, event.team_id, home)), b = screen(pitchPosition(event.end_position!, event.team_id, home));
            const complete = event.outcome === "complete", color = teamColor(event.team_id, home);
            const details = [formatTime(event.match_time_seconds), name(event.player_id), outcomeLabel(event, language), event.distance_m !== undefined ? distanceText(event.distance_m, units) : null, event.difficulty_rating !== undefined ? bandLabel(difficultyBand(event.difficulty_rating), language) : null];
            return <g key={event.event_id} data-event-id={event.event_id}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeOpacity={complete ? .75 : .45} strokeWidth="1.6" strokeDasharray={complete ? undefined : "4 4"}><title>{details.filter(Boolean).join(" · ")}</title></line>
                <circle cx={b.x} cy={b.y} r="2.6" fill={complete ? color : "none"} stroke={color} strokeOpacity=".8" />
            </g>;
        })}
    </g>;
}
