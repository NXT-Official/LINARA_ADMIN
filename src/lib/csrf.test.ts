import { describe, expect, it } from "vitest";

import { isServerFnRequest } from "./csrf";

describe("isServerFnRequest", () => {
  it("matches server function calls only", () => {
    expect(isServerFnRequest("http://localhost:8081/_serverFn/abc123")).toBe(true);
    expect(isServerFnRequest("http://localhost:8081/sign-in")).toBe(false);
    expect(isServerFnRequest("http://localhost:8081/reset-password#access_token=x")).toBe(false);
    expect(isServerFnRequest("http://localhost:8081/assets/_serverFn.js")).toBe(false);
  });
});
