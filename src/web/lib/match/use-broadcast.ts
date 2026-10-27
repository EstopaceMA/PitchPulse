"use client";

import { useEffect, useRef, useState } from "react";
import type { PlaybackState } from "./playback";
import type { Preferences } from "./types";

/**
 * Studio → broadcast window sync on one browser. The studio owns the clock and preferences; the broadcast view
 * only renders them, so its overlays never run ahead of the studio's processed prefix.
 */
export type BroadcastState = Pick<PlaybackState, "elapsed" | "cursor" | "secondHalf" | "status"> & { preferences: Preferences };
type Message = { type: "state"; state: BroadcastState } | { type: "hello" };
const channelName = (id: string) => `pitchpulse-broadcast:${id}`;

/** Posts every studio change, and answers a newly opened broadcast window straight away. */
export function useBroadcastPublisher(id: string, state: BroadcastState) {
    const latest = useRef(state);
    const channel = useRef<BroadcastChannel | null>(null);
    useEffect(() => {
        if (typeof BroadcastChannel === "undefined") return;
        const opened = channel.current = new BroadcastChannel(channelName(id));
        opened.onmessage = (event: MessageEvent<Message>) => { if (event.data?.type === "hello") opened.postMessage({ type: "state", state: latest.current } satisfies Message); };
        return () => { opened.close(); channel.current = null; };
    }, [id]);
    useEffect(() => {
        latest.current = state;
        channel.current?.postMessage({ type: "state", state } satisfies Message);
    }, [state]);
}

/** The latest studio state for this match, or null until the studio answers. */
export function useBroadcastSubscriber(id: string, enabled: boolean): BroadcastState | null {
    const [state, setState] = useState<BroadcastState | null>(null);
    useEffect(() => {
        if (!enabled || typeof BroadcastChannel === "undefined") return;
        const channel = new BroadcastChannel(channelName(id));
        channel.onmessage = (event: MessageEvent<Message>) => { if (event.data?.type === "state") setState(event.data.state); };
        channel.postMessage({ type: "hello" } satisfies Message);
        return () => channel.close();
    }, [id, enabled]);
    return state;
}
