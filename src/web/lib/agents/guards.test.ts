import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { countReached } from "../match/playback";
import { validateMatch } from "../match/validation";
import { addGrounding, bannedClaim, createGrounding, internalReference, SHOWN_EVIDENCE, toAgentAnswer, toAgentInsights, toAgentRecap, toCommentaryLines, ungrounded, UnverifiableOutput } from "./guards";
import { buildMatchPacket } from "./packet";

const data = validateMatch(JSON.parse(readFileSync(new URL("../../public/arsenal-vs-chelsea-match.json", import.meta.url), "utf8")));
const home = data.match.home_team_id, away = data.match.away_team_id;
const events = data.events.slice(0, countReached(data.events, 1800, false));
const packet = buildMatchPacket(data, events, { elapsed: 1800, secondHalf: false, status: "paused" });
const grounding = createGrounding(packet.names, [...packet.order.keys(), ...packet.playerTeams.keys(), ...packet.teams.keys()]);
addGrounding(grounding, packet.facts);
const later = data.events[events.length].event_id;
const reached = events.filter(event => event.team_id === home).at(-1)!.event_id;
const shots = packet.catalog.get(`${home}.total.shots`)!;
const passes = packet.catalog.get(`${home}.total.passes_attempted`)!;
const homeName = data.teams.find(team => team.team_id === home)!.name;
const homePlayer = data.players.find(player => player.team_id === home && packet.catalog.has(`${player.player_id}.total.actions`))!;
const both = (en: string, fil = en) => { void fil; return en; };

function card(overrides: Record<string, unknown> = {}) {
    return {
        topic: "chance_creation", team_id: home, player_id: null,
        headline: both(`${homeName} shooting so far`),
        observed: both(`${homeName} have ${shots.value} shots by 30:00.`, `May ${shots.value} tira ang ${homeName} hanggang 30:00.`),
        casual: both(`${homeName} keep trying their luck.`, `Patuloy na sumusubok ang ${homeName}.`),
        interpretation: both("This may reflect sustained attacking intent.", "Maaaring nagpapakita ito ng tuloy-tuloy na pag-atake."),
        metric_keys: [`${home}.total.shots`], evidence_event_ids: [],
        ...overrides,
    };
}

