import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, toPublicError, type PublicError } from "@/lib/console-error";
import { logError } from "@/lib/log.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

import { parseFaqId, parseFaqInput } from "./faq.input";
import type { FaqEntry, FaqInput } from "./faq.types";

/** FAQs (020-faq.sql): one function call each after the guard. */

async function run<T>(fn: () => Promise<T>): Promise<T | PublicError> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ConsoleError)) logError("faq", e);
    return toPublicError(e);
  }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

type DbFaq = {
  id: string;
  question: string;
  answer: string;
  category: string;
  sort_order: number;
  published: boolean;
  updated_at: string;
};

const toEntry = (r: DbFaq): FaqEntry => ({
  id: r.id,
  question: r.question,
  answer: r.answer,
  category: r.category,
  sortOrder: r.sort_order,
  published: r.published,
  updatedAt: r.updated_at,
});

export function listFaqsHandler(): Promise<{ ok: true; faqs: FaqEntry[] } | PublicError> {
  return run(async () => {
    const staff = await requireStaff("faq.manage");
    const rows = await call<DbFaq[] | null>("faq_list", { p_actor: staff.userId });
    return { ok: true as const, faqs: (rows ?? []).map(toEntry) };
  });
}

export function saveFaqHandler(input: FaqInput): Promise<{ ok: true; id: string } | PublicError> {
  return run(async () => {
    const f = parseFaqInput(input);
    const staff = await requireStaff("faq.manage");
    const id = await call<string>("faq_save", {
      p_actor: staff.userId,
      p_entry: {
        ...(f.id ? { id: f.id } : {}),
        question: f.question,
        answer: f.answer,
        category: f.category,
        sort_order: f.sortOrder,
        published: f.published,
      },
    });
    return { ok: true as const, id };
  });
}

export function deleteFaqHandler(input: { id: string }): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const id = parseFaqId(input.id);
    const staff = await requireStaff("faq.manage");
    await call("faq_delete", { p_actor: staff.userId, p_id: id });
    return { ok: true as const };
  });
}
