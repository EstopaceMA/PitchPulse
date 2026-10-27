"use client";

import { useEffect, useMemo, useReducer } from "react";
import type { MatchData, PlaybackCheckpoint } from "./types";
import { initialPlayback, playbackReducer, restorePlayback, type PlaybackAction } from "./playback";
import { aggregate, cloneStatistics, reduceStatistics } from "./statistics";
import type { Statistics } from "./types";

export function useSimulation(data: MatchData, checkpoint?: PlaybackCheckpoint) {
  const [{ state, stats }, dispatch] = useReducer((previous: { state: ReturnType<typeof initialPlayback>; stats: Statistics }, action: PlaybackAction) => {
    const state = playbackReducer(data, previous.state, action);
    if (state.cursor === previous.state.cursor) return { state, stats: previous.stats };
    if (state.cursor < previous.state.cursor) return { state, stats: aggregate(data, data.events.slice(0, state.cursor)) };
    const stats = cloneStatistics(previous.stats);
    for (let i = previous.state.cursor; i < state.cursor; i++) reduceStatistics(stats, data.events[i]);
    return { state, stats };
  }, undefined, () => {
    const state = restorePlayback(data, checkpoint);
    return { state, stats: aggregate(data, data.events.slice(0, state.cursor)) };
  });
  useEffect(() => {
    if (state.status !== "playing") return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      dispatch({ type: "tick", seconds: (now - last) / 1000 });
      last = now;
    // The formation animation consumes this same clock, not an independent timer.
    }, 33);
    return () => clearInterval(timer);
  }, [state.status, state.speed]);
  const events = useMemo(() => data.events.slice(0, state.cursor), [data, state.cursor]);
  return { state, dispatch, events, stats };
}