describe("numeric grounding and banned claims", () => {
    test("keeps grounding and unsupported-claim checks in all added languages", () => {
        for (const claim of ["Arsenal tuvo 60% de posesión", "Arsenal tuvo 3 goles esperados", "Chelsea teve 60% de posse de bola", "Chelsea teve gols esperados", "Arsenal memiliki persentase penguasaan bola 60%", "Chelsea memiliki gol yang diharapkan", "نسبة الاستحواذ 60% لأرسنال", "الأهداف المتوقعة لتشيلسي", "อาร์เซนอลครองบอล 60%", "ประตูที่คาดหวังของเชลซี"]) {
            assert.ok(bannedClaim(claim), claim);
        }
        for (const statement of ["Arsenal tuvo 987 tiros", "Arsenal teve 987 finalizações", "Arsenal mencatat 987 tembakan", "سدد أرسنال 987 تسديدة", "อาร์เซนอลยิง 987 ครั้ง"]) {
            assert.equal(ungrounded(statement, grounding), "987", statement);
        }
    });
    test("allows shown numbers and times, strips names and IDs, and normalizes mm:ss", () => {
        assert.equal(ungrounded(`${homePlayer.name} took ${shots.value} shots by 30:00`, grounding), null);
        assert.equal(ungrounded("Event EVT-00002 and player ARS10 are references, not numbers", grounding), null);
        assert.equal(ungrounded("Kick-off was at 0:00", grounding), null);
        assert.equal(ungrounded("They had 987 touches", grounding), "987");
        assert.equal(ungrounded("A goal at 88:12", grounding), "88:12");
    });

    test("rejects unsupported claims in English and Filipino while allowing plain possession changes", () => {
        for (const text of ["Arsenal had 58% possession", "possession share favours Chelsea", "possession at 61%", "mataas ang porsiyento ng possession", "covered 10 km", "the distance covered", "an xG of 1.2", "expected goals rose", "a 30% chance of scoring", "the probability of a goal", "heat map shows", "pusta sa laban"]) {
            assert.ok(bannedClaim(text), text);
        }
        for (const text of ["Arsenal won possession back three times", "Possession changes followed interceptions", "chance creation improved"]) assert.ok(!bannedClaim(text), text);
    });

    test("allows grounded synthetic ball and shot speeds but still rejects running data and invented speeds", () => {
        const fastest = packet.catalog.get(`${home}.total.max_shot_speed`)!.value;
        for (const text of [`${homeName}'s fastest shot reached ${fastest}, a synthetic dataset value.`, `Tembakan tercepat ${homeName} ${fastest.replace("km/h", "km/jam")}.`]) {
            assert.equal(bannedClaim(text), null, text);
            assert.equal(ungrounded(text, grounding), null, text);
        }
        assert.equal(ungrounded("a 131.7 km/h strike", grounding), "131.7");
        for (const text of ["his top speed was impressive", "a sprint speed of 31", "his running speed dropped", "covered 10 km", "ran 9 kilometres"]) assert.ok(bannedClaim(text), text);
    });

    test("rejects outside knowledge about the real clubs and players in English and Filipino", () => {
        for (const text of ["Saka has 9 goals this season", "the best spell of his career", "a summer transfer target", "signed from Newcastle", "his new contract", "back from injury", "the Arsenal captain", "an England international", "a Premier League rivalry", "Champions League nights", "ngayong season", "ang kapitan ng Chelsea", "bagong kontrata", "napinsala noong nakaraang laban", "sa pambansang koponan"]) {
            assert.ok(bannedClaim(text), text);
        }
        for (const text of ["Bukayo Saka took 3 shots from the attacking third", "Chelsea pressed high between 15:00 and 30:00", "Declan Rice passed to Martin Ødegaard", "the second half opened with a long spell of passing", "a European-style press", "pinilit ng Arsenal ang depensa ng Chelsea"]) assert.ok(!bannedClaim(text), text);
    });

    test("rejects metric keys, block codes and dataset IDs in prose but not names or plain words", () => {
        for (const text of [`${homeName} had shots (${home}.total.shots = 4)`, "Arsenal had 3 shots in b1", `Arsenal scored (${reached})`, `${homePlayer.player_id} was busy`, `(${away} 20 middle recoveries)`, "ARS.zone.passes.centre was high"]) {
            assert.ok(internalReference(text, grounding), text);
        }
        for (const text of [`${homePlayer.name} was busy between 15:00 and 30:00`, "Arsenal lead 1-0", "a b-side move", "Chelsea pressed high"]) assert.ok(!internalReference(text, grounding), text);
        const { result } = toAgentInsights({ cards: [card({ observed: both(`${homeName} have ${shots.value} shots (${home}.total.shots).`) })] }, packet, grounding, data.match.match_id);
        assert.equal(result.length, 0);
    });

    test("removes citations that only list IDs, but still rejects IDs mixed into prose", () => {
        const cited = toAgentInsights({ cards: [card({ observed: both(`${homeName} have ${shots.value} shots by 30:00 (${reached}).`, `May ${shots.value} tira ang ${homeName} (${reached} at ${reached}).`) })] }, packet, grounding, data.match.match_id);
        assert.equal(cited.result.length, 1);
        assert.deepEqual(cited.result[0].explanation, both(`${homeName} have ${shots.value} shots by 30:00.`, `May ${shots.value} tira ang ${homeName}.`));
        const mixed = toAgentInsights({ cards: [card({ observed: both(`${homeName} have ${shots.value} shots (${reached} after a long pass).`) })] }, packet, grounding, data.match.match_id);
        assert.equal(mixed.result.length, 0);
        const recap = toAgentRecap({ story: both(`${homeName} reached 30:00.`), turning_points: [{ event_id: reached, caption: both(`${reached} — A recorded moment.`) }], team_notes: [], watch_next: null }, packet, grounding, "full-time");
        assert.deepEqual(recap.result.turningPoints[0].caption, both("A recorded moment."));
    });
});

describe("analyst cards", () => {
    test("materializes metric labels, values and evidence from the catalog, never from the model", () => {
        const { result, dropped } = toAgentInsights({ cards: [card({ metric_keys: [`${home}.total.shots`, "ARS.total.invented"] })] }, packet, grounding, data.match.match_id);
        assert.equal(dropped, 0);
        assert.equal(result.length, 1);
        const [insight] = result;
        assert.equal(insight.source, "foundry");
        assert.equal(insight.rule, "agent");
        assert.deepEqual(insight.metrics, [{ label: shots.label, value: shots.value }]);
        assert.deepEqual(insight.eventIds, shots.evidence.slice(-SHOWN_EVIDENCE));
        assert.equal(insight.at, 1800);
        assert.ok(insight.eventIds.every(id => packet.order.has(id)));
    });

    test("states the full evidence count when the listed events are capped", () => {
        const { result } = toAgentInsights({ cards: [card({ metric_keys: [`${home}.total.passes_attempted`], observed: both(`${homeName} attempted ${passes.value} passes.`) })] }, packet, grounding, data.match.match_id);
        assert.equal(result[0].eventIds.length, SHOWN_EVIDENCE);
        assert.equal(result[0].evidenceTotal, passes.evidence.length);
        assert.deepEqual(result[0].eventIds, passes.evidence.slice(-SHOWN_EVIDENCE));
    });

    test("drops cards with future or unknown evidence, ungrounded numbers, banned claims or bad IDs", () => {
        const cards = [
            card({ evidence_event_ids: [later] }),
            card({ evidence_event_ids: ["EVT-NOPE"] }),
            card({ observed: both(`${homeName} have 99 shots.`) }),
            card({ interpretation: both("Their possession share of 60% may matter.") }),
            card({ team_id: "XXX" }),
            card({ player_id: data.players.find(player => player.team_id === away)!.player_id }),
            card({ metric_keys: ["invented.key"] }),
            card({ topic: "vibes" }),
            card({ headline: { en: "Only English" } }),
        ];
        for (const [index, bad] of cards.entries()) {
            const { result, dropped } = toAgentInsights({ cards: [bad] }, packet, grounding, data.match.match_id);
            assert.equal(result.length, 0, `card ${index} should be dropped`);
            assert.equal(dropped, 1);
        }
        // At most four cards are read; extras count as dropped rather than silently disappearing.
        const many = toAgentInsights({ cards: Array.from({ length: 6 }, () => card()) }, packet, grounding, data.match.match_id);
        assert.equal(many.result.length, 4);
        assert.equal(many.dropped, 2);
    });

    test("accepts valid cited evidence and a player card for that team", () => {
        const { result } = toAgentInsights({ cards: [card({ evidence_event_ids: [reached], player_id: homePlayer.player_id, metric_keys: [`${homePlayer.player_id}.total.actions`], observed: both(`${homePlayer.name} recorded ${packet.catalog.get(`${homePlayer.player_id}.total.actions`)!.value} actions.`) })] }, packet, grounding, data.match.match_id);
        assert.equal(result.length, 1);
        assert.equal(result[0].playerId, homePlayer.player_id);
        assert.ok(result[0].eventIds.includes(reached));
    });

    test("an output without a cards array is unverifiable as a whole", () => {
        assert.throws(() => toAgentInsights({ text: "hello" }, packet, grounding, data.match.match_id), UnverifiableOutput);
    });
});

