import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPanelWidths, draggedPanelWidth, maximumPanelWidth, resolvePanelWidths, MIN_PITCH_WIDTH, PANEL_LIMITS, SPLITTER_WIDTH } from "./studio-layout";
import { StudioSplitter } from "./studio-splitter";

const both = { browser: true, inspector: true };
const defaults = { browser: null, inspector: null };
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .001, `${actual} != ${expected}`);

test("studio keeps its responsive defaults until explicitly resized", () => {
    assert.deepEqual(defaultPanelWidths(1000), { browser: 210, inspector: 250 });
    assert.deepEqual(defaultPanelWidths(1440), { browser: 230, inspector: 280 });
    assert.deepEqual(defaultPanelWidths(1920), { browser: 250, inspector: 300 });
    assert.deepEqual(resolvePanelWidths(1440, 1440, both, defaults), defaultPanelWidths(1440));
    assert.deepEqual(resolvePanelWidths(1440, 1440, both, { browser: 360, inspector: null }), { browser: 360, inspector: 280 });
});

test("dragging moves either divider in the pointer direction and respects limits", () => {
    assert.equal(draggedPanelWidth("browser", 230, 50, 480), 280);
    assert.equal(draggedPanelWidth("inspector", 280, 50, 560), 240);
    assert.equal(draggedPanelWidth("inspector", 280, -50, 560), 330);
    assert.equal(draggedPanelWidth("browser", 230, -1000, 480), 200);
    assert.equal(draggedPanelWidth("browser", 230, 1000, 315), 315);
    assert.equal(draggedPanelWidth("inspector", 280, -1000, 420), 420);
});

test("constrained layouts share available extra space without overwriting preferences", () => {
    const preferred = Object.freeze({ browser: 480, inspector: 560 });
    const widths = resolvePanelWidths(901, 901, both, preferred);
    near((widths.browser - 200) / 280, (widths.inspector - 240) / 320);
    near(901 - widths.browser - widths.inspector - 2 * SPLITTER_WIDTH, MIN_PITCH_WIDTH);
    assert.deepEqual(resolvePanelWidths(1800, 1800, both, preferred), preferred);
    assert.deepEqual(preferred, { browser: 480, inspector: 560 });
});

test("closing a panel releases its space and reopening restores preferred widths", () => {
    const preferred = { browser: 480, inspector: 560 };
    assert.equal(resolvePanelWidths(1000, 1000, { browser: false, inspector: true }, preferred).inspector, 560);
    assert.equal(resolvePanelWidths(1000, 1000, { browser: true, inspector: false }, preferred).browser, 480);
    assert.deepEqual(resolvePanelWidths(1600, 1600, both, preferred), preferred);
    assert.equal(maximumPanelWidth("inspector", 1000, { browser: false, inspector: true }, preferred), 560);
});

test("all desktop configurations reserve the pitch and clamp each resize against its fixed sibling", () => {
    for (const width of [901, 1000, 1150, 1280, 1440, 1920]) {
        for (const browser of [false, true]) for (const inspector of [false, true]) {
            const open = { browser, inspector };
            const actual = resolvePanelWidths(width, width, open, { browser: 480, inspector: 560 });
            const used = (browser ? actual.browser + 8 : 0) + (inspector ? actual.inspector + 8 : 0);
            assert.ok(width - used >= MIN_PITCH_WIDTH - .001);
            for (const side of ["browser", "inspector"] as const) {
                assert.ok(actual[side] >= PANEL_LIMITS[side].min && actual[side] <= PANEL_LIMITS[side].max);
                if (!open[side]) continue;
                const max = maximumPanelWidth(side, width, open, actual);
                assert.ok(max >= actual[side] - .001);
                const other = side === "browser" ? "inspector" : "browser";
                assert.ok(width - max - 8 - (open[other] ? actual[other] + 8 : 0) >= MIN_PITCH_WIDTH - .001);
            }
        }
    }
});

test("splitters expose bilingual names, panel associations, width bounds and keyboard instructions", () => {
    const noop = () => {};
    for (const side of ["browser", "inspector"] as const) for (const language of ["en", "fil"] as const) {
        const html = renderToStaticMarkup(<StudioSplitter side={side} panelId={`test-${side}`} language={language} value={300} max={480} cancelKey="test" onResizeStart={noop} onResize={noop} onResizeEnd={noop} onReset={noop} />);
        assert.match(html, /role="separator" tabindex="0" aria-orientation="vertical"/);
        assert.ok(html.includes(`aria-controls="test-${side}"`));
        assert.ok(html.includes(`aria-valuemin="${PANEL_LIMITS[side].min}"`));
        assert.match(html, /aria-valuemax="480" aria-valuenow="300"/);
        assert.ok(html.includes(language === "en" ? "300 pixels wide" : "300 pixel ang lapad"));
        assert.ok(html.includes(language === "en" ? "Resize" : "Baguhin ang lapad"));
        assert.match(html, /Shift/); assert.match(html, /Escape/); assert.match(html, /aria-describedby=/);
    }
});
