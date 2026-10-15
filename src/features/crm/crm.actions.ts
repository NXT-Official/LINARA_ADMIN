import { createServerFn } from "@tanstack/react-start";

import {
  exportContactsHandler,
  findDuplicatesHandler,
  importLeadsHandler,
} from "./crm.data.server";
import {
  crmDashboardHandler,
  getContactHandler,
  linkSuggestionsHandler,
  listContactsHandler,
  type ContactFilters,
  type ListContactsInput,
} from "./crm.handlers.server";
import type { ActivityInput, FollowUpInput, LeadInput } from "./crm.input";
import type { ContactRef, LeadStage } from "./crm.types";
import {
  addActivityHandler,
  addFollowUpHandler,
  completeFollowUpHandler,
  createLeadHandler,
  deleteLeadHandler,
  linkContactHandler,
  setLeadStageHandler,
  unlinkContactHandler,
  updateContactHandler,
  type UpdateContactInput,
} from "./crm.writes.server";

export const listContactsFn = createServerFn({ method: "GET" })
  .validator((d: ListContactsInput) => d)
  .handler(({ data }) => listContactsHandler(data));

export const getContactFn = createServerFn({ method: "GET" })
  .validator((d: ContactRef) => d)
  .handler(({ data }) => getContactHandler(data));

export const linkSuggestionsFn = createServerFn({ method: "GET" })
  .validator((d: { contactId: string }) => d)
  .handler(({ data }) => linkSuggestionsHandler(data));

export const crmDashboardFn = createServerFn({ method: "GET" }).handler(() =>
  crmDashboardHandler(),
);

// ---------------------------------------------------------------- Writes (POST)

export const createLeadFn = createServerFn({ method: "POST" })
  .validator((d: LeadInput) => d)
  .handler(({ data }) => createLeadHandler(data));

export const updateContactFn = createServerFn({ method: "POST" })
  .validator((d: UpdateContactInput) => d)
  .handler(({ data }) => updateContactHandler(data));

export const setLeadStageFn = createServerFn({ method: "POST" })
  .validator((d: { contactId: string; stage: LeadStage; lostReason?: string | null }) => d)
  .handler(({ data }) => setLeadStageHandler(data));

export const linkContactFn = createServerFn({ method: "POST" })
  .validator((d: { contactId: string; userId: string }) => d)
  .handler(({ data }) => linkContactHandler(data));

export const unlinkContactFn = createServerFn({ method: "POST" })
  .validator((d: { contactId: string }) => d)
  .handler(({ data }) => unlinkContactHandler(data));

export const deleteLeadFn = createServerFn({ method: "POST" })
  .validator((d: { contactId: string }) => d)
  .handler(({ data }) => deleteLeadHandler(data));

export const addActivityFn = createServerFn({ method: "POST" })
  .validator((d: ActivityInput & { ref: ContactRef }) => d)
  .handler(({ data }) => addActivityHandler(data));

export const addFollowUpFn = createServerFn({ method: "POST" })
  .validator((d: FollowUpInput & { ref: ContactRef }) => d)
  .handler(({ data }) => addFollowUpHandler(data));

export const completeFollowUpFn = createServerFn({ method: "POST" })
  .validator((d: { followUpId: string }) => d)
  .handler(({ data }) => completeFollowUpHandler(data));

// ---------------------------------------------------------------- Data in and out (POST)

export const findDuplicatesFn = createServerFn({ method: "POST" })
  .validator((d: { emails: string[]; phones: string[] }) => d)
  .handler(({ data }) => findDuplicatesHandler(data));

export const importLeadsFn = createServerFn({ method: "POST" })
  .validator((d: { rows: LeadInput[]; consentBasis: string }) => d)
  .handler(({ data }) => importLeadsHandler(data));

export const exportContactsFn = createServerFn({ method: "POST" })
  .validator((d: { filters: ContactFilters; code: string }) => d)
  .handler(({ data }) => exportContactsHandler(data));
