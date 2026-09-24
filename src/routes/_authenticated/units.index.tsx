import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";

import {
  AppShell,
  DataTable,
  EmptyState,
  InlineError,
  LoadingCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@/components/rentid/patterns";
import { money } from "@/lib/format";
import { useActiveOrg, useProperties, useTenancies, useUnits } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/units/")({
  head: () => ({
    meta: [{ title: "Units — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: UnitsPage,
});

function UnitsPage() {
  const active = useActiveOrg();
  const units = useUnits(null, active.orgId);
  const properties = useProperties(active.orgId);
  const tenancies = useTenancies(active.orgId);

  const loading = units.isLoading || properties.isLoading || tenancies.isLoading;
  const isError = units.isError || properties.isError || tenancies.isError;

  const propertyById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof properties.data>[number]>();
    for (const p of properties.data ?? []) map.set(p.id, p);
    return map;
  }, [properties.data]);

  const tenantByUnit = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tenancies.data ?? []) {
      if (t.status !== "cancelled" && t.status !== "ended") map.set(t.unit_id, t.tenant_name);
    }
    return map;
  }, [tenancies.data]);

  const rows = (units.data ?? []).slice().sort((a, b) => {
    const pa = propertyById.get(a.property_id)?.name ?? "";
    const pb = propertyById.get(b.property_id)?.name ?? "";
    return pa.localeCompare(pb) || a.name.localeCompare(b.name);
  });

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader
        title="Units"
        subtitle={
          active.org ? `${active.org.name} · ${rows.length} units portfolio-wide` : undefined
        }
      />

      <div className="mt-5">
        {isError ? (
          <InlineError message="Couldn't load units." onRetry={() => void units.refetch()} />
        ) : loading ? (
          <LoadingCard label="Loading units…" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No units yet"
            description="Add a property and units to see your portfolio here."
            action={
              <Link
                to="/properties"
                className="rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-brand-foreground"
              >
                Go to properties
              </Link>
            }
          />
        ) : (
          <SectionCard title="All units" aside={`${rows.length} total`}>
            <DataTable
              rows={rows}
              columns={[
                {
                  key: "unit",
                  header: "Unit",
                  cell: (u) => (
                    <Link
                      to="/properties/$propertyId"
                      params={{ propertyId: u.property_id }}
                      className="font-medium text-brand"
                    >
                      {u.name}
                    </Link>
                  ),
                },
                {
                  key: "property",
                  header: "Property",
                  cell: (u) => propertyById.get(u.property_id)?.name ?? "—",
                },
                {
                  key: "rent",
                  header: "Rent",
                  cell: (u) =>
                    u.monthly_rent != null ? `${money(Number(u.monthly_rent))}/mo` : "—",
                },
                {
                  key: "tenant",
                  header: "Tenant",
                  cell: (u) => tenantByUnit.get(u.id) ?? "—",
                  hideOnMobile: true,
                },
                {
                  key: "status",
                  header: "Status",
                  align: "right",
                  cell: (u) => (
                    <StatusPill
                      status={u.occupancy_status === "occupied" ? "Occupied" : "Vacant"}
                      tone={u.occupancy_status === "occupied" ? "success" : "neutral"}
                    />
                  ),
                },
              ]}
            />
          </SectionCard>
        )}
      </div>
    </AppShell>
  );
}
