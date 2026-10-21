# PitchPulse — Match Analysis Studio

## Experience

The home page is a game library. Opening a card enters a focused analysis studio modeled on an editing application's layout. The pitch is the primary viewer, with an event/library browser on the left, an analysis inspector on the right, and a transport/timeline below. This is structured-event replay; there is no actual video, clip export, or recorded player tracking.

The library begins with the one bundled synthetic demo. Additional games come from validated JSON imports. Never fabricate fixtures, dates, team crests, footage thumbnails, or final-result previews to fill the grid. Card previews use CSS pitch markings and team initials.

## Visual language

- Charcoal background `#111315`, surfaces `#1a1d20`, inset panels `#15191c`, borders `#30363a`.
- Green `#32D74B` for playback, actions, and active indicators; lime `#A3E635` for focus. Keep accents restrained.
- Home red `#FF6276` and away blue `#669CFF` consistently identify teams on the pitch, timeline, and comparisons. Use labels and distinct solid/dashed marks as well as color.
- Inter for interface text, JetBrains Mono for clock/data values. Both remain self-hosted.
- Library cards use rounded corners and generous spacing. Studio panels use shared edges, compact headers, and independent scrolling. Extend the existing tokens in `app/globals.css`; reuse the Base UI button/select components.

## Layout and navigation

- Library: branding, language, browser save status, introduction/import action, search, responsive card grid, quiet footer. Cards show teams, duration, source, saved progress, and annotation count.
- Studio: the pitch dominates the workspace. The event browser starts collapsed, the inspector stays narrow, and the top bars and bottom timeline remain compact. Pitch view options open from the **View** menu; note/bookmark actions share the pitch header.
- Browser tabs: reached events with team/player/type filters, or saved library entries with import.
- Inspector tabs: Details, Stats, Insights, Notes. Retain viewing modes, player focus, rule-based disclosures, commentary, evidence links, and boundary recaps.
- Desktop side panels collapse independently. Tablet/mobile stack the pitch, inspector, and browser; retain a single accessible playback dock with safe-area space. Zoomed tracks scroll inside their own viewport.

## Timeline and analysis

- Provide one native scrubber, a time ruler, playhead, half-time boundary, home/away event tracks, and saved annotation track. Fit/2×/4×/8× zoom changes scale only.
- Render only reached events. Group crowded markers and page their event lists; do not render 50,000 interactive markers.
- Selecting a reached event inspects its historical pitch snapshot without moving live playback or statistics. Keep a clear reviewing status and **Follow live** action.
- Notes capture the playhead or inspected event; bookmarks save the same exact anchor immediately. Both pause playback. Saved annotations remain accessible after rewinding. Selecting a note shows its text; **Go to moment** deliberately restores its saved prefix.
- Persist match JSON, annotations, and exact checkpoints in this browser. Communicate saved/saving/unsaved status accurately; storage failure must leave session analysis usable. There is no cloud account or cross-device sync.

## Accessibility and integrity

- Every visible label and accessible control supports English/Filipino through `tr`. Keep keyboard focus, skip links, accessible dropdowns, SVG descriptions, native scrubber keyboard navigation, and reduced-motion snapshots.
- Retain all playback invariants: elapsed time plus event cursor, explicit second-half transition, full-time stop, deterministic seeking/restart, and one shared movement clock. Reopening restores playback paused.
- Derive scores, statistics, insights, recaps, and event tracks only from the processed prefix. Strip embedded final summaries at validation. Only user-authored annotations can remain visible beyond a rewound playhead.
- Movement remains explicitly illustrative. Recorded-event view uses supplied positions only; no invented missing shot endpoints, possession percentages, player distances, tracking measurements, or calibrated probabilities.
- Insight facts and cautious interpretations remain separate, supported by reached evidence IDs. Local rules are not labeled AI.

See [README.md](README.md) for the user workflow and upload contract, and [AGENTS.md](AGENTS.md) for development and verification requirements.
