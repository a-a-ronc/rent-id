import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  AppShell,
  EmptyState,
  InlineError,
  ListRow,
  LoadingCard,
  PageHeader,
  SectionCard,
  StatusPill,
  TextInput,
  TrustBadge,
} from "@/components/rentid/patterns";
import { daysUntil, money } from "@/lib/format";
import { useActiveOrg, useTenancies } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/tenants/")({
  head: () => ({
    meta: [{ title: "Tenants — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: TenantsPage,
});

type Filter = "all" | "verified" | "pending" | "ended";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "verified", label: "Verified" },
  { key: "pending", label: "Pending" },
  { key: "ended", label: "Ended" },
];

function TenantsPage() {
  const active = useActiveOrg();
  const tenancies = useTenancies(active.orgId);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const all = tenancies.data ?? [];
  const filtered = all
    .filter((t) => {
      if (filter === "verified") return t.verified;
      if (filter === "pending") return t.status === "pending";
      if (filter === "ended") return t.status === "ended";
      return true;
    })
    .filter((t) => {
      if (!q.trim()) return true;
      const haystack = [t.tenant_name, t.property?.name, t.unit?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q.trim().toLowerCase());
    })
    .sort((a, b) => (a.tenant_name ?? "").localeCompare(b.tenant_name ?? ""));

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader
        title="Tenants"
        subtitle={active.org ? `${active.org.name} · ${filtered.length} shown` : undefined}
      />

      <div className="mt-5 space-y-3">
        <TextInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tenants, properties or units…"
          aria-label="Search tenants"
        />

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-4 py-1.5 font-display text-[12px] font-medium transition-colors ${
                filter === f.key ? "bg-brand text-brand-foreground" : "glass text-muted-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {tenancies.isLoading ? (
          <LoadingCard label="Fetching tenancies…" />
        ) : tenancies.isError ? (
          <InlineError
            message={
              tenancies.error instanceof Error ? tenancies.error.message : "Could not load tenants."
            }
            onRetry={() => tenancies.refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={all.length === 0 ? "No tenants yet" : "No matches"}
            description={
              all.length === 0
                ? "Invite a tenant from a unit page — once they accept, the tenancy becomes verified."
                : "Try a different search or filter."
            }
          />
        ) : (
          <SectionCard title="All tenancies" aside={`${filtered.length} total`}>
            {filtered.map((t) => {
              const end = t.end_date ? daysUntil(t.end_date) : null;
              return (
                <ListRow
                  key={t.id}
                  onClick={undefined}
                  title={t.tenant_name ?? "Tenant"}
                  subtitle={[
                    t.property?.name ?? "",
                    t.unit?.name ?? "",
                    t.monthly_rent != null ? `${money(Number(t.monthly_rent))}/mo` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  pill={
                    t.verified ? (
                      <TrustBadge kind="verified_tenancy" />
                    ) : (
                      <StatusPill
                        status={t.status === "pending" ? "Invitation sent" : t.status}
                        tone={t.status === "ended" ? "neutral" : "warning"}
                      />
                    )
                  }
                  value={
                    <Link
                      to="/tenants/$tenancyId"
                      params={{ tenancyId: t.id }}
                      className="text-[12.5px] font-medium text-brand"
                    >
                      {end != null && end >= 0 && end <= 60 ? `${end}d left · Manage` : "Manage"}
                    </Link>
                  }
                />
              );
            })}
          </SectionCard>
        )}
      </div>
    </AppShell>
  );
}
