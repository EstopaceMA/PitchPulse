import { formationAnchors } from "@/lib/match/movement";
import type { MatchEvent, Player } from "@/lib/match/types";

type SourceEvent = MatchEvent & { related_event_id?: string };
export interface ShotRealignment { shot: string; from: string; to: string; edited: string[] }

const DEFENDERS = new Set(["CB", "LB", "RB"]);
const ATTACKERS = ["RW", "ST", "LW"], MIDFIELDERS = ["CM", "DM"];
// The penalty-area line on the documented 105 x 68 m pitch, in team-relative x.
const PENALTY_AREA_X = (105 - 16.5) / 105 * 100;

/**
 * Hands each shot the simulation gave to a defender to a forward (inside the penalty area) or a midfielder
 * (outside it) of the same team: the one whose formation lane is nearest the shot, never the player who fed it.
 * The move that gave the shooter the ball moves too: the feeding pass's recipient, or the ball win (possession
 * change and its tackle), plus opponents' pressure on the shooter in between. Event IDs, times, positions,
 * outcomes and team totals never change, and once no defender shots remain nothing changes.
 */
export function realignDefenderShots<E extends SourceEvent>(players: readonly Player[], source: readonly E[]): { events: E[]; changes: ShotRealignment[] } {
    const roles = new Map(players.map(player => [player.player_id, player.position ?? ""]));
    const anchors = formationAnchors(players);
    const events = source.map(event => ({ ...event }));
    const ids = new Map(events.map((event, index) => [event.event_id, index]));
    const order = [...events.keys()].sort((a, b) => events[a].sequence - events[b].sequence);
    const changes: ShotRealignment[] = [];
    for (const [step, at] of order.entries()) {
        const shot = events[at], shooter = shot.player_id;
        if (shot.type !== "shot" || !shooter || !DEFENDERS.has(roles.get(shooter) ?? "")) continue;
        // Walk back through the shot's possession to the move that gave the shooter the ball.
        let opener = -1;
        for (let back = step - 1; back >= 0 && events[order[back]].possession_id === shot.possession_id; back--) {
            const event = events[order[back]];
            if ((event.type === "pass" && event.team_id === shot.team_id && event.recipient_player_id === shooter) || (event.type === "possession_change" && event.player_id === shooter)) { opener = back; break; }
        }
        const start = opener >= 0 ? events[order[opener]] : null;
        const passer = start?.type === "pass" ? start.player_id : null;
        const y = shot.position?.y ?? 50;
        const pick = (group: readonly string[]) => players
            .filter(player => player.team_id === shot.team_id && group.includes(player.position ?? "") && player.player_id !== passer)
            .sort((a, b) => Math.abs(anchors.get(a.player_id)!.y - y) - Math.abs(anchors.get(b.player_id)!.y - y))[0]?.player_id;
        const inBox = (shot.position?.x ?? 0) >= PENALTY_AREA_X;
        const taker = pick(inBox ? ATTACKERS : MIDFIELDERS) ?? pick(inBox ? MIDFIELDERS : ATTACKERS);
        if (!taker) throw new Error(`${shot.event_id}: ${shot.team_id} has no forward or midfielder to take this shot.`);

        const edited = [at];
        shot.player_id = taker;
        if (start?.type === "pass") {
            start.recipient_player_id = taker;
            edited.push(order[opener]);
        } else if (start) {
            start.player_id = taker;
            edited.push(order[opener]);
            const tackle = start.related_event_id !== undefined ? ids.get(start.related_event_id) : undefined;
            if (tackle !== undefined && events[tackle].player_id === shooter && events[tackle].team_id === shot.team_id) {
                events[tackle].player_id = taker;
                edited.push(tackle);
            }
        }
        for (let between = opener >= 0 ? opener + 1 : step; between < step; between++) {
            const event = events[order[between]];
            if (event.team_id !== shot.team_id && event.target_player_id === shooter) {
                event.target_player_id = taker;
                edited.push(order[between]);
            }
        }
        changes.push({ shot: shot.event_id, from: shooter, to: taker, edited: edited.map(index => events[index].event_id).sort() });
    }
    return { events, changes };
}
