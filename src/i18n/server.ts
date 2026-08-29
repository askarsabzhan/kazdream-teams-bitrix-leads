import "server-only";

import { cookies } from "next/headers";

import { getDictionary } from "./dictionaries";
import { resolveLocale, UI_LOCALE_COOKIE } from "./locale";

export async function getLocale() {
  const cookieStore = await cookies();
  return resolveLocale(cookieStore.get(UI_LOCALE_COOKIE)?.value);
}

export async function getI18n() {
  const locale = await getLocale();
  return { locale, dictionary: getDictionary(locale) };
}
