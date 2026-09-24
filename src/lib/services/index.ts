/**
 * RentID service layer.
 *
 * The UI imports ONLY from here (or the `src/lib/rentid.ts` hooks that wrap it).
 * Today every function reads/writes the mock database in `src/lib/mock/`;
 * when Supabase is reachable each body is replaced with a query and no
 * component changes. See `docs/SUPABASE_INTEGRATION.md`.
 */
export * as auth from "./auth";
export * from "./portfolio";
export * from "./tenancies";
export * from "./finance";
export * from "./operations";
export * from "./marketplace";
export * from "./syndication";
export * from "./management";
export * from "./student";
export * from "./verification";
export { resetDb as resetDemoData } from "@/lib/mock/db";
export { DEMO_ACCOUNTS } from "@/lib/mock/seed";
