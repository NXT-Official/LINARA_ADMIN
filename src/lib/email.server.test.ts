import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  value: {
    resendApiKey: "re_test" as string | null,
    emailFrom: "Linara Business Console <onboarding@resend.dev>",
    emailTestRecipient: null as string | null,
  },
}));
vi.mock("./server-env.server", () => ({ serverEnv: () => env.value }));

import { escapeHtml, sendEmails } from "./email.server";

const fetchMock = vi.fn();
const mail = (to: string) => ({ to, subject: "Hello", text: "Hi", html: "<p>Hi</p>" });

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  env.value = {
    resendApiKey: "re_test",
    emailFrom: "Linara Business Console <onboarding@resend.dev>",
    emailTestRecipient: null,
  };
});
afterEach(() => vi.unstubAllGlobals());

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

describe("sendEmails (D45)", () => {
  it("sends each recipient their own email through Resend's batch API", async () => {
    await expect(sendEmails([mail("a@x.com"), mail("b@x.com")])).resolves.toBe("sent");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails/batch");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(sentBody()).toEqual([
      expect.objectContaining({ to: ["a@x.com"], from: env.value.emailFrom, subject: "Hello" }),
      expect.objectContaining({ to: ["b@x.com"] }),
    ]);
  });

  it("sends nothing without a key", async () => {
    env.value.resendApiKey = null;
    await expect(sendEmails([mail("a@x.com")])).resolves.toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when there's no one to tell", async () => {
    await expect(sendEmails([])).resolves.toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the test recipient gets every email, marked with who it was for", async () => {
    env.value.emailTestRecipient = "me@x.com";
    await sendEmails([mail("a@x.com")]);
    expect(sentBody()[0]).toMatchObject({ to: ["me@x.com"], subject: "[test, for a@x.com] Hello" });
  });

  it("splits more than 100 emails into batches", async () => {
    await sendEmails(Array.from({ length: 150 }, (_, i) => mail(`p${i}@x.com`)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a refused send throws without the key in the message", async () => {
    fetchMock.mockResolvedValue(new Response("domain not verified", { status: 403 }));
    await expect(sendEmails([mail("a@x.com")])).rejects.toThrow(/Resend 403: domain not verified/);
    await expect(sendEmails([mail("a@x.com")])).rejects.not.toThrow(/re_test/);
  });

  it("escapes HTML", () => {
    expect(escapeHtml(`<b>"Tom" & 'Jo'</b>`)).toBe(
      "&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jo&#39;&lt;/b&gt;",
    );
  });
});
