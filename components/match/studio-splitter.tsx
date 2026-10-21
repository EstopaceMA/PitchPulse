"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { tr } from "@/lib/match/presentation";
import type { Language } from "@/lib/match/types";
import { draggedPanelWidth, PANEL_LIMITS, type StudioSide } from "./studio-layout";

type SplitterProps = {
    side: StudioSide;
    panelId: string;
    language: Language;
    value: number;
    max: number;
    cancelKey: string;
    onResizeStart: () => void;
    onResize: (width: number) => void;
    onResizeEnd: (cancelled: boolean) => void;
    onReset: () => void;
};
type Drag = {
    pointerId: number; x: number; width: number; max: number; side: StudioSide;
    element: HTMLDivElement; resize: SplitterProps["onResize"]; finish: SplitterProps["onResizeEnd"]; cleanup: () => void;
};

export function StudioSplitter({ side, panelId, language: l, value, max, cancelKey, onResizeStart, onResize, onResizeEnd, onReset }: SplitterProps) {
    const helpId = useId();
    const drag = useRef<Drag | null>(null);
    const [dragging, setDragging] = useState(false);
    const finish = useCallback((cancelled: boolean) => {
        const current = drag.current;
        if (!current) return;
        drag.current = null;
        current.cleanup();
        if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
        document.documentElement.classList.remove("studio-resizing");
        setDragging(false);
        current.finish(cancelled);
    }, []);
    // Panel closure/unmount, viewport changes and layout changes all end the gesture.
    useEffect(() => () => finish(true), [cancelKey, finish]);
    const help = tr(l, "Drag or use Left/Right arrows to resize. Shift moves faster. Home/End set minimum/maximum. Enter or double-click resets. Escape cancels dragging.", "I-drag o gamitin ang kaliwa/kanang arrow upang baguhin ang lapad. Mas mabilis sa Shift. Home/End para sa pinakamaliit/pinakamalaki. Enter o dobleng click upang i-reset. Escape upang kanselahin ang pag-drag.");
    return <div className="studio-splitter" role="separator" tabIndex={0} aria-orientation="vertical"
        aria-label={side === "browser" ? tr(l, "Resize browser panel", "Baguhin ang lapad ng browser") : tr(l, "Resize inspector panel", "Baguhin ang lapad ng tagasuri")}
        aria-controls={panelId} aria-valuemin={PANEL_LIMITS[side].min} aria-valuemax={max} aria-valuenow={value}
        aria-valuetext={tr(l, `${Math.round(value)} pixels wide`, `${Math.round(value)} pixel ang lapad`)} aria-describedby={helpId}
        data-side={side} data-dragging={dragging} title={help}
        onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0 || drag.current || document.documentElement.classList.contains("studio-resizing")) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            const escape = (key: KeyboardEvent) => { if (key.key === "Escape") { key.preventDefault(); finish(true); } };
            const blur = () => finish(true);
            window.addEventListener("keydown", escape);
            window.addEventListener("blur", blur);
            drag.current = { pointerId: event.pointerId, x: event.clientX, width: value, max, side, element: event.currentTarget, resize: onResize, finish: onResizeEnd,
                cleanup: () => { window.removeEventListener("keydown", escape); window.removeEventListener("blur", blur); } };
            document.documentElement.classList.add("studio-resizing");
            setDragging(true);
            onResizeStart();
        }}
        onPointerMove={event => {
            const current = drag.current;
            if (current?.pointerId === event.pointerId) current.resize(draggedPanelWidth(current.side, current.width, event.clientX - current.x, current.max));
        }}
        onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) finish(false); }}
        onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) finish(true); }}
        onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) finish(true); }}
        onDoubleClick={onReset}
        onKeyDown={event => {
            if (drag.current) return;
            if (event.key === "Enter") { event.preventDefault(); onReset(); return; }
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? PANEL_LIMITS[side].min : event.key === "End" ? max
                : draggedPanelWidth(side, value, (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 50 : 10), max);
            onResizeStart(); onResize(next); onResizeEnd(false);
        }}>
        <span className="splitter-grip" aria-hidden="true" /><span id={helpId} className="sr-only">{help}</span>
    </div>;
}
