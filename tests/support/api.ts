import { type APIRequestContext, type APIResponse, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** A unique, human-readable name so tests never collide with each other or with existing data. */
export function uniqueName(prefix = "Team"): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

function headers(cookie: string | undefined): Record<string, string> {
  return { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) };
}

export function getJson(request: APIRequestContext, path: string, cookie?: string): Promise<APIResponse> {
  return request.get(path, { headers: cookie ? { Cookie: cookie } : {} });
}

export function patchJson(request: APIRequestContext, path: string, data: unknown, cookie?: string): Promise<APIResponse> {
  return request.patch(path, { data, headers: headers(cookie) });
}

/** DELETE with the JSON content type the API requires for every state-changing request. */
export function deleteJson(request: APIRequestContext, path: string, cookie?: string): Promise<APIResponse> {
  return request.delete(path, { headers: headers(cookie) });
}

export interface TeamBody {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  ticketCount: number;
  epicCount: number;
}

export interface EpicBody {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  createdAt: string;
  modifiedAt: string;
  ticketCount: number;
}

export async function createTeam(request: APIRequestContext, cookie: string, name = uniqueName()): Promise<TeamBody> {
  const response = await request.post("/api/teams", { data: { name }, headers: headers(cookie) });
  expect(response.status()).toBe(201);
  return (await response.json()) as TeamBody;
}

export async function createEpic(
  request: APIRequestContext,
  cookie: string,
  teamId: string,
  title = uniqueName("Epic"),
  description?: string,
): Promise<EpicBody> {
  const data = description === undefined ? { teamId, title } : { teamId, title, description };
  const response = await request.post("/api/epics", { data, headers: headers(cookie) });
  expect(response.status()).toBe(201);
  return (await response.json()) as EpicBody;
}

export type TicketTypeValue = "bug" | "feature" | "fix";
export type TicketStateValue = "new" | "ready_for_implementation" | "in_progress" | "ready_for_acceptance" | "done";

export const TICKET_STATE_VALUES: TicketStateValue[] = [
  "new",
  "ready_for_implementation",
  "in_progress",
  "ready_for_acceptance",
  "done",
];

export interface TicketBody {
  id: string;
  teamId: string;
  epicId: string | null;
  epic: { id: string; title: string } | null;
  type: TicketTypeValue;
  state: TicketStateValue;
  title: string;
  body: string;
  createdBy: { id: string; email: string };
  createdAt: string;
  modifiedAt: string;
  commentCount: number;
}

export interface CommentBody {
  id: string;
  ticketId: string;
  body: string;
  author: { id: string; email: string };
  createdAt: string;
}

function postJsonWithType(request: APIRequestContext, path: string, data: unknown, cookie?: string): Promise<APIResponse> {
  return request.post(path, { data, headers: headers(cookie) });
}

/** Creates a ticket via the API (201 expected). `fields` overrides the defaults. */
export async function createTicket(
  request: APIRequestContext,
  cookie: string,
  teamId: string,
  fields: Record<string, unknown> = {},
): Promise<TicketBody> {
  const data = { teamId, type: "feature", title: uniqueName("Ticket"), body: "Ticket body", ...fields };
  const response = await postJsonWithType(request, "/api/tickets", data, cookie);
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as TicketBody;
}

/** Adds a comment via the API (201 expected). */
export async function addComment(
  request: APIRequestContext,
  cookie: string,
  ticketId: string,
  body = "A comment",
): Promise<CommentBody> {
  const response = await postJsonWithType(request, `/api/tickets/${ticketId}/comments`, { body }, cookie);
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as CommentBody;
}

/** Waits a little so a later update would get a visibly different timestamp. */
export function tick(ms = 25): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A well-formed UUID that does not belong to any record. */
export const MISSING_ID = "00000000-0000-4000-8000-000000000000";
