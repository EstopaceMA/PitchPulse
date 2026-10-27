import type { Language } from "@/lib/match/types";

export const LOCALES = ["en", "fil", "es", "pt-BR", "id", "ar", "th"] as const satisfies readonly Language[];
export const DEFAULT_LOCALE: Language = "en";
export const LOCALE_COOKIE = "pitchpulse-locale";
export const LOCALE_NAMES: Record<Language, string> = {
    en: "English",
    fil: "Filipino",
    es: "Español",
    "pt-BR": "Português (Brasil)",
    id: "Bahasa Indonesia",
    ar: "العربية",
    th: "ไทย",
};
export const isLocale = (value: unknown): value is Language => typeof value === "string" && (LOCALES as readonly string[]).includes(value);
export const localeDirection = (locale: Language) => locale === "ar" ? "rtl" : "ltr";
