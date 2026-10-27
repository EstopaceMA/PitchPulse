import { formatTime } from "./playback";
import { speedText } from "./presentation";
import { translate } from "@/lib/i18n/translate";
import type { Insight, InsightProvider, InsightRequestOptions, Language, MatchData, MatchEvent } from "./types";

const WINDOW_SECONDS = 300;
const COOLDOWN_SECONDS = 180;
const HISTORY_LIMIT = 200;
const MIN_PASS_ATTEMPTS = 5;
const MIN_PASS_CHANGE_PP = 10;
const MIN_PLAYER_ACTIONS = 4;
const PRESS_REGAIN_SECONDS = 5;
const MIN_PRESS_REGAINS = 2;
const DROUGHT_SECONDS = 720;
const MIN_TERRITORY_ACTIONS = 6;

const localize = (language: Language, key: string, values?: Record<string, string | number>) => translate(language, key, values);
const range = (from: number, to: number): string => `${formatTime(from)}–${formatTime(to)}`;
const completedPass = (event: MatchEvent): number => Number(event.type === "pass" && event.outcome === "complete");
const goal = (event: MatchEvent): number => Number(event.type === "shot" && event.outcome === "goal");

const isRecovery = (event: MatchEvent): boolean => event.type === "possession_change" && (event.reason === "interception" || event.reason === "tackle");
/** Coordinates are acting-team-relative: do not rotate away-team positions here. */
function isAttackingThirdRecovery(event: MatchEvent): boolean {
    return isRecovery(event) && event.position !== undefined && event.position.x >= 66.67;
}
const thirdKey = (x: number): string => x >= 66.67 ? "agentThirdAttacking" : x > 33.33 ? "agentThirdMiddle" : "agentThirdDefensive";
/** Passes, shots, challenges, pressure and recoveries recorded in the acting team's attacking third. */
function isAttackingThirdAction(event: MatchEvent): boolean {
    const location = event.type === "pass" ? event.start_position ?? event.position : event.position;
    return location !== undefined && location.x >= 66.67 && (["pass", "shot", "tackle", "pressure"].includes(event.type) || isRecovery(event));
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
    /** Recoveries within PRESS_REGAIN_SECONDS of the same team's pressure, and that team's pressure events. */
    regains: EventWindows;
    pressures: EventWindows;
    territory: EventWindows;
}

const teamWindows = (): TeamWindows => ({ recoveries: new EventWindows(), shots: new EventWindows(), passes: new EventWindows(), regains: new EventWindows(), pressures: new EventWindows(), territory: new EventWindows() });

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
 * No timers, shared cache, or playback-speed-dependent checkpoints. Only the
 * selected language affects wording; it never changes facts or evidence.
 * Early windows are clipped at kick-off, explicitly noted in comparisons.
 *
 * For validated two-team imports, a call costs O(n log n) worst-case for sorting,
 * then O(n + emitted evidence). Already ordered input skips sorting. Cooldowns
 * bound the number of times each event can appear in emitted evidence. Working
 * memory is O(n + metadata), plus at most 200 retained insights.
 */
