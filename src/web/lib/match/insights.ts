import { formatTime } from "./playback";
import { translate } from "@/lib/i18n/translate";
import type { Insight, InsightProvider, InsightRequestOptions, Language, MatchData, MatchEvent } from "./types";

const WINDOW_SECONDS = 300;
const COOLDOWN_SECONDS = 180;
const HISTORY_LIMIT = 200;
const MIN_PASS_ATTEMPTS = 5;
const MIN_PASS_CHANGE_PP = 10;
const MIN_PLAYER_ACTIONS = 4;

const localize = (language: Language, key: string, values?: Record<string, string | number>) => translate(language, key, values);
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
