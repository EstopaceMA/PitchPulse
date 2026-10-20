"use client";

import { Users } from "lucide-react";
import type { MotionFrame } from "@/lib/match/movement";
import { teamColor, tr } from "@/lib/match/presentation";
import type { Language, MatchData, Position } from "@/lib/match/types";

const screen = (p: Position) => ({ x: 38 + p.x * 6.84, y: 34 + p.y * 4.42 });
type LabelBox = { x: number; y: number; w: number; h: number };
const overlap = (a: LabelBox, b: LabelBox) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

export function TeamMotion({ data, frame, names, selectedPlayer, onSelect, language }: { data: MatchData; frame: MotionFrame; names: boolean; selectedPlayer: string | null; onSelect: (id: string) => void; language: Language }) {
    const players = frame.players.map(motion => ({ ...motion, player: data.players.find(p => p.player_id === motion.playerId)!, point: screen(motion.position) }));
    // Screen-space decluttering only. These markers are illustrative, so small
    // symmetric offsets keep players independently clickable without changing data.
    for (let pass = 0; pass < 12; pass++) {
        for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
            const a = players[i].point, b = players[j].point;
            const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
            if (distance >= 37) continue;
            const ux = distance > .001 ? dx / distance : Math.cos(i + j);
            const uy = distance > .001 ? dy / distance : Math.sin(i + j);
            const shift = (37 - distance) / 2;
            a.x = Math.max(54, Math.min(706, a.x - ux * shift));
            a.y = Math.max(50, Math.min(460, a.y - uy * shift));
            b.x = Math.max(54, Math.min(706, b.x + ux * shift));
            b.y = Math.max(50, Math.min(460, b.y + uy * shift));
        }
    }
    const boxes: LabelBox[] = [];
    const markers = players.map(({ point }) => ({ x: point.x - 14, y: point.y - 14, w: 28, h: 28 }));
    const labels = players.map(({ player, point }) => {
        const w = Math.max(56, Math.min(180, player.name.length * 5.3 + 14));
        const below = player.team_id === data.match.home_team_id;
        const offsets = below ? [20, -38, 41, -59, 62, -80] : [-38, 20, -59, 41, -80, 62];
        let best: LabelBox | undefined, bestScore = Infinity;
        for (const dy of offsets) {
            for (const dx of [0, -w / 2, w / 2]) {
                const box = { x: Math.max(6, Math.min(754 - w, point.x - w / 2 + dx)), y: Math.max(6, Math.min(486, point.y + dy)), w, h: 18 };
                const score = [...boxes, ...markers].reduce((sum, b) => sum + overlap(box, b), 0);
                if (score < bestScore) { best = box; bestScore = score; }
                if (score === 0) break;
            }
            if (bestScore === 0) break;
        }
        const box = best!;
        boxes.push(box);
        return box;
    });
    const ball = frame.ball && screen(frame.ball);
    return <g data-testid="full-team-layer">
        {players.map(({ playerId, point, active, player }) => {
            const color = teamColor(player.team_id, data.match.home_team_id), chosen = playerId === selectedPlayer;
            return <g key={playerId} className={`sim-player${chosen ? " chosen" : ""}`} data-player-id={playerId} data-active={active} transform={`translate(${point.x}, ${point.y})`} role="button" tabIndex={0} aria-pressed={chosen} aria-label={`${player.name}, ${player.position ?? tr(language, "player", "manlalaro")}, ${tr(language, "simulated position", "simuladong posisyon")}`} onClick={() => onSelect(playerId)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(playerId); } }}>
                <title>{`${player.name} · ${player.position ?? ""} · ${tr(language, "Illustrative movement, not tracking", "Halimbawang galaw, hindi tracking")}`}</title>
                <circle className="player-focus-ring" r="20" fill="none" stroke={chosen ? "#b4f6dc" : color} strokeOpacity={chosen ? 1 : active ? .7 : 0} strokeWidth="1.6" strokeDasharray={chosen ? "3 3" : undefined} />
                <circle r="15" fill="#101824" stroke={color} strokeWidth={active ? 3 : 1.8} />
                <circle r="11.5" fill={color} fillOpacity={active ? .7 : .25} />
                <text textAnchor="middle" y="4" fill="#f6f9ff" fontSize="11" fontWeight="650" pointerEvents="none">{player.shirt_number ?? "•"}</text>
                {player.position === "GK" && <rect x="-10" y="-17" width="20" height="5" rx="2" fill="#ebd198" />}
            </g>;
        })}
        {names && players.map(({ playerId, player, point, active }, index) => {
            const box = labels[index], color = teamColor(player.team_id, data.match.home_team_id);
            return <g key={playerId} pointerEvents="none" className={`sim-player-name${active || playerId === selectedPlayer ? " is-highlighted" : ""}`} data-name-for={playerId}>
                <line x1={point.x} y1={point.y} x2={box.x + box.w / 2} y2={box.y + box.h / 2} stroke={color} strokeOpacity=".3" strokeWidth=".7" />
                <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="4" fill="#0a1720" fillOpacity=".94" stroke={color} strokeOpacity={active || playerId === selectedPlayer ? .85 : .25} />
                <text x={box.x + box.w / 2} y={box.y + 12.5} textAnchor="middle" fill={active || playerId === selectedPlayer ? "#fff" : "#d7e3ed"} fontSize="9" fontWeight={active ? 650 : 450} textLength={player.name.length > 32 ? box.w - 12 : undefined} lengthAdjust="spacingAndGlyphs">{player.name}</text>
            </g>;
        })}
        {ball && <g data-testid="simulation-ball" transform={`translate(${ball.x}, ${ball.y})`} pointerEvents="none"><circle r="9" fill="#07111b" fillOpacity=".4" /><circle r="5.5" fill="#fff" stroke="#0e1a23" strokeWidth="1.5" /><path d="M0-3l3 2-1 3h-4l-1-3Z" fill="#1c2936" /></g>}
    </g>;
}

