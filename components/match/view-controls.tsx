"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Activity, Check, ChevronDown, Settings2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { tr } from "@/lib/match/presentation";
import type { Language, MatchData, Preferences, ViewMode } from "@/lib/match/types";

type ViewControlsProps = {
    data: MatchData;
    preferences: Preferences;
    onChange: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
};

export function PreferencesMenu({ data, preferences, onChange, compact = false }: ViewControlsProps & { compact?: boolean }) {
    const [settings, setSettings] = useState(false);
    const settingsRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const id = useId();
    const l = preferences.language;
    useEffect(() => {
        if (!settings) return;
        const closeOutside = (event: MouseEvent) => {
            if (!settingsRef.current?.contains(event.target as Node)) setSettings(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !event.defaultPrevented && !settingsRef.current?.querySelector('[role="combobox"][aria-expanded="true"]')) {
                setSettings(false);
                triggerRef.current?.focus();
            }
        };
        document.addEventListener("mousedown", closeOutside);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("mousedown", closeOutside);
            document.removeEventListener("keydown", escape);
        };
    }, [settings]);

    return <div ref={settingsRef} className="preferences-anchor">
                    <Button ref={triggerRef} variant="ghost" className="personalize-button" aria-label={compact ? tr(l, "Preferences", "Mga setting") : undefined} title={compact ? tr(l, "Team, player and language preferences", "Mga setting ng koponan, manlalaro at wika") : undefined} aria-expanded={settings} aria-controls={`${id}-preferences`} onClick={() => setSettings(open => !open)}>
                        <Settings2 size={14} aria-hidden="true" /><span>{compact ? tr(l, "Preferences", "Mga setting") : tr(l, "Make it yours", "Iayon sa iyo")}</span><ChevronDown size={12} aria-hidden="true" />
                    </Button>
                    {settings && <div className="preferences-popover" id={`${id}-preferences`}>
                        <h3>{tr(l, "Your match. Your perspective.", "Iyong laban. Iyong pananaw.")}</h3>
                        <label className="select-field">
                            <span>{tr(l, "Favorite team", "Paboritong koponan")}</span>
                            <Select label={tr(l, "Favorite team", "Paboritong koponan")} value={preferences.team} onValueChange={value => onChange("team", value)} options={data.teams.map(team => ({ value: team.team_id, label: team.name }))} portalContainer={settingsRef} />
                        </label>
                        <label className="select-field">
                            <span>{tr(l, "Favorite player", "Paboritong manlalaro")}</span>
                            <Select label={tr(l, "Favorite player", "Paboritong manlalaro")} value={preferences.player} onValueChange={value => onChange("player", value)} disabled={data.players.length === 0} portalContainer={settingsRef} options={data.players.length === 0
                                ? [{ value: "", label: tr(l, "No players", "Walang manlalaro") }]
                                : data.teams.flatMap(team => data.players.filter(player => player.team_id === team.team_id).map(player => ({ value: player.player_id, label: player.name, group: team.name })))} />
                        </label>
                        <label className="select-field">
                            <span>{tr(l, "Language", "Wika")}</span>
                            <Select label={tr(l, "Language", "Wika")} value={l} onValueChange={value => onChange("language", value as Language)} options={[{ value: "en", label: "English" }, { value: "fil", label: "Filipino" }]} portalContainer={settingsRef} />
                        </label>
                        <p>{tr(l, "Preferences update instantly. Your match keeps its place.", "Agad na magbabago ang pananaw. Hindi magsisimulang muli ang laban.")}</p>
                        <Button variant="secondary" onClick={() => { setSettings(false); triggerRef.current?.focus(); }}><Check size={14} aria-hidden="true" />{tr(l, "Done", "Tapos")}</Button>
                    </div>}
                </div>;
}

export function ViewControls({ data, preferences, onChange, showPreferences = true }: ViewControlsProps & { showPreferences?: boolean }) {
    const id = useId();
    const l = preferences.language;
    const modes: { id: ViewMode; title: string; description: string }[] = [
        { id: "casual", title: tr(l, "Casual Fan", "Tagahanga"), description: tr(l, "The story, simply told", "Simple at malinaw na kuwento") },
        { id: "analyst", title: tr(l, "Analyst", "Analista"), description: tr(l, "Every detail. All the evidence.", "Bawat detalye at ebidensiya") },
        { id: "player", title: tr(l, "Player Focus", "Pokus sa Manlalaro"), description: tr(l, "Follow one player's impact", "Sundan ang ambag ng manlalaro") },
    ];
    return <section className="panel analysis-controls" aria-labelledby={`${id}-heading`}>
        <div className="view-toolbar">
            <div className="view-toolbar-heading">
                <h2 id={`${id}-heading`}>{tr(l, "Your perspective", "Iyong pananaw")}</h2>
                {showPreferences && <PreferencesMenu data={data} preferences={preferences} onChange={onChange} />}
            </div>
            <div className="view-modes" role="group" aria-label={tr(l, "Viewing mode", "Paraan ng pagtingin")} aria-describedby={`${id}-description`}>
                {modes.map(mode => <button key={mode.id} type="button" aria-pressed={preferences.mode === mode.id} className={preferences.mode === mode.id ? "active" : ""} onClick={() => onChange("mode", mode.id)}>
                    {mode.id === "casual" ? <Activity size={14} aria-hidden="true" /> : mode.id === "analyst" ? <Settings2 size={14} aria-hidden="true" /> : <UserRound size={14} aria-hidden="true" />}
                    <span>{mode.title}</span>
                </button>)}
            </div>
            <p className="mode-description" id={`${id}-description`}>{modes.find(mode => mode.id === preferences.mode)?.description}</p>
        </div>
        {preferences.mode === "player" && <div className="focus-bar">
            <UserRound size={17} aria-hidden="true" /><label htmlFor={`${id}-player`}>{tr(l, "Following", "Sinusundan")}</label>
            <Select id={`${id}-player`} label={tr(l, "Following", "Sinusundan")} value={preferences.player} onValueChange={value => onChange("player", value)} disabled={data.players.length === 0} options={data.players.length === 0
                ? [{ value: "", label: tr(l, "No players", "Walang manlalaro") }]
                : data.teams.flatMap(team => data.players.filter(player => player.team_id === team.team_id).map(player => ({ value: player.player_id, label: player.name, group: team.name })))} />
            <span>{tr(l, "Player actions, accumulated stats, and personal insights", "Mga aksiyon, kabuuang estadistika, at personal na pagsusuri")}</span>
        </div>}
    </section>;
}
