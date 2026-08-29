"use server";

import { cookies } from "next/headers";

import { resolveLocale, UI_LOCALE_COOKIE } from "./locale";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = resolveLocale(formData.get("locale"));
  const cookieStore = await cookies();
  cookieStore.set(UI_LOCALE_COOKIE, locale, {
    httpOnly: true,
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
