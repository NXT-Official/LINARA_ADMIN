import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./server-env.server";

const DEV = {
  SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_real",
  APP_ENV: "development",
  SITE_URL: "http://localhost:8081",
  HCAPTCHA_SITE_KEY: "10000000-ffff-ffff-ffff-000000000001",
  HCAPTCHA_SECRET: "0x0000000000000000000000000000000000000000",
};

describe("parseServerEnv", () => {
  it("names every missing variable", () => {
    let message = "";
    try {
      parseServerEnv({});
    } catch (e) {
      message = (e as Error).message;
    }
    for (const name of [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SITE_URL",
      "HCAPTCHA_SECRET",
    ]) {
      expect(message).toContain(name);
    }
  });

  it("never echoes a value", () => {
    let message = "";
    try {
      parseServerEnv({ ...DEV, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc", SITE_URL: "not a url" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("SITE_URL");
    expect(message).not.toContain("sb_secret_abc");
    expect(message).not.toContain("not a url");
  });

  it("production refuses the hCaptcha test secret", () => {
    expect(() =>
      parseServerEnv({ ...DEV, APP_ENV: "production", SITE_URL: "https://console.example.com" }),
    ).toThrow(/test hCaptcha/);
  });

  it("production refuses http", () => {
    expect(() =>
      parseServerEnv({
        ...DEV,
        APP_ENV: "production",
        SITE_URL: "http://console.example.com",
        HCAPTCHA_SECRET: "0xrealsecret",
      }),
    ).toThrow(/https/);
  });

  it("development accepts the .env.example values", () => {
    const env = parseServerEnv(DEV);
    expect(env.appEnv).toBe("development");
    expect(env.siteUrl).toBe("http://localhost:8081");
    expect(env.serviceKey).toBe("sb_secret_real");
  });

  it("emails: development defaults to Resend's test sender and may skip the key (D45)", () => {
    const env = parseServerEnv(DEV);
    expect(env.resendApiKey).toBeNull();
    expect(env.emailFrom).toBe("Linara Business Console <onboarding@resend.dev>");
    expect(env.emailTestRecipient).toBeNull();
    expect(
      parseServerEnv({ ...DEV, RESEND_API_KEY: "re_abc", EMAIL_TEST_RECIPIENT: "me@x.com" }),
    ).toMatchObject({ resendApiKey: "re_abc", emailTestRecipient: "me@x.com" });
  });

  it("emails: production needs a key, its own domain, and no test recipient (D45)", () => {
    const prod = {
      ...DEV,
      APP_ENV: "production",
      SITE_URL: "https://console.example.com",
      HCAPTCHA_SECRET: "0xrealsecret",
    };
    expect(() => parseServerEnv(prod)).toThrow(/RESEND_API_KEY is missing/);
    expect(() => parseServerEnv({ ...prod, RESEND_API_KEY: "re_abc" })).toThrow(/EMAIL_FROM/);
    expect(() =>
      parseServerEnv({
        ...prod,
        RESEND_API_KEY: "re_abc",
        EMAIL_FROM: "Linara <onboarding@resend.dev>",
      }),
    ).toThrow(/EMAIL_FROM/);
    const ok = { ...prod, RESEND_API_KEY: "re_abc", EMAIL_FROM: "Linara <console@linara.example>" };
    expect(parseServerEnv(ok).emailFrom).toBe("Linara <console@linara.example>");
    expect(() => parseServerEnv({ ...ok, EMAIL_TEST_RECIPIENT: "me@x.com" })).toThrow(
      /EMAIL_TEST_RECIPIENT/,
    );
    let message = "";
    try {
      parseServerEnv({ ...prod, RESEND_API_KEY: "re_secret_value" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain("re_secret_value");
  });

  it("drops a trailing slash from the site URL", () => {
    expect(parseServerEnv({ ...DEV, SITE_URL: "http://localhost:8081/" }).siteUrl).toBe(
      "http://localhost:8081",
    );
  });
});
