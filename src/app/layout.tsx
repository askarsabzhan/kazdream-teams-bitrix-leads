import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LocaleProvider } from "@/i18n/provider";
import { getI18n } from "@/i18n/server";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { dictionary } = await getI18n();
  return {
    title: {
      default: dictionary.metadata.title,
      template: `%s · ${dictionary.metadata.title}`,
    },
    description: dictionary.metadata.description,
  };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale } = await getI18n();
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
