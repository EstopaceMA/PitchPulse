"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { maximumPanelWidth, resolvePanelWidths, type PanelWidths, type PreferredWidths } from "./studio-layout";

export function useStudioLayout(bodyRef: RefObject<HTMLDivElement | null>, browserOpen: boolean, inspectorOpen: boolean) {
    const [size, setSize] = useState({ width: 0, viewport: 0 });
    const [preferred, setPreferred] = useState<PreferredWidths>({ browser: null, inspector: null });
    const context = useMemo(() => ({ size, browserOpen, inspectorOpen }), [size, browserOpen, inspectorOpen]);
    // Hold the visible sibling fixed through a resize, without changing its preference.
    // A new layout context discards this temporary allocation, even on returning to an old size.
    const [allocation, setAllocation] = useState<{ context: typeof context; widths: PanelWidths } | null>(null);
    const rollback = useRef<{ preferred: PreferredWidths; allocation: typeof allocation } | null>(null);
    useEffect(() => {
        const body = bodyRef.current;
        if (!body) return;
        const measure = () => {
            const width = body.clientWidth, viewport = window.innerWidth;
            setSize(previous => previous.width === width && previous.viewport === viewport ? previous : { width, viewport });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(body);
        window.addEventListener("resize", measure);
        return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
    }, [bodyRef]);
    const open = { browser: browserOpen, inspector: inspectorOpen };
    const widths = allocation?.context === context ? allocation.widths : resolvePanelWidths(size.width, size.viewport, open, preferred);
    const begin = () => {
        rollback.current = { preferred, allocation };
        setAllocation({ context, widths });
    };
    const finish = (cancelled: boolean) => {
        if (cancelled && rollback.current) {
            setPreferred(rollback.current.preferred);
            setAllocation(rollback.current.allocation);
        }
        rollback.current = null;
    };
    return {
        desktop: size.viewport > 900,
        cancelKey: `${size.width}:${size.viewport}:${browserOpen}:${inspectorOpen}`,
        style: size.width ? { "--browser-width": `${widths.browser}px`, "--inspector-width": `${widths.inspector}px` } as CSSProperties : undefined,
        browser: {
            side: "browser" as const, value: widths.browser, max: maximumPanelWidth("browser", size.width, open, widths),
            onResizeStart: begin,
            onResize: (value: number) => {
                setPreferred(previous => ({ ...previous, browser: value }));
                setAllocation(previous => previous ? { ...previous, widths: { ...previous.widths, browser: value } } : previous);
            },
            onResizeEnd: finish,
            onReset: () => { setPreferred(previous => ({ ...previous, browser: null })); setAllocation(null); },
        },
        inspector: {
            side: "inspector" as const, value: widths.inspector, max: maximumPanelWidth("inspector", size.width, open, widths),
            onResizeStart: begin,
            onResize: (value: number) => {
                setPreferred(previous => ({ ...previous, inspector: value }));
                setAllocation(previous => previous ? { ...previous, widths: { ...previous.widths, inspector: value } } : previous);
            },
            onResizeEnd: finish,
            onReset: () => { setPreferred(previous => ({ ...previous, inspector: null })); setAllocation(null); },
        },
    };
}
