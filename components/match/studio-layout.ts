export type StudioSide = "browser" | "inspector";
export type PanelWidths = Record<StudioSide, number>;
export type PreferredWidths = Record<StudioSide, number | null>;
export type OpenPanels = Record<StudioSide, boolean>;

export const PANEL_LIMITS = { browser: { min: 200, max: 480 }, inspector: { min: 240, max: 560 } } as const;
export const SPLITTER_WIDTH = 8;
export const MIN_PITCH_WIDTH = 360;

export function defaultPanelWidths(viewport: number): PanelWidths {
    return viewport >= 1600 ? { browser: 250, inspector: 300 }
        : viewport <= 1150 ? { browser: 210, inspector: 250 } : { browser: 230, inspector: 280 };
}

export function clampPanelWidth(side: StudioSide, width: number, maximum: number = PANEL_LIMITS[side].max): number {
    return Math.max(PANEL_LIMITS[side].min, Math.min(maximum, width));
}

/** Layout preferences are never overwritten by a smaller viewport. */
export function resolvePanelWidths(width: number, viewport: number, open: OpenPanels, preferred: PreferredWidths): PanelWidths {
    const defaults = defaultPanelWidths(viewport);
    const wanted = {
        browser: clampPanelWidth("browser", preferred.browser ?? defaults.browser),
        inspector: clampPanelWidth("inspector", preferred.inspector ?? defaults.inspector),
    };
    const sides = (["browser", "inspector"] as const).filter(side => open[side]);
    const budget = width - MIN_PITCH_WIDTH - sides.length * SPLITTER_WIDTH;
    const minimum = sides.reduce((sum, side) => sum + PANEL_LIMITS[side].min, 0);
    const extra = sides.reduce((sum, side) => sum + wanted[side] - PANEL_LIMITS[side].min, 0);
    const scale = extra > 0 ? Math.min(1, Math.max(0, budget - minimum) / extra) : 1;
    for (const side of sides) wanted[side] = PANEL_LIMITS[side].min + (wanted[side] - PANEL_LIMITS[side].min) * scale;
    return wanted;
}

export function maximumPanelWidth(side: StudioSide, width: number, open: OpenPanels, actual: PanelWidths): number {
    const other = side === "browser" ? "inspector" : "browser";
    return Math.max(PANEL_LIMITS[side].min, Math.min(PANEL_LIMITS[side].max,
        width - MIN_PITCH_WIDTH - SPLITTER_WIDTH - (open[other] ? actual[other] + SPLITTER_WIDTH : 0)));
}

export function draggedPanelWidth(side: StudioSide, start: number, delta: number, maximum: number): number {
    return clampPanelWidth(side, start + (side === "browser" ? delta : -delta), maximum);
}
