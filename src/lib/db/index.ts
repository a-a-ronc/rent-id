/**
 * Thin access layer over the Supabase browser client.
 *
 * Every read/write from the service layer goes through `db` (RLS-scoped to the
 * signed-in user) and `unwrap()` so PostgREST errors become one `DbError`
 * type with a human-readable message. Privileged operations are Postgres RPCs
 * (SECURITY DEFINER functions defined in supabase/migrations) or server
 * functions using the service-role client — never the browser client.
 */
import type { PostgrestError, PostgrestSingleResponse } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { AppRole, UUID } from "@/lib/types";

export const db = supabase;

export class DbError extends Error {
  readonly code: string | null;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(
    error: PostgrestError | { message: string; code?: string; details?: string; hint?: string },
  ) {
    super(humanizeDbError(error));
    this.name = "DbError";
    this.code = error.code ?? null;
    this.details = error.details ?? null;
    this.hint = error.hint ?? null;
  }
}

export class NotFoundError extends Error {
  constructor(what = "Record") {
    super(`${what} not found.`);
    this.name = "NotFoundError";
  }
}

/** Map Postgres/PostgREST error codes to copy the UI can show verbatim. */
export function humanizeDbError(error: {
  message: string;
  code?: string;
  details?: string;
}): string {
  switch (error.code) {
    case "42501":
      return error.message.startsWith("new row violates row-level security") ||
        error.message.includes("permission denied")
        ? "You don't have permission to do that."
        : error.message;
    case "23505":
      return "That record already exists.";
    case "23503":
      return "That record is linked to something that no longer exists.";
    case "23514":
      return "One of the values is out of range.";
    case "54000":
      return "Too many attempts — please wait a bit and try again.";
    case "PGRST116":
      return "Record not found.";
    case "P0002":
      return "Record not found.";
    case "22023":
      return error.message;
    default:
      return error.message || "Something went wrong talking to the database.";
  }
}

type Result<T> = { data: T | null; error: PostgrestError | null };

/** Throw on error; return data (which may legitimately be an empty array). */
export function unwrap<T>(result: Result<T>): T {
  if (result.error) throw new DbError(result.error);
  return result.data as T;
}

/** Throw on error and on missing row. */
export function unwrapOne<T>(result: PostgrestSingleResponse<T> | Result<T>, what?: string): T {
  if (result.error) {
    if (result.error.code === "PGRST116") throw new NotFoundError(what);
    throw new DbError(result.error);
  }
  if (result.data === null || result.data === undefined) throw new NotFoundError(what);
  return result.data;
}

/** Throw on error; null when the row is absent (maybeSingle semantics). */
export function unwrapMaybe<T>(result: Result<T>): T | null {
  if (result.error) {
    if (result.error.code === "PGRST116") return null;
    throw new DbError(result.error);
  }
  return result.data;
}

let cachedUserId: UUID | null = null;
db.auth.onAuthStateChange((_event, session) => {
  cachedUserId = session?.user.id ?? null;
});

/** Current user id from the local session (no network). */
export async function currentUserId(): Promise<UUID | null> {
  if (cachedUserId) return cachedUserId;
  const { data } = await db.auth.getSession();
  cachedUserId = data.session?.user.id ?? null;
  return cachedUserId;
}

/**
 * Best-effort client-side audit trail. RLS only accepts rows where
 * actor_id = auth.uid(); the row is append-only once written. Server-side
 * RPCs write their own audit rows, so call this only for plain table writes.
 */
export async function logAudit(entry: {
  organization_id?: UUID | null;
  actor_role?: AppRole | null;
  action: string;
  entity_type: string;
  entity_id?: UUID | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const actor = await currentUserId();
  if (!actor) return;
  const { error } = await db.from("audit_logs").insert({
    actor_id: actor,
    actor_role: entry.actor_role ?? null,
    organization_id: entry.organization_id ?? null,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id ?? null,
    metadata: (entry.metadata ?? {}) as never,
  });
  if (error && import.meta.env.DEV) console.warn("[audit] not recorded:", error.message);
}

export function nowIso() {
  return new Date().toISOString();
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Group rows by a key, preserving insertion order. */
export function groupBy<T, K extends string | number | null | undefined>(
  rows: T[],
  key: (row: T) => K,
) {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export function indexBy<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((r) => [r.id, r] as const));
}
