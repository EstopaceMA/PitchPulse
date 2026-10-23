import { pitchPosition } from "./playback";
import type { MatchData, MatchEvent, Player, Position } from "./types";

export type MotionFrame = {
    time: number;
    sequence: number;
    eventId?: string;
    players: { playerId: string; position: Position; active: boolean }[];
    ball: Position | null;
};

type Role = "GK" | "RB" | "CB" | "LB" | "DM" | "CM" | "RW" | "ST" | "LW";
const DEFAULT_ROLES: readonly Role[] = ["GK", "RB", "CB", "CB", "LB", "DM", "CM", "CM", "RW", "ST", "LW"];
// Team-relative, compact 4-3-3 starting shape. Repeated roles share their lane.
const FORMATION: Record<Role, { x: number; minY: number; maxY: number }> = {
    GK: { x: 7, minY: 46, maxY: 54 },
    RB: { x: 23, minY: 12, maxY: 24 },
    CB: { x: 21, minY: 34, maxY: 66 },
    LB: { x: 23, minY: 76, maxY: 88 },
    DM: { x: 34, minY: 44, maxY: 56 },
    CM: { x: 41, minY: 30, maxY: 70 },
    RW: { x: 48, minY: 10, maxY: 24 },
    ST: { x: 48, minY: 42, maxY: 58 },
    LW: { x: 48, minY: 76, maxY: 90 },
};
const PLAYER_TWEEN_SECONDS = 6;
// Presentation time only: deliberately unrelated to any recorded speed metric.
const BALL_TWEEN_SECONDS = 2;

type LayoutPlayer = {
    playerId: string;
    teamId: string;
    base: Position;
    direction: 1 | -1;
    phase: number;
    keeper: boolean;
};
type BallPath = { time: number; from: Position; to: Position; duration: number };
type Segment = {
    time: number;
    sequence: number;
    eventId?: string;
    stopAt: number;
    moving: boolean;
    // Four packed numbers per player: start x/y, target x/y. No event references.
    paths: Float64Array;
    actor: number;
    related: number;
    ball: BallPath | null;
};
type TimelineState = { duration: number; players: readonly LayoutPlayer[]; segments: readonly Segment[] };
const timelineState: unique symbol = Symbol("illustrative movement timeline");

/** Opaque, reusable snapshot. Construct with buildMovementTimeline; do not modify. */
export interface MovementTimeline {
    readonly [timelineState]: TimelineState;
}

function clamp(value: number, low = 0, high = 100): number {
    return Math.max(low, Math.min(high, value));
}

function bounded(x: number, y: number): Position {
    return { x: clamp(x), y: clamp(y) };
}

/** Reject unusable source coordinates instead of manufacturing a recorded anchor. */
function recordedPosition(value: Position | undefined, teamId: string | null, homeId: string): Position | null {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)
        || value.x < 0 || value.x > 100 || value.y < 0 || value.y > 100) return null;
    return pitchPosition({ x: value.x, y: value.y }, teamId, homeId);
}

function layoutPlayers(players: readonly Player[], homeId: string): LayoutPlayer[] {
    const teams = new Map<string, { size: number; counts: Map<Role, number>; used: Map<Role, number> }>();
    const assigned = players.map((player) => {
        let team = teams.get(player.team_id);
        if (!team) {
            team = { size: 0, counts: new Map(), used: new Map() };
            teams.set(player.team_id, team);
        }
        const ordinal = team.size++;
        const label = player.position?.trim().toUpperCase();
        const role: Role = label && Object.hasOwn(FORMATION, label)
            ? label as Role : DEFAULT_ROLES[ordinal % DEFAULT_ROLES.length];
        team.counts.set(role, (team.counts.get(role) ?? 0) + 1);
        return { player, team, ordinal, role };
    });
    return assigned.map(({ player, team, ordinal, role }) => {
        const slot = team.used.get(role) ?? 0;
        team.used.set(role, slot + 1);
        const count = team.counts.get(role)!;
        const lane = FORMATION[role];
        return {
            playerId: player.player_id,
            teamId: player.team_id,
            base: { x: lane.x, y: lane.minY + (lane.maxY - lane.minY) * (count === 1 ? 0.5 : slot / (count - 1)) },
            direction: player.team_id === homeId ? 1 : -1,
            phase: ordinal * 2.399963229728653,
            keeper: role === "GK",
        };
    });
}

function worldPosition(local: Position, player: LayoutPlayer): Position {
    return player.direction === 1 ? { ...local } : { x: 100 - local.x, y: 100 - local.y };
}

function motionTime(segment: Segment, elapsed: number): number {
    return segment.moving ? Math.max(segment.time, Math.min(elapsed, segment.stopAt)) : segment.time;
}