export function PlayerRoster({ data, language, selectedPlayer, onSelect, activeIds }: { data: MatchData; language: Language; selectedPlayer: string | null; onSelect: (id: string) => void; activeIds: ReadonlySet<string> }) {
    return <div className="pitch-roster">
        <details><summary><Users size={14} />{tr(language, "Player names & lineups", "Mga pangalan at lineup")}<span>{data.players.length} {tr(language, "players", "manlalaro")}</span></summary><div className="roster-teams">{[data.match.home_team_id, data.match.away_team_id].map(teamId => <section key={teamId} aria-label={`${data.teams.find(t => t.team_id === teamId)?.name} ${tr(language, "lineup", "lineup")}`}>
            <h3 style={{ color: teamColor(teamId, data.match.home_team_id) }}>{data.teams.find(t => t.team_id === teamId)?.name}</h3>
            <ul>{data.players.filter(p => p.team_id === teamId).map(player => <li key={player.player_id}><button type="button" className={player.player_id === selectedPlayer ? "selected" : ""} aria-pressed={player.player_id === selectedPlayer} onClick={() => onSelect(player.player_id)}><span className="roster-number" style={{ color: teamColor(teamId, data.match.home_team_id) }}>{player.shirt_number ?? "•"}</span><span className="roster-name">{player.name}</span><span className="roster-position">{player.position ?? "—"}</span>{activeIds.has(player.player_id) && <i className="tiny-dot green" title={tr(language, "Current participant", "Kasalukuyang kasali")} />}</button></li>)}</ul>
        </section>)}</div></details>
        <p>{tr(language, "Names come directly from the dataset. Demo player labels are fictional.", "Mula mismo sa dataset ang mga pangalan. Kathang-isip ang mga demo na manlalaro.")}</p>
    </div>;
}