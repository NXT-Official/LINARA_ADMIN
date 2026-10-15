import { requireStaff } from "@/features/auth/session.server";
import { ConsoleError, type PublicError } from "@/lib/console-error";
import { isUuid } from "@/lib/list-input";
import { getAdminClient } from "@/lib/supabase-admin.server";

import { run } from "./crm.handlers.server";
import {
  parseActivityInput,
  parseFollowUpInput,
  parseLeadInput,
  parseLeadStage,
  parseOwnerAndTags,
  type ActivityInput,
  type FollowUpInput,
  type LeadInput,
} from "./crm.input";
import type { ContactRef, LeadStage } from "./crm.types";

/**
 * CRM writes (FR-CRM-1 to FR-CRM-9, FR-CRM-14). Each is one SQL function that
 * makes the change and records it in the audit log together (D34). A broken
 * rule (P0001) comes back with its plain message; anything else says nothing.
 */

const NOT_FOUND = "There's no contact with this address.";

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new ConsoleError("conflict", error.message);
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

function contactId(id: unknown): string {
  if (!isUuid(id)) throw new ConsoleError("not_found", NOT_FOUND);
  return id;
}

function refIds(ref: ContactRef): { p_contact_id: string | null; p_user_id: string | null } {
  if ("contactId" in ref) return { p_contact_id: contactId(ref.contactId), p_user_id: null };
  return { p_contact_id: null, p_user_id: contactId(ref.userId) };
}

type Saved = { ok: true; contactId: string } | PublicError;

export function createLeadHandler(input: LeadInput): Promise<Saved> {
  return run(async () => {
    const lead = parseLeadInput(input);
    const staff = await requireStaff("crm.write");
    const id = await call<string>("crm_create_lead", {
      p_actor: staff.userId,
      p_full_name: lead.fullName,
      p_email: lead.email,
      p_phone: lead.phone,
      p_source: lead.source,
      p_owner_id: lead.ownerId,
      p_tags: lead.tags,
      p_note: lead.note,
    });
    return { ok: true as const, contactId: id };
  });
}

export type UpdateContactInput = {
  ref: ContactRef;
  /** A lead's full details. Leave out for a customer: only owner and tags change. */
  details?: LeadInput;
  ownerId?: string | null;
  tags?: string[] | string | null;
};

export function updateContactHandler(input: UpdateContactInput): Promise<Saved> {
  return run(async () => {
    const ids = refIds(input.ref);
    const lead = input.details ? parseLeadInput(input.details) : null;
    const { ownerId, tags } = lead ?? parseOwnerAndTags(input);
    const staff = await requireStaff("crm.write");

    // A manager with no contact row yet gets one now (FR-CRM-3).
    const id =
      ids.p_contact_id ??
      (await call<string>("crm_ensure_contact", {
        p_actor: staff.userId,
        p_user_id: ids.p_user_id,
      }));
    const saved = await call<string>("crm_update_contact", {
      p_actor: staff.userId,
      p_contact_id: id,
      p_full_name: lead?.fullName ?? null,
      p_email: lead?.email ?? null,
      p_phone: lead?.phone ?? null,
      p_source: lead?.source ?? null,
      p_owner_id: ownerId,
      p_tags: tags,
    });
    return { ok: true as const, contactId: saved };
  });
}

export function setLeadStageHandler(input: {
  contactId: string;
  stage: LeadStage;
  lostReason?: string | null;
}): Promise<Saved> {
  return run(async () => {
    const id = contactId(input.contactId);
    const { stage, lostReason } = parseLeadStage(input.stage, input.lostReason);
    const staff = await requireStaff("crm.write");
    await call("crm_set_lead_stage", {
      p_actor: staff.userId,
      p_contact_id: id,
      p_stage: stage,
      p_lost_reason: lostReason,
    });
    return { ok: true as const, contactId: id };
  });
}

export function linkContactHandler(input: { contactId: string; userId: string }): Promise<Saved> {
  return run(async () => {
    const id = contactId(input.contactId);
    const userId = contactId(input.userId);
    const staff = await requireStaff("crm.write");
    await call("crm_link_contact", { p_actor: staff.userId, p_contact_id: id, p_user_id: userId });
    return { ok: true as const, contactId: id };
  });
}

export function unlinkContactHandler(input: { contactId: string }): Promise<Saved> {
  return run(async () => {
    const id = contactId(input.contactId);
    const staff = await requireStaff("crm.write");
    await call("crm_unlink_contact", { p_actor: staff.userId, p_contact_id: id });
    return { ok: true as const, contactId: id };
  });
}

export function deleteLeadHandler(input: {
  contactId: string;
}): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    const id = contactId(input.contactId);
    const staff = await requireStaff("crm.write");
    await call("crm_delete_lead", { p_actor: staff.userId, p_contact_id: id });
    return { ok: true as const };
  });
}

export function addActivityHandler(
  input: ActivityInput & { ref: ContactRef },
): Promise<{ ok: true; id: string } | PublicError> {
  return run(async () => {
    const ids = refIds(input.ref);
    const activity = parseActivityInput(input);
    const staff = await requireStaff("crm.write");
    const id = await call<string>("crm_add_activity", {
      p_actor: staff.userId,
      ...ids,
      p_kind: activity.kind,
      p_body: activity.body,
      p_occurred_at: activity.occurredAt,
    });
    return { ok: true as const, id };
  });
}

export function addFollowUpHandler(
  input: FollowUpInput & { ref: ContactRef },
): Promise<{ ok: true; id: string } | PublicError> {
  return run(async () => {
    const ids = refIds(input.ref);
    const followUp = parseFollowUpInput(input);
    const staff = await requireStaff("crm.write");
    const id = await call<string>("crm_add_follow_up", {
      p_actor: staff.userId,
      ...ids,
      p_due_at: followUp.dueAt,
      p_note: followUp.note,
      p_assignee_id: followUp.assigneeId,
    });
    return { ok: true as const, id };
  });
}

export function completeFollowUpHandler(input: {
  followUpId: string;
}): Promise<{ ok: true } | PublicError> {
  return run(async () => {
    if (!isUuid(input.followUpId)) {
      throw new ConsoleError("not_found", "That follow-up doesn't exist.");
    }
    const staff = await requireStaff("crm.write");
    await call("crm_complete_follow_up", {
      p_actor: staff.userId,
      p_follow_up_id: input.followUpId,
    });
    return { ok: true as const };
  });
}