function playerPositions(segment: Segment, players: readonly LayoutPlayer[], elapsed: number): Float64Array {
    const age = motionTime(segment, elapsed) - segment.time;
    const progress = clamp(age / PLAYER_TWEEN_SECONDS, 0, 1);
    const ease = progress * progress * (3 - 2 * progress);
    const positions = new Float64Array(players.length * 2);
    for (let i = 0; i < players.length; i++) {
        const offset = i * 4;
        const x = segment.paths[offset], y = segment.paths[offset + 1];
        if (!segment.moving || age === 0) {
            positions[i * 2] = x;
            positions[i * 2 + 1] = y;
            continue;
        }
        const player = players[i];
        // Small continuing lane adjustments keep the whole shape alive between actions.
        // They are illustrative, not tracking, running distances, or possession evidence.
        const amplitude = i === segment.actor || i === segment.related ? 0.25 : player.keeper ? 0.4 : 1.6;
        const dx = Math.sin(age * 0.32 + player.phase) * amplitude * player.direction;
        const dy = Math.cos(age * 0.23 + player.phase) * amplitude * 0.75 * player.direction;
        const targetX = clamp(segment.paths[offset + 2] + dx);
        const targetY = clamp(segment.paths[offset + 3] + dy);
        positions[i * 2] = x + (targetX - x) * ease;
        positions[i * 2 + 1] = y + (targetY - y) * ease;
    }
    return positions;
}

function ballPosition(segment: Segment, elapsed: number): Position | null {
    const path = segment.ball;
    if (!path) return null;
    const progress = path.duration === 0 ? 0 : clamp((motionTime(segment, elapsed) - path.time) / path.duration, 0, 1);
    return {
        x: path.from.x + (path.to.x - path.from.x) * progress,
        y: path.from.y + (path.to.y - path.from.y) * progress,
    };
}

function stationaryBall(position: Position | null, time: number): BallPath | null {
    return position ? { time, from: position, to: position, duration: 0 } : null;
}

function formationTarget(player: LayoutPlayer, ball: Position | null, possessionTeam: string | null): Position {
    // Rotation is its own inverse: convert the ball to this player's team-relative space.
    const focus = ball ? worldPosition(ball, player) : { x: 50, y: 50 };
    const advance = player.keeper ? 0 : possessionTeam === player.teamId ? 8 : possessionTeam ? -3 : 2;
    const x = player.base.x + advance + (focus.x - 50) * (player.keeper ? 0.04 : 0.28);
    const y = player.base.y + (focus.y - 50) * (player.keeper ? 0.07 : 0.17);
    return worldPosition({ x: clamp(x, 2, 98), y: clamp(y, 2, 98) }, player);
}

/** Team-relative 4-3-3 lane anchors by player ID: the slots the illustrative movement starts from. */
export function formationAnchors(players: readonly Player[]): Map<string, Position> {
    // Anchors are team-relative; the home team only sets drawing direction, which anchors don't use.
    return new Map(layoutPlayers(players, "").map(player => [player.playerId, player.base]));
}

/**
 * Build from the already-processed, sequence-ordered prefix ONLY. Never reads
 * data.events, summaries, or later events to choose a target or tween duration.
 * Timestamps must be nondecreasing and sequences strictly increasing; malformed
 * ordering is rejected rather than sorted (including equal-time boundary events).
 *
 * All player paths are illustrative formations, NOT reconstructed tracking.
 * Keep names in data.players and statistics/event-only anchors in their existing
 * pipelines. Memoize this snapshot when the processed prefix changes, then sample
 * it using the shared playback elapsed. For a pinned event use slice(0, index + 1)
 * and that event's match_time_seconds, not the complete match's timeline.
 *
 * O(events * players + events + players) time/storage. Packed paths use 32 bytes
 * per player per event (~35 MB for 50,000 events / 22 players, plus metadata).
 */
