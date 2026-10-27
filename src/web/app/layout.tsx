import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { AppLocaleProvider } from "@/components/match/locale-provider";
import { isLocale, localeDirection } from "@/lib/i18n/locales";
import { translate } from "@/lib/i18n/translate";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";

// The document language and direction come from the per-browser locale cookie.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const requested = await getLocale();
  const locale = isLocale(requested) ? requested : "en";
  return { title: translate(locale, "metadataTitle"), description: translate(locale, "metadataDescription") };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const requested = await getLocale();
  const locale = isLocale(requested) ? requested : "en";
  return (
    <html
      lang={locale}
      dir={localeDirection(locale)}
      className="dark h-full antialiased"
    >
      <body className="min-h-full flex flex-col"><AppLocaleProvider initialLocale={locale}>{children}</AppLocaleProvider></body>
    </html>
  );
}
