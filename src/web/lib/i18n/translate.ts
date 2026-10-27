import { createTranslator } from "next-intl";
import type { Language } from "@/lib/match/types";
import { messages } from "./messages";

type Values = Record<string, string | number | Date>;
const translators = new Map<Language, ReturnType<typeof createTranslator>>();

/** Shared by pure match logic and React components; messages use next-intl's ICU formatter. */
export function translate(locale: Language, key: string, values?: Values): string {
    let translator = translators.get(locale);
    if (!translator) {
        translator = createTranslator({ locale, messages: messages[locale] });
        translators.set(locale, translator);
    }
    return translator(key, values);
}
