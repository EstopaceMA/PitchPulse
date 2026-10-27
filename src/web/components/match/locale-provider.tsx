"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { isLocale, LOCALE_COOKIE, localeDirection } from "@/lib/i18n/locales";
import { messages } from "@/lib/i18n/messages";
import type { Language } from "@/lib/match/types";

const LocaleContext = createContext<{ locale: Language; setLocale: (locale: Language) => void } | null>(null);

export function AppLocaleProvider({ initialLocale, children }: { initialLocale: Language; children: ReactNode }) {
    const [locale, setCurrentLocale] = useState(initialLocale);
    useEffect(() => {
        document.documentElement.lang = locale;
        document.documentElement.dir = localeDirection(locale);
    }, [locale]);
    const value = useMemo(() => ({ locale, setLocale(next: Language) {
        if (!isLocale(next)) return;
        document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(next)}; Path=/; Max-Age=31536000; SameSite=Lax`;
        setCurrentLocale(next);
    } }), [locale]);
    return <LocaleContext.Provider value={value}><NextIntlClientProvider locale={locale} messages={messages[locale]}>{children}</NextIntlClientProvider></LocaleContext.Provider>;
}

export function useAppLocale() {
    const value = useContext(LocaleContext);
    if (!value) throw new Error("AppLocaleProvider is missing");
    return value;
}
