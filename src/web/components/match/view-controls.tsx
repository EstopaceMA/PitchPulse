"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { Check, ChevronDown, Settings2, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { tr } from "@/lib/match/presentation";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/locales";
import { focusMetricLabel } from "@/lib/match/overlays";
import { FOCUS_METRICS, type FocusMetric, type Language, type MatchData, type Preferences, type Units, type ViewMode } from "@/lib/match/types";

type ViewControlsProps = {
    data: MatchData;
    preferences: Preferences;
    onChange: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
};

export function PreferencesMenu({ data, preferences, onChange, compact = false, aiAvailable = false }: ViewControlsProps & { compact?: boolean; aiAvailable?: boolean }) {
    const [settings, setSettings] = useState(false);
    const settingsRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const id = useId();
    const l = preferences.language;
    const favorites = preferences.favorites ?? [];
    const playerName = (playerId: string) => data.players.find(player => player.player_id === playerId)?.name ?? playerId;
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
        <Button ref={triggerRef} variant="ghost" className="personalize-button" aria-label={compact ? tr(l, "preferences") : undefined} title={compact ? tr(l, "perspectiveTeamPlayerAndLanguagePreferences") : undefined} aria-expanded={settings} aria-controls={`${id}-preferences`} onClick={() => setSettings(open => !open)}>
            <Settings2 size={14} aria-hidden="true" /><span>{compact ? tr(l, "preferences") : tr(l, "makeItYours")}</span><ChevronDown size={12} aria-hidden="true" />
        </Button>
        {settings && <div className="preferences-popover" id={`${id}-preferences`}>
            <h3>{tr(l, "preferences")}</h3>
            <PerspectiveSelect preferences={preferences} onChange={onChange} portalContainer={settingsRef} />
            <label className="select-field">
                <span>{tr(l, "favoriteTeam")}</span>
                <Select label={tr(l, "favoriteTeam")} value={preferences.team} onValueChange={value => onChange("team", value)} options={data.teams.map(team => ({ value: team.team_id, label: team.name }))} portalContainer={settingsRef} />
            </label>
            <label className="select-field">
                <span>{preferences.mode === "player" ? tr(l, "followingPlayer") : tr(l, "favoritePlayer")}</span>
                <Select label={preferences.mode === "player" ? tr(l, "followingPlayer") : tr(l, "favoritePlayer")} value={preferences.player} onValueChange={value => onChange("player", value)} disabled={data.players.length === 0} portalContainer={settingsRef} options={data.players.length === 0
                    ? [{ value: "", label: tr(l, "noPlayers") }]
                    : data.teams.flatMap(team => data.players.filter(player => player.team_id === team.team_id).map(player => ({ value: player.player_id, label: player.name, group: team.name })))} />
            </label>
            <div className="favorite-players" role="group" aria-label={tr(l, "favoritePlayers")}>
                <span>{tr(l, "favoritePlayers")}</span>
                {favorites.length ? <ul>{favorites.map(playerId => <li key={playerId}><Star size={12} aria-hidden="true" />{playerName(playerId)}<button type="button" aria-label={tr(l, "removeFavorite", { name: playerName(playerId) })} onClick={() => onChange("favorites", favorites.filter(entry => entry !== playerId))}><X size={12} aria-hidden="true" /></button></li>)}</ul> : <p>{tr(l, "noFavoritePlayersYet")}</p>}
                {preferences.player && !favorites.includes(preferences.player) && <Button size="sm" variant="ghost" onClick={() => onChange("favorites", [preferences.player, ...favorites])}><Star size={13} aria-hidden="true" />{tr(l, "addToFavorites", { name: playerName(preferences.player) })}</Button>}
            </div>
            <label className="select-field">
                <span>{tr(l, "myMetric")}</span>
                <Select label={tr(l, "myMetric")} value={preferences.metric ?? ""} onValueChange={value => onChange("metric", (value || null) as FocusMetric | null)} options={[{ value: "", label: tr(l, "noMetric") }, ...FOCUS_METRICS.map(metric => ({ value: metric, label: focusMetricLabel(metric, l) }))]} portalContainer={settingsRef} />
            </label>
            <label className="select-field">
                <span>{tr(l, "units")}</span>
                <Select label={tr(l, "units")} value={preferences.units ?? "metric"} onValueChange={value => onChange("units", value as Units)} options={[{ value: "metric", label: tr(l, "unitsMetric") }, { value: "imperial", label: tr(l, "unitsImperial") }]} portalContainer={settingsRef} />
            </label>
            {aiAvailable && <label className="checkbox-field"><input type="checkbox" checked={!!preferences.autoExplain} onChange={event => onChange("autoExplain", event.target.checked)} /><span>{tr(l, "explainKeyMomentsAutomatically")}<small>{tr(l, "autoExplainHint")}</small></span></label>}
            <label className="select-field">
                <span>{tr(l, "language")}</span>
                <Select label={tr(l, "language")} value={l} onValueChange={value => onChange("language", value as Language)} options={LOCALES.map(locale => ({ value: locale, label: LOCALE_NAMES[locale] }))} portalContainer={settingsRef} />
            </label>
            <Button variant="secondary" onClick={() => { setSettings(false); triggerRef.current?.focus(); }}><Check size={14} aria-hidden="true" />{tr(l, "done")}</Button>
        </div>}
    </div>;
}

export function perspectiveLabel(mode: ViewMode, language: Language) {
    return { casual: tr(language, "casualFan"), analyst: tr(language, "analyst"), player: tr(language, "playerFocus") }[mode];
}

export function PerspectiveSelect({ preferences, onChange, portalContainer }: Pick<ViewControlsProps, "preferences" | "onChange"> & { portalContainer?: ComponentProps<typeof Select>["portalContainer"] }) {
    return <label className="select-field"><span>{tr(preferences.language, "perspective")}</span>
        <Select label={tr(preferences.language, "perspective")} value={preferences.mode} onValueChange={value => onChange("mode", value as ViewMode)} options={(["casual", "analyst", "player"] as const).map(value => ({ value, label: perspectiveLabel(value, preferences.language) }))} portalContainer={portalContainer} />
    </label>;
}
