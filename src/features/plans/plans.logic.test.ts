import { describe, expect, it } from "vitest";

import {
  applyAction,
  centavosToInput,
  describeChanges,
  featureOffForEveryone,
  parsePeso,
  priceSummary,
  validateContent,
  type ActionResult,
  type CatalogAction,
} from "./plans.logic";
import { SAMPLE_CATALOG } from "./plans.sample";
import type { CatalogState, PlanContent } from "./plans.types";

const now = new Date("2026-10-26T05:00:00.000Z");
const ctx = { now, by: "Tester" };
const run = (state: CatalogState, action: CatalogAction): ActionResult =>
  applyAction(state, action, ctx);
const ok = (res: ActionResult): CatalogState => {
  if (!res.ok) throw new Error(`refused: ${res.message}`);
  return res.state;
};
const refused = (res: ActionResult): string => {
  if (res.ok) throw new Error("expected a refusal");
  return res.message;
};
const plan = (s: CatalogState, id: string) => s.plans.find((p) => p.id === id)!;
const withContent = (s: CatalogState, id: string, change: Partial<PlanContent>): PlanContent => ({
  ...plan(s, id).content,
  ...change,
});

describe("parsePeso", () => {
  it.each([
    ["0", 0],
    ["199", 19_900],
    ["1,299.50", 129_950],
    ["₱100", 10_000],
    ["  ₱ 99.9 ", 9_990],
    ["999,999.99", 99_999_999],
  ])("reads %j as %i centavos", (input, centavos) => {
    expect(parsePeso(input)).toEqual({ ok: true, centavos });
  });

  it.each([
    "",
    "   ",
    "-1",
    "1.234",
    "abc",
    "1e5",
    "12,34",
    "1,2345",
    "NaN",
    "Infinity",
    "0x10",
    "١٢٣",
    "１００",
    "10.",
    ".5",
    "1 000",
  ])("refuses %j", (input) => {
    expect(parsePeso(input).ok).toBe(false);
  });

  it("refuses more than the cap, and a number too big to hold exactly", () => {
    expect(parsePeso("1,000,000").ok).toBe(false);
    expect(parsePeso("9".repeat(40)).ok).toBe(false);
  });

  it("round-trips through the field", () => {
    for (const c of [0, 1, 5, 10, 99, 100, 129_950, 99_999_999]) {
      expect(parsePeso(centavosToInput(c))).toEqual({ ok: true, centavos: c });
    }
  });
});

describe("validateContent", () => {
  const free = plan(SAMPLE_CATALOG, "free").content;
  const others = SAMPLE_CATALOG.plans.filter((p) => p.id !== "free");

  it("accepts the sample Free plan", () => {
    expect(validateContent(free, others, { forPublish: true })).toEqual({});
  });

  it("refuses a blank, whitespace-only, too long or duplicate name, whatever the case", () => {
    expect(validateContent({ ...free, name: "" }, others).name).toBeDefined();
    expect(validateContent({ ...free, name: " \t " }, others).name).toBeDefined();
    expect(validateContent({ ...free, name: "x".repeat(41) }, others).name).toBeDefined();
    expect(validateContent({ ...free, name: "  normal " }, others).name).toMatch(/already/);
  });

  it("counts characters, not UTF-16 units, so an emoji name of 40 is allowed", () => {
    expect(validateContent({ ...free, name: "🏠".repeat(40) }, others).name).toBeUndefined();
    expect(validateContent({ ...free, name: "🏠".repeat(41) }, others).name).toBeDefined();
  });

  it("refuses broken prices, trials and limits", () => {
    const bad = validateContent(
      {
        ...free,
        prices: { monthly: -1, annual: 1.5, one_time: Number.NaN },
        trialDays: 91,
        limits: { households: 0, kasambahay: 2.5, co_managers: 21 },
      },
      others,
    );
    expect(Object.keys(bad).sort()).toEqual(
      [
        "annual",
        "co_managers",
        "households",
        "kasambahay",
        "monthly",
        "one_time",
        "trialDays",
      ].sort(),
    );
    expect(validateContent({ ...free, trialDays: -1 }, others).trialDays).toBeDefined();
    expect(validateContent({ ...free, trialDays: Number.NaN }, others).trialDays).toBeDefined();
  });

  it("allows unlimited, but a plan needs a price only to publish", () => {
    const unpriced = { ...free, prices: { monthly: null, annual: null, one_time: null } };
    expect(validateContent(unpriced, others)).toEqual({});
    expect(validateContent(unpriced, others, { forPublish: true }).prices).toBeDefined();
    const unlimited = {
      ...free,
      limits: { households: null, kasambahay: null, co_managers: null },
    };
    expect(validateContent(unlimited, others)).toEqual({});
  });
});

