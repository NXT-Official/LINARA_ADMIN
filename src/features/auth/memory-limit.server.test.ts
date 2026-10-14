import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { memoryLimit, memoryLimitSize, resetMemoryLimit } from "./memory-limit.server";

describe("memoryLimit (D30, memory tier)", () => {
  beforeEach(() => {
    resetMemoryLimit();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("allows max calls, blocks the next, then resets after the window", () => {
    expect([1, 2, 3].map(() => memoryLimit("k", 3, 1000))).toEqual([true, true, true]);
    expect(memoryLimit("k", 3, 1000)).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(memoryLimit("k", 3, 1000)).toBe(true);
  });

  it("counts keys separately", () => {
    expect(memoryLimit("a", 1, 1000)).toBe(true);
    expect(memoryLimit("b", 1, 1000)).toBe(true);
    expect(memoryLimit("a", 1, 1000)).toBe(false);
  });

  it("stays bounded under many distinct keys", () => {
    for (let i = 0; i < 10_050; i++) memoryLimit(`k${i}`, 5, 60_000);
    expect(memoryLimitSize()).toBeLessThanOrEqual(10_000);
  });
});