function generate(data: MatchData, events: readonly MatchEvent[], elapsed: number, options?: InsightRequestOptions): Insight[] {
    if (!Number.isFinite(elapsed) || elapsed < 0 || events.length === 0) return [];
    const language = options?.preferences?.language ?? "en";
    const t = (key: string, values?: Record<string, string | number>) => localize(language, key, values);
    const metric = (key: string, value: string): Insight["metrics"][number] => ({ label: t(key), value });

    const ordered = events.filter(event => event.match_time_seconds <= elapsed);
    if (ordered.some((event, index) => index > 0 && compareEvents(ordered[index - 1], event) > 0)) {
        ordered.sort(compareEvents);
    }

    const teamNames = new Map(data.teams.map(team => [team.team_id, team.name]));
    const playerNames = new Map(data.players.map(player => [player.player_id, player.name]));
    const teams = new Map<string, TeamWindows>();
    const players = new Map<string, EventWindows>();
    const lastEmitted = new Map<string, number>();
    const score = new Map(data.teams.map(team => [team.team_id, 0]));
    // Every reached event by possession_id, so a goal can walk back to the start of its move.
    const possessions = new Map<string, MatchEvent[]>();
    const lastShots = new Map<string, MatchEvent>();
    const pressing = new Map<string, MatchEvent[]>();
    const regainPressure = new Map<string, string>();
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
        const earlyNote = earlyComparison ? ` ${t("ruleEarlyWindow")}` : "";

        // Lazy construction avoids copying evidence or formatting a card on cooldown.
        // Event-anchored rules (goals, ended droughts) pass a zero cooldown so no occurrence is skipped.
        const emit = (rule: Insight["rule"], teamId: string, playerId: string | undefined, make: () => Omit<Insight, "id" | "rule" | "teamId" | "playerId" | "at">, cooldown = COOLDOWN_SECONDS): void => {
            const key = JSON.stringify([rule, teamId, playerId ?? null]);
            if (at - (lastEmitted.get(key) ?? -Infinity) < cooldown) return;
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

        if (event.possession_id !== null) {
            const key = String(event.possession_id);
            let possession = possessions.get(key);
            if (!possession) possessions.set(key, possession = []);
            possession.push(event);
        }

        let actingPlayer: EventWindows | undefined;
        let pressedRegain = false;
        if (event.team_id !== null) {
            let team = teams.get(event.team_id);
            if (!team) {
                team = teamWindows();
                teams.set(event.team_id, team);
            }
            if (isAttackingThirdRecovery(event)) team.recoveries.add(event);
            if (event.type === "shot") team.shots.add(event);
            if (event.type === "pass") team.passes.add(event);
            if (isAttackingThirdAction(event)) team.territory.add(event);
            const recentPressure = (pressing.get(event.team_id) ?? []).filter(pressure => at - pressure.match_time_seconds <= PRESS_REGAIN_SECONDS);
            if (event.type === "pressure") {
                team.pressures.add(event);
                recentPressure.push(event);
            } else if (isRecovery(event) && recentPressure.length) {
                team.regains.add(event);
                regainPressure.set(event.event_id, recentPressure.at(-1)!.event_id);
                pressedRegain = true;
            }
            pressing.set(event.team_id, recentPressure);

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

        if (event.team_id !== null && event.type === "shot") {
            const teamId = event.team_id, name = teamNames.get(teamId) ?? teamId;
            const previous = lastShots.get(teamId);
            const gap = at - (previous?.match_time_seconds ?? 0);
            if (gap >= DROUGHT_SECONDS) {
                const minutes = Math.floor(gap / 60), since = previous ? formatTime(previous.match_time_seconds) : t("ruleKickOff");
                emit("drought", teamId, undefined, () => ({
                    from: previous?.match_time_seconds ?? 0,
                    headline: t("ruleDroughtHeadline", { name }),
                    explanation: t("ruleDroughtExplanation", { name, time: formatTime(at), since, minutes }),
                    casual: t("ruleDroughtCasual", { name, minutes }),
                    interpretation: t("ruleDroughtInterpretation"),
                    metrics: [metric("ruleMetricMinutesWithoutShot", String(minutes)), metric("ruleMetricPreviousShot", formatTime(previous?.match_time_seconds ?? 0))],
                    eventIds: [...previous ? [previous.event_id] : [], event.event_id],
                }), 0);
            }
            lastShots.set(teamId, event);
            if (event.outcome === "goal") {
                const opponent = data.teams.find(team => team.team_id !== teamId)?.team_id;
                const mine = score.get(teamId) ?? 0, theirs = opponent ? score.get(opponent) ?? 0 : 0;
                score.set(teamId, mine + 1);
                const state = mine === 0 && theirs === 0 ? "Opener" : mine === theirs ? "Ahead" : mine + 1 === theirs ? "Equaliser" : mine > theirs ? "Extended" : "Closer";
                const possession = event.possession_id === null ? [event] : possessions.get(String(event.possession_id)) ?? [event];
                const start = possession[0], move = possession.filter(entry => entry.team_id === teamId);
                const seconds = at - start.match_time_seconds;
                const passes = move.filter(entry => entry.type === "pass" && entry.outcome === "complete").length;
                const scorer = event.player_id ? playerNames.get(event.player_id) ?? event.player_id : name;
                const regained = start.team_id === teamId && isRecovery(start);
                const origin = start.type === "kickoff" && start.team_id === teamId ? t("ruleGoalOriginKickoff")
                    : regained && start.position ? t("ruleGoalOriginRecovery", { winner: start.player_id ? playerNames.get(start.player_id) ?? start.player_id : name, how: t(start.reason === "tackle" ? "ruleHowTackle" : "ruleHowInterception"), third: t(thirdKey(start.position.x)) })
                    : t("ruleGoalOriginOther");
                const homeId = data.match.home_team_id, awayId = data.match.away_team_id;
                const scoreline = `${score.get(homeId) ?? 0}–${score.get(awayId) ?? 0}`;
                emit("goal_context", teamId, undefined, () => ({
                    from: start.match_time_seconds,
                    headline: t(`ruleGoalHeadline${state}`, { name }),
                    explanation: t(passes ? "ruleGoalExplanation" : "ruleGoalExplanationNoPass", { scorer, time: formatTime(at), score: `${teamNames.get(homeId) ?? homeId} ${scoreline} ${teamNames.get(awayId) ?? awayId}`, seconds, passes, passWord: t(passes === 1 ? "rulePassOne" : "rulePassMany"), origin }),
                    casual: t("ruleGoalCasual", { scorer, name, seconds }),
                    interpretation: t(regained && seconds <= 25 ? "ruleGoalInterpretationTransition" : passes >= 3 ? "ruleGoalInterpretationBuildUp" : "ruleGoalInterpretationOther"),
                    metrics: [
                        metric("ruleMetricScore", scoreline),
                        metric("ruleMetricMoveDuration", `${seconds} s`),
                        metric("ruleMetricPassesInMove", String(passes)),
                        ...event.shot_speed_kmh !== undefined ? [metric("shotSpeedSynthetic", speedText(event.shot_speed_kmh))] : [],
                    ],
                    eventIds: move.map(entry => entry.event_id),
                }), 0);
            }
        }

        // Territory compares both teams in the same windows, so advance every team before any rule reads them.
        for (const windows of teams.values()) windows.territory.advance(at);
        for (const [teamId, windows] of teams) {
            const name = teamNames.get(teamId) ?? teamId;
            const { recoveries, shots, passes, regains, pressures, territory } = windows;
            recoveries.advance(at);
            shots.advance(at);
            passes.advance(at);
            regains.advance(at);
            pressures.advance(at);

            if (pressedRegain && teamId === event.team_id && regains.recentCount >= MIN_PRESS_REGAINS) {
                emit("pressing", teamId, undefined, () => {
                    const count = regains.recentCount;
                    return {
                        from: recentFrom,
                        headline: t("rulePressingHeadline", { name }),
                        explanation: t("rulePressingExplanation", { name, count, seconds: PRESS_REGAIN_SECONDS, range: recentRange, pressures: pressures.recentCount }),
                        casual: t("rulePressingCasual", { name }),
                        interpretation: t("rulePressingInterpretation"),
                        metrics: [metric("ruleMetricPressRegains", String(count)), metric("ruleMetricPressures", String(pressures.recentCount)), metric("ruleMetricRecentWindow", recentRange)],
                        eventIds: regains.eventIds().flatMap(id => [regainPressure.get(id)!, id]),
                    };
                });
            }

            const rival = [...teams].find(([id]) => id !== teamId)?.[1];
            const recentTotal = territory.recentCount + (rival?.territory.recentCount ?? 0);
            const previousTotal = territory.previousCount + (rival?.territory.previousCount ?? 0);
            // Integer comparisons: at least 60% of recent attacking-third actions, at most 45% of the previous ones.
            if (recentTotal >= MIN_TERRITORY_ACTIONS && previousTotal >= MIN_TERRITORY_ACTIONS && 5 * territory.recentCount >= 3 * recentTotal && 20 * territory.previousCount <= 9 * previousTotal) {
                emit("momentum", teamId, undefined, () => ({
                    from: previousFrom,
                    headline: t("ruleMomentumHeadline", { name }),
                    explanation: t("ruleMomentumExplanation", { name, recent: territory.recentCount, recentTotal, recentRange, previous: territory.previousCount, previousTotal, previousRange }) + earlyNote,
                    casual: t("ruleMomentumCasual", { name }) + earlyNote,
                    interpretation: t("ruleMomentumInterpretation"),
                    metrics: [
                        metric("ruleMetricRecentTerritory", `${territory.recentCount}/${recentTotal}`),
                        metric("ruleMetricPreviousTerritory", `${territory.previousCount}/${previousTotal}`),
                        metric("ruleMetricRecentWindow", recentRange),
                        metric("ruleMetricPreviousWindow", previousRange),
                    ],
                    eventIds: territory.eventIds(true),
                }));
            }

            // No unrequested minimum: even one qualifying recovery is a factual card.
            if (recoveries.recentCount > 0) {
                emit("recoveries", teamId, undefined, () => {
                    const count = recoveries.recentCount;
                    return {
                        from: recentFrom,
                        headline: t("ruleRecoveriesHeadline", { name }),
                        explanation: t("ruleRecoveriesExplanation", { name, count, range: recentRange, recovery: t(count === 1 ? "ruleRecoveryOne" : "ruleRecoveryMany") }),
                        casual: t("ruleRecoveriesCasual", { name, count, times: t(count === 1 ? "ruleTimeOne" : "ruleTimeMany") }),
                        interpretation: t("ruleRecoveriesInterpretation"),
                        metrics: [metric("ruleMetricAttackingRecoveries", String(count)), metric("ruleMetricRecentWindow", recentRange)],
                        eventIds: recoveries.eventIds(),
                    };
                });
            }

            if (shots.recentCount > shots.previousCount) {
                emit("shots", teamId, undefined, () => ({
                    from: previousFrom,
                    headline: t("ruleShotsHeadline", { name }),
                    explanation: t("ruleShotsExplanation", { name, recent: shots.recentCount, recentRange, previous: shots.previousCount, previousRange, increase: shots.recentCount - shots.previousCount }) + earlyNote,
                    casual: t("ruleShotsCasual", { name }) + earlyNote,
                    interpretation: t("ruleShotsInterpretation") + ` ${t(earlyComparison ? "ruleShotsEarlyLimit" : "ruleShotsQualityLimit")}`,
                    metrics: [
                        metric("ruleMetricRecentShots", String(shots.recentCount)),
                        metric("ruleMetricPreviousShots", String(shots.previousCount)),
                        metric("ruleMetricIncrease", `+${shots.recentCount - shots.previousCount}`),
                        metric("ruleMetricRecentWindow", recentRange),
                        metric("ruleMetricPreviousWindow", previousRange),
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
                            headline: t(delta > 0 ? "rulePassingUpHeadline" : "rulePassingDownHeadline", { name }),
                            explanation: t("rulePassingExplanation", { name, recentCompleted: passes.recentCompleted, recentCount: passes.recentCount, recentPercent, recentRange, previousCompleted: passes.previousCompleted, previousCount: passes.previousCount, previousPercent, previousRange, change }) + earlyNote,
                            casual: t(delta > 0 ? "rulePassingLargerCasual" : "rulePassingSmallerCasual", { name }) + earlyNote,
                            interpretation: t("rulePassingInterpretation"),
                            metrics: [
                                metric("ruleMetricRecentCompletion", `${passes.recentCompleted}/${passes.recentCount} (${recentPercent}%)`),
                                metric("ruleMetricPreviousCompletion", `${passes.previousCompleted}/${passes.previousCount} (${previousPercent}%)`),
                                metric("ruleMetricChange", change),
                                metric("ruleMetricRecentWindow", recentRange),
                                metric("ruleMetricPreviousWindow", previousRange),
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
                headline: t(player.recentGoals > 0 ? "rulePlayerGoalHeadline" : "rulePlayerActionsHeadline", { name }),
                explanation: t("rulePlayerExplanation", { name, actions: player.recentCount, goals: player.recentGoals, range: recentRange, actionWord: t(player.recentCount === 1 ? "ruleActionOne" : "ruleActionMany"), goalWord: t(player.recentGoals === 1 ? "ruleGoalOne" : "ruleGoalMany") }),
                casual: player.recentGoals > 0 ? t("rulePlayerGoalCasual", { name, actions: player.recentCount, actionWord: t(player.recentCount === 1 ? "ruleActionOne" : "ruleActionMany") }) : t("rulePlayerActionsCasual", { name, actions: player.recentCount }),
                interpretation: t("rulePlayerInterpretation"),
                metrics: [metric("ruleMetricActions", String(player.recentCount)), metric("ruleMetricGoals", String(player.recentGoals)), metric("ruleMetricRecentWindow", recentRange)],
                eventIds: player.eventIds(),
            }));
        }
    }

    return historyStart === 0 ? history : [...history.slice(historyStart), ...history.slice(0, historyStart)];
}

// `satisfies` keeps the synchronous signature for existing call sites.
export const ruleBasedProvider = { kind: "rule-based", generate } satisfies InsightProvider;
