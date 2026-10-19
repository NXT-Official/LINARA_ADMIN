import { createServerFn } from "@tanstack/react-start";

import {
  addNoteHandler,
  assignHandler,
  createTicketHandler,
  getTicketHandler,
  listTicketsHandler,
  markTicketReadHandler,
  replyToTicketHandler,
  setLinksHandler,
  setPriorityHandler,
  setStatusHandler,
  supportCountsHandler,
  type ListTicketsInput,
} from "./support.handlers.server";
import type { TicketInput } from "./support.input";
import type { TicketPriority, TicketStatus } from "./support.types";

export const listTicketsFn = createServerFn({ method: "GET" })
  .validator((d: ListTicketsInput) => d)
  .handler(({ data }) => listTicketsHandler(data));

export const getTicketFn = createServerFn({ method: "GET" })
  .validator((d: { ticketId: string }) => d)
  .handler(({ data }) => getTicketHandler(data));

export const supportCountsFn = createServerFn({ method: "GET" }).handler(() =>
  supportCountsHandler(),
);

export const createTicketFn = createServerFn({ method: "POST" })
  .validator((d: TicketInput) => d)
  .handler(({ data }) => createTicketHandler(data));

export const setStatusFn = createServerFn({ method: "POST" })
  .validator((d: { ticketId: string; status: TicketStatus }) => d)
  .handler(({ data }) => setStatusHandler(data));

export const assignFn = createServerFn({ method: "POST" })
  .validator((d: { ticketId: string; assigneeId: string | null }) => d)
  .handler(({ data }) => assignHandler(data));

export const setPriorityFn = createServerFn({ method: "POST" })
  .validator((d: { ticketId: string; priority: TicketPriority }) => d)
  .handler(({ data }) => setPriorityHandler(data));

export const setLinksFn = createServerFn({ method: "POST" })
  .validator(
    (d: {
      ticketId: string;
      userId: string | null;
      householdId: string | null;
      contactId: string | null;
    }) => d,
  )
  .handler(({ data }) => setLinksHandler(data));

export const addNoteFn = createServerFn({ method: "POST" })
  .validator((d: { ticketId: string; body: string }) => d)
  .handler(({ data }) => addNoteHandler(data));

export const replyToTicketFn = createServerFn({ method: "POST" })
  .validator((d: { ticketId: string; body: string }) => d)
  .handler(({ data }) => replyToTicketHandler(data));

export const markTicketReadFn = createServerFn({ method: "POST" })
  .validator((d: { ticketId: string }) => d)
  .handler(({ data }) => markTicketReadHandler(data));
