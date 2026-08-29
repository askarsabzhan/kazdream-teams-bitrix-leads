import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDictionary } from "./dictionaries";
import { DEFAULT_LOCALE, resolveLocale } from "./locale";

describe("UI locale", () => {
  it("defaults a missing locale to Russian", () => {
    expect(resolveLocale(undefined)).toBe("ru");
    expect(DEFAULT_LOCALE).toBe("ru");
  });

  it.each(["ru", "en"] as const)("accepts %s", (locale) => {
    expect(resolveLocale(locale)).toBe(locale);
  });

  it("falls back to Russian for an invalid locale", () => {
    expect(resolveLocale("de")).toBe("ru");
  });

  it("maps important statuses in Russian and English", () => {
    expect(getDictionary("ru").values.succeeded).toBe("Успешно");
    expect(getDictionary("ru").values.blocked).toBe("Заблокировано");
    expect(getDictionary("en").values.succeeded).toBe("Succeeded");
    expect(getDictionary("en").values.blocked).toBe("Blocked");
  });

  it("keeps internal business values unchanged while mapping display text", () => {
    const internalValue = "Partner";
    expect(internalValue).toBe("Partner");
    expect(getDictionary("ru").values[internalValue.toLocaleLowerCase()]).toBe("Партнёр");
    expect(getDictionary("en").values[internalValue.toLocaleLowerCase()]).toBe(internalValue);
  });

  it("does not add server secrets to public environment variables", () => {
    const example = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    const publicNames = example
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=/)?.[1])
      .filter((name): name is string => Boolean(name?.startsWith("NEXT_PUBLIC_")));

    expect(publicNames).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ]);
  });
});
