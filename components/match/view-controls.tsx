"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { Check, ChevronDown, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { tr } from "@/lib/match/presentation";
import type { Language, MatchData, Preferences, ViewMode } from "@/lib/match/types";

type ViewControlsProps = {
    data: MatchData;
    preferences: Preferences;
    onChange: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
};

/** Session-only and off by default, like the other preferences. */
export interface AiPreference { available: boolean; enabled: boolean; onChange: (enabled: boolean) => void }

export function PreferencesMenu({ data, preferences, onChange, compact = false, ai }: ViewControlsProps & { compact?: boolean; ai?: AiPreference }) {
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
        <Button ref={triggerRef} variant="ghost" className="personalize-button" aria-label={compact ? tr(l, "Preferences", "Mga setting") : undefined} title={compact ? tr(l, "Perspective, team, player and language preferences", "Mga setting ng pananaw, koponan, manlalaro at wika") : undefined} aria-expanded={settings} aria-controls={`${id}-preferences`} onClick={() => setSettings(open => !open)}>
            <Settings2 size={14} aria-hidden="true" /><span>{compact ? tr(l, "Preferences", "Mga setting") : tr(l, "Make it yours", "Iayon sa iyo")}</span><ChevronDown size={12} aria-hidden="true" />
        </Button>
        {settings && <div className="preferences-popover" id={`${id}-preferences`}>
            <h3>{tr(l, "Preferences", "Mga setting")}</h3>
            <PerspectiveSelect preferences={preferences} onChange={onChange} portalContainer={settingsRef} />
            <label className="select-field">
                <span>{tr(l, "Favorite team", "Paboritong koponan")}</span>
                <Select label={tr(l, "Favorite team", "Paboritong koponan")} value={preferences.team} onValueChange={value => onChange("team", value)} options={data.teams.map(team => ({ value: team.team_id, label: team.name }))} portalContainer={settingsRef} />
            </label>
            <label className="select-field">
                <span>{preferences.mode === "player" ? tr(l, "Following player", "Sinusundang manlalaro") : tr(l, "Favorite player", "Paboritong manlalaro")}</span>
                <Select label={preferences.mode === "player" ? tr(l, "Following player", "Sinusundang manlalaro") : tr(l, "Favorite player", "Paboritong manlalaro")} value={preferences.player} onValueChange={value => onChange("player", value)} disabled={data.players.length === 0} portalContainer={settingsRef} options={data.players.length === 0
                    ? [{ value: "", label: tr(l, "No players", "Walang manlalaro") }]
                    : data.teams.flatMap(team => data.players.filter(player => player.team_id === team.team_id).map(player => ({ value: player.player_id, label: player.name, group: team.name })))} />
            </label>
            <label className="select-field">
                <span>{tr(l, "Language", "Wika")}</span>
                <Select label={tr(l, "Language", "Wika")} value={l} onValueChange={value => onChange("language", value as Language)} options={[{ value: "en", label: "English" }, { value: "fil", label: "Filipino" }]} portalContainer={settingsRef} />
            </label>
            {ai && <label className="ai-toggle">
                <input type="checkbox" checked={ai.enabled} disabled={!ai.available} onChange={event => ai.onChange(event.target.checked)} aria-describedby={`${id}-ai-note`} />
                <span><b>{tr(l, "AI analysis (Microsoft Foundry)", "Pagsusuri ng AI (Microsoft Foundry)")}</b><small id={`${id}-ai-note`}>{ai.available
                    ? tr(l, "Off by default. When on, only the AI buttons you press send this match’s reached events to your Foundry project, where responses are stored.", "Naka-off bilang default. Kapag naka-on, ang mga AI button lamang na pipindutin mo ang magpapadala ng mga naabot na pangyayari ng laban sa iyong Foundry project, kung saan naiimbak ang mga sagot.")
                    : tr(l, "Not configured on this server. Local analysis is unaffected.", "Hindi naka-configure sa server na ito. Hindi apektado ang lokal na pagsusuri.")}</small></span>
            </label>}
            <p>{tr(l, "Preferences update instantly. Your match keeps its place.", "Agad na magbabago ang pananaw. Hindi magsisimulang muli ang laban.")}</p>
            <Button variant="secondary" onClick={() => { setSettings(false); triggerRef.current?.focus(); }}><Check size={14} aria-hidden="true" />{tr(l, "Done", "Tapos")}</Button>
        </div>}
    </div>;
}

export function perspectiveLabel(mode: ViewMode, language: Language) {
    return { casual: tr(language, "Casual Fan", "Tagahanga"), analyst: tr(language, "Analyst", "Analista"), player: tr(language, "Player Focus", "Pokus sa Manlalaro") }[mode];
}

export function PerspectiveSelect({ preferences, onChange, portalContainer }: Pick<ViewControlsProps, "preferences" | "onChange"> & { portalContainer?: ComponentProps<typeof Select>["portalContainer"] }) {
    return <label className="select-field"><span>{tr(preferences.language, "Perspective", "Pananaw")}</span>
        <Select label={tr(preferences.language, "Perspective", "Pananaw")} value={preferences.mode} onValueChange={value => onChange("mode", value as ViewMode)} options={(["casual", "analyst", "player"] as const).map(value => ({ value, label: perspectiveLabel(value, preferences.language) }))} portalContainer={portalContainer} />
    </label>;
}
