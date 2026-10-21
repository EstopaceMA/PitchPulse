# PitchPulse — Match Analysis Studio

## Experience

The home page is a game library. Opening a card enters a focused analysis studio modeled on an editing application's layout. The pitch is the primary viewer, with an event/library browser on the left, an analysis inspector on the right, and a transport/timeline below. This is structured-event replay; there is no actual video, clip export, or recorded player tracking.

The library begins with the one bundled synthetic demo. Additional games come from validated JSON imports. Never fabricate fixtures, dates, team crests, footage thumbnails, or final-result previews to fill the grid. Card previews use CSS pitch markings and team initials.

## Visual language

- Charcoal background `#111315`, surfaces `#1a1d20`, inset panels `#15191c`, borders `#30363a`.
- Green `#32D74B` for playback, actions, and active indicators; lime `#A3E635` for focus. Keep accents restrained.
- Home red `#FF6276` and away blue `#669CFF` consistently identify teams on the pitch, timeline, and comparisons. Use labels and distinct solid/dashed marks as well as color.
- Violet `#b9a7ff` (`--ai-accent`) marks Microsoft Foundry AI output only: the **AI · Microsoft Foundry** badge, AI tags, and the left rule on AI cards. It always appears with a text label, never color alone.
- Inter for interface text, JetBrains Mono for clock/data values. Both remain self-hosted.
- Library cards use rounded corners and generous spacing. Studio panels use shared edges, compact headers, and independent scrolling. Extend the existing tokens in `app/globals.css`; reuse the Base UI button/select components.

## Layout and navigation

- Library: branding, language, browser save status, a compact match-library heading/count, search, one import action with its JSON size limit, and a responsive card grid. Each card has one link covering its preview and title; deletion is a separate control. Cards show teams, duration, source, saved progress, and annotation count.
- Studio: the pitch dominates the workspace. The event browser starts collapsed, the inspector stays narrow, and the top bars and bottom timeline remain compact. Browser/inspector toggles, **View**, and note/bookmark actions share a wrapping pitch header. Keep score, clock, save status, and Preferences in the top bar without a separate workbar.
- Browser tabs: reached events with team/player/type filters, or saved library entries with import.
- Inspector tabs: Details, Stats, Insights, Notes, plus **Ask** only while AI analysis is on. Perspective and player focus live in Preferences, with a compact active-perspective label in the inspector. Retain rule-based disclosures, commentary, evidence links, and boundary recaps.
- AI analysis is opt-in per session (Preferences, or the Insights call to action) and is disabled with an explanation when the server isn't configured. AI sections sit beside, never inside, the rule-based panels: the AI analysis section under the rule-based insights, the AI recap under the statistics recap, and narration under each templated commentary row. On desktop, the Ask question box stays pinned at the bottom of the inspector.
- Desktop side panels collapse independently and have 8px draggable dividers. Browser widths range from 200–480px and inspector widths from 240–560px, constrained to leave at least 360px for the pitch. Preserve the current responsive defaults, keep the opposite panel fixed during dragging, and proportionally constrain preferred widths when the window shrinks. Width preferences last for the mounted studio only. Dividers support pointer capture, bilingual separator labels, arrows (10px; Shift 50px), Home/End limits, Enter/double-click reset, and Escape cancellation. Remove splitters from view and keyboard navigation at 900px and below. Tablet/mobile stack the pitch, inspector, and browser; retain a single accessible playback dock with safe-area space. Zoomed tracks scroll inside their own viewport.

## Timeline and analysis

- Provide one native scrubber, a time ruler, playhead, half-time boundary, home/away event tracks, and saved annotation track. Labeled speed and zoom selects share the transport row. Fit/2×/4×/8× zoom changes scale only; event and annotation tracks stay visible.
- Render only reached events. Group crowded markers and page their event lists; do not render 50,000 interactive markers.
- Selecting a reached event inspects its historical pitch snapshot without moving live playback or statistics. Keep a reviewing status, inspected-event time, and **Follow live** together in the pitch header. The Events panel shows the reached-event count.
- Notes capture the playhead or inspected event; bookmarks save the same exact anchor immediately. Both pause playback. Saved annotations remain accessible after rewinding. Selecting a note shows its text; **Go to moment** deliberately restores its saved prefix.
- Persist match JSON, annotations, and exact checkpoints in this browser. Communicate saved/saving/unsaved status accurately; storage failure must leave session analysis usable. There is no cloud account or cross-device sync.

## Accessibility and integrity

- Every visible label and accessible control supports English/Filipino through `tr`. Keep keyboard focus, skip links, accessible dropdowns, SVG descriptions, native scrubber keyboard navigation, and reduced-motion snapshots.
- Retain all playback invariants: elapsed time plus event cursor, explicit second-half transition, full-time stop, deterministic seeking/restart, and one shared movement clock. Reopening restores playback paused.
- Derive scores, statistics, insights, recaps, and event tracks only from the processed prefix. Strip embedded final summaries at validation. Only user-authored annotations can remain visible beyond a rewound playhead.
- Keep a concise movement and fictional-demo disclosure visible above the pitch. Put the legend, interaction hints, and detailed explanations in a collapsed **About this view** section; show raw event IDs in event details rather than the current-action summary. Movement remains explicitly illustrative. Recorded-event view uses supplied positions only; no invented missing shot endpoints, possession percentages, player distances, tracking measurements, or calibrated probabilities.
- Insight facts and cautious interpretations remain separate, supported by reached evidence IDs. Local rules are not labeled AI, and AI output is always labeled AI.
- AI requests pause playback and describe that frozen moment ("As of mm:ss"). Results and chat from a later playhead are hidden after a rewind, like future events. AI evidence opens the same historical inspection as rule evidence. When the evidence list is capped, the full count is stated.

See [README.md](README.md) for the user workflow and upload contract, and [AGENTS.md](AGENTS.md) for development and verification requirements.