export function buildMovementTimeline(data: MatchData, events: readonly MatchEvent[]): MovementTimeline {
    const homeId = data.match.home_team_id;
    const duration = Number.isFinite(data.match.duration_seconds) ? Math.max(0, data.match.duration_seconds) : 0;
    const half = Number.isFinite(data.match.period_seconds) ? clamp(data.match.period_seconds, 0, duration) : duration / 2;
    const players = layoutPlayers(data.players, homeId);
    const indices = new Map(players.map((player, index) => [player.playerId, index]));
    const initialPaths = new Float64Array(players.length * 4);
    players.forEach((player, i) => {
        const position = worldPosition(player.base, player);
        initialPaths.set([position.x, position.y, position.x, position.y], i * 4);
    });
    const segments: Segment[] = [{
        time: 0, sequence: 0, stopAt: 0, moving: false,
        paths: initialPaths, actor: -1, related: -1, ball: null,
    }];
    let possessionTeam: string | null = null;
    let lastSequence = -1;
    for (const event of events) {
        const previous = segments[segments.length - 1];
        const time = event.match_time_seconds;
        if (!Number.isFinite(time) || time < previous.time || time > duration
            || !Number.isInteger(event.sequence) || event.sequence < 0 || event.sequence <= lastSequence) {
            throw new RangeError("Movement events must have in-match, nondecreasing timestamps and increasing sequences.");
        }
        lastSequence = event.sequence;
        // Crucial: sample the interrupted trajectory, never its unfinished target.
        const from = playerPositions(previous, players, time);
        const previousBall = ballPosition(previous, time);
        const stopped = event.type === "half_time" || event.type === "full_time";
        const control = stopped || event.type === "match_start" || event.type === "second_half_start";
        const actor = control ? -1 : indices.get(event.player_id ?? "") ?? -1;
        const teamId = event.team_id ?? players[actor]?.teamId ?? null;
        const defensive = event.type === "pressure" || event.type === "tackle";
        let related = -1;
        if (event.type === "pass" && event.outcome === "complete") {
            const recipient = indices.get(event.recipient_player_id ?? "") ?? -1;
            if (players[recipient]?.teamId === teamId) related = recipient;
        } else if (defensive) {
            const target = indices.get(event.target_player_id ?? "") ?? -1;
            if (target >= 0 && teamId && players[target].teamId !== teamId) related = target;
        }
        if (!control) {
            if (defensive) {
                // Pressure/unsuccessful tackles do not establish a possession change.
                // A named target supplies proximity context, not a new ball winner.
                if (event.type === "tackle" && event.outcome === "won") possessionTeam = teamId;
            } else if (teamId) possessionTeam = teamId;
        }
        const position = recordedPosition(event.position, teamId, homeId);
        const startPosition = recordedPosition(event.start_position, teamId, homeId);
        const start = event.type === "pass" ? startPosition ?? position : position ?? startPosition;
        const end = event.type === "pass" || event.type === "shot"
            ? recordedPosition(event.end_position, teamId, homeId) : null;
        const focus = end ?? start ?? previousBall;
        let ball = previous.ball;
        if (stopped) ball = stationaryBall(previousBall, time);
        else if (start) {
            // A shot without an explicit end stays at the actual shot location, even
            // when outcome=goal. Missing pass origins never create an invented flight.
            ball = end ? { time, from: start, to: end, duration: BALL_TWEEN_SECONDS } : stationaryBall(start, time);
        }
        const paths = new Float64Array(players.length * 4);
        players.forEach((player, i) => {
            let target = formationTarget(player, focus, possessionTeam);
            if (i === actor && start) {
                target = defensive && related >= 0 ? bounded(start.x - player.direction * 1.5, start.y) : start;
            } else if (i === related) {
                if (defensive && start) {
                    const direction = teamId === homeId ? 1 : -1;
                    target = bounded(start.x + direction * 1.5, start.y);
                } else if (end) target = end;
            }
            paths.set([from[i * 2], from[i * 2 + 1], target.x, target.y], i * 4);
        });
        segments.push({
            time, sequence: event.sequence, eventId: event.event_id,
            stopAt: event.period === 1 ? half : duration, moving: !stopped,
            paths, actor, related, ball,
        });
    }
    return { [timelineState]: { duration, players, segments } };
}

/**
 * Stateless O(log(events) + players) sampling, safe in any call order. Returns
 * fresh positions; identical elapsed gives identical frames, including pauses.
 * The latest supplied event at/before elapsed wins, even at a shared timestamp.
 * No-event frames use sequence=0 and omit eventId. Nonfinite elapsed samples 0;
 * finite elapsed is clamped to the match duration. Period-one extrapolation
 * stops at half-time until a period-two event is supplied; stop controls freeze
 * immediately. Frame.time remains the requested clamped playback clock.
 *
 * Player positions are continuous across target changes (velocity need not be).
 * The ball re-anchors to new recorded observations and may jump between actions;
 * its two-second pass/explicit-shot flights are illustrative, not measured.
 */
export function sampleMovement(timeline: MovementTimeline, elapsed: number): MotionFrame {
    const { duration, players, segments } = timeline[timelineState];
    const time = Number.isFinite(elapsed) ? clamp(elapsed, 0, duration) : 0;
    let low = 0, high = segments.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (segments[middle].time <= time) low = middle + 1;
        else high = middle;
    }
    const segment = segments[Math.max(0, low - 1)];
    const positions = playerPositions(segment, players, time);
    return {
        time,
        sequence: segment.sequence,
        ...(segment.eventId === undefined ? {} : { eventId: segment.eventId }),
        players: players.map((player, i) => ({
            playerId: player.playerId,
            position: { x: positions[i * 2], y: positions[i * 2 + 1] },
            active: i === segment.actor || i === segment.related,
        })),
        ball: ballPosition(segment, time),
    };
}