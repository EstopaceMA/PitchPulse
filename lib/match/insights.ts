import { formatTime } from "./playback";
import type { Insight, InsightProvider, Language, MatchData, MatchEvent } from "./types";

const WINDOW_SECONDS = 300;
const COOLDOWN_SECONDS = 180;
const HISTORY_LIMIT = 200;
const MIN_PASS_ATTEMPTS = 5;
const MIN_PASS_CHANGE_PP = 10;
const MIN_PLAYER_ACTIONS = 4;

type Translation = Record<Language, string>;
const translated = (en: string, fil: string): Translation => ({ en, fil });
const metric = (en: string, fil: string, value: string): Insight["metrics"][number] => ({ label: translated(en, fil), value });
const range = (from: number, to: number): string => `${formatTime(from)}–${formatTime(to)}`;
const completedPass = (event: MatchEvent): number => Number(event.type === "pass" && event.outcome === "complete");
const goal = (event: MatchEvent): number => Number(event.type === "shot" && event.outcome === "goal");

/** Coordinates are acting-team-relative: do not rotate away-team positions here. */
function isAttackingThirdRecovery(event: MatchEvent): boolean {
    return event.type === "possession_change"
        && (event.reason === "interception" || event.reason === "tackle")
        && event.position !== undefined
        && event.position.x >= 66.67;
}

/**
 * A monotone queue with disjoint windows: recent (at - 300, at] and previous
 * (at - 600, at - 300]. An event exactly on the split belongs to previous.
 * Negative lower bounds naturally include kick-off events at zero.
 * Each event crosses each cursor once; no shifting or repeated prefix scans.
 */
class EventWindows {
    private readonly events: MatchEvent[] = [];
    private start = 0;
    private split = 0;
    recentCompleted = 0;
    previousCompleted = 0;
    recentGoals = 0;

    get recentCount(): number { return this.events.length - this.split; }
    get previousCount(): number { return this.split - this.start; }

    add(event: MatchEvent): void {
        this.events.push(event);
        this.recentCompleted += completedPass(event);
        this.recentGoals += goal(event);
    }

    advance(at: number): void {
        while (this.split < this.events.length && this.events[this.split].match_time_seconds <= at - WINDOW_SECONDS) {
            const event = this.events[this.split++];
            const completed = completedPass(event);
            this.recentCompleted -= completed;
            this.previousCompleted += completed;
            this.recentGoals -= goal(event);
        }
        while (this.start < this.split && this.events[this.start].match_time_seconds <= at - 2 * WINDOW_SECONDS) {
            this.previousCompleted -= completedPass(this.events[this.start++]);
        }
    }

    eventIds(includePrevious = false): string[] {
        const ids: string[] = [];
        for (let index = includePrevious ? this.start : this.split; index < this.events.length; index++) {
            ids.push(this.events[index].event_id);
        }
        return ids;
    }
}

interface TeamWindows {
    recoveries: EventWindows;
    shots: EventWindows;
    passes: EventWindows;
}

const teamWindows = (): TeamWindows => ({ recoveries: new EventWindows(), shots: new EventWindows(), passes: new EventWindows() });

function compareEvents(left: MatchEvent, right: MatchEvent): number {
    return left.match_time_seconds - right.match_time_seconds
        || left.sequence - right.sequence
        || (left.event_id < right.event_id ? -1 : left.event_id > right.event_id ? 1 : 0);
}

/**
 * Pure prefix replay; metadata supplies names/identity only. All evidence comes
 * from the supplied processed events, additionally capped by elapsed.
 *
 * Team rules run after every event, including expiry-only changes. Player rules
 * run on that player's own actions, never on a global "best player" selection.
 * No timers, preferences, shared cache, or playback-speed-dependent checkpoints.
 * Early windows are clipped at kick-off, explicitly noted in comparisons.
 *
 * For validated two-team imports, a call costs O(n log n) worst-case for sorting,
 * then O(n + emitted evidence). Already ordered input skips sorting. Cooldowns
 * bound the number of times each event can appear in emitted evidence. Working
 * memory is O(n + metadata), plus at most 200 retained insights.
 */
