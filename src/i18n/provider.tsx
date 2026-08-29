"use client";

import { createContext, type ReactNode, useContext } from "react";

import { getDictionary } from "./dictionaries";
import { DEFAULT_LOCALE } from "./locale";
import type { Locale } from "./types";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ children, locale }: { children: ReactNode; locale: Locale }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useDictionary() {
  return getDictionary(useLocale());
}
