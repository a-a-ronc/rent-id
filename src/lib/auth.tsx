/**
 * Session context over Supabase Auth (see `src/lib/services/auth.ts`).
 *
 * `useAuth()` exposes { user, roles, loading }. Roles are read from
 * `public.user_roles` and are only a UX hint — every protected read and write
 * is enforced by row-level security on the server.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import * as authService from "@/lib/services/auth";
import type { AppRole, User } from "@/lib/types";

export type { AppRole };

type AuthState = {
  user: User | null;
  roles: AppRole[];
  loading: boolean;
};

const AuthContext = createContext<AuthState>({ user: null, roles: [], loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const snapshot = authService.peekSession();
    return snapshot
      ? { user: snapshot.user, roles: snapshot.roles, loading: false }
      : { user: null, roles: [], loading: true };
  });

  useEffect(() => {
    let active = true;
    void authService.getSession().then((session) => {
      if (!active) return;
      setState({ user: session?.user ?? null, roles: session?.roles ?? [], loading: false });
    });
    const unsubscribe = authService.onAuthStateChange((next) => {
      if (!active) return;
      setState({ user: next?.user ?? null, roles: next?.roles ?? [], loading: false });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => authService.getProfile(user!.id),
  });
}

export function useRoles() {
  const { user, roles } = useAuth();
  return useQuery({
    queryKey: ["roles", user?.id],
    enabled: Boolean(user?.id),
    initialData: roles,
    queryFn: () => authService.getRoles(user!.id),
  });
}

export function usePrimaryRole(): AppRole | null {
  const { roles } = useAuth();
  if (roles.includes("admin")) return "admin";
  if (roles.includes("landlord")) return "landlord";
  if (roles.includes("property_manager")) return "property_manager";
  if (roles.includes("tenant")) return "tenant";
  return null;
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof authService.updateProfile>[1]) =>
      authService.updateProfile(user!.id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["profile"] }),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    await authService.signOut();
    qc.clear();
  };
}

export { authService };