function generate(data: MatchData, events: readonly MatchEvent[], elapsed: number): Insight[] {
    if (!Number.isFinite(elapsed) || elapsed < 0 || events.length === 0) return [];

    const ordered = events.filter(event => event.match_time_seconds <= elapsed);
    if (ordered.some((event, index) => index > 0 && compareEvents(ordered[index - 1], event) > 0)) {
        ordered.sort(compareEvents);
    }

    const teamNames = new Map(data.teams.map(team => [team.team_id, team.name]));
    const playerNames = new Map(data.players.map(player => [player.player_id, player.name]));
    const teams = new Map<string, TeamWindows>();
    const players = new Map<string, EventWindows>();
    const lastEmitted = new Map<string, number>();
    // A ring buffer preserves chronological emission order without shifting history.
    const history: Insight[] = [];
    let historyStart = 0;

    for (const event of ordered) {
        const at = event.match_time_seconds;
        const recentFrom = Math.max(0, at - WINDOW_SECONDS);
        const previousFrom = Math.max(0, at - 2 * WINDOW_SECONDS);
        const recentRange = range(recentFrom, at);
        const previousRange = range(previousFrom, recentFrom);
        const earlyComparison = at < 2 * WINDOW_SECONDS;
        const earlyEn = earlyComparison ? " Windows are clipped at kick-off, so this is not yet a comparison of two full five-minute periods." : "";
        const earlyFil = earlyComparison ? " Nagsisimula lamang sa kick-off ang datos, kaya hindi pa ito paghahambing ng dalawang buong limang minuto." : "";

        // Lazy construction avoids copying evidence or formatting a card on cooldown.
        const emit = (rule: Insight["rule"], teamId: string, playerId: string | undefined, make: () => Omit<Insight, "id" | "rule" | "teamId" | "playerId" | "at">): void => {
            const key = JSON.stringify([rule, teamId, playerId ?? null]);
            if (at - (lastEmitted.get(key) ?? -Infinity) < COOLDOWN_SECONDS) return;
            const insight: Insight = {
                ...make(),
                id: JSON.stringify([data.match.match_id, rule, teamId, playerId ?? null, event.event_id]),
                rule,
                teamId,
                ...(playerId === undefined ? {} : { playerId }),
                at,
            };
            lastEmitted.set(key, at);
            if (history.length < HISTORY_LIMIT) history.push(insight);
            else {
                history[historyStart] = insight;
                historyStart = (historyStart + 1) % HISTORY_LIMIT;
            }
        };

        let actingPlayer: EventWindows | undefined;
        if (event.team_id !== null) {
            let team = teams.get(event.team_id);
            if (!team) {
                team = teamWindows();
                teams.set(event.team_id, team);
            }
            if (isAttackingThirdRecovery(event)) team.recoveries.add(event);
            if (event.type === "shot") team.shots.add(event);
            if (event.type === "pass") team.passes.add(event);

            if (event.player_id !== null) {
                const key = JSON.stringify([event.team_id, event.player_id]);
                actingPlayer = players.get(key);
                if (!actingPlayer) {
                    actingPlayer = new EventWindows();
                    players.set(key, actingPlayer);
                }
                // Count recorded acting-player actions, just as statistics.addEvent does;
                // recipients/targets do not get credited with an extra action.
                actingPlayer.add(event);
                actingPlayer.advance(at);
            }
        }

        for (const [teamId, windows] of teams) {
            const name = teamNames.get(teamId) ?? teamId;
            const { recoveries, shots, passes } = windows;
            recoveries.advance(at);
            shots.advance(at);
            passes.advance(at);

            // No unrequested minimum: even one qualifying recovery is a factual card.
            if (recoveries.recentCount > 0) {
                emit("recoveries", teamId, undefined, () => {
                    const count = recoveries.recentCount;
                    return {
                        from: recentFrom,
                        headline: translated(`Attacking-third recoveries: ${name}`, `Mga pagbawi sa attacking third: ${name}`),
                        explanation: translated(
                            `${name} recorded ${count} attacking-third ${count === 1 ? "recovery" : "recoveries"} in ${recentRange}. Only possession changes from an interception or tackle at x ≥ 66.67 count.`,
                            `Nagtala ang ${name} ng ${count} pagbawi ng bola sa attacking third sa ${recentRange}. Binibilang lamang ang possession change dahil sa interception o tackle sa x ≥ 66.67.`,
                        ),
                        casual: translated(
                            `${name} won the ball back ${count} ${count === 1 ? "time" : "times"} in the third nearest the opponent's goal during this window.`,
                            `${count} beses nabawi ng ${name} ang bola sa ikatlong bahagi ng pitch na pinakamalapit sa goal ng kalaban sa saklaw na ito.`,
                        ),
                        interpretation: translated(
                            "These recoveries may offer chances to attack closer to goal. They do not establish sustained pressure or guarantee a scoring chance.",
                            "Maaaring magbigay ang mga pagbawing ito ng pagkakataong umatake malapit sa goal. Hindi nito pinatutunayan ang tuloy-tuloy na pressure o tinitiyak ang pagkakataong makaiskor.",
                        ),
                        metrics: [metric("Attacking-third recoveries", "Mga pagbawi sa attacking third", String(count)), metric("Recent window", "Kamakailang saklaw", recentRange)],
                        eventIds: recoveries.eventIds(),
                    };
                });
            }

            if (shots.recentCount > shots.previousCount) {
                emit("shots", teamId, undefined, () => ({
                    from: previousFrom,
                    headline: translated(`More recent shots: ${name}`, `Mas maraming tira kamakailan: ${name}`),
                    explanation: translated(
                        `${name} recorded ${shots.recentCount} shots in ${recentRange}, compared with ${shots.previousCount} in ${previousRange}: an increase of ${shots.recentCount - shots.previousCount}.${earlyEn}`,
                        `Nagtala ang ${name} ng ${shots.recentCount} tira sa ${recentRange}, kumpara sa ${shots.previousCount} sa ${previousRange}: nadagdagan ng ${shots.recentCount - shots.previousCount}.${earlyFil}`,
                    ),
                    casual: translated(
                        `${name} took more shots in the recent window than in the preceding one.${earlyEn}`,
                        `Mas maraming tira ang ${name} sa kamakailang saklaw kaysa sa naunang saklaw.${earlyFil}`,
                    ),
                    interpretation: translated(
                        `This may indicate more shooting activity, not better chances or a likely goal.${earlyComparison ? " Unequal playing time in these early windows limits the comparison." : " Shot quality is not assessed by this count."}`,
                        `Maaaring mas aktibo ang pagtira, ngunit hindi ito nangangahulugang mas maganda ang mga pagkakataon o malapit nang magka-goal.${earlyComparison ? " Limitado ang paghahambing dahil hindi pa pantay ang haba ng oras ng laro sa mga saklaw." : " Hindi sinusukat ng bilang na ito ang kalidad ng mga tira."}`,
                    ),
                    metrics: [
                        metric("Recent shots", "Kamakailang mga tira", String(shots.recentCount)),
                        metric("Previous shots", "Naunang mga tira", String(shots.previousCount)),
                        metric("Increase", "Dagdag", `+${shots.recentCount - shots.previousCount}`),
                        metric("Recent window", "Kamakailang saklaw", recentRange),
                        metric("Previous window", "Naunang saklaw", previousRange),
                    ],
                    eventIds: shots.eventIds(true),
                }));
            }

            if (passes.recentCount >= MIN_PASS_ATTEMPTS && passes.previousCount >= MIN_PASS_ATTEMPTS) {
                // Compare exact integer ratios: an exact 10 pp boundary must not fail
                // due to subtracting two rounded/floating-point percentages.
                const numerator = 100 * (passes.recentCompleted * passes.previousCount - passes.previousCompleted * passes.recentCount);
                const denominator = passes.recentCount * passes.previousCount;
                if (Math.abs(numerator) >= MIN_PASS_CHANGE_PP * denominator) {
                    emit("passing", teamId, undefined, () => {
                        const recentPercent = (100 * passes.recentCompleted / passes.recentCount).toFixed(1);
                        const previousPercent = (100 * passes.previousCompleted / passes.previousCount).toFixed(1);
                        const delta = numerator / denominator;
                        const change = `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pp`;
                        return {
                            from: previousFrom,
                            headline: translated(
                                `${name}: pass completion ${delta > 0 ? "up" : "down"}`,
                                `${name}: ${delta > 0 ? "tumaas" : "bumaba"} ang porsiyento ng kumpletong pasa`,
                            ),
                            explanation: translated(
                                `${name} completed ${passes.recentCompleted}/${passes.recentCount} passes (${recentPercent}%) in ${recentRange}, versus ${passes.previousCompleted}/${passes.previousCount} (${previousPercent}%) in ${previousRange}. Change: ${change} (percentage points).${earlyEn}`,
                                `Nakumpleto ng ${name} ang ${passes.recentCompleted}/${passes.recentCount} pasa (${recentPercent}%) sa ${recentRange}, kumpara sa ${passes.previousCompleted}/${passes.previousCount} (${previousPercent}%) sa ${previousRange}. Pagbabago: ${change} (puntos-porsiyento).${earlyFil}`,
                            ),
                            casual: translated(
                                `A ${delta > 0 ? "larger" : "smaller"} share of ${name}'s recent passes reached a teammate.${earlyEn}`,
                                `${delta > 0 ? "Mas malaking" : "Mas maliit na"} bahagi ng mga kamakailang pasa ng ${name} ang umabot sa kakampi.${earlyFil}`,
                            ),
                            interpretation: translated(
                                "This may reflect a change in passing execution, but pass difficulty, pressure and the small samples could also explain it. It does not prove a tactical change.",
                                "Maaaring nagbago ang pagpasa, ngunit maaari ring dahil ito sa hirap ng mga pasa, pressure, o maliit na sample. Hindi nito pinatutunayan ang pagbabago ng taktika.",
                            ),
                            metrics: [
                                metric("Recent completion", "Kamakailang kumpletong pasa", `${passes.recentCompleted}/${passes.recentCount} (${recentPercent}%)`),
                                metric("Previous completion", "Naunang kumpletong pasa", `${passes.previousCompleted}/${passes.previousCount} (${previousPercent}%)`),
                                metric("Change (percentage points)", "Pagbabago (puntos-porsiyento)", change),
                                metric("Recent window", "Kamakailang saklaw", recentRange),
                                metric("Previous window", "Naunang saklaw", previousRange),
                            ],
                            eventIds: passes.eventIds(true),
                        };
                    });
                }
            }
        }

        if (actingPlayer && event.team_id !== null && event.player_id !== null
            && (actingPlayer.recentCount >= MIN_PLAYER_ACTIONS || actingPlayer.recentGoals > 0)) {
            const player = actingPlayer;
            const name = playerNames.get(event.player_id) ?? event.player_id;
            // Goals use the existing player rule and the same per-player cooldown.
            emit("player", event.team_id, event.player_id, () => ({
                from: recentFrom,
                headline: translated(
                    `${name}: ${player.recentGoals > 0 ? "a goal in the recent window" : "recent contributions"}`,
                    `${name}: ${player.recentGoals > 0 ? "may goal sa kamakailang saklaw" : "mga kamakailang ambag"}`,
                ),
                explanation: translated(
                    `${name} recorded ${player.recentCount} ${player.recentCount === 1 ? "action" : "actions"}, including ${player.recentGoals} ${player.recentGoals === 1 ? "goal" : "goals"}, in ${recentRange}. Actions count events credited to this player, not recipient or target mentions.`,
                    `Nagtala si ${name} ng ${player.recentCount} aksyon, kabilang ang ${player.recentGoals} goal, sa ${recentRange}. Binibilang ang mga event kung saan siya ang kumilos, hindi ang pagbanggit bilang tatanggap o target.`,
                ),
                casual: translated(
                    player.recentGoals > 0
                        ? `${name} scored in this recent window; the goal is included in their ${player.recentCount} recorded ${player.recentCount === 1 ? "action" : "actions"}.`
                        : `${name} was involved in ${player.recentCount} recorded actions in this window.`,
                    player.recentGoals > 0
                        ? `Naka-goal si ${name} sa kamakailang saklaw; kasama ang goal sa kanyang ${player.recentCount} naitalang aksyon.`
                        : `May ${player.recentCount} naitalang aksyon si ${name} sa saklaw na ito.`,
                ),
                interpretation: translated(
                    "This highlights recent recorded involvement, not an overall player rating. Action counts alone cannot establish quality, off-ball influence or future performance.",
                    "Ipinapakita nito ang kamakailang naitalang pakikilahok, hindi ang kabuuang rating ng manlalaro. Hindi sapat ang bilang ng aksyon upang patunayan ang kalidad, ambag nang walang bola, o susunod na pagganap.",
                ),
                metrics: [metric("Recorded actions", "Naitalang aksyon", String(player.recentCount)), metric("Goals", "Mga goal", String(player.recentGoals)), metric("Recent window", "Kamakailang saklaw", recentRange)],
                eventIds: player.eventIds(),
            }));
        }
    }

    return historyStart === 0 ? history : [...history.slice(historyStart), ...history.slice(0, historyStart)];
}

export const ruleBasedProvider: InsightProvider = { kind: "rule-based", generate };