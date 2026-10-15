import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-env.server", () => ({ serverEnv: () => ({ hcaptchaSecret: "0xsecret" }) }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestIP: () => "1.2.3.4" }));

import { verifyCaptcha } from "./captcha.server";

describe("verifyCaptcha (S-3)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown) =>
    fetchMock.mockResolvedValue({ ok: true, json: async () => body });

  it("passes a token hCaptcha accepts", async () => {
    respond({ success: true });
    await expect(verifyCaptcha("tok")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.hcaptcha.com/siteverify");
    expect(String(init.body)).toContain("secret=0xsecret");
    expect(String(init.body)).toContain("response=tok");
  });

  it("rejects a token hCaptcha refuses", async () => {
    respond({ success: false });
    await expect(verifyCaptcha("tok")).rejects.toMatchObject({
      code: "invalid_input",
      publicMessage: "Complete the captcha check, then try again.",
    });
  });

  it("rejects a missing token without calling hCaptcha", async () => {
    await expect(verifyCaptcha(undefined)).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up on a slow hCaptcha instead of holding the request", async () => {
    respond({ success: true });
    await verifyCaptcha("tok");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails closed when hCaptcha can't be reached", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    await expect(verifyCaptcha("tok")).rejects.toMatchObject({ code: "invalid_input" });
  });
});
