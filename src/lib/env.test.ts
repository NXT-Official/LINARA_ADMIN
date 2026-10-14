import { describe, expect, it } from "vitest";

import { parseAppEnv } from "./env";

describe("parseAppEnv", () => {
  it("treats an unset value as development", () => {
    expect(parseAppEnv(undefined)).toBe("development");
    expect(parseAppEnv("")).toBe("development");
    expect(parseAppEnv("  ")).toBe("development");
  });

  it("accepts each environment, ignoring case and spaces", () => {
    expect(parseAppEnv("development")).toBe("development");
    expect(parseAppEnv(" Staging ")).toBe("staging");
    expect(parseAppEnv("PRODUCTION")).toBe("production");
  });

  it("rejects anything else", () => {
    expect(() => parseAppEnv("prod")).toThrow(/APP_ENV/);
    expect(() => parseAppEnv("preview")).toThrow(/APP_ENV/);
  });
});