describe("saving a plan", () => {
  it("saves a draft in place, with no version", () => {
    const s = ok(
      run(SAMPLE_CATALOG, {
        type: "save_plan",
        planId: "normal",
        content: withContent(SAMPLE_CATALOG, "normal", { trialDays: 7 }),
      }),
    );
    expect(plan(s, "normal").content.trialDays).toBe(7);
    expect(plan(s, "normal").versions).toEqual([]);
  });

  it("saves a published plan as a new version and keeps the old ones", () => {
    const s = ok(
      run(SAMPLE_CATALOG, {
        type: "save_plan",
        planId: "free",
        content: withContent(SAMPLE_CATALOG, "free", {
          limits: { households: 1, kasambahay: 2, co_managers: 0 },
        }),
      }),
    );
    const free = plan(s, "free");
    expect(free.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(free.versions[0]).toMatchObject({ summary: "Changed limits", savedBy: "Tester" });
    expect(free.subscribers).toBe(42);
  });

  it("refuses a save with nothing changed, so no empty version appears", () => {
    expect(
      refused(
        run(SAMPLE_CATALOG, {
          type: "save_plan",
          planId: "free",
          content: plan(SAMPLE_CATALOG, "free").content,
        }),
      ),
    ).toMatch(/Nothing has changed/);
  });

  it("refuses removing every price from a published plan", () => {
    const res = run(SAMPLE_CATALOG, {
      type: "save_plan",
      planId: "free",
      content: withContent(SAMPLE_CATALOG, "free", {
        prices: { monthly: null, annual: null, one_time: null },
      }),
    });
    expect(refused(res)).toMatch(/at least one price/);
  });

  it("refuses a plan that no longer exists, and leaves the state untouched", () => {
    const before = JSON.stringify(SAMPLE_CATALOG);
    refused(
      run(SAMPLE_CATALOG, {
        type: "save_plan",
        planId: "gone",
        content: plan(SAMPLE_CATALOG, "free").content,
      }),
    );
    expect(JSON.stringify(SAMPLE_CATALOG)).toBe(before);
  });
});

describe("plan status", () => {
  it("won't publish a plan with no price (Normal and Premium wait for marketing)", () => {
    expect(
      refused(run(SAMPLE_CATALOG, { type: "set_status", planId: "normal", status: "published" })),
    ).toMatch(/price/);
  });

  it("publishing a priced draft makes version 1", () => {
    const priced = ok(
      run(SAMPLE_CATALOG, {
        type: "save_plan",
        planId: "normal",
        content: withContent(SAMPLE_CATALOG, "normal", {
          prices: { monthly: 19_900, annual: null, one_time: null },
        }),
      }),
    );
    const s = ok(run(priced, { type: "set_status", planId: "normal", status: "published" }));
    expect(plan(s, "normal")).toMatchObject({ status: "published" });
    expect(plan(s, "normal").versions).toHaveLength(1);
  });

  it("keeps at least one plan published", () => {
    expect(
      refused(run(SAMPLE_CATALOG, { type: "set_status", planId: "free", status: "hidden" })),
    ).toMatch(/at least one plan published/);
    expect(
      refused(run(SAMPLE_CATALOG, { type: "set_status", planId: "free", status: "retired" })),
    ).toMatch(/at least one plan published/);
  });

  it("refuses moves the state doesn't allow, and a retired plan is final", () => {
    expect(
      refused(run(SAMPLE_CATALOG, { type: "set_status", planId: "normal", status: "retired" })),
    ).toMatch(/can't become/);
    const retired: CatalogState = {
      ...SAMPLE_CATALOG,
      plans: SAMPLE_CATALOG.plans.map((p) =>
        p.id === "premium" ? { ...p, status: "retired" } : p,
      ),
    };
    expect(
      refused(run(retired, { type: "set_status", planId: "premium", status: "published" })),
    ).toMatch(/can't become/);
    expect(
      refused(
        run(retired, {
          type: "save_plan",
          planId: "premium",
          content: withContent(retired, "premium", { trialDays: 1 }),
        }),
      ),
    ).toMatch(/retired/);
  });
});

describe("creating, deleting and ordering", () => {
  it("creates a draft at the end of the list", () => {
    const s = ok(run(SAMPLE_CATALOG, { type: "create_plan", id: "family", name: " Family " }));
    expect(plan(s, "family")).toMatchObject({ status: "draft", displayOrder: 4 });
    expect(plan(s, "family").content.name).toBe("Family");
  });

  it("refuses a duplicate name or id when creating, case and spaces aside", () => {
    expect(refused(run(SAMPLE_CATALOG, { type: "create_plan", id: "x", name: "FREE" }))).toMatch(
      /already/,
    );
    expect(
      refused(run(SAMPLE_CATALOG, { type: "create_plan", id: "free", name: "Other" })),
    ).toMatch(/id/);
    expect(refused(run(SAMPLE_CATALOG, { type: "create_plan", id: "y", name: "   " }))).toMatch(
      /name/,
    );
  });

  it("deletes only a never-published draft", () => {
    expect(plan(ok(run(SAMPLE_CATALOG, { type: "delete_plan", planId: "normal" })), "normal")).toBe(
      undefined,
    );
    expect(refused(run(SAMPLE_CATALOG, { type: "delete_plan", planId: "free" }))).toMatch(
      /Retire it instead/,
    );
  });

  it("moves a plan and keeps the order 1..n with no gaps or repeats", () => {
    const s = ok(run(SAMPLE_CATALOG, { type: "move_plan", planId: "premium", direction: -1 }));
    const order = [...s.plans].sort((a, b) => a.displayOrder - b.displayOrder).map((p) => p.id);
    expect(order).toEqual(["free", "premium", "normal"]);
    expect(s.plans.map((p) => p.displayOrder).sort()).toEqual([1, 2, 3]);
    expect(
      refused(run(SAMPLE_CATALOG, { type: "move_plan", planId: "free", direction: -1 })),
    ).toMatch(/end of the list/);
    expect(
      refused(run(SAMPLE_CATALOG, { type: "move_plan", planId: "premium", direction: 1 })),
    ).toMatch(/end of the list/);
  });
});

describe("add-ons", () => {
  const coManager = SAMPLE_CATALOG.addons.find((a) => a.id === "extra_co_manager")!;

  it("won't offer an add-on with no price (co-manager is still TBD)", () => {
    expect(
      refused(
        run(SAMPLE_CATALOG, { type: "save_addon", addon: { ...coManager, status: "active" } }),
      ),
    ).toMatch(/price/);
  });

  it("offers it once priced", () => {
    const s = ok(
      run(SAMPLE_CATALOG, {
        type: "save_addon",
        addon: { ...coManager, status: "active", monthlyPrice: 7_500 },
      }),
    );
    expect(s.addons.find((a) => a.id === "extra_co_manager")).toMatchObject({ status: "active" });
  });

  it("refuses a bad step or price", () => {
    for (const step of [0, -1, 11, 1.5, Number.NaN]) {
      expect(run(SAMPLE_CATALOG, { type: "save_addon", addon: { ...coManager, step } }).ok).toBe(
        false,
      );
    }
    expect(
      run(SAMPLE_CATALOG, { type: "save_addon", addon: { ...coManager, monthlyPrice: -100 } }).ok,
    ).toBe(false);
  });
});

describe("global switches", () => {
  it("Staff pay & HR starts off, and that marks its feature off for everyone", () => {
    expect(SAMPLE_CATALOG.switches.find((s) => s.key === "staff_pay_hr")?.enabled).toBe(false);
    expect(featureOffForEveryone(SAMPLE_CATALOG, "staff_pay_hr")).toBe(true);
    expect(featureOffForEveryone(SAMPLE_CATALOG, "tasks")).toBe(false);
  });

  it("turning it on needs a reason, records who and when, and keeps the history", () => {
    expect(
      refused(
        run(SAMPLE_CATALOG, { type: "set_switch", key: "staff_pay_hr", enabled: true, note: "  " }),
      ),
    ).toMatch(/why/);
    const s = ok(
      run(SAMPLE_CATALOG, {
        type: "set_switch",
        key: "staff_pay_hr",
        enabled: true,
        note: "Cleared by legal",
      }),
    );
    expect(s.switches[0]).toMatchObject({ enabled: true, updatedBy: "Tester" });
    expect(s.switchHistory.map((h) => h.enabled)).toEqual([true, false]);
    expect(featureOffForEveryone(s, "staff_pay_hr")).toBe(false);
  });

  it("refuses a repeat flip (a double click) instead of logging it twice", () => {
    expect(
      refused(
        run(SAMPLE_CATALOG, { type: "set_switch", key: "staff_pay_hr", enabled: false, note: "x" }),
      ),
    ).toMatch(/already off/);
  });
});

describe("summaries", () => {
  it("describes prices and changes in plain words", () => {
    expect(priceSummary(plan(SAMPLE_CATALOG, "free").content)).toBe("₱0 a month");
    expect(priceSummary(plan(SAMPLE_CATALOG, "normal").content)).toBe("Not priced");
    const free = plan(SAMPLE_CATALOG, "free").content;
    expect(describeChanges(free, { ...free, trialDays: 3, name: "Starter" })).toBe(
      "Changed name and trial",
    );
  });
});
