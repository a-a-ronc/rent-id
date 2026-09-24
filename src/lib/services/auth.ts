/**
 * Authentication — Supabase Auth.
 *
 * Passwords are hashed by GoTrue (bcrypt); this module never sees or stores
 * them. Roles come from `public.user_roles` (RLS: own rows), which only the
 * signup trigger and platform RPCs can write. The public surface (session,
 * signIn, signUp, signOut, onAuthStateChange, profile, roles) is what
 * `src/lib/auth.tsx` exposes to the UI.
 */
import type { Session as SupabaseSession, User as SupabaseUser } from "@supabase/supabase-js";

import { db, DbError, unwrap, unwrapMaybe, unwrapOne } from "@/lib/db";
import { toProfile } from "@/lib/db/mappers";
import type { TablesUpdate } from "@/integrations/supabase/types";
import type { AppRole, Profile, User, UUID } from "@/lib/types";

export type AppSession = { user: User; roles: AppRole[]; accessToken: string };

/** Sign-up result. `session` is null when the project requires email confirmation. */
export type SignUpResult = { session: AppSession | null; needsEmailConfirmation: boolean };

const SIGNUP_ROLES: AppRole[] = ["landlord", "tenant", "property_manager"];

let current: AppSession | null = null;
let hydrated: Promise<void> | null = null;
const listeners = new Set<(s: AppSession | null) => void>();

function toUser(u: SupabaseUser): User {
  return {
    id: u.id,
    email: u.email ?? "",
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
  };
}

async function loadRoles(userId: UUID): Promise<AppRole[]> {
  const rows = unwrap(await db.from("user_roles").select("role").eq("user_id", userId));
  return rows.map((r) => r.role);
}

async function buildSession(s: SupabaseSession | null): Promise<AppSession | null> {
  if (!s) return null;
  const roles = await loadRoles(s.user.id).catch(() => [] as AppRole[]);
  return { user: toUser(s.user), roles, accessToken: s.access_token };
}

function emit() {
  listeners.forEach((l) => l(current));
}

/** Resolve the persisted session once; later changes arrive via onAuthStateChange. */
function hydrate(): Promise<void> {
  if (hydrated) return hydrated;
  hydrated = (async () => {
    if (typeof window === "undefined") return;
    const { data } = await db.auth.getSession();
    current = await buildSession(data.session);
    db.auth.onAuthStateChange((event, session) => {
      void (async () => {
        if (event === "SIGNED_OUT") {
          current = null;
        } else if (session) {
          // keep roles if the user is unchanged and this is just a token refresh
          if (event === "TOKEN_REFRESHED" && current?.user.id === session.user.id) {
            current = { ...current, accessToken: session.access_token };
          } else {
            current = await buildSession(session);
          }
        }
        emit();
      })();
    });
  })();
  return hydrated;
}

export async function getSession(): Promise<AppSession | null> {
  await hydrate();
  return current;
}

/** Synchronous snapshot for render paths; may be null before hydration completes. */
export function peekSession(): AppSession | null {
  return current;
}

export function onAuthStateChange(listener: (s: AppSession | null) => void) {
  listeners.add(listener);
  void hydrate();
  return () => {
    listeners.delete(listener);
  };
}

export async function signIn(email: string, password: string): Promise<AppSession> {
  const { data, error } = await db.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(friendlyAuthError(error.message));
  current = await buildSession(data.session);
  emit();
  if (!current) throw new Error("Sign in failed.");
  return current;
}

export async function signUp(input: {
  email: string;
  password: string;
  fullName: string;
  role: AppRole;
  phone?: string | null;
}): Promise<SignUpResult> {
  if (!SIGNUP_ROLES.includes(input.role)) throw new Error("That role cannot be self-assigned.");
  if (input.password.length < 12) throw new Error("Use at least 12 characters for your password.");
  const { data, error } = await db.auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      // consumed by public.handle_new_user() → profile + role (never admin)
      data: { full_name: input.fullName.trim(), role: input.role, phone: input.phone ?? null },
      ...(typeof window !== "undefined"
        ? { emailRedirectTo: `${window.location.origin}/auth` }
        : {}),
    },
  });
  if (error) throw new Error(friendlyAuthError(error.message));
  if (!data.session) return { session: null, needsEmailConfirmation: true };
  current = await buildSession(data.session);
  emit();
  return { session: current, needsEmailConfirmation: false };
}

export async function signOut() {
  await db.auth.signOut();
  current = null;
  emit();
  return true;
}

export async function requestPasswordReset(email: string) {
  const { error } = await db.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    typeof window !== "undefined" ? { redirectTo: `${window.location.origin}/auth?reset=1` } : {},
  );
  if (error) throw new Error(friendlyAuthError(error.message));
  return true;
}

export async function updatePassword(newPassword: string) {
  if (newPassword.length < 12) throw new Error("Use at least 12 characters for your password.");
  const { error } = await db.auth.updateUser({ password: newPassword });
  if (error) throw new Error(friendlyAuthError(error.message));
  return true;
}

export async function getProfile(userId: UUID): Promise<Profile | null> {
  const row = unwrapMaybe(await db.from("profiles").select("*").eq("id", userId).maybeSingle());
  return row ? toProfile(row) : null;
}

export async function updateProfile(
  userId: UUID,
  patch: Partial<Pick<Profile, "full_name" | "phone" | "onboarded" | "avatar_url">>,
): Promise<Profile> {
  const update: TablesUpdate<"profiles"> = {};
  if (patch.full_name !== undefined) update.full_name = patch.full_name;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.avatar_url !== undefined) update.avatar_url = patch.avatar_url;
  if (patch.onboarded !== undefined) update.onboarding_completed = patch.onboarded;
  const row = unwrapOne(
    await db.from("profiles").update(update).eq("id", userId).select("*").single(),
    "Profile",
  );
  return toProfile(row);
}

export async function getRoles(userId: UUID): Promise<AppRole[]> {
  return loadRoles(userId);
}

/**
 * Roles are granted by the database (signup trigger, accept_invitation,
 * create_organization). A user may add tenant/landlord/PM to their own account;
 * admin is never grantable from the client (RLS rejects it).
 */
export async function addRole(userId: UUID, role: AppRole) {
  if (!SIGNUP_ROLES.includes(role)) throw new Error("That role cannot be self-assigned.");
  const { error } = await db.from("user_roles").insert({ user_id: userId, role });
  if (error && error.code !== "23505") throw new DbError(error);
  if (current?.user.id === userId) {
    current = { ...current, roles: await loadRoles(userId) };
    emit();
  }
  return true;
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Incorrect email or password.";
  if (m.includes("email not confirmed"))
    return "Confirm your email address first — check your inbox.";
  if (m.includes("already registered")) return "An account with that email already exists.";
  if (m.includes("rate limit")) return "Too many attempts — please wait a minute and try again.";
  if (m.includes("password")) return message;
  return message;
}
