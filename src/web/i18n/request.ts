import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "@/lib/i18n/locales";
import { messages } from "@/lib/i18n/messages";

export default getRequestConfig(async () => {
    const requested = (await cookies()).get(LOCALE_COOKIE)?.value;
    const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;
    return { locale, messages: messages[locale] };
});
