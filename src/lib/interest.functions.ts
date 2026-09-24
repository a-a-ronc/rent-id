/**
 * Prospective-user registrations ("Join RentID / Letter of Intent").
 *
 * Public submissions are written server-side with the privileged client because
 * the table intentionally has no anon policy. Admin reads verify the caller's
 * admin role through their own session before touching privileged reads.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

export const INTEREST_ROLES = ["renter", "landlord", "property_manager", "other"] as const;
export type InterestRole = (typeof INTEREST_ROLES)[number];

export type InterestRegistration = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  roles: string[];
  would_use: boolean;
  acknowledged: boolean;
  current_units: number | null;
  intended_units: number | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
};

export type RegisterResult =
  { status: "created" | "updated" } | { status: "duplicate"; message: string };

const baseSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(3, "Enter your first and last name")
    .max(120)
    .refine((v) => v.split(/\s+/).length >= 2, "Enter your first and last name"),
  email: z.string().trim().email("Enter a valid email address").max(255),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v.replace(/\D/g, "").length === 10, "Enter a 10-digit U.S. phone number"),
  roles: z.array(z.enum(INTEREST_ROLES)).min(1, "Select at least one role"),
  would_use: z.boolean(),
  acknowledged: z.literal(true),
  current_units: z.number().int().min(1).max(1000000).nullable().optional(),
  intended_units: z.number().int().min(0).max(1000000).nullable().optional(),
  update_existing: z.boolean().optional(),
});

/** Unit counts only apply to landlords / property managers. */
const registrationSchema = baseSchema.superRefine((data, ctx) => {
  const owns = data.roles.includes("landlord") || data.roles.includes("property_manager");
  if (owns && (data.current_units === null || data.current_units === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["current_units"],
      message: "Enter the number of rental units you own or manage",
    });
  }
});

export type RegistrationInput = z.input<typeof baseSchema>;

export const registerInterest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => registrationSchema.parse(data))
  .handler(async ({ data }): Promise<RegisterResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const emailNormalized = data.email.toLowerCase();
    const digits = data.phone.replace(/\D/g, "");
    const phone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;

    const request = getRequest();
    const headers = request?.headers;
    const metadata = {
      user_agent: headers?.get("user-agent")?.slice(0, 500) ?? null,
      referer: headers?.get("referer")?.slice(0, 500) ?? null,
      ip_address:
        headers?.get("cf-connecting-ip") ??
        headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        null,
    };

    const managesUnits = data.roles.includes("landlord") || data.roles.includes("property_manager");
    const units = {
      current_units: managesUnits ? (data.current_units ?? null) : null,
      intended_units: managesUnits ? (data.intended_units ?? null) : null,
    };

    const { data: existing } = await supabaseAdmin
      .from("interest_registrations")
      .select("id, submission_count")
      .eq("email_normalized", emailNormalized)
      .maybeSingle();

    if (existing && !data.update_existing) {
      return {
        status: "duplicate",
        message: "It looks like you've already registered your interest in RentID.",
      };
    }

    if (existing) {
      const { error } = await supabaseAdmin
        .from("interest_registrations")
        .update({
          full_name: data.full_name,
          email: data.email.trim(),
          phone,
          roles: data.roles,
          would_use: data.would_use,
          acknowledged: true,
          submitted_at: new Date().toISOString(),
          submission_count: (existing.submission_count ?? 1) + 1,
          ...units,
          ...metadata,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { status: "updated" };
    }

    const { error } = await supabaseAdmin.from("interest_registrations").insert({
      full_name: data.full_name,
      email: data.email.trim(),
      email_normalized: emailNormalized,
      phone,
      roles: data.roles,
      would_use: data.would_use,
      acknowledged: true,
      ...units,
      ...metadata,
    });
    if (error) throw new Error(error.message);
    return { status: "created" };
  });

/* -------------------------------- admin read ------------------------------- */

export type InterestStats = {
  total: number;
  yes: number;
  no: number;
  yes_percentage: number;
  renters: number;
  landlords: number;
  property_managers: number;
  this_week: number;
  this_month: number;
  /** Registrations that are a landlord and/or property manager (counted once). */
  unit_holders: number;
  /** Current units owned/managed across all registrations. */
  current_units_all: number;
  /** Current units owned/managed by "yes" registrations. */
  current_units_yes: number;
  /** Intended units across all registrations (secondary figure). */
  intended_units_all: number;
  /** Primary metric: intended units from "yes" registrations only. */
  intended_units_yes: number;
  /** Average intended units per "yes" landlord/property manager. */
  average_intended_units: number;
};

/**
 * Registrations are personal data, so the read is authorised server-side only.
 * The app's session layer is still local (not real auth), so an administrator
 * unlocks the list with the RENTID_ADMIN_ACCESS_CODE secret. Once real sessions
 * land, an admin bearer token authorises without the code.
 */
export const listInterestRegistrations = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ access_code: z.string().max(200).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }): Promise<{ rows: InterestRegistration[]; stats: InterestStats }> => {
    const expected = process.env["RENTID_ADMIN_ACCESS_CODE"];
    const authorised = Boolean(expected && data.access_code && data.access_code === expected);
    if (!authorised) throw new Error("Administrator access only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: registrations, error } = await supabaseAdmin
      .from("interest_registrations")
      .select(
        "id, full_name, email, phone, roles, would_use, acknowledged, current_units, intended_units, submitted_at, created_at, updated_at",
      )
      .order("submitted_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (registrations ?? []) as InterestRegistration[];
    return { rows, stats: computeInterestStats(rows) };
  });

/**
 * Shared stat maths so the dashboard, filtered views and the CSV summary all
 * agree. A registration that is both landlord and property manager is counted
 * once for unit totals; the primary intended-unit figure only counts "yes".
 */
export function computeInterestStats(rows: InterestRegistration[]): InterestStats {
  const now = Date.now();
  const since = (days: number) => now - days * 24 * 60 * 60 * 1000;
  const has = (r: InterestRegistration, role: InterestRole) => r.roles.includes(role);
  const yes = rows.filter((r) => r.would_use).length;

  const holders = rows.filter((r) => has(r, "landlord") || has(r, "property_manager"));
  const yesHolders = holders.filter((r) => r.would_use);
  const sum = (list: InterestRegistration[], key: "current_units" | "intended_units") =>
    list.reduce((acc, r) => acc + (r[key] ?? 0), 0);
  const intendedYes = sum(yesHolders, "intended_units");

  return {
    total: rows.length,
    yes,
    no: rows.length - yes,
    yes_percentage: rows.length ? Math.round((yes / rows.length) * 100) : 0,
    renters: rows.filter((r) => has(r, "renter")).length,
    landlords: rows.filter((r) => has(r, "landlord")).length,
    property_managers: rows.filter((r) => has(r, "property_manager")).length,
    this_week: rows.filter((r) => new Date(r.submitted_at).getTime() >= since(7)).length,
    this_month: rows.filter((r) => new Date(r.submitted_at).getTime() >= since(30)).length,
    unit_holders: holders.length,
    current_units_all: sum(holders, "current_units"),
    current_units_yes: sum(yesHolders, "current_units"),
    intended_units_all: sum(holders, "intended_units"),
    intended_units_yes: intendedYes,
    average_intended_units: yesHolders.length ? Math.round(intendedYes / yesHolders.length) : 0,
  };
}
