# DESIGN.md - "PitchPulse" Football Match Intelligence

## 1. Visual Theme & Atmosphere
The design should convey **live match energy**, **analytical clarity**, and **control**. The interface should feel like a professional football analytics dashboard, with clear insights that fans and broadcasters can understand.

PitchPulse uses **synthetic football events** to simulate live matches, surface key moments, generate commentary, and produce automated match recaps. The experience should work well on laptops and tablets.

## 2. Color Palette

- **Primary Background:** `#101411` (Deep dark green for visual comfort).
- **Card Surface:** `#19211B`.
- **Primary Accent (Data):** `#32D74B` (Vibrant Green) for charts, key statistics, and action buttons.
- **Highlight Accent:** `#A3E635` (Lime) for key moments and selected states.
- **Alert Accent:** `#FF453A` (Red) for red cards, errors, and critical alerts.
- **Caution Accent:** `#FFCC00` (Yellow) for yellow cards and warnings.
- **Primary Text:** `#FFFFFF`.
- **Secondary Text:** `#9BA89E` (Muted gray-green for labels).
- **Borders and Grid Lines:** `#2A362D`.

## 3. Component Styling

- **Cards:** `border-radius: 16px`. Background: `#19211B`. Internal padding: `20px`. Subtle border: `1px solid #2A362D`.
- **Scoreboard:** Prominent team names, scores, match clock, and match phase. Include a visible **“Simulated Match”** label.
- **Charts:** Grid lines in `#2A362D`. Team comparisons use the same red home (`#FF6276`) and blue away (`#669CFF`) colors as the pitch, with distinct line styles and labels. Reserve green for non-team data and actions.
- **Pitch Visualization:** Muted green pitch with thin markings. Display event positions, passes, and shots using clear markers and restrained animations.
- **Event Feed:** Timestamped rows with event icons, team names, and short descriptions. Hover background: `#223026`.
- **Insight Cards:** Pair each AI-generated insight with supporting statistics or linked match events.
- **Alerts:** Background: `#3A1C1C`. Text: `#FF453A`. Left border: `4px solid #FF453A`.
- **Simulator Controls:** Clear Start, Pause, and Reset buttons, alongside playback speed and scenario selection.
- **Dropdowns:** Shared Base UI selects with inset dark triggers, visible chevrons, lime focus/selection states, and selected-item checkmarks. Group players by team in scrollable, viewport-bounded menus; preserve 44px targets, keyboard/type-ahead navigation, and reduced-motion support.

## 4. Typography

- **Headings:** Inter, Semi Bold, 24px.
- **Scoreboard:** Inter, Bold, 40px.
- **Match Clock:** JetBrains Mono or Fira Code, Bold, 32px. Use tabular numbers to prevent shifting.
- **Body and Commentary:** Inter Regular, 14px.
- **Labels and Timestamps:** Inter Medium, 12px.

## 5. Layout Principles

- **Grid:** 12 columns.
- **Spacing:** Multiples of 8px (8px, 16px, 24px, 32px).
- **Header:** PitchPulse branding, match selection, simulation status, and personalization settings.
- **Scoreboard:** Full-width match summary with teams, score, clock, and simulator controls.
- **Statistics:** Keep shots, shots on target, and pass accuracy in the Match statistics panel. Do not duplicate them in a separate KPI row between the scoreboard and pitch.
- **Main Area:** Pitch visualization and match statistics spanning 8 columns. Live commentary and key moments spanning 4 columns on the right.
- **Lower Area:** Event timeline, explainable AI insights, and match recap.
- **Tablet Layout:** Stack panels in reading order while keeping the scoreboard and simulator controls easy to access.

## 6. Do’s and Don’ts

- ✅ **Do:** Use green as the primary accent with restrained gradients.
- ✅ **Do:** Clearly label synthetic data and simulated live playback.
- ✅ **Do:** Ground commentary and recaps in events that have already occurred.
- ✅ **Do:** Show why a key moment matters using supporting events and statistics.
- ✅ **Do:** Allow users to choose a favorite team, commentary language, and detail level.
- ✅ **Do:** Use text and icons alongside colors to distinguish teams and event types.
- ❌ **Don’t:** Present synthetic matches as real fixtures or live results.
- ❌ **Don’t:** Invent player actions, statistics, or explanations unsupported by the event data.
- ❌ **Don’t:** Reveal future events or the final result before playback reaches them.
- ❌ **Don’t:** Overload the dashboard with animations, neon effects, or decorative graphics.
- ❌ **Don’t:** Include video playback controls; the simulator is driven by structured match events.

## 7. Current implementation and data boundaries

- Possession is **unavailable** and is not shown as a metric: the event dataset does not record possession durations. Never estimate a percentage from event counts or timestamps.
- Commentary, key moments, statistics, and recaps receive only processed events or statistics reduced from that prefix. Seeking backward removes later contributions.
- Insights are currently **local, rule-based**, not AI-generated. Keep that visible disclosure and supporting evidence; `InsightProvider` remains the future AI adapter boundary.
- Scenario selection offers the bundled synthetic demonstration and validated JSON uploads. No invented scenarios, disciplinary events, or future-result previews are added.
- Keep the header uncluttered: branding/navigation/preferences occupy the primary row; match selection, one upload action, and a compact status badge occupy a separate contextual row. Language is inside Preferences, not duplicated in the header. On small screens the labeled settings icon opens the same preferences.
- Inter and JetBrains Mono are self-hosted. Mobile retains one accessible playback dock and analysis switching; tablet panels stack without hiding primary controls.
- Team identity on the pitch and in Match statistics uses the shared red/blue team colors. Comparison labels, values, and bars use red for home and blue for away, including recap comparisons. Preserve solid home and dashed/striped away marks; colors are never the sole identifier.
- Panel headings use 24px; compact card labels and timestamps use 12px. Cards use a 20px content inset, with layout gaps on the 8px scale.

See [AGENTS.md](AGENTS.md) for implementation invariants and [README.md](README.md) for the upload contract and verification workflow.