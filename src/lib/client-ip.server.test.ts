import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
  socket: "10.0.0.1" as string | undefined,
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => m.headers[name.toLowerCase()],
  getRequestIP: () => m.socket,
}));

import { clientIp } from "./client-ip.server";

afterEach(() => {
  vi.unstubAllEnvs();
  m.headers = {};
  m.socket = "10.0.0.1";
});

describe("clientIp", () => {
  it("off Vercel, a spoofed X-Forwarded-For is ignored: the socket address counts", () => {
    vi.stubEnv("VERCEL", "");
    m.headers = { "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" };
    expect(clientIp()).toBe("10.0.0.1");
  });

  it("on Vercel, the leftmost X-Forwarded-For entry is the caller", () => {
    vi.stubEnv("VERCEL", "1");
    m.headers = { "x-forwarded-for": " 203.0.113.9 , 10.1.1.1" };
    expect(clientIp()).toBe("203.0.113.9");
  });

  it("on Vercel, x-real-ip alone is not trusted", () => {
    vi.stubEnv("VERCEL", "1");
    m.headers = { "x-real-ip": "7.7.7.7" };
    expect(clientIp()).toBe("10.0.0.1");
  });

  it("on Vercel with an empty header, falls back to the socket", () => {
    vi.stubEnv("VERCEL", "1");
    m.headers = { "x-forwarded-for": " , " };
    expect(clientIp()).toBe("10.0.0.1");
  });

  it("no address at all is undefined, not a string", () => {
    vi.stubEnv("VERCEL", "");
    m.socket = undefined;
    expect(clientIp()).toBeUndefined();
  });
});