describe("recap, answer and commentary outputs", () => {
    const recap = (overrides: Record<string, unknown> = {}) => ({
        story: both(`${homeName} reached 30:00 with ${shots.value} shots.`),
        turning_points: [{ event_id: reached, caption: both("A recorded moment.") }, { event_id: later, caption: both("A future moment.") }],
        team_notes: [{ team_id: home, observed: both(`${shots.value} shots so far.`), interpretation: both("This may matter."), metric_keys: [`${home}.total.shots`] }],
        watch_next: both("Can they keep shooting?"),
        ...overrides,
    });

    test("recaps drop future turning points and keep questions only at half-time", () => {
        const half = toAgentRecap(recap(), packet, grounding, "half-time");
        assert.deepEqual(half.result.turningPoints.map(point => point.eventId), [reached]);
        assert.equal(half.dropped, 1);
        assert.deepEqual(half.result.watchNext, both("Can they keep shooting?"));
        assert.equal(half.result.teamNotes[0].metrics[0].value, shots.value);
        assert.equal(toAgentRecap(recap(), packet, grounding, "full-time").result.watchNext, null);
        assert.throws(() => toAgentRecap(recap({ story: both("They had 77 shots.") }), packet, grounding, "half-time"), UnverifiableOutput);
    });

    test("answers reject unreached evidence and drop only an unverifiable caveat", () => {
        const answer = { answer: both(`${homeName} have ${shots.value} shots.`), evidence_event_ids: [reached], caveat: both("Counts include 444 imaginary events."), out_of_scope: false };
        const { result, dropped } = toAgentAnswer(answer, packet, grounding);
        assert.deepEqual(result.eventIds, [reached]);
        assert.equal(result.caveat, null);
        assert.equal(dropped, 1);
        assert.throws(() => toAgentAnswer({ ...answer, evidence_event_ids: [later] }, packet, grounding), UnverifiableOutput);
    });

    test("only a declined out-of-scope answer may name the real-world topic it cannot answer", () => {
        const declined = { answer: both("This replay records events only, so it cannot say who the captain is.", "Mga pangyayari lamang ang naitala, kaya hindi nito masasabi kung sino ang kapitan."), evidence_event_ids: [], caveat: null, out_of_scope: true };
        assert.equal(toAgentAnswer(declined, packet, grounding).result.outOfScope, true);
        assert.throws(() => toAgentAnswer({ ...declined, out_of_scope: false }, packet, grounding), /captain/);
        assert.throws(() => toAgentAnswer({ ...declined, answer: both("He has captained them for 77 matches.") }, packet, grounding), /77/);
        assert.throws(() => toAgentAnswer({ ...declined, answer: both("Possession share is not recorded.") }, packet, grounding), /possession share/i);
    });

    test("commentary keeps requested events only, in request order", () => {
        const ids = events.slice(-3).map(event => event.event_id);
        const lines = [{ event_id: ids[1], text: both("Second.") }, { event_id: later, text: both("Future.") }, { event_id: ids[0], text: both("First.") }, { event_id: ids[0], text: both("Duplicate.") }];
        const { result, dropped } = toCommentaryLines({ lines }, grounding, ids);
        assert.deepEqual(result.map(line => line.eventId), [ids[0], ids[1]]);
        assert.equal(dropped, 2);
    });
});
