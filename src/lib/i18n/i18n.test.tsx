// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { translate, useT } from "./i18n";
import { localeFromCookies, writeLocale } from "./locale-cookie";
import { LOCALES, parseLocale } from "./locales";
import { LocaleProvider } from "./locale-provider";
import { MESSAGES, type MessageKey } from "./messages";

afterEach(cleanup);

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("console languages (D42)", () => {
  it("every language has every English text, filled in, with the same placeholders", () => {
    const keys = Object.keys(MESSAGES.en) as MessageKey[];
    for (const { code } of LOCALES) {
      expect(Object.keys(MESSAGES[code]).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        expect(MESSAGES[code][key].trim(), `${code} ${key}`).not.toBe("");
        expect(placeholders(MESSAGES[code][key]), `${code} ${key}`).toEqual(
          placeholders(MESSAGES.en[key]),
        );
      }
    }
  });

  it("fills placeholders", () => {
    expect(translate("en", "list.showing", { shown: 8, total: 20 })).toBe("Showing 1 to 8 of 20");
    expect(translate("ja", "list.page", { page: 2 })).toBe("2 ページ");
  });

  it("falls back to English for an unknown or missing language", () => {
    expect(parseLocale("de")).toBe("en");
    expect(parseLocale(undefined)).toBe("en");
    expect(parseLocale("fil")).toBe("fil");
  });

  it("remembers the choice in a cookie", () => {
    writeLocale("es");
    expect(localeFromCookies(document.cookie)).toBe("es");
    writeLocale("en");
    expect(localeFromCookies(document.cookie)).toBe("en");
  });

  it("is English outside a provider, and the provider's language inside one", () => {
    function Label() {
      return <p>{useT()("shell.signOut")}</p>;
    }
    render(<Label />);
    expect(screen.getByText("Sign out")).toBeInTheDocument();
    cleanup();
    render(
      <LocaleProvider initial="zh-CN">
        <Label />
      </LocaleProvider>,
    );
    expect(screen.getByText("退出登录")).toBeInTheDocument();
  });
});
