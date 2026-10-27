import assert from "node:assert/strict";
import { test } from "node:test";
import { createTranslator } from "next-intl";
import { DEFAULT_LOCALE, isLocale, LOCALES, localeDirection } from "./locales";
import { messages } from "./messages";

const parameters = (message: string) => [...message.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map(match => match[1]).sort();

test("all seven catalogs have the same nonempty keys and matching interpolation", () => {
    const english = messages.en as Record<string, string>;
    const keys = Object.keys(english).sort();
    assert.ok(keys.length > 400);
    for (const locale of LOCALES) {
        const catalog = messages[locale] as Record<string, string>;
        assert.deepEqual(Object.keys(catalog).sort(), keys, locale);
        const errors: string[] = [];
        const format = createTranslator({ locale, messages: catalog, onError: error => errors.push(error.message) });
        for (const key of keys) {
            assert.ok(catalog[key].trim(), `${locale}:${key} is empty`);
            assert.deepEqual(parameters(catalog[key]), parameters(english[key]), `${locale}:${key} interpolation`);
            const values = Object.fromEntries(parameters(english[key]).map(name => [name, "2"]));
            assert.ok(format(key, values).trim(), `${locale}:${key} cannot format`);
        }
        assert.deepEqual(errors, [], `${locale} ICU messages`);
    }
});

test("only supported locale cookies are accepted and Arabic sets RTL", () => {
    for (const locale of LOCALES) assert.ok(isLocale(locale));
    assert.equal(isLocale("../../ar"), false);
    assert.equal(isLocale("pt"), false);
    assert.equal(DEFAULT_LOCALE, "en");
    assert.equal(localeDirection("ar"), "rtl");
    for (const locale of LOCALES.filter(value => value !== "ar")) assert.equal(localeDirection(locale), "ltr");
});
