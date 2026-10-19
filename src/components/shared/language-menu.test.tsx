// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useT } from "@/lib/i18n/i18n";
import { localeFromCookies, writeLocale } from "@/lib/i18n/locale-cookie";
import { LocaleProvider } from "@/lib/i18n/locale-provider";

import { LanguageMenu } from "./language-menu";

afterEach(() => {
  cleanup();
  writeLocale("en");
});

function Page() {
  return <p>{useT()("nav.users")}</p>;
}

// Radix menus open on pointer down, which jsdom has to be told about.
function open(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
}

describe("LanguageMenu (D42)", () => {
  it("switches the console's language at once and remembers it", async () => {
    render(
      <LocaleProvider initial="en">
        <LanguageMenu />
        <Page />
      </LocaleProvider>,
    );
    expect(screen.getByText("Users")).toBeInTheDocument();
    open(screen.getByRole("button", { name: "Language: English" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Español" }));

    expect(screen.getByText("Usuarios")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Idioma: Español" })).toBeInTheDocument();
    expect(localeFromCookies(document.cookie)).toBe("es");
    expect(document.documentElement.lang).toBe("es");
  });
});
