import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** The invite email pasted into Supabase > Authentication > Email Templates > Invite user. */
const html = readFileSync(
  resolve(__dirname, "../../../supabase/email-templates/invite.html"),
  "utf8",
);

describe("invite email template (FR-TM-2)", () => {
  it("has a set-up button and the same link written out", () => {
    expect(html).toMatch(
      /<a\s[^>]*href="\{\{ \.ConfirmationURL \}\}"[^>]*>\s*Set up my account\s*<\/a\s*>/,
    );
    expect(html.match(/\{\{ \.ConfirmationURL \}\}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("says what happens and how long the link lasts", () => {
    expect(html).toContain("Linara Business Console");
    expect(html).toContain("choose your password");
    expect(html).toContain("two-step sign-in");
    expect(html).toContain("24 hours");
    expect(html).toContain("{{ .Email }}");
  });

  it("shows the invite's details, and still reads well without them", () => {
    expect(html).toContain("{{ if .Data.invite_role }}");
    expect(html).toContain("{{ .Data.invite_role }}");
    expect(html).toContain("{{ .Data.invited_by }}");
    expect(html).toContain("{{ .Data.invite_environment }}");
    expect(html).toContain("{{ range .Data.invite_permissions }}");
    // Every {{ if }} and {{ range }} is closed, or Supabase rejects the template.
    const opened = (html.match(/\{\{ (if|range) /g) ?? []).length;
    expect(opened).toBeGreaterThan(0);
    expect(opened).toBe((html.match(/\{\{ end \}\}/g) ?? []).length);
  });

  it("uses the brand colours inline and nothing an email client strips or blocks", () => {
    expect(html).toContain("#26574e");
    expect(html).toContain("#faf3e6");
    expect(html).not.toMatch(/<script|<link |<style|oklch|var\(--/i);
    expect(html).not.toContain("\u2014");
  });
});
