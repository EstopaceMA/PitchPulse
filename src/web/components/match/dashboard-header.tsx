"use client";

import { Activity, LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { tr } from "@/lib/match/presentation";
import type { MatchStatus } from "@/lib/match/playback";
import type { MatchData, Preferences } from "@/lib/match/types";
import { PreferencesMenu } from "./view-controls";
import { FootballMark } from "./football-mark";

export function Brand() {
    return <a href="#" className="brand" aria-label="PitchPulse home"><span className="brand-mark"><Activity size={24} strokeWidth={2.3} aria-hidden="true" /><span className="brand-ball"><FootballMark size={15} /></span></span><span>pitch<span className="brand-light">pulse</span><span className="brand-period">.</span></span></a>;
}

export function DashboardHeader({ data, preferences, source, sourceKind, loading, status, statusText, onChange, onUpload, onDemo, onInsights }: {
    data: MatchData;
    preferences: Preferences;
    source: string;
    sourceKind: "demo" | "upload";
    loading: boolean;
    status: MatchStatus;
    statusText: string;
    onChange: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
    onUpload: () => void;
    onDemo: () => void;
    onInsights: () => void;
}) {
    const l = preferences.language;
    return <header className="topbar">
        <div className="topbar-inner">
            <Brand />
            <nav className="top-navigation" aria-label={tr(l, "mainNavigation")}>
                <a href="#main-content" className="active">{tr(l, "matchCentre")}</a>
                <a href="#insights" onClick={onInsights}>{tr(l, "insights")}</a>
            </nav>
            <div className="header-preferences"><PreferencesMenu data={data} preferences={preferences} onChange={onChange} compact /></div>
        </div>
        <div className="matchbar">
            <div className="matchbar-inner">
                <div className="matchbar-controls">
                    <label className="scenario-select">
                        <span>{tr(l, "match")}</span>
                        <Select label={tr(l, "matchScenario")} title={sourceKind === "upload" ? source : tr(l, "arsenalVsChelseaSyntheticDemo")} value={sourceKind} disabled={loading} onValueChange={value => { if (value === "demo") onDemo(); }} options={[
                            { value: "demo", label: tr(l, "arsenalVsChelseaDemo") },
                            ...(sourceKind === "upload" ? [{ value: "upload", label: source }] : []),
                        ]} />
                    </label>
                    <Button variant="outline" className="upload-button" aria-label={tr(l, "loadMatch")} disabled={loading} onClick={onUpload}>
                        {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                        <span>{tr(l, "loadMatch")}</span>
                    </Button>
                </div>
                <span className={`header-status ${status}`}><span className="tiny-dot" aria-hidden="true" /><span className="sr-only">{tr(l, "simulationStatus")}</span>{statusText}</span>
            </div>
        </div>
    </header>;
}
