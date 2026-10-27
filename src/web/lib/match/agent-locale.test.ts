import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCALES } from "../i18n/locales";
import { agentCacheKeys } from "./use-agents";

test("analysis, recap and narration session keys are isolated by language", () => {
    const keys = LOCALES.map(language => agentCacheKeys("match", 12, "paused", { mode: "analyst", language, team: "home", player: "" }));
    for (const task of ["analyst", "recap", "narration"] as const) {
        assert.equal(new Set(keys.map(key => key[task])).size, LOCALES.length, task);
    }
    assert.deepEqual(keys[0], agentCacheKeys("match", 12, "paused", { mode: "analyst", language: "en", team: "home", player: "" }));
});
