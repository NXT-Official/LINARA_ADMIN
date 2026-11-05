import { describe, expect, it } from "vitest";

import { badRequest, isMalformedServerFnBody } from "./server-fn-body";

const JSON_CT = "application/json";
// What the browser really sends (captured from the sign-in form).
const REAL =
  '{"t":{"t":10,"i":0,"p":{"k":["data"],"v":[{"t":1,"s":"a@b.co"}]},"o":0},"f":127,"m":[]}';

describe("isMalformedServerFnBody", () => {
  it("lets a real browser call through", () => {
    expect(isMalformedServerFnBody(JSON_CT, REAL)).toBe(false);
    expect(isMalformedServerFnBody("application/json; charset=utf-8", REAL)).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   \n"],
    ["not JSON", "{not json"],
    ["truncated", REAL.slice(0, 30)],
    ["a number", "42"],
    ["null", "null"],
    ["a string", '"x"'],
    ["an array", "[1,2]"],
    ["an object without t", "{}"],
    ["t is null", '{"t":null}'],
    ["t is a string", '{"t":"x"}'],
  ])("refuses %s", (_, body) => {
    expect(isMalformedServerFnBody(JSON_CT, body)).toBe(true);
  });

  it("leaves form uploads and other types to the framework", () => {
    expect(isMalformedServerFnBody("multipart/form-data; boundary=x", "")).toBe(false);
    expect(isMalformedServerFnBody("text/plain", "")).toBe(false);
    expect(isMalformedServerFnBody(null, "")).toBe(false);
  });
});

describe("badRequest", () => {
  it("is a 400 that says nothing about the framework", async () => {
    const res = badRequest();
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toBe('{"error":"bad_request"}');
    expect(text).not.toMatch(/seroval|tanstack|stack|TypeError/i);
  });
});
